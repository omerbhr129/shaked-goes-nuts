import { DurableObject } from "cloudflare:workers";
import type { GameState, ID } from "../shared/types";
import type { Env } from "./env";
import { REACTIONS, RULES, SOUNDS } from "../shared/catalog";
import { GameError, dispatch, newId, nextDue, normalize, tick } from "./logic";
import { seedState } from "./seed";
import { buildPublic, viewFor } from "./views";

/** Per-socket identity, kept on the socket so it survives hibernation. */
interface Att {
  sid: string;
  token: string | null;
  key: string | null;
}

const PARTS = ["players", "rounds", "bets", "missions", "ledger"] as const;
const IMG_CHUNK = 96 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm", "video/3gpp", "video/x-m4v"];
const MAX_IMAGE = 2_500_000;
const MAX_VIDEO = 40_000_000;
/** the most one piece of a video can be */
const RANGE_MAX = 4 * 1024 * 1024;

const VOICE =
  "Speak natural Israeli Hebrew like a loud, cocky Israeli street guy (an ars) hosting a wild bachelor party: rough, slangy, high energy, sarcastic, with great comedic timing. Read exactly what is written, swear words included. Never translate or soften anything.";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

/**
 * The whole party lives in this one Durable Object: a single-threaded owner of the game state,
 * so bets and payouts can never race. Each socket gets a view filtered to what its owner may see.
 */
export class GameRoom extends DurableObject<Env> {
  private s!: GameState;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    ctx.blockConcurrencyWhile(async () => {
      this.s = normalize((await this.load()) ?? seedState(Date.now()));
    });
  }

  /* ---------- persistence: state split across keys to stay far below value-size limits ---------- */

  private async load(): Promise<GameState | null> {
    const m = await this.ctx.storage.get(["s:meta", ...PARTS.map((k) => `s:${k}`)]);
    const meta = m.get("s:meta") as Omit<GameState, (typeof PARTS)[number]> | undefined;
    if (!meta) return null;
    const s = { ...meta } as GameState;
    for (const k of PARTS) (s as any)[k] = m.get(`s:${k}`) ?? [];
    return s;
  }

  private async save() {
    const { players, rounds, bets, missions, ledger, ...meta } = this.s;
    await this.ctx.storage.put({
      "s:meta": meta,
      "s:players": players,
      "s:rounds": rounds,
      "s:bets": bets,
      "s:missions": missions,
      "s:ledger": ledger,
    });
  }

  /* ---------- identity ---------- */

  private isAdmin(key: string | null | undefined) {
    return !!key && !!this.env.ADMIN_KEY && key === this.env.ADMIN_KEY;
  }

  private playerId(token: string | null | undefined): ID | null {
    return token ? this.s.players.find((p) => p.token === token)?.id ?? null : null;
  }

  private sockets(except?: WebSocket) {
    const out: { ws: WebSocket; att: Att }[] = [];
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except || ws.readyState !== 1) continue;
      const att = ws.deserializeAttachment() as Att | null;
      if (att) out.push({ ws, att });
    }
    return out;
  }

  private online(except?: WebSocket) {
    const set = new Set<ID>();
    for (const { att } of this.sockets(except)) {
      const pid = this.playerId(att.token);
      if (pid) set.add(pid);
    }
    return set;
  }

  private view(token: string | null, key: string | null) {
    const pub = buildPublic(this.s, Date.now(), this.online());
    return viewFor(this.s, pub, this.playerId(token), this.isAdmin(key));
  }

  private broadcast(except?: WebSocket) {
    const pub = buildPublic(this.s, Date.now(), this.online(except));
    for (const { ws, att } of this.sockets(except)) {
      try {
        const v = viewFor(this.s, pub, this.playerId(att.token), this.isAdmin(att.key));
        ws.send(JSON.stringify({ t: "s", d: v }));
      } catch {
        /* socket went away mid-send */
      }
    }
  }

  /* ---------- HTTP ---------- */

  async fetch(req: Request): Promise<Response> {
    const path = new URL(req.url).pathname;
    try {
      if (path === "/ws") return this.upgrade(req);
      if (path === "/api/view") return json(this.view(req.headers.get("x-token"), req.headers.get("x-key")));
      if (path === "/api/act" && req.method === "POST") return await this.act(req);
      if (path === "/api/upload" && req.method === "POST") return await this.upload(req);
      if (path === "/api/tts" && req.method === "POST") return await this.tts(req);
      if (path.startsWith("/media/")) return await this.media(path.slice("/media/".length), req);
    } catch (e) {
      console.error("request failed", path, e);
      return json({ ok: false, err: "שגיאה בשרת. נסו שוב." }, 500);
    }
    return json({ ok: false, err: "not found" }, 404);
  }

  private upgrade(req: Request) {
    if (req.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("Expected WebSocket", { status: 426 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  private async act(req: Request) {
    const token = req.headers.get("x-token");
    const key = req.headers.get("x-key");
    const sid = req.headers.get("x-sid");
    let body: { a?: unknown; p?: unknown };
    try {
      body = await req.json();
    } catch {
      return json({ ok: false, err: "בקשה לא תקינה" }, 400);
    }
    const a = String(body?.a ?? "");
    const p = (body?.p && typeof body.p === "object" ? body.p : {}) as Record<string, unknown>;
    if (a === "react") return this.react(token, p);
    if (a === "sound") return this.sound(key, p);

    const backup = structuredClone(this.s);
    let r: unknown;
    try {
      r = dispatch(this.s, { a, p, playerId: this.playerId(token), admin: this.isAdmin(key), now: Date.now() });
    } catch (e) {
      this.s = backup;
      if (e instanceof GameError) return json({ ok: false, err: e.message });
      console.error("action failed", a, e);
      return json({ ok: false, err: "משהו השתבש בשרת. נסו שוב." }, 500);
    }

    // join / leave hand out a new identity: move the caller's socket over before anyone hears about it
    let viewToken = token;
    if (r && typeof r === "object" && "token" in r) {
      viewToken = (r as { token: string | null }).token;
      if (sid)
        for (const { ws, att } of this.sockets())
          if (att.sid === sid) ws.serializeAttachment({ ...att, token: viewToken } satisfies Att);
    }

    tick(this.s, Date.now());
    this.s.v++;
    await this.save();
    await this.syncAlarm();
    this.broadcast();
    return json({ ok: true, r: r ?? null, d: this.view(viewToken, key) });
  }

  /* ---------- emojis thrown at the TV: not saved, just passed along, a few per second at most ---------- */

  private recent = new Map<ID, number[]>();

  private react(token: string | null, p: Record<string, unknown>) {
    const pid = this.playerId(token);
    if (!pid) return json({ ok: false, err: "צריך להתחבר מחדש. בחרו את השם שלכם" });
    const e = String(p.emoji ?? "");
    if (!REACTIONS.includes(e)) return json({ ok: false, err: "אימוג׳י לא מוכר" });
    const now = Date.now();
    const times = (this.recent.get(pid) ?? []).filter((t) => now - t < 3000);
    if (times.length >= 5) return json({ ok: false, err: "לאט לאט 🙂" });
    times.push(now);
    this.recent.set(pid, times);
    const msg = JSON.stringify({ t: "fx", d: { kind: "emoji", e, by: pid } });
    for (const { ws } of this.sockets())
      try {
        ws.send(msg);
      } catch {
        /* socket went away */
      }
    return json({ ok: true, r: null });
  }

  /* ---------- the host's soundboard: straight to the TV, not saved ---------- */

  private lastSound = 0;

  private sound(key: string | null, p: Record<string, unknown>) {
    if (!this.isAdmin(key)) return json({ ok: false, err: "צריך הרשאת מנחה" });
    const snd = SOUNDS.find((x) => x.id === p.id);
    if (!snd) return json({ ok: false, err: "צליל לא מוכר" });
    const now = Date.now();
    if (now - this.lastSound < 700) return json({ ok: false, err: "רגע, לאט 🙂" });
    this.lastSound = now;
    const msg = JSON.stringify({ t: "fx", d: { kind: "sound", id: snd.id } });
    for (const { ws } of this.sockets())
      try {
        ws.send(msg);
      } catch {
        /* socket went away */
      }
    return json({ ok: true, r: null });
  }

  /* ---------- images (stored in chunks so any size under the cap fits) ---------- */

  private async upload(req: Request) {
    // always drain the body first: answering early leaves the client's connection in a broken state
    const buf = await req.arrayBuffer();
    if (!this.isAdmin(req.headers.get("x-key")) && !this.playerId(req.headers.get("x-token")))
      return json({ ok: false, err: "אין הרשאה" }, 403);
    const type = (req.headers.get("content-type") ?? "").split(";")[0].trim();
    const video = VIDEO_TYPES.includes(type);
    if (!IMAGE_TYPES.includes(type) && !video) return json({ ok: false, err: "אפשר להעלות רק תמונות וסרטונים" }, 415);
    if (buf.byteLength < 100) return json({ ok: false, err: "הקובץ ריק. נסו שוב" }, 400);
    if (buf.byteLength > (video ? MAX_VIDEO : MAX_IMAGE))
      return json({ ok: false, err: video ? "הסרטון גדול מדי. עד 40 מגה, בערך חצי דקה" : "התמונה גדולה מדי" }, 413);
    const id = newId(14);
    await this.writeBlob(`img:${id}`, type, buf);
    return json({ ok: true, url: `/media/${id}` });
  }

  private async media(id: string, req: Request) {
    if (!/^[a-z0-9]{6,40}$/.test(id)) return new Response("bad id", { status: 400 });
    const key = `img:${id}`;
    const meta = await this.ctx.storage.get<{ type: string; n: number; size?: number }>(key);
    if (!meta) return new Response("not found", { status: 404 });
    const cache = "public, max-age=31536000, immutable";
    // Safari only plays video that can be fetched in pieces: answer byte ranges
    const range = meta.size ? req.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/) : null;
    if (range && meta.size) {
      const size = meta.size;
      let start = range[1] ? Number(range[1]) : NaN;
      let end = range[2] ? Number(range[2]) : size - 1;
      if (Number.isNaN(start)) {
        start = Math.max(0, size - end);
        end = size - 1;
      }
      end = Math.min(end, size - 1, start + RANGE_MAX - 1);
      if (start >= size || start > end) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
      const first = Math.floor(start / IMG_CHUNK);
      const last = Math.floor(end / IMG_CHUNK);
      const keys = Array.from({ length: last - first + 1 }, (_, i) => `${key}:${first + i}`);
      const parts = await this.ctx.storage.get<ArrayBuffer>(keys);
      const body = new Uint8Array(end - start + 1);
      let at = 0;
      keys.forEach((k, i) => {
        const chunk = new Uint8Array(parts.get(k) ?? new ArrayBuffer(0));
        const from = i === 0 ? start - first * IMG_CHUNK : 0;
        const to = Math.min(chunk.byteLength, end - (first + i) * IMG_CHUNK + 1);
        if (to > from) {
          body.set(chunk.subarray(from, to), at);
          at += to - from;
        }
      });
      return new Response(body, {
        status: 206,
        headers: { "content-type": meta.type, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(body.byteLength), "accept-ranges": "bytes", "cache-control": cache },
      });
    }
    const blob = await this.readBlob(key);
    if (!blob) return new Response("not found", { status: 404 });
    return new Response(blob.body, {
      headers: { "content-type": blob.type, "cache-control": cache, ...(meta.size ? { "accept-ranges": "bytes" } : {}) },
    });
  }

  private async writeBlob(key: string, type: string, buf: ArrayBuffer) {
    const n = Math.ceil(buf.byteLength / IMG_CHUNK);
    // a video is hundreds of chunks: storage takes at most 128 keys per write
    for (let i = 0; i < n; i += 100) {
      const entries: Record<string, ArrayBuffer> = {};
      for (let j = i; j < Math.min(n, i + 100); j++) entries[`${key}:${j}`] = buf.slice(j * IMG_CHUNK, (j + 1) * IMG_CHUNK);
      await this.ctx.storage.put(entries);
    }
    // the index goes last, so a half-written file is never served
    await this.ctx.storage.put(key, { type, n, size: buf.byteLength });
  }

  private async readBlob(key: string): Promise<{ type: string; body: Uint8Array } | null> {
    const meta = await this.ctx.storage.get<{ type: string; n: number }>(key);
    if (!meta) return null;
    const keys = Array.from({ length: meta.n }, (_, i) => `${key}:${i}`);
    // storage reads at most 128 keys at a time
    const parts = new Map<string, ArrayBuffer>();
    for (let i = 0; i < keys.length; i += 100) for (const [k, v] of await this.ctx.storage.get<ArrayBuffer>(keys.slice(i, i + 100))) parts.set(k, v);
    const chunks = keys.map((k) => new Uint8Array(parts.get(k) ?? new ArrayBuffer(0)));
    const body = new Uint8Array(chunks.reduce((a, c) => a + c.byteLength, 0));
    let o = 0;
    for (const c of chunks) {
      body.set(c, o);
      o += c.byteLength;
    }
    return { type: meta.type, body };
  }

  /* ---------- the announcer: reads out lines the game itself wrote (never arbitrary text), cached once made ---------- */

  private lineFor(ref: string): string | null {
    const [kind, id, key] = ref.split(":");
    if (kind === "feed") return this.s.feed.find((e) => e.id === id)?.text ?? null;
    if (kind === "round" && key) return this.s.rounds.find((r) => r.id === id)?.lines?.[key] ?? null;
    if (kind === "sb") return SOUNDS.find((x) => x.id === id)?.line ?? null;
    if (kind === "rules") return RULES[Number(id)]?.line ?? null;
    return null;
  }

  private async tts(req: Request) {
    const body = (await req.json().catch(() => ({}))) as { ref?: unknown };
    const text = typeof body.ref === "string" ? this.lineFor(body.ref) : null;
    const clean = (text ?? "").replace(/[\p{Extended_Pictographic}\u200d\ufe0f]/gu, "").replace(/[()+]/g, " ").replace(/\s+/g, " ").trim();
    if (!clean || !this.env.OPENAI_API_KEY) return json({ ok: false, err: "no line" }, 404);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(clean)));
    const key = `tts:${[...digest.slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
    const headers = { "content-type": "audio/mpeg", "cache-control": "public, max-age=86400" };
    const cached = await this.readBlob(key);
    if (cached) return new Response(cached.body, { headers });
    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { authorization: `Bearer ${this.env.OPENAI_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o-mini-tts", voice: "ash", input: clean, instructions: VOICE, response_format: "mp3" }),
    });
    if (!res.ok) {
      console.error("tts failed", res.status, (await res.text()).slice(0, 300));
      return json({ ok: false, err: "tts failed" }, 502);
    }
    const audio = await res.arrayBuffer();
    await this.writeBlob(key, "audio/mpeg", audio);
    return new Response(audio, { headers });
  }

  /* ---------- realtime ---------- */

  async webSocketMessage(ws: WebSocket, msg: string | ArrayBuffer) {
    if (typeof msg !== "string") return;
    let m: { t?: string; token?: unknown; key?: unknown };
    try {
      m = JSON.parse(msg);
    } catch {
      return;
    }
    if (m.t !== "hello") return;
    const prev = ws.deserializeAttachment() as Att | null;
    const att: Att = {
      sid: prev?.sid ?? newId(12),
      token: typeof m.token === "string" ? m.token : null,
      key: typeof m.key === "string" ? m.key : null,
    };
    ws.serializeAttachment(att);
    ws.send(JSON.stringify({ t: "s", sid: att.sid, d: this.view(att.token, att.key) }));
    if (this.playerId(att.token)) this.broadcast(ws);
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    try {
      ws.close(code >= 1000 && code < 1004 ? code : 1000, reason);
    } catch {
      /* already closed */
    }
    const att = ws.deserializeAttachment() as Att | null;
    if (att && this.playerId(att.token)) this.broadcast(ws);
  }

  async webSocketError(ws: WebSocket) {
    const att = ws.deserializeAttachment() as Att | null;
    if (att && this.playerId(att.token)) this.broadcast(ws);
  }

  /* ---------- betting countdown ---------- */

  private async syncAlarm() {
    const due = nextDue(this.s);
    if (due) await this.ctx.storage.setAlarm(Math.max(due, Date.now() + 50));
    else await this.ctx.storage.deleteAlarm();
  }

  /** Betting closing, missions paying out: whatever is due now. */
  async alarm() {
    if (tick(this.s, Date.now())) {
      this.s.v++;
      await this.save();
      this.broadcast();
    }
    await this.syncAlarm();
  }
}
