import { DurableObject } from "cloudflare:workers";
import type { GameState, ID } from "../shared/types";
import type { Env } from "./env";
import { GameError, activeRound, closeQuiz, dispatch, newId, normalize } from "./logic";
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

const VOICE =
  "Speak natural Israeli Hebrew. You are an over-the-top, sarcastic game-show announcer at a wild bachelor party: loud, energetic, punchy, with comedic timing. Never translate, read exactly what is written.";

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
      if (path.startsWith("/media/")) return await this.media(path.slice("/media/".length));
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

    this.s.v++;
    await this.save();
    await this.syncAlarm();
    this.broadcast();
    return json({ ok: true, r: r ?? null, d: this.view(viewToken, key) });
  }

  /* ---------- images (stored in chunks so any size under the cap fits) ---------- */

  private async upload(req: Request) {
    // always drain the body first: answering early leaves the client's connection in a broken state
    const buf = await req.arrayBuffer();
    if (!this.isAdmin(req.headers.get("x-key")) && !this.playerId(req.headers.get("x-token")))
      return json({ ok: false, err: "אין הרשאה" }, 403);
    const type = (req.headers.get("content-type") ?? "").split(";")[0].trim();
    if (!["image/jpeg", "image/png", "image/webp"].includes(type)) return json({ ok: false, err: "אפשר להעלות רק תמונות" }, 415);
    if (buf.byteLength < 100 || buf.byteLength > 2_500_000) return json({ ok: false, err: "התמונה גדולה מדי" }, 413);
    const id = newId(14);
    await this.writeBlob(`img:${id}`, type, buf);
    return json({ ok: true, url: `/media/${id}` });
  }

  private async media(id: string) {
    if (!/^[a-z0-9]{6,40}$/.test(id)) return new Response("bad id", { status: 400 });
    const blob = await this.readBlob(`img:${id}`);
    if (!blob) return new Response("not found", { status: 404 });
    return new Response(blob.body, {
      headers: { "content-type": blob.type, "cache-control": "public, max-age=31536000, immutable" },
    });
  }

  private async writeBlob(key: string, type: string, buf: ArrayBuffer) {
    const n = Math.ceil(buf.byteLength / IMG_CHUNK);
    const entries: Record<string, unknown> = { [key]: { type, n } };
    for (let i = 0; i < n; i++) entries[`${key}:${i}`] = buf.slice(i * IMG_CHUNK, (i + 1) * IMG_CHUNK);
    await this.ctx.storage.put(entries);
  }

  private async readBlob(key: string): Promise<{ type: string; body: Uint8Array } | null> {
    const meta = await this.ctx.storage.get<{ type: string; n: number }>(key);
    if (!meta) return null;
    const keys = Array.from({ length: meta.n }, (_, i) => `${key}:${i}`);
    const parts = await this.ctx.storage.get<ArrayBuffer>(keys);
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
    const r = activeRound(this.s);
    if (r && r.status === "open" && r.closesAt) await this.ctx.storage.setAlarm(r.closesAt);
    else await this.ctx.storage.deleteAlarm();
  }

  async alarm() {
    const r = activeRound(this.s);
    if (!r || r.status !== "open" || !r.closesAt) return;
    if (Date.now() < r.closesAt - 30) {
      await this.ctx.storage.setAlarm(r.closesAt);
      return;
    }
    if (r.kind === "quiz") closeQuiz(this.s, r, Date.now());
    else r.status = "closed";
    this.s.v++;
    await this.save();
    this.broadcast();
  }
}
