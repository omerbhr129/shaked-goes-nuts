import { useEffect, useState, useSyncExternalStore } from "react";
import type { ClientView } from "../shared/types";

export type Role = "player" | "tv" | "admin";
export type ConnStatus = "connecting" | "online" | "offline";

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function lsSet(key: string, v: string | null) {
  try {
    if (v === null) localStorage.removeItem(key);
    else localStorage.setItem(key, v);
  } catch {
    /* storage blocked (private mode) — the session just won't persist */
  }
}

export const creds = {
  get token() {
    return lsGet("sgn.token");
  },
  set token(v: string | null) {
    lsSet("sgn.token", v);
  },
  get key() {
    return lsGet("sgn.key");
  },
  set key(v: string | null) {
    lsSet("sgn.key", v);
  },
};

interface Snapshot {
  view: ClientView | null;
  status: ConnStatus;
}

/** Things that happen and are gone: emojis flying at the TV. */
export type Fx = { kind: "emoji"; e: string; by: string } | { kind: "sound"; id: string };

/**
 * One live connection per screen. State arrives over a WebSocket; actions go over HTTP so a
 * half-dead socket (phone just woke up) can never swallow a bet. If the socket is down we poll.
 */
export class Game {
  offset = 0;
  private snap: Snapshot = { view: null, status: "connecting" };
  private ws: WebSocket | null = null;
  private sid: string | null = null;
  private subs = new Set<() => void>();
  private fxSubs = new Set<(fx: Fx) => void>();
  private retries = 0;
  private lastSeen = 0;
  private reconnectTimer = 0;

  constructor(readonly role: Role) {
    this.connect();
    window.setInterval(() => this.heartbeat(), 10_000);
    window.setInterval(() => {
      if (this.snap.status !== "online") void this.refresh();
    }, 4_000);
    const wake = () => {
      if (document.visibilityState === "visible") this.ensureFresh();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", () => this.ensureFresh());
    window.addEventListener("pageshow", () => this.ensureFresh());
  }

  get view() {
    return this.snap.view;
  }

  subscribe = (fn: () => void) => {
    this.subs.add(fn);
    return () => {
      this.subs.delete(fn);
    };
  };
  getSnapshot = () => this.snap;

  onFx(fn: (fx: Fx) => void) {
    this.fxSubs.add(fn);
    return () => {
      this.fxSubs.delete(fn);
    };
  }

  private set(patch: Partial<Snapshot>) {
    this.snap = { ...this.snap, ...patch };
    this.subs.forEach((f) => f());
  }

  private auth() {
    if (this.role === "player") return { token: creds.token };
    if (this.role === "admin") return { key: creds.key };
    return {};
  }

  private headers(extra?: Record<string, string>) {
    const h: Record<string, string> = { ...extra };
    if (this.role === "player" && creds.token) h["x-token"] = creds.token;
    if (this.role === "admin" && creds.key) h["x-key"] = creds.key;
    if (this.sid) h["x-sid"] = this.sid;
    return h;
  }

  private apply(view: ClientView) {
    const cur = this.snap.view;
    if (cur && view.pub.v < cur.pub.v) return;
    this.offset = view.pub.now - Date.now();
    this.set({ view });
  }

  connect() {
    window.clearTimeout(this.reconnectTimer);
    const old = this.ws;
    this.ws = null;
    if (old) {
      old.onclose = old.onmessage = old.onerror = old.onopen = null;
      try {
        old.close();
      } catch {
        /* ignore */
      }
    }
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.lastSeen = Date.now();
      ws.send(JSON.stringify({ t: "hello", ...this.auth() }));
    };
    ws.onmessage = (ev) => {
      this.lastSeen = Date.now();
      if (ev.data === "pong") return;
      let m: { t?: string; sid?: string; d?: ClientView };
      try {
        m = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (m.t === "fx" && m.d) {
        const fx = m.d as unknown as Fx;
        this.fxSubs.forEach((f) => f(fx));
        return;
      }
      if (m.t === "s" && m.d) {
        if (m.sid) this.sid = m.sid;
        this.retries = 0;
        this.apply(m.d);
        if (this.snap.status !== "online") this.set({ status: "online" });
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.set({ status: "offline" });
      this.scheduleReconnect();
    };
    ws.onerror = () => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    };
  }

  private scheduleReconnect() {
    window.clearTimeout(this.reconnectTimer);
    const delay = Math.min(5000, 400 * 2 ** this.retries++);
    this.reconnectTimer = window.setTimeout(() => this.connect(), delay);
  }

  /** Re-identify the socket after the stored credentials changed. */
  rehello() {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ t: "hello", ...this.auth() }));
    else this.connect();
  }

  private heartbeat() {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (Date.now() - this.lastSeen > 25_000) {
      this.connect();
      return;
    }
    try {
      ws.send("ping");
    } catch {
      /* ignore */
    }
  }

  private ensureFresh() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || Date.now() - this.lastSeen > 12_000) {
      this.retries = 0;
      this.connect();
    }
    void this.refresh();
  }

  async refresh() {
    try {
      const res = await fetch("/api/view", { headers: this.headers(), cache: "no-store" });
      if (res.ok) this.apply(await res.json());
    } catch {
      /* offline; the poller will try again */
    }
  }

  async act<T = unknown>(a: string, p: Record<string, unknown> = {}): Promise<T> {
    let res: Response;
    try {
      res = await fetch("/api/act", {
        method: "POST",
        headers: this.headers({ "content-type": "application/json" }),
        body: JSON.stringify({ a, p }),
      });
    } catch {
      throw new Error("אין חיבור לשרת. בדקו את האינטרנט ונסו שוב.");
    }
    let data: { ok: boolean; err?: string; r?: T; d?: ClientView };
    try {
      data = await res.json();
    } catch {
      throw new Error("השרת לא ענה. נסו שוב.");
    }
    if (!data.ok) throw new Error(data.err || "משהו השתבש. נסו שוב.");
    if (data.d) this.apply(data.d);
    return data.r as T;
  }

  async upload(blob: Blob): Promise<string> {
    let res: Response;
    try {
      res = await fetch("/api/upload", {
        method: "POST",
        headers: this.headers({ "content-type": blob.type || "image/jpeg" }),
        body: blob,
      });
    } catch {
      throw new Error("ההעלאה נכשלה. בדקו את האינטרנט ונסו שוב.");
    }
    const data = (await res.json().catch(() => ({ ok: false }))) as { ok: boolean; url?: string; err?: string };
    if (!data.ok || !data.url) throw new Error(data.err || "ההעלאה נכשלה");
    return data.url;
  }
}

const games = new Map<Role, Game>();
export function getGame(role: Role) {
  let g = games.get(role);
  if (!g) {
    g = new Game(role);
    games.set(role, g);
  }
  return g;
}

export function useGame(role: Role) {
  const game = getGame(role);
  const snap = useSyncExternalStore(game.subscribe, game.getSnapshot);
  return { game, view: snap.view, status: snap.status };
}

/** Server-synced clock that re-renders while `active`. */
export function useServerNow(game: Game, active = true, tickMs = 250) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setTick((t) => t + 1), tickMs);
    return () => window.clearInterval(id);
  }, [active, tickMs]);
  return Date.now() + game.offset;
}
