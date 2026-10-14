import type { Audience, FeedKind, GameState, ID, Mission, PlayerRec, RoundKind, RoundOption, RoundRec, TargetSlot, TvMode, WheelKind } from "../shared/types";
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

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const sample = <T>(a: T[]): T => a[Math.floor(Math.random() * a.length)];

export const activeRound = (s: GameState): RoundRec | null =>
  s.activeRoundId ? s.rounds.find((r) => r.id === s.activeRoundId) ?? null : null;

export function balanceOf(s: GameState, pid: ID): number {
  let b = s.settings.startBalance;
  for (const e of s.ledger) if (e.playerId === pid) b += e.delta;
  return b;
}

/** Balance minus everything still riding on rounds that have not been settled. */
export function available(s: GameState, pid: ID, exceptRoundId?: ID): number {
  const live = new Set(s.rounds.filter((r) => (r.status === "open" || r.status === "closed") && r.id !== exceptRoundId).map((r) => r.id));
  let held = 0;
  for (const b of s.bets) if (b.playerId === pid && live.has(b.roundId)) held += b.amount;
  return balanceOf(s, pid) - held;
}

export function bettingOpen(r: RoundRec, now: number): boolean {
  return r.status === "open" && (r.closesAt === null || now < r.closesAt);
}

export function standings(s: GameState) {
  return s.players
    .map((p) => ({ id: p.id, name: p.name, balance: balanceOf(s, p.id) }))
    .sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name, "he"));
}

const nameOf = (s: GameState, id: ID) => s.players.find((p) => p.id === id)?.name ?? "מישהו";

function pushFeed(s: GameState, now: number, kind: FeedKind, text: string, players: ID[] = [], ref: ID | null = null) {
  s.feed.push({ id: newId(), at: now, kind, text, players, ref });
  if (s.feed.length > 40) s.feed = s.feed.slice(-40);
}

/** Older saved states get the fields newer versions rely on. */
export function normalize(s: GameState): GameState {
  s.seq ??= 0;
  s.players ??= [];
  s.rounds ??= [];
  s.bets ??= [];
  s.missions ??= [];
  s.ledger ??= [];
  s.accusations ??= [];
  s.bailouts ??= [];
  s.feed ??= [];
  s.wheel ??= null;
  s.activeRoundId ??= null;
  s.lastResolvedId ??= null;
  s.tv = Object.assign({ mode: "lobby", at: Date.now(), step: 0 }, s.tv);
  s.settings = Object.assign(
    { currency: "שקדים", startBalance: 1000, allowJoinNew: true, bankBonus: 200, catchReward: 100, falsePenalty: 50, bailoutAmount: 300 },
    s.settings,
  );
  for (const r of s.rounds) {
    r.kind ??= "challenge";
    r.bonus ??= s.settings.bankBonus;
    r.refunded ??= false;
    r.reward ??= 0;
    r.correctId ??= null;
    r.losers ??= [];
    r.loserReason ??= null;
  }
  for (const m of s.missions) {
    m.caughtBy ??= null;
    m.template ??= m.text;
    m.targets ??= {};
  }
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

/* ---------- missions dealing ---------- */

const SLOTS = /\{([GXY])\}/g;
const slotsOf = (template: string) => new Set([...template.matchAll(SLOTS)].map((m) => m[1] as TargetSlot));
const groomOf = (s: GameState) => s.players.find((p) => p.isGroom) ?? null;
const handOf = (s: GameState, pid: ID) => s.missions.filter((m) => m.assignedTo === pid && m.status !== "burned");

function fits(s: GameState, m: Mission, p: PlayerRec) {
  if (!(m.audience === "all" || (m.audience === "groom") === p.isGroom)) return false;
  const slots = slotsOf(m.template);
  const others = s.players.length - 1 - (slots.has("G") ? 1 : 0);
  if (slots.has("G")) {
    const g = groomOf(s);
    if (!g || g.id === p.id) return false;
  }
  return others >= (slots.has("Y") ? 2 : slots.has("X") ? 1 : 0);
}

const renderText = (s: GameState, template: string, targets: Mission["targets"]) =>
  template.replace(SLOTS, (_, slot: TargetSlot) => nameOf(s, targets[slot] ?? ""));

function resetMission(m: Mission) {
  Object.assign(m, { assignedTo: null, status: "open", claimedAt: null, doneAt: null, caughtBy: null, text: m.template, targets: {} });
}

/** Hand mission m to p, filling {G}/{X}/{Y} with other players (never p), spreading who gets targeted. */
function giveMission(s: GameState, m: Mission, p: PlayerRec): boolean {
  const slots = slotsOf(m.template);
  const targets: Mission["targets"] = {};
  if (slots.has("G")) {
    const g = groomOf(s);
    if (!g || g.id === p.id) return false;
    targets.G = g.id;
  }
  const mine = new Set(handOf(s, p.id).flatMap((x) => Object.values(x.targets)));
  const load = new Map<ID, number>();
  for (const x of s.missions) if (x.assignedTo) for (const t of Object.values(x.targets)) if (t) load.set(t, (load.get(t) ?? 0) + 1);
  for (const slot of ["X", "Y"] as const) {
    if (!slots.has(slot)) continue;
    const taken = Object.values(targets);
    const pool = shuffle(s.players.filter((x) => x.id !== p.id && !taken.includes(x.id)));
    pool.sort((a, b) => Number(mine.has(a.id)) - Number(mine.has(b.id)) || (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0));
    if (!pool[0]) return false;
    targets[slot] = pool[0].id;
  }
  Object.assign(m, { assignedTo: p.id, targets, text: renderText(s, m.template, targets), status: "open", claimedAt: null, doneAt: null, caughtBy: null });
  return true;
}

/** Fill a hand up to `per` live missions: one written for their role, the rest from anything that fits, spreading reward tiers. */
function dealTo(s: GameState, p: PlayerRec, per = 3): number {
  let dealt = 0;
  const own = p.isGroom ? "groom" : "friends";
  for (let guard = 0; guard < 20; guard++) {
    const hand = handOf(s, p.id);
    if (hand.length >= per) break;
    const free = s.missions.filter((m) => m.assignedTo === null && m.status === "open" && fits(s, m, p));
    if (!free.length) break;
    const tiers = new Set(hand.map((m) => m.reward));
    let pool = hand.some((m) => m.audience === own) ? free : free.filter((m) => m.audience === own);
    if (!pool.length) pool = free;
    // a mixed hand: at most one mission about the groom and one two-person mission, unless nothing else is left
    for (const slot of ["G", "Y"] as const)
      if (hand.some((m) => slotsOf(m.template).has(slot))) {
        const rest = pool.filter((m) => !slotsOf(m.template).has(slot));
        if (rest.length) pool = rest;
      }
    const fresh = pool.filter((m) => !tiers.has(m.reward));
    if (giveMission(s, sample(fresh.length ? fresh : pool), p)) dealt++;
  }
  return dealt;
}

/* ---------- the shared pot ---------- */

/** Winners split every stake plus the bank bonus in proportion to what they put in. Nobody right: everyone is refunded. */
function settle(s: GameState, r: RoundRec, winId: ID, now: number) {
  s.ledger = s.ledger.filter((e) => !(e.kind === "bet" && e.ref === r.id));
  const bets = s.bets.filter((b) => b.roundId === r.id);
  const winners = bets.filter((b) => b.optionId === winId);
  const W = winners.reduce((a, b) => a + b.amount, 0);
  r.refunded = bets.length > 0 && winners.length === 0;
  if (!bets.length || r.refunded) return;
  const pot = bets.reduce((a, b) => a + b.amount, 0) + r.bonus;
  for (const b of bets) {
    const delta = b.optionId === winId ? Math.floor((b.amount / W) * pot) - b.amount : -b.amount;
    s.ledger.push({ id: newId(), playerId: b.playerId, delta, kind: "bet", ref: r.id, note: r.title, at: now });
  }
}

/** Quiz: every right answer earns the reward, the fastest one the bonus too. Wrong or silent players drink;
 *  if everybody was right, the slowest one drinks. */
function settleQuiz(s: GameState, r: RoundRec, rightId: ID, now: number) {
  s.ledger = s.ledger.filter((e) => !(e.kind === "quiz" && e.ref === r.id));
  const answers = s.bets.filter((b) => b.roundId === r.id).sort((a, b) => a.at - b.at);
  const right = answers.filter((a) => a.optionId === rightId);
  right.forEach((a, i) => {
    const delta = r.reward + (i === 0 ? r.bonus : 0);
    if (delta) s.ledger.push({ id: newId(), playerId: a.playerId, delta, kind: "quiz", ref: r.id, note: i === 0 ? "הכי מהיר לתשובה הנכונה" : "תשובה נכונה", at: now });
  });
  const rightIds = new Set(right.map((a) => a.playerId));
  let losers = s.players.filter((p) => p.token && !r.noBet.includes(p.id) && !rightIds.has(p.id)).map((p) => p.id);
  let reason: RoundRec["loserReason"] = losers.length ? "wrong" : null;
  if (!losers.length && right.length > 1) {
    losers = [right[right.length - 1].playerId];
    reason = "slow";
  }
  r.losers = losers;
  r.loserReason = reason;
}

/** Settle a round with its winning option and put the result on the TV. */
function resolveWith(s: GameState, r: RoundRec, win: RoundOption, now: number) {
  if (r.status === "open") r.closesAt = Math.min(r.closesAt ?? now, now);
  if (r.kind === "quiz") settleQuiz(s, r, win.id, now);
  else settle(s, r, win.id, now);
  Object.assign(r, { status: "resolved", winnerId: win.id, resolvedAt: now });
  s.lastResolvedId = r.id;
  if (r.kind !== "night" && s.activeRoundId === r.id) s.tv = { mode: "round", at: now, step: 0 };
  if (r.kind === "quiz" && r.losers.length) {
    const answered = new Set(s.bets.filter((b) => b.roundId === r.id).map((b) => b.playerId));
    const list = (ids: ID[]) => ids.map((id) => nameOf(s, id)).join(", ");
    const wrong = r.losers.filter((id) => answered.has(id));
    const silent = r.losers.filter((id) => !answered.has(id));
    const why = [wrong.length && `${list(wrong)} ${wrong.length > 1 ? "טעו" : "טעה"}`, silent.length && `${list(silent)} לא ${silent.length > 1 ? "ענו" : "ענה"}`].filter(Boolean).join(", ו");
    const text = r.loserReason === "slow" ? `🥃 ${list(r.losers)} ענה אחרון. שוט!` : `🥃 ${why}. ${r.losers.length > 1 ? "שוט לכולם!" : "שוט!"}`;
    pushFeed(s, now, "shot", text, r.losers, r.id);
  }
  if (r.kind === "night") {
    const winners = s.bets.filter((b) => b.roundId === r.id && b.optionId === win.id).map((b) => b.playerId);
    pushFeed(s, now, "result", `🌙 הוכרע: ${r.title} — ״${win.label}״`, winners, r.id);
  }
}

/** A quiz runs itself: it closes when time is up or everyone answered, and if the answer is known it is settled on the spot. */
export function closeQuiz(s: GameState, r: RoundRec, now: number) {
  r.status = "closed";
  r.closesAt = Math.min(r.closesAt ?? now, now);
  const win = r.correctId ? r.options.find((o) => o.id === r.correctId) : undefined;
  if (win) resolveWith(s, r, win, now);
}

/* ---------- the wheel ---------- */

const PUNISHMENTS = [
  "לשיר לאיתי שיר אהבה מול כולם",
  "שוט כפול לבחירת החתן",
  "נאום של דקה: למה איתי הכי טוב בעולם",
  "להגיש לכולם קפה מחר בבוקר",
  "ללבוש עד הבוקר מה שהחתן בוחר",
  "להתקשר לשחף ולספר לה כמה איתי מדהים",
  "10 שכיבות סמיכה עם החתן על הגב",
  "ריקוד סולו של 30 שניות על השולחן",
];

const DARES = [
  "שוט לבחירת החתן",
  "20 שכיבות סמיכה",
  "לשיר פזמון לבחירת החבר׳ה",
  "נאום תודה של 30 שניות לבנק המרכזי (החתן)",
  "לגימה ענקית מול כולם",
  "ריקוד סולו של 20 שניות",
];

function wheelSegments(s: GameState, kind: WheelKind): [string, ID[]][] {
  const st = standings(s);
  const ids = st.map((p) => p.id);
  const king = ids[0];
  const second = ids[1] ?? king;
  const last = ids[ids.length - 1];
  const last2 = ids[ids.length - 2];
  if (kind === "punish") return PUNISHMENTS.map((t) => [t, [last]]);
  const groom = s.players.find((p) => p.isGroom)?.id ?? king;
  const lastRound = s.rounds.find((r) => r.id === s.lastResolvedId);
  const losers = !lastRound
    ? []
    : lastRound.kind === "quiz"
      ? lastRound.losers
      : [...new Set(s.ledger.filter((e) => e.kind === "bet" && e.ref === lastRound.id && e.delta < 0).map((e) => e.playerId))];
  const below = st.filter((p) => p.balance < s.settings.startBalance).map((p) => p.id);
  return [
    ["🍺 המקום האחרון שותה", [last]],
    ["👑 המלך בוחר מי שותה", [king]],
    ["📉 המפסידים של הסיבוב האחרון שותים", losers.length ? losers : [last]],
    ["🥈 המקום השני מחלק 3 לגימות", [second]],
    ["🍻 כולם שותים לכבוד החתן!", ids],
    ["🤵 החתן בוחר מי שותה", [groom]],
    [`💸 כל מי שמתחת ל־${fmt(s.settings.startBalance)} שותה`, below],
    ["🔥 מס עשירים: המלך שותה", [king]],
    ["😇 הפעם אף אחד לא שותה", []],
    ["🍋 שני האחרונים שותים", last2 ? [last2, last] : [last]],
  ];
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
    let pl: PlayerRec;
    if (p.playerId) {
      pl = findPlayer(s, p.playerId);
      if (pl.token) fail(`${pl.name} כבר מחובר ממכשיר אחר. אם זה אתם, בקשו מהמנחה לשחרר את השם.`);
      pl.token = newId(24);
      pl.joinedAt = now;
    } else {
      if (!s.settings.allowJoinNew) fail("אפשר להצטרף רק עם שם מהרשימה. בקשו מהמנחה להוסיף אתכם.");
      const name = str(p.name, 16);
      if (name.length < 2) fail("השם צריך להכיל לפחות 2 תווים");
      if (s.players.some((x) => x.name === name)) fail("השם הזה כבר ברשימה. בחרו אותו משם");
      pl = { id: newId(), name, ticker: ipoTicker(s), photo: null, isGroom: false, token: newId(24), joinedAt: now };
      s.players.push(pl);
    }
    dealTo(s, pl);
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
    const r = findRound(s, c.p.roundId);
    if (r.kind !== "night" && s.activeRoundId !== r.id) fail("הסיבוב הזה כבר לא פעיל");
    if (!bettingOpen(r, c.now)) fail(r.kind === "quiz" ? "הזמן לענות נגמר" : "ההימורים כבר נסגרו");
    if (r.noBet.includes(pl.id)) fail(r.kind === "quiz" ? "על השאלה הזאת אתה לא עונה 😉" : "משתתפי האתגר לא מהמרים בסיבוב הזה");
    const opt = r.options.find((o) => o.id === c.p.optionId) ?? fail("האפשרות הזאת לא קיימת");
    if (r.kind === "quiz") {
      const prev = s.bets.find((b) => b.roundId === r.id && b.playerId === pl.id);
      let ticket: number;
      if (prev) {
        prev.optionId = opt.id;
        prev.at = c.now;
        ticket = prev.ticket;
      } else {
        ticket = ++s.seq;
        s.bets.push({ roundId: r.id, playerId: pl.id, optionId: opt.id, amount: 0, at: c.now, ticket });
      }
      const answered = new Set(s.bets.filter((b) => b.roundId === r.id).map((b) => b.playerId));
      if (s.players.every((x) => !x.token || r.noBet.includes(x.id) || answered.has(x.id))) closeQuiz(s, r, c.now);
      return { ticket };
    }
    const max = Math.min(r.maxBet, available(s, pl.id, r.id));
    if (max <= 0) fail(`נגמרו לך ה${s.settings.currency}. אפשר לבקש חילוץ 🆘`);
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
    const r = findRound(s, c.p.roundId);
    if (!bettingOpen(r, c.now)) fail("ההימורים כבר נסגרו");
    s.bets = s.bets.filter((b) => !(b.roundId === r.id && b.playerId === pl.id));
  },

  claimMission(s, c) {
    const pl = me(s, c);
    const m = findMission(s, c.p.missionId);
    if (m.assignedTo !== pl.id) fail("המשימה הזאת לא שלך");
    if (m.status === "burned") fail("המשימה נשרפה. מישהו תפס אותך 🔥");
    if (m.status === "done") fail("המשימה כבר סומנה כבוצעה");
    m.status = "done";
    m.doneAt = c.now;
    m.claimedAt = c.now;
    s.ledger.push({ id: newId(), playerId: pl.id, delta: m.reward, kind: "mission", ref: m.id, note: "משימה סודית", at: c.now });
    pushFeed(s, c.now, "mission", "🚨 מבזק: משימה סודית בוצעה הרגע! מישהו כאן עבד עליכם.", [], m.id);
  },

  unclaimMission(s, c) {
    const pl = me(s, c);
    const m = findMission(s, c.p.missionId);
    if (m.assignedTo !== pl.id || m.status !== "done") fail("אי אפשר לבטל את המשימה הזאת");
    s.ledger = s.ledger.filter((e) => !(e.kind === "mission" && e.ref === m.id));
    m.status = "open";
    m.doneAt = null;
    m.claimedAt = null;
  },

  extraMission(s, c) {
    const pl = me(s, c);
    const hand = handOf(s, pl.id);
    if (hand.some((m) => m.status === "open" || m.status === "pending")) fail("קודם מסיימים את המשימות הפתוחות");
    if (!dealTo(s, pl, hand.length + 1)) fail("נגמרו המשימות במאגר. אתם אגדה");
  },

  accuse(s, c) {
    const pl = me(s, c);
    const suspect = findPlayer(s, c.p.suspectId);
    if (suspect.id === pl.id) fail("אי אפשר לתפוס את עצמך 🙃");
    const text = str(c.p.text, 160);
    if (text.length < 3) fail("כתבו מה לדעתכם הייתה המשימה");
    if (s.accusations.some((a) => a.by === pl.id && a.status === "pending")) fail("כבר יש לך האשמה שמחכה למנחה");
    s.accusations.push({ id: newId(), by: pl.id, suspect: suspect.id, text, at: c.now, status: "pending", missionId: null });
  },

  requestBailout(s, c) {
    const pl = me(s, c);
    if (available(s, pl.id) >= 100) fail("חילוץ מגיע רק למי שנשאר עם פחות מ־100");
    if (s.bailouts.some((b) => b.playerId === pl.id && b.status === "pending")) fail("כבר ביקשת חילוץ. המנחה על זה");
    s.bailouts.push({ id: newId(), playerId: pl.id, at: c.now, status: "pending", dare: null });
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
    const kind: RoundKind = d.kind === "night" || d.kind === "quiz" ? d.kind : "challenge";
    const minBet = int(d.minBet, 50, 1, 1_000_000);
    const maxBet = int(d.maxBet, 500, minBet, 1_000_000);
    const seconds = kind === "night" ? 0 : int(d.seconds, kind === "quiz" ? 25 : 60, 0, 900);
    const bonus = int(d.bonus, kind === "quiz" ? 50 : s.settings.bankBonus, 0, 1_000_000);
    const reward = kind === "quiz" ? int(d.reward, 100, 0, 1_000_000) : 0;
    const rawCi = (p.round ?? {}).correctIndex;
    const ci = rawCi === null || rawCi === undefined || rawCi === "" ? NaN : Number(rawCi);
    const correctId = kind === "quiz" && Number.isInteger(ci) && options[ci] ? options[ci].id : null;
    const noBet = (Array.isArray(d.noBet) ? d.noBet : []).filter((id) => s.players.some((x) => x.id === id)).map(String);
    if (existing) {
      Object.assign(existing, base, { kind, options, minBet, maxBet, seconds, bonus, reward, correctId, noBet });
      return { id: existing.id };
    }
    const r: RoundRec = {
      id: newId(),
      kind,
      ...base,
      options,
      minBet,
      maxBet,
      seconds,
      bonus,
      reward,
      correctId,
      noBet,
      status: "draft",
      openedAt: null,
      closesAt: null,
      winnerId: null,
      resolvedAt: null,
      refunded: false,
      losers: [],
      loserReason: null,
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
    const kind = s.rounds[i].kind;
    let j = i;
    do j += p.dir === "up" ? -1 : 1;
    while (j >= 0 && j < s.rounds.length && s.rounds[j].kind !== kind);
    if (j < 0 || j >= s.rounds.length) return;
    [s.rounds[i], s.rounds[j]] = [s.rounds[j], s.rounds[i]];
  },

  openRound(s, { p, now }) {
    const r = findRound(s, p.roundId);
    if (r.status === "resolved") fail("לסיבוב הזה כבר יש תוצאה");
    if (r.kind === "night") {
      if (r.status === "draft") {
        s.bets = s.bets.filter((b) => b.roundId !== r.id);
        r.openedAt = now;
      }
      Object.assign(r, { status: "open", closesAt: null, winnerId: null, resolvedAt: null, refunded: false });
      return;
    }
    const cur = activeRound(s);
    if (cur && cur.id !== r.id && (cur.status === "open" || cur.status === "closed"))
      fail(`הסיבוב ״${cur.title}״ עדיין פעיל. קודם הכריזו תוצאה או בטלו אותו`);
    const seconds = int(p.seconds, r.seconds, 0, 900);
    if (r.status === "draft") {
      s.bets = s.bets.filter((b) => b.roundId !== r.id);
      r.openedAt = now;
    }
    Object.assign(r, { status: "open", closesAt: seconds > 0 ? now + seconds * 1000 : null, winnerId: null, resolvedAt: null, refunded: false });
    s.activeRoundId = r.id;
    s.tv = { mode: "round", at: now, step: 0 };
  },

  openAllNight(s, { now }) {
    let n = 0;
    for (const r of s.rounds)
      if (r.kind === "night" && r.status === "draft") {
        s.bets = s.bets.filter((b) => b.roundId !== r.id);
        Object.assign(r, { status: "open", openedAt: now, closesAt: null, winnerId: null, resolvedAt: null, refunded: false });
        n++;
      }
    if (!n) fail("אין הימורי לילה סגורים לפתיחה");
    return { opened: n };
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
    const r = findRound(s, p.roundId);
    if (r.status !== "open") fail("ההימורים כבר סגורים");
    if (r.kind === "quiz") return void closeQuiz(s, r, now);
    r.status = "closed";
    r.closesAt = Math.min(r.closesAt ?? now, now);
  },

  resolveRound(s, { p, now }) {
    const r = findRound(s, p.roundId);
    if (r.status === "draft") fail("הסיבוב עוד לא נפתח");
    const win = r.options.find((o) => o.id === p.optionId) ?? fail("בחרו את האפשרות שניצחה");
    resolveWith(s, r, win, now);
  },

  undoResolve(s, { p, now }) {
    const r = findRound(s, p.roundId);
    if (r.status !== "resolved") fail("לסיבוב אין תוצאה");
    if (r.kind !== "night") {
      const cur = activeRound(s);
      if (cur && cur.id !== r.id && (cur.status === "open" || cur.status === "closed")) fail("יש סיבוב אחר פעיל. קודם סיימו אותו");
      s.activeRoundId = r.id;
      s.tv = { mode: "round", at: now, step: 0 };
    }
    s.ledger = s.ledger.filter((e) => !((e.kind === "bet" || e.kind === "quiz") && e.ref === r.id));
    Object.assign(r, { status: "closed", winnerId: null, resolvedAt: null, refunded: false, losers: [], loserReason: null });
  },

  cancelRound(s, { p, now }) {
    const r = findRound(s, p.roundId);
    s.ledger = s.ledger.filter((e) => !((e.kind === "bet" || e.kind === "quiz") && e.ref === r.id));
    s.bets = s.bets.filter((b) => b.roundId !== r.id);
    Object.assign(r, { status: "draft", openedAt: null, closesAt: null, winnerId: null, resolvedAt: null, refunded: false, losers: [], loserReason: null });
    if (s.lastResolvedId === r.id) s.lastResolvedId = null;
    if (s.activeRoundId === r.id) {
      s.activeRoundId = null;
      if (s.tv.mode === "round") s.tv = { mode: "board", at: now, step: 0 };
    }
  },

  saveMission(s, { p }) {
    const d = (p.mission ?? {}) as Partial<Mission>;
    const template = str(d.template ?? d.text, 240);
    if (template.length < 3) fail("כתבו את המשימה");
    const reward = int(d.reward, 150, 0, 100_000);
    const audience: Audience = d.audience === "friends" || d.audience === "groom" ? d.audience : "all";
    const holder = d.assignedTo ? findPlayer(s, d.assignedTo) : null;
    const existing = d.id ? s.missions.find((m) => m.id === d.id) : undefined;
    if (existing) {
      const moved = (holder?.id ?? null) !== existing.assignedTo;
      if (moved && (existing.status === "done" || existing.status === "burned")) fail("משימה שבוצעה או נשרפה אי אפשר להעביר");
      if (existing.status === "done")
        for (const e of s.ledger) if (e.kind === "mission" && e.ref === existing.id) e.delta = reward;
      Object.assign(existing, { template, reward, audience });
      if (moved || (existing.assignedTo && [...slotsOf(template)].some((k) => !existing.targets[k]))) {
        const to = holder ?? (moved ? null : findPlayer(s, existing.assignedTo));
        resetMission(existing);
        if (to && !giveMission(s, existing, to)) fail("המשימה לא מתאימה לשחקן הזה");
      } else existing.text = existing.assignedTo ? renderText(s, template, existing.targets) : template;
      return { id: existing.id };
    }
    const m: Mission = { id: newId(), template, text: template, targets: {}, reward, audience, assignedTo: null, status: "open", claimedAt: null, doneAt: null, caughtBy: null };
    s.missions.push(m);
    if (holder && !giveMission(s, m, holder)) fail("המשימה נשמרה במאגר, אבל היא לא מתאימה לשחקן הזה");
    return { id: m.id };
  },

  deleteMission(s, { p }) {
    const m = findMission(s, p.missionId);
    s.ledger = s.ledger.filter((e) => !(e.kind === "mission" && e.ref === m.id));
    s.missions = s.missions.filter((x) => x !== m);
  },

  assignMission(s, { p }) {
    const m = findMission(s, p.missionId);
    if (m.status === "done" || m.status === "burned") fail("משימה שבוצעה או נשרפה אי אפשר להעביר");
    resetMission(m);
    if (!p.playerId) return;
    const pl = findPlayer(s, p.playerId);
    if (slotsOf(m.template).has("G") && pl.isGroom) fail("משימה על החתן לא יכולה ללכת לחתן 🙂");
    if (!giveMission(s, m, pl)) fail("לא הצלחנו לשבץ את המשימה");
  },

  dealMissions(s) {
    let dealt = 0;
    for (const pl of shuffle([...s.players])) dealt += dealTo(s, pl);
    return { dealt };
  },

  swapMission(s, { p }) {
    const m = findMission(s, p.missionId);
    if (!m.assignedTo) fail("המשימה לא משויכת לאף אחד");
    if (m.status !== "open") fail("אפשר להחליף רק משימה פתוחה");
    const pl = findPlayer(s, m.assignedTo);
    const free = s.missions.filter((x) => x.assignedTo === null && x.status === "open" && x.id !== m.id && fits(s, x, pl));
    if (!free.length) fail("אין משימות פנויות במאגר. הוסיפו עוד משימות");
    const same = free.filter((x) => x.reward === m.reward);
    const pick = sample(same.length ? same : free);
    resetMission(m);
    if (!giveMission(s, pick, pl)) fail("לא הצלחנו להחליף");
    return { id: pick.id };
  },

  /** Host override: approve marks done (and pays), revoke takes the reward back. */
  reviewMission(s, { p, now }) {
    const m = findMission(s, p.missionId);
    if (!m.assignedTo) fail("המשימה לא משויכת לאף אחד");
    if (m.status === "burned") fail("המשימה נשרפה");
    if (p.approve) {
      if (m.status === "done") return;
      Object.assign(m, { status: "done", doneAt: now });
      s.ledger.push({ id: newId(), playerId: m.assignedTo, delta: m.reward, kind: "mission", ref: m.id, note: "משימה סודית", at: now });
    } else {
      s.ledger = s.ledger.filter((e) => !(e.kind === "mission" && e.ref === m.id));
      Object.assign(m, { status: "open", claimedAt: null, doneAt: null });
    }
  },

  judgeAccusation(s, { p, now }) {
    const a = s.accusations.find((x) => x.id === p.accusationId && x.status === "pending") ?? fail("ההאשמה כבר טופלה");
    const by = nameOf(s, a.by);
    const suspect = nameOf(s, a.suspect);
    if (p.missionId) {
      const m =
        s.missions.find((x) => x.id === p.missionId && x.assignedTo === a.suspect && x.status !== "burned") ??
        fail("בחרו משימה של החשוד");
      s.ledger = s.ledger.filter((e) => !(e.kind === "mission" && e.ref === m.id));
      Object.assign(m, { status: "burned", caughtBy: a.by, doneAt: null, claimedAt: null });
      Object.assign(a, { status: "right", missionId: m.id });
      s.ledger.push({ id: newId(), playerId: a.by, delta: s.settings.catchReward, kind: "catch", ref: a.id, note: `תפס את ${suspect}`, at: now });
      dealTo(s, findPlayer(s, a.suspect));
      pushFeed(s, now, "caught", `🕵️ ${by} תפס את ${suspect} על חם! המשימה שנשרפה: ${m.text}`, [a.by, a.suspect], a.id);
    } else {
      a.status = "wrong";
      s.ledger.push({ id: newId(), playerId: a.by, delta: -s.settings.falsePenalty, kind: "penalty", ref: a.id, note: "האשמת שווא", at: now });
      pushFeed(s, now, "miss", `🤡 האשמת שווא! ${by} חשד ב${suspect} ופספס`, [a.by, a.suspect], a.id);
    }
  },

  judgeBailout(s, { p, now }) {
    const b = s.bailouts.find((x) => x.id === p.bailoutId && x.status === "pending") ?? fail("הבקשה כבר טופלה");
    if (!p.approve) {
      b.status = "denied";
      return;
    }
    const amount = s.settings.bailoutAmount;
    Object.assign(b, { status: "granted", dare: sample(DARES) });
    s.ledger.push({ id: newId(), playerId: b.playerId, delta: amount, kind: "bailout", ref: b.id, note: "חילוץ ממשלתי", at: now });
    pushFeed(s, now, "bailout", `🆘 חילוץ ממשלתי ל${nameOf(s, b.playerId)}: +${fmt(amount)}. בתמורה: ${b.dare}`, [b.playerId], b.id);
  },

  spinWheel(s, { p, now }) {
    if (!s.players.length) fail("אין שחקנים");
    const kind: WheelKind = p.kind === "punish" ? "punish" : "drink";
    const segs = wheelSegments(s, kind);
    const index = Math.floor(Math.random() * segs.length);
    const [label, players] = segs[index];
    s.wheel = { id: newId(), at: now, kind, segments: segs.map(([t]) => t), index, label, players };
    const names = players.map((id) => nameOf(s, id)).join(", ");
    const text = kind === "punish" ? `🍋 העונש של ${names}: ${label}` : players.length && players.length < s.players.length ? `🎡 ${label}: ${names}` : `🎡 ${label}`;
    pushFeed(s, now, "wheel", text, players, s.wheel.id);
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
    s.accusations = s.accusations.filter((a) => a.by !== pl.id && a.suspect !== pl.id);
    s.bailouts = s.bailouts.filter((b) => b.playerId !== pl.id);
    const retarget: string[] = [];
    for (const m of s.missions) {
      if (m.assignedTo === pl.id) resetMission(m);
      else if (m.assignedTo && m.status === "open" && Object.values(m.targets).includes(pl.id)) {
        retarget.push(m.assignedTo);
        resetMission(m);
      }
    }
    for (const r of s.rounds) {
      r.noBet = r.noBet.filter((id) => id !== pl.id);
      for (const o of r.options) if (o.playerId === pl.id) o.playerId = null;
    }
    for (const id of retarget) {
      const holder = s.players.find((x) => x.id === id);
      if (holder) dealTo(s, holder);
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
    if (!["lobby", "round", "board", "night", "missions", "awards", "winner"].includes(mode)) fail("מצב תצוגה לא מוכר");
    s.tv = { mode, at: now, step: 0 };
  },

  tvStep(s, { p, now }) {
    const max = int(p.max, 30, 0, 30);
    s.tv = { ...s.tv, at: now, step: Math.max(0, Math.min(max, s.tv.step + (Number(p.delta) < 0 ? -1 : 1))) };
  },

  saveSettings(s, { p }) {
    const d = (p.settings ?? {}) as Partial<GameState["settings"]>;
    const cur = s.settings;
    s.settings = {
      currency: str(d.currency, 16) || cur.currency,
      startBalance: int(d.startBalance, cur.startBalance, 0, 1_000_000),
      allowJoinNew: d.allowJoinNew === undefined ? cur.allowJoinNew : !!d.allowJoinNew,
      bankBonus: int(d.bankBonus, cur.bankBonus, 0, 1_000_000),
      catchReward: int(d.catchReward, cur.catchReward, 0, 1_000_000),
      falsePenalty: int(d.falsePenalty, cur.falsePenalty, 0, 1_000_000),
      bailoutAmount: int(d.bailoutAmount, cur.bailoutAmount, 0, 1_000_000),
    };
  },

  resetGame(s, { p, now }) {
    Object.assign(s, { bets: [], ledger: [], accusations: [], bailouts: [], feed: [], wheel: null, seq: 0, activeRoundId: null, lastResolvedId: null });
    for (const r of s.rounds)
      Object.assign(r, { status: "draft", openedAt: null, closesAt: null, winnerId: null, resolvedAt: null, refunded: false, losers: [], loserReason: null });
    for (const m of s.missions) {
      if (m.status === "burned" || p.undeal) resetMission(m);
      else Object.assign(m, { status: "open", claimedAt: null, doneAt: null, caughtBy: null });
    }
    if (p.unclaim)
      for (const pl of s.players) {
        pl.token = null;
        pl.joinedAt = null;
      }
    s.tv = { mode: "lobby", at: now, step: 0 };
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
