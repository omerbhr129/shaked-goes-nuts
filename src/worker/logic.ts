import type { Audience, GameState, ID, Mission, PlayerRec, RoundOption, RoundRec, TvMode } from "../shared/types";
import { seedState } from "./seed";

/** A rule violation. Its message is shown to the person as-is. */
export class GameError extends Error {}

function fail(msg: string): never {
  throw new GameError(msg);
}

const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
export function newId(n = 8): string {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  let s = "";
  for (const b of a) s += ALPHABET[b % 32];
  return s;
}

export const activeRound = (s: GameState): RoundRec | null =>
  s.activeRoundId ? s.rounds.find((r) => r.id === s.activeRoundId) ?? null : null;

export function balanceOf(s: GameState, pid: ID): number {
  let b = s.settings.startBalance;
  for (const e of s.ledger) if (e.playerId === pid) b += e.delta;
  return b;
}

export function bettingOpen(r: RoundRec, now: number): boolean {
  return r.status === "open" && (r.closesAt === null || now < r.closesAt);
}

export function normalize(s: GameState): GameState {
  s.seq ??= 0;
  s.players ??= [];
  s.rounds ??= [];
  s.bets ??= [];
  s.missions ??= [];
  s.ledger ??= [];
  s.activeRoundId ??= null;
  s.tv ??= { mode: "lobby", at: Date.now() };
  s.settings = Object.assign({ currency: "שקדים", startBalance: 1000, allowJoinNew: true }, s.settings);
  return s;
}

/* ---------- input helpers ---------- */

const str = (v: unknown, max: number) =>
  (typeof v === "string" ? v : "").replace(/\s+/g, " ").trim().slice(0, max);

const int = (v: unknown, def: number, min: number, max: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};

const media = (v: unknown): string | null =>
  typeof v === "string" && /^\/(media|photos)\/[\w.-]{1,80}$/.test(v) ? v : null;

const findPlayer = (s: GameState, id: unknown) => s.players.find((p) => p.id === id) ?? fail("השחקן לא נמצא");
const findRound = (s: GameState, id: unknown) => s.rounds.find((r) => r.id === id) ?? fail("הסיבוב לא נמצא");
const findMission = (s: GameState, id: unknown) => s.missions.find((m) => m.id === id) ?? fail("המשימה לא נמצאה");

function ipoTicker(s: GameState) {
  for (let i = 1; ; i++) {
    const t = `IPO${i}`;
    if (!s.players.some((p) => p.ticker === t)) return t;
  }
}

function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const sample = <T>(a: T[]): T => a[Math.floor(Math.random() * a.length)];

/* ---------- missions dealing ---------- */

const fits = (m: Mission, p: PlayerRec) => m.audience === "all" || (m.audience === "groom") === p.isGroom;

/** Fill a player's hand up to `per` missions: one written for their role, the rest from anything that fits, spreading reward tiers. */
function dealTo(s: GameState, p: PlayerRec, per = 3): number {
  let dealt = 0;
  const own = p.isGroom ? "groom" : "friends";
  while (true) {
    const hand = s.missions.filter((m) => m.assignedTo === p.id);
    if (hand.length >= per) break;
    const free = s.missions.filter((m) => m.assignedTo === null && m.status === "open" && fits(m, p));
    if (!free.length) break;
    const tiers = new Set(hand.map((m) => m.reward));
    let pool = hand.some((m) => m.audience === own) ? free : free.filter((m) => m.audience === own);
    if (!pool.length) pool = free;
    const fresh = pool.filter((m) => !tiers.has(m.reward));
    sample(fresh.length ? fresh : pool).assignedTo = p.id;
    dealt++;
  }
  return dealt;
}

/* ---------- actions ---------- */

export interface Ctx {
  a: string;
  p: Record<string, any>;
  playerId: ID | null;
  admin: boolean;
  now: number;
}
type Handler = (s: GameState, c: Ctx) => unknown;

const me = (s: GameState, c: Ctx): PlayerRec =>
  (c.playerId ? s.players.find((p) => p.id === c.playerId) : undefined) ??
  fail("צריך להתחבר מחדש. בחרו את השם שלכם");

const PLAYER: Record<string, Handler> = {
  join(s, { p, now }) {
    if (p.playerId) {
      const pl = findPlayer(s, p.playerId);
      if (pl.token) fail(`${pl.name} כבר מחובר ממכשיר אחר. אם זה אתם, בקשו מהמנחה לשחרר את השם.`);
      pl.token = newId(24);
      pl.joinedAt = now;
      return { token: pl.token, playerId: pl.id };
    }
    if (!s.settings.allowJoinNew) fail("אפשר להצטרף רק עם שם מהרשימה. בקשו מהמנחה להוסיף אתכם.");
    const name = str(p.name, 16);
    if (name.length < 2) fail("השם צריך להכיל לפחות 2 תווים");
    if (s.players.some((x) => x.name === name)) fail("השם הזה כבר ברשימה. בחרו אותו משם");
    const pl: PlayerRec = { id: newId(), name, ticker: ipoTicker(s), photo: null, isGroom: false, token: newId(24), joinedAt: now };
    s.players.push(pl);
    if (s.missions.some((m) => m.assignedTo)) dealTo(s, pl);
    return { token: pl.token, playerId: pl.id };
  },

  leave(s, c) {
    const pl = me(s, c);
    pl.token = null;
    pl.joinedAt = null;
    return { token: null };
  },

  bet(s, c) {
    const pl = me(s, c);
    const r = activeRound(s);
    if (!r || r.id !== c.p.roundId) fail("הסיבוב הזה כבר לא פעיל");
    if (!bettingOpen(r, c.now)) fail("ההימורים כבר נסגרו");
    if (r.noBet.includes(pl.id)) fail("משתתפי האתגר לא מהמרים בסיבוב הזה");
    const opt = r.options.find((o) => o.id === c.p.optionId) ?? fail("האפשרות הזאת לא קיימת");
    const max = Math.min(r.maxBet, balanceOf(s, pl.id));
    if (max <= 0) fail("נגמרו לך השקדים. אפשר לבקש חילוץ מהמנחה");
    const min = Math.min(r.minBet, max);
    const amount = Math.round(Number(c.p.amount));
    if (!Number.isFinite(amount) || amount < min || amount > max) fail(`אפשר להמר על ${min} עד ${max}`);
    const existing = s.bets.find((b) => b.roundId === r.id && b.playerId === pl.id);
    if (existing) {
      existing.optionId = opt.id;
      existing.amount = amount;
      existing.at = c.now;
      return { ticket: existing.ticket };
    }
    const ticket = ++s.seq;
    s.bets.push({ roundId: r.id, playerId: pl.id, optionId: opt.id, amount, at: c.now, ticket });
    return { ticket };
  },

  unbet(s, c) {
    const pl = me(s, c);
    const r = activeRound(s);
    if (!r || r.id !== c.p.roundId || !bettingOpen(r, c.now)) fail("ההימורים כבר נסגרו");
    s.bets = s.bets.filter((b) => !(b.roundId === r.id && b.playerId === pl.id));
  },

  claimMission(s, c) {
    const pl = me(s, c);
    const m = findMission(s, c.p.missionId);
    if (m.assignedTo !== pl.id) fail("המשימה הזאת לא שלך");
    if (m.status === "done") fail("המשימה כבר אושרה");
    m.status = "pending";
    m.claimedAt = c.now;
  },

  unclaimMission(s, c) {
    const pl = me(s, c);
    const m = findMission(s, c.p.missionId);
    if (m.assignedTo !== pl.id || m.status !== "pending") fail("אין בקשה פתוחה למשימה הזאת");
    m.status = "open";
    m.claimedAt = null;
  },

  setPhoto(s, c) {
    me(s, c).photo = media(c.p.photo);
  },
};

const ADMIN: Record<string, Handler> = {
  saveRound(s, { p }) {
    const d = (p.round ?? {}) as Partial<RoundRec>;
    const title = str(d.title, 160);
    if (!title) fail("צריך לכתוב שאלה");
    const existing = d.id ? s.rounds.find((r) => r.id === d.id) : undefined;
    const base = { emoji: str(d.emoji, 8) || "🎲", title, note: str(d.note, 220), image: media(d.image) };
    if (existing && existing.status !== "draft") {
      Object.assign(existing, base);
      return { id: existing.id };
    }
    const seen = new Set<string>();
    const options: RoundOption[] = (Array.isArray(d.options) ? d.options : [])
      .map((o: any) => {
        const playerId = o?.playerId && s.players.some((x) => x.id === o.playerId) ? String(o.playerId) : null;
        const label = str(o?.label, 40) || (playerId ? s.players.find((x) => x.id === playerId)!.name : "");
        let id = str(o?.id, 24) || playerId || newId(6);
        if (seen.has(id)) id = newId(6);
        seen.add(id);
        return { id, label, playerId };
      })
      .filter((o) => o.label);
    if (options.length < 2) fail("צריך לפחות 2 אפשרויות");
    if (options.length > 10) fail("אפשר עד 10 אפשרויות");
    const minBet = int(d.minBet, 50, 1, 1_000_000);
    const maxBet = int(d.maxBet, 500, minBet, 1_000_000);
    const seconds = int(d.seconds, 60, 0, 900);
    const noBet = (Array.isArray(d.noBet) ? d.noBet : []).filter((id) => s.players.some((x) => x.id === id)).map(String);
    if (existing) {
      Object.assign(existing, base, { options, minBet, maxBet, seconds, noBet });
      return { id: existing.id };
    }
    const r: RoundRec = {
      id: newId(),
      ...base,
      options,
      minBet,
      maxBet,
      seconds,
      noBet,
      status: "draft",
      openedAt: null,
      closesAt: null,
      winnerId: null,
      resolvedAt: null,
    };
    s.rounds.push(r);
    return { id: r.id };
  },

  deleteRound(s, { p }) {
    const r = findRound(s, p.roundId);
    if (r.status === "open" || r.status === "closed") fail("הסיבוב פעיל. קודם בטלו אותו");
    if (r.status === "resolved") fail("לסיבוב יש תוצאה. קודם בטלו את הסיבוב");
    s.rounds = s.rounds.filter((x) => x !== r);
    if (s.activeRoundId === r.id) s.activeRoundId = null;
  },

  moveRound(s, { p }) {
    const i = s.rounds.findIndex((r) => r.id === p.roundId);
    if (i < 0) fail("הסיבוב לא נמצא");
    const j = i + (p.dir === "up" ? -1 : 1);
    if (j < 0 || j >= s.rounds.length) return;
    [s.rounds[i], s.rounds[j]] = [s.rounds[j], s.rounds[i]];
  },

  openRound(s, { p, now }) {
    const r = findRound(s, p.roundId);
    const cur = activeRound(s);
    if (cur && cur.id !== r.id && (cur.status === "open" || cur.status === "closed"))
      fail(`הסיבוב ״${cur.title}״ עדיין פעיל. קודם הכריזו תוצאה או בטלו אותו`);
    if (r.status === "resolved") fail("לסיבוב הזה כבר יש תוצאה");
    const seconds = int(p.seconds, r.seconds, 0, 900);
    if (r.status === "draft") {
      s.bets = s.bets.filter((b) => b.roundId !== r.id);
      r.openedAt = now;
    }
    r.status = "open";
    r.closesAt = seconds > 0 ? now + seconds * 1000 : null;
    r.winnerId = null;
    r.resolvedAt = null;
    s.activeRoundId = r.id;
    s.tv = { mode: "round", at: now };
  },

  extendRound(s, { p, now }) {
    const r = activeRound(s);
    if (!r || r.id !== p.roundId || (r.status !== "open" && r.status !== "closed")) fail("הסיבוב לא פעיל");
    const add = int(p.seconds, 30, 5, 600) * 1000;
    const base = r.status === "open" && r.closesAt && r.closesAt > now ? r.closesAt : now;
    r.status = "open";
    r.closesAt = base + add;
  },

  closeRound(s, { p, now }) {
    const r = activeRound(s);
    if (!r || r.id !== p.roundId) fail("הסיבוב לא פעיל");
    if (r.status !== "open") fail("ההימורים כבר סגורים");
    r.status = "closed";
    r.closesAt = Math.min(r.closesAt ?? now, now);
  },

  resolveRound(s, { p, now }) {
    const r = findRound(s, p.roundId);
    if (r.status === "draft") fail("הסיבוב עוד לא נפתח");
    const win = r.options.find((o) => o.id === p.optionId) ?? fail("בחרו את האפשרות שניצחה");
    s.ledger = s.ledger.filter((e) => !(e.kind === "bet" && e.ref === r.id));
    if (r.status === "open") r.closesAt = Math.min(r.closesAt ?? now, now);
    for (const b of s.bets) {
      if (b.roundId !== r.id) continue;
      const delta = b.optionId === win.id ? b.amount : -b.amount;
      s.ledger.push({ id: newId(), playerId: b.playerId, delta, kind: "bet", ref: r.id, note: r.title, at: now });
    }
    r.status = "resolved";
    r.winnerId = win.id;
    r.resolvedAt = now;
    if (s.activeRoundId === r.id) s.tv = { mode: "round", at: now };
  },

  undoResolve(s, { p, now }) {
    const r = findRound(s, p.roundId);
    if (r.status !== "resolved") fail("לסיבוב אין תוצאה");
    const cur = activeRound(s);
    if (cur && cur.id !== r.id && (cur.status === "open" || cur.status === "closed"))
      fail("יש סיבוב אחר פעיל. קודם סיימו אותו");
    s.ledger = s.ledger.filter((e) => !(e.kind === "bet" && e.ref === r.id));
    r.status = "closed";
    r.winnerId = null;
    r.resolvedAt = null;
    s.activeRoundId = r.id;
    s.tv = { mode: "round", at: now };
  },

  cancelRound(s, { p, now }) {
    const r = findRound(s, p.roundId);
    s.ledger = s.ledger.filter((e) => !(e.kind === "bet" && e.ref === r.id));
    s.bets = s.bets.filter((b) => b.roundId !== r.id);
    Object.assign(r, { status: "draft", openedAt: null, closesAt: null, winnerId: null, resolvedAt: null });
    if (s.activeRoundId === r.id) {
      s.activeRoundId = null;
      if (s.tv.mode === "round") s.tv = { mode: "board", at: now };
    }
  },

  saveMission(s, { p }) {
    const d = (p.mission ?? {}) as Partial<Mission>;
    const text = str(d.text, 240);
    if (text.length < 3) fail("כתבו את המשימה");
    const reward = int(d.reward, 150, 0, 100_000);
    const audience: Audience = d.audience === "friends" || d.audience === "groom" ? d.audience : "all";
    const assignedTo = d.assignedTo && s.players.some((x) => x.id === d.assignedTo) ? d.assignedTo : null;
    const existing = d.id ? s.missions.find((m) => m.id === d.id) : undefined;
    if (existing) {
      if (assignedTo !== existing.assignedTo) {
        if (existing.status === "done") fail("משימה שאושרה אי אפשר להעביר");
        existing.assignedTo = assignedTo;
        existing.status = "open";
        existing.claimedAt = null;
      }
      if (existing.status === "done")
        for (const e of s.ledger) if (e.kind === "mission" && e.ref === existing.id) e.delta = reward;
      Object.assign(existing, { text, reward, audience });
      return { id: existing.id };
    }
    const m: Mission = { id: newId(), text, reward, audience, assignedTo, status: "open", claimedAt: null, doneAt: null };
    s.missions.push(m);
    return { id: m.id };
  },

  deleteMission(s, { p }) {
    const m = findMission(s, p.missionId);
    s.ledger = s.ledger.filter((e) => !(e.kind === "mission" && e.ref === m.id));
    s.missions = s.missions.filter((x) => x !== m);
  },

  assignMission(s, { p }) {
    const m = findMission(s, p.missionId);
    if (m.status === "done") fail("משימה שאושרה אי אפשר להעביר");
    m.assignedTo = p.playerId ? findPlayer(s, p.playerId).id : null;
    m.status = "open";
    m.claimedAt = null;
  },

  dealMissions(s) {
    let dealt = 0;
    for (const pl of shuffle([...s.players])) dealt += dealTo(s, pl);
    return { dealt };
  },

  swapMission(s, { p }) {
    const m = findMission(s, p.missionId);
    if (!m.assignedTo) fail("המשימה לא משויכת לאף אחד");
    if (m.status === "done") fail("משימה שאושרה אי אפשר להחליף");
    const pl = findPlayer(s, m.assignedTo);
    const free = s.missions.filter((x) => x.assignedTo === null && x.status === "open" && fits(x, pl));
    if (!free.length) fail("אין משימות פנויות במאגר. הוסיפו עוד משימות");
    const same = free.filter((x) => x.reward === m.reward);
    const pick = sample(same.length ? same : free);
    m.assignedTo = null;
    m.status = "open";
    m.claimedAt = null;
    pick.assignedTo = pl.id;
    return { id: pick.id };
  },

  reviewMission(s, { p, now }) {
    const m = findMission(s, p.missionId);
    if (!m.assignedTo) fail("המשימה לא משויכת לאף אחד");
    if (p.approve) {
      if (m.status === "done") return;
      m.status = "done";
      m.doneAt = now;
      s.ledger.push({ id: newId(), playerId: m.assignedTo, delta: m.reward, kind: "mission", ref: m.id, note: "משימה סודית", at: now });
    } else {
      s.ledger = s.ledger.filter((e) => !(e.kind === "mission" && e.ref === m.id));
      m.status = "open";
      m.claimedAt = null;
      m.doneAt = null;
    }
  },

  savePlayer(s, { p }) {
    const d = (p.player ?? {}) as Partial<PlayerRec>;
    const name = str(d.name, 16);
    if (!name) fail("צריך שם");
    const existing = d.id ? s.players.find((x) => x.id === d.id) : undefined;
    if (s.players.some((x) => x.name === name && x !== existing)) fail("כבר יש שחקן בשם הזה");
    const ticker = str(d.ticker, 5).toUpperCase().replace(/[^A-Z0-9]/g, "") || existing?.ticker || ipoTicker(s);
    const isGroom = !!d.isGroom;
    if (isGroom) for (const x of s.players) x.isGroom = false;
    if (existing) {
      Object.assign(existing, { name, ticker, isGroom });
      if ("photo" in d) existing.photo = media(d.photo);
      return { id: existing.id };
    }
    const pl: PlayerRec = { id: newId(), name, ticker, photo: media(d.photo), isGroom, token: null, joinedAt: null };
    s.players.push(pl);
    return { id: pl.id };
  },

  deletePlayer(s, { p }) {
    const pl = findPlayer(s, p.playerId);
    s.players = s.players.filter((x) => x !== pl);
    s.bets = s.bets.filter((b) => b.playerId !== pl.id);
    s.ledger = s.ledger.filter((e) => e.playerId !== pl.id);
    for (const m of s.missions)
      if (m.assignedTo === pl.id) Object.assign(m, { assignedTo: null, status: "open", claimedAt: null, doneAt: null });
    for (const r of s.rounds) {
      r.noBet = r.noBet.filter((id) => id !== pl.id);
      for (const o of r.options) if (o.playerId === pl.id) o.playerId = null;
    }
  },

  releasePlayer(s, { p }) {
    const pl = findPlayer(s, p.playerId);
    pl.token = null;
    pl.joinedAt = null;
  },

  adjust(s, { p, now }) {
    const pl = findPlayer(s, p.playerId);
    const delta = int(p.delta, 0, -1_000_000, 1_000_000);
    if (!delta) fail("כתבו סכום");
    s.ledger.push({ id: newId(), playerId: pl.id, delta, kind: "adjust", ref: null, note: str(p.note, 60) || "מתנה מהמנחה", at: now });
  },

  setTv(s, { p, now }) {
    const mode = p.mode as TvMode;
    if (!["lobby", "round", "board", "missions", "winner"].includes(mode)) fail("מצב תצוגה לא מוכר");
    s.tv = { mode, at: now };
  },

  saveSettings(s, { p }) {
    const d = (p.settings ?? {}) as Partial<GameState["settings"]>;
    s.settings = {
      currency: str(d.currency, 16) || s.settings.currency,
      startBalance: int(d.startBalance, s.settings.startBalance, 0, 1_000_000),
      allowJoinNew: d.allowJoinNew === undefined ? s.settings.allowJoinNew : !!d.allowJoinNew,
    };
  },

  resetGame(s, { p, now }) {
    s.bets = [];
    s.ledger = [];
    s.seq = 0;
    s.activeRoundId = null;
    for (const r of s.rounds) Object.assign(r, { status: "draft", openedAt: null, closesAt: null, winnerId: null, resolvedAt: null });
    for (const m of s.missions) Object.assign(m, { status: "open", claimedAt: null, doneAt: null });
    if (p.undeal) for (const m of s.missions) m.assignedTo = null;
    if (p.unclaim)
      for (const pl of s.players) {
        pl.token = null;
        pl.joinedAt = null;
      }
    s.tv = { mode: "lobby", at: now };
  },

  reseed(s, { now }) {
    const photos = new Map(s.players.map((pl) => [pl.id, pl.photo]));
    const fresh = seedState(now);
    for (const pl of fresh.players) pl.photo = photos.get(pl.id) ?? null;
    Object.assign(s, fresh, { v: s.v });
  },
};

export function dispatch(s: GameState, c: Ctx): unknown {
  if (Object.hasOwn(PLAYER, c.a)) return PLAYER[c.a](s, c);
  if (Object.hasOwn(ADMIN, c.a)) {
    if (!c.admin) fail("צריך הרשאת מנחה");
    return ADMIN[c.a](s, c);
  }
  fail("פעולה לא מוכרת");
}
