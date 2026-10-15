import type { Audience, FeedEvent, FeedKind, GameState, GroomCard, Shout, ID, Mission, PlayerRec, RoundKind, RoundOption, RoundRec, TargetSlot, TvMode, WheelKind } from "../shared/types";
import { GAMES, SHOP } from "../shared/catalog";
import { DEFAULT_SETTINGS, seedState } from "./seed";

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

/** Open for bets: a drawn round only starts once the TV's reel has stopped spinning. */
/** Stakes on night bets that are not settled yet (optionally leaving one round out). */
export function nightStaked(s: GameState, pid: ID, except?: ID): number {
  const live = new Set(s.rounds.filter((r) => r.kind === "night" && (r.status === "open" || r.status === "closed") && r.id !== except).map((r) => r.id));
  return s.bets.filter((b) => b.playerId === pid && live.has(b.roundId)).reduce((a, b) => a + b.amount, 0);
}

export function bettingOpen(r: RoundRec, now: number): boolean {
  return r.status === "open" && (r.openedAt === null || now >= r.openedAt) && (r.closesAt === null || now < r.closesAt);
}

export function standings(s: GameState) {
  return s.players
    .map((p) => ({ id: p.id, name: p.name, balance: balanceOf(s, p.id) }))
    .sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name, "he"));
}

const nameOf = (s: GameState, id: ID) => s.players.find((p) => p.id === id)?.name ?? "מישהו";

function pushFeed(s: GameState, now: number, kind: FeedKind, text: string, players: ID[] = [], ref: ID | null = null, data?: FeedEvent["data"]) {
  s.feed.push({ id: newId(), at: now, kind, text, players, ref, ...(data ? { data } : {}) });
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
  s.draw ??= null;
  s.shouts ??= [];
  s.doubleNext ??= false;
  s.king ??= null;
  s.kingAt ??= 0;
  s.cards = Object.assign({ veto: false, double: false, drink: false }, s.cards);
  for (const p of s.players) {
    p.hat ??= null;
    p.item ??= null;
  }
  s.tv = Object.assign({ mode: "lobby", at: Date.now(), step: 0 }, s.tv);
  s.settings = Object.assign({ ...DEFAULT_SETTINGS }, s.settings);
  for (const r of s.rounds) {
    r.kind ??= "challenge";
    r.bonus ??= s.settings.bankBonus;
    r.refunded ??= false;
    r.reward ??= 0;
    r.correctId ??= null;
    r.losers ??= [];
    r.loserReason ??= null;
    r.lines ??= {};
    r.task ??= null;
    r.game ??= null;
    r.mult ??= 1;
    r.final ??= false;
  }
  for (const m of s.missions) {
    m.caughtBy ??= null;
    m.template ??= m.text;
    m.targets ??= {};
  }
  return s;
}

function resetRound(r: RoundRec) {
  Object.assign(r, { status: "draft", openedAt: null, closesAt: null, winnerId: null, resolvedAt: null, refunded: false, losers: [], loserReason: null, lines: {}, task: null, mult: 1, final: false });
}

/** What winnings are multiplied by: the wheel's double, and the final doubles again. */
const payMult = (r: RoundRec) => (r.mult || 1) * (r.final ? 2 : 1);

/** A round going live picks up a waiting "next round is double", and can be the final. */
function armRound(s: GameState, r: RoundRec, final = false) {
  r.mult = s.doubleNext ? 2 : 1;
  s.doubleNext = false;
  r.final = final && r.kind === "challenge";
}

/** A round taken off the table hands its double on to the next one. */
function disarmRound(s: GameState, r: RoundRec) {
  if (r.mult > 1) s.doubleNext = true;
}

/* ---------- the funny bits: unfiltered lines for the TV and the announcer ---------- */

const LINES = {
  // a mission was just done: nobody knows by whom (yet)
  alert: [
    "שימו לב יא זונות! משימה סודית בוצעה הרגע! יש לכם {t} לתפוס את המניאק שעשה אותה",
    "וואלה יא שרמוטות, מישהו פה עבד עליכם בעיניים! משימה סודית בוצעה. מי זה? תפסו אותו!",
    "אחושרמוטה! משימה סודית בוצעה מתחת לאף שלכם. יש לכם {t}, יא נובים",
    "שימו לב כולם, שימו לב יא זונות! משימה סודית! מי שתופס את הבן זונה, גונב לו את השקדים",
  ],
  // nobody caught him: the name comes out and whoever got played pays
  reveal: [
    "זה היה {n}, יא זונות! עבד על {t} בעיניים, ו{t} משלם לו {r} שקדים",
    "וואלה, {n} הקליבר הזה! סגר משימה על {t} ואף אחד לא תפס. {t}, תוציא את הארנק",
    "{n} הזיין עשה ל{t} בית ספר. {r} שקדים עוברים מ{t} ל{n}",
    "אחושרמוטה, {n}! {t} אכל אותה ומשלם {r} שקדים",
  ],
  revealN: [
    "זה היה {n}, יא זונות! עבד על {t} בעיניים, והם משלמים לו {r} שקדים",
    "וואלה, {n} הקליבר הזה! עבד על {t} ואף אחד לא תפס. תוציאו את הארנקים",
  ],
  caught: ["איזה חובבן", "בפעם הבאה תתאמן מול המראה, יא נוב", "השקדים עברו לבלש", "ככה זה כשמתעסקים עם בלשים, יא שרמוטה"],
  miss: ["פרנואיד מקצועי", "תרגיע, אחי", "50 שקדים עוברים לחשוד, יא זונה"],
  win1: ["{n} המלך! תשתחוו לו, יא זונות", "{n} הזיין קרע את הבורסה", "וואלה {n}, קראת את המשחק כמו נוסטרדמוס, כפרה עליך", "{n} הרוויח, ועכשיו הוא יהיה בלתי נסבל כל הלילה"],
  winN: ["{n} קרעו את הבורסה! תשתחוו, יא שרמוטות", "{n}: המלכים של הסיבוב, וכל השאר זונות של הבורסה", "{n} צדקו, ועכשיו הם יהיו בלתי נסבלים כל הלילה"],
  groomWin: ["החתן ניצח! שחף, תתכונני לחיים עם אלוף", "{n} החתן הזיין קרע את הבורסה"],
  lose1: ["{n} הימר כמו גאון והפסיד כמו אפס", "{n}, יא שרמוטה, הבורסה צחקה לך בפרצוף", "יא ברוך, {n}. שוב", "{n} שרף שקדים כמו שאיתי שורף סטייקים"],
  loseN: ["{n} הימרו כמו גאונים והפסידו כמו אפסים", "{n}, יא זונות, הבורסה צחקה לכם בפרצוף", "{n}: חבורת נובים", "{n} שרפו שקדים כמו שאיתי שורף סטייקים"],
  groomLose: ["החתן הפסיד! שחף, את רואה עם מי את מתחתנת?", "{n}, עוד לא התחתנת וכבר מפסיד, יא כפרה"],
  none: ["אף אחד לא צדק! חבורת אפסים. השקדים חוזרים, אבל כולם שותים", "אפס צדקו. אפס! יא זונות, הבורסה מתביישת בכם"],
  // one-on-one: {w} won, {l} lost, {game} is what they played
  duel: [
    "{w} פירק את {l} ב{game}! וואלה {l}, לך תתאמן מול הקיר",
    "{w} הזיין קרע את {l} ב{game}. {l}, תחזור כשתגדל",
    "אחושרמוטה, איזה {game}! {w} ניצח, ו{l} בוכה לאמא",
    "{w} מלך ה{game}! {l}, השוט עליך, יא כפרה",
  ],
  fast: [
    "{n} ענה מהר יותר מאיתי כשאומרים לו ״שווארמה״",
    "{n}: האצבע הכי מהירה במזרח התיכון, וואלה",
    "{n} ענה לפני שסיימנו לכתוב את השאלה, יא מלך",
    "גוגל התקשרו. הם רוצים את {n} בחזרה",
    "מהר יותר מאיתי כשהוא שומע ״בר פתוח״. כפרה עליך {n}",
    "{n} עובד במוסד? רק שואלים",
    "{n} מהיר כמו שאיתי אמר ״כן״ לשחף",
    "{n}, תשאיר קצת שקדים גם לזונות האחרות",
  ],
  wrong1: ["{n} ענה כמו אחרון הנובים", "{n}, אפילו גוגל לא היה מציל אותך, יא שרמוטה", "{n} טעה בגדול, אחי"],
  wrongN: ["{n} ענו כמו חבורת נובים", "{n}, יא זונות, אפילו גוגל לא היה מציל אתכם", "{n} טעו בגדול"],
  silent1: ["{n} בכלל לא ענה, ישן בעמידה", "{n} לא ענה. כנראה היה עסוק בלהסתכל על הנוף"],
  silentN: ["{n} בכלל לא ענו, ישנים בעמידה, יא זונות", "{n} לא ענו. כנראה היו עסוקים במנגל"],
  slow: ["{n} צדק, אבל בקצב של צב בפנסיה. שוט, יא שרמוטה!", "{n} ענה לאט כמו האינטרנט בווילה. שוט!", "{n} עדיין קורא את השאלה, וואלה. שוט!"],
  broke: ["{n} פשט רגל, יא זונות! אמא שלו כבר מתקשרת לבנק", "{n} שרף את כל השקדים. הבנק המרכזי בהלם", "{n} נשאר עם כיס ריק ולב שבור, כפרה עליו", "{n} רשמית מרושש. מישהו יקנה לזונה הזאת שקד?"],
  gift: ["איזה חבר", "וואלה, נדיב", "יא זונה רומנטית", "כפרה עליך"],
  selfGift: ["אין כמו לפנק את עצמך", "יא נרקיסיסט", "וואלה, מגיע לך"],
  // the lead changed hands: {n} the new king, {o} the old one
  king: [
    "יש מלך חדש, יא זונות! {n} עקף את {o}. כולם להשתחוות",
    "וואלה! {n} גנב את הכתר מ{o}. {o}, תחזיר את הכתר ותתבייש",
    "{n} המלך החדש של הבורסה! {o}, הממלכה שלך נפלה, כפרה",
    "אחושרמוטה, הפיכה בבורסה! {n} על הכס, ו{o} למטבח",
  ],
  kingFirst: ["יש לנו מלך! {n} מוביל את הבורסה. תשתחוו, יא שרמוטות", "{n} פותח פער ותופס את הכתר. כולם לרצפה, יא זונות"],
  // {k} right in a row
  streak: ["{n} על רצף! {k} ברצף, הבחור הזה רואה את העתיד", "וואלה {n} בוער! {k} ברצף, שמישהו יעצור אותו", "{n}: {k} ברצף. הבנק מתחיל להזיע, יא זונות"],
  voted1: ["{n}! הדמוקרטיה דיברה, יא זונות. שוט!", "וואלה, כולם חושבים שזה {n}. תשתה ותשתוק", "{n} נבחר בכבוד. כוס למעלה, יא שרמוטה"],
  votedN: ["תיקו! {n} שותים ביחד, יא זונות", "{n}: הדמוקרטיה דיברה. שוט לכולכם"],
  noVotes: ["אף אחד לא הצביע, חבורת עצלנים. כולם שותים!", "אפס קולות. אפס! יא זונות, כולם שותים"],
  veto: ["החתן הטיל וטו, יא זונות! האתגר מבוטל וכל השקדים חוזרים", "וטו של החתן! איתי אמר לא, וזהו. מי שלא מרוצה, שיתחתן בעצמו"],
  doubled: ["החתן הכפיל את ההימור! אם איתי צודק, הוא לוקח כפול, יא זונות", "קלף זהב! איתי הכפיל. או שהוא גאון, או שהוא שיכור"],
  drink: ["קלף זהב! החתן החליט: {n} שותה עכשיו, יא שרמוטה. בלי ויכוחים", "איתי שלף קלף זהב: {n}, למטה! שוט מול כולם"],
};

const andList = (names: string[]) => (names.length > 1 ? `${names.slice(0, -1).join(", ")} ו${names[names.length - 1]}` : (names[0] ?? ""));
const fill = (pool: string[], who: string) => sample(pool).replaceAll("{n}", who);

/** Losers of a challenge get a task. The pool only opens up late in the night. */
const TASKS = ["לגימה גדולה 🍺", "שוט 🥃", "10 שכיבות סמיכה 💪", "לשיר לאיתי שורה משיר אהבה 🎤", "להגיד לאיתי מחמאה מביכה מול כולם", "חצי בירה בלי ידיים", "לחקות את איתי עד שמישהו צוחק", "ריקוד של 15 שניות על הדשא"];
const POOL_TASK = "🌊 קפיצה לבריכה עם הבגדים!";
const LATE_TASKS = [POOL_TASK, "🌊 עמידה מתחת למפל של הבריכה, 10 שניות", "שוט כפול 🥃🥃", "20 שכיבות סמיכה עם מישהו על הגב"];
const LATE_AFTER = 8;
const BROKE_AT = 100;
const SWAP_PRICE = 50;
const BROKE_TASKS = ["20 שכיבות סמיכה", "שוט לבחירת החתן", "לשיר לאיתי שיר אהבה מול כולם", "ריקוד סולו של 20 שניות על הדשא", "נאום תודה של 30 שניות לבנק המרכזי (איתי)", "לגימה ענקית מול כולם"];
/** the wheel spins, lands, and shows what came up before betting opens */
const DRAW_MS = 8000;

/** What else the wheel can land on, besides a challenge or a question. */
const SURPRISES: { id: string; label: string; line: string }[] = [
  { id: "shots", label: "🥃 שוט לכולם!", line: "וואלה יצא שוט לכולם! יאללה יא זונות, כוסות למעלה" },
  { id: "groom", label: "🍻 כולם שותים לכבוד החתן", line: "כולם שותים לכבוד איתי! לחיים, יא חתן" },
  { id: "king", label: "👑 המלך בוחר מי שותה", line: "{king}, המלך, בוחר מי שותה. תבחר בחוכמה, יא מלך" },
  { id: "bitter", label: "🍋 השקד המר שותה כפול", line: "{last}, השקד המר, שוט כפול. כפרה עליך" },
  { id: "rain", label: "💸 גשם של שקדים: 50 לכל אחד", line: "הבנק השתגע! 50 שקדים לכל אחד, יא עשירים" },
  { id: "sing", label: "🎤 כולם שרים לאיתי", line: "כולם שרים לאיתי שיר אהבה, עכשיו, בלי תירוצים, יא זונות" },
  { id: "double", label: "💥 הסיבוב הבא כפול!", line: "וואלה! הסיבוב הבא כפול, יא זונות. מי שצודק לוקח פי 2" },
];

export const isLate = (s: GameState) => s.rounds.filter((r) => r.kind !== "night" && r.status === "resolved").length >= LATE_AFTER;

function pickTask(s: GameState) {
  if (!isLate(s)) return sample(TASKS);
  if (!s.rounds.some((r) => r.task === POOL_TASK) && Math.random() < 0.5) return POOL_TASK;
  return sample([...TASKS, ...LATE_TASKS]);
}

function roast(s: GameState, ids: ID[], one: string[], many: string[], groom: string[]) {
  const names = andList(ids.map((id) => nameOf(s, id)));
  if (ids.length > 1) return fill(many, names);
  return fill(s.players.find((p) => p.id === ids[0])?.isGroom && Math.random() < 0.6 ? groom : one, names);
}

/** Challenge settled: who won, who lost, and what the losers have to do now. */
function verdict(s: GameState, r: RoundRec, winId: ID) {
  const res = s.ledger.filter((e) => e.kind === "bet" && e.ref === r.id);
  const lines: Record<string, string> = {};
  // a one-on-one: the winner gets his picture and a line about the game
  const w = r.options.find((o) => o.id === winId)?.playerId;
  const rivals = r.options.filter((o) => o.playerId && o.playerId !== w).map((o) => nameOf(s, o.playerId!));
  if (w && rivals.length) {
    lines.duel = sample(LINES.duel)
      .replaceAll("{w}", nameOf(s, w))
      .replaceAll("{l}", andList(rivals))
      .replaceAll("{game}", (r.game && GAMES[r.game]?.name) || "האתגר");
    lines.duelLoser = andList(rivals);
  }
  r.task = null;
  r.losers = [];
  if (r.refunded) {
    lines.lose = sample(LINES.none);
    r.task = "כולם שותים לגימה 🍻";
    r.losers = [...new Set(s.bets.filter((b) => b.roundId === r.id).map((b) => b.playerId))];
  } else {
    const win = res.filter((e) => e.delta > 0).map((e) => e.playerId);
    const lose = res.filter((e) => e.delta < 0).map((e) => e.playerId);
    if (win.length) lines.win = roast(s, win, LINES.win1, LINES.winN, LINES.groomWin);
    if (lose.length) {
      lines.lose = roast(s, lose, LINES.lose1, LINES.loseN, LINES.groomLose);
      r.task = pickTask(s);
      r.losers = lose;
    }
  }
  r.lines = lines;
}

/** Quiz settled: praise the fastest, roast the wrong, the silent and the slow. */
function quizLines(s: GameState, r: RoundRec) {
  const answered = new Set(s.bets.filter((b) => b.roundId === r.id).map((b) => b.playerId));
  const right = s.ledger.filter((e) => e.kind === "quiz" && e.ref === r.id).map((e) => e.playerId);
  const lines: Record<string, string> = {};
  if (right.length) lines.fast = fill(LINES.fast, nameOf(s, right[0]));
  if (right.length > 1) lines.kings = `צדקו גם: ${andList(right.slice(1).map((id) => nameOf(s, id)))}`;
  if (r.loserReason === "slow" && r.losers[0]) lines.slow = fill(LINES.slow, nameOf(s, r.losers[0]));
  else if (r.losers.length) {
    const wrong = r.losers.filter((id) => answered.has(id)).map((id) => nameOf(s, id));
    const silent = r.losers.filter((id) => !answered.has(id)).map((id) => nameOf(s, id));
    const parts: string[] = [];
    if (wrong.length) parts.push(fill(wrong.length > 1 ? LINES.wrongN : LINES.wrong1, andList(wrong)));
    if (silent.length) parts.push(fill(silent.length > 1 ? LINES.silentN : LINES.silent1, andList(silent)));
    lines.shot = `${parts.join(". ")}. ${r.losers.length > 1 ? "המשימה של כולם" : "המשימה"}: לשתות שוט!`;
  }
  r.lines = lines;
}

/** Votes per option. */
function tally(s: GameState, r: RoundRec) {
  const votes = s.bets.filter((b) => b.roundId === r.id);
  const count = new Map<ID, number>();
  for (const v of votes) count.set(v.optionId, (count.get(v.optionId) ?? 0) + 1);
  return { votes, count, top: Math.max(0, ...count.values()) };
}

/** A vote is settled: the most votes drinks (everyone tied at the top), and whoever voted with the majority earns the reward. */
function settleVote(s: GameState, r: RoundRec, win: RoundOption, now: number) {
  s.ledger = s.ledger.filter((e) => !(e.kind === "vote" && e.ref === r.id));
  const { votes, count, top } = tally(s, r);
  // the host can name someone else; otherwise every option tied at the top is chosen
  const chosen = top > 0 && (count.get(win.id) ?? 0) === top ? r.options.filter((o) => (count.get(o.id) ?? 0) === top) : [win];
  const ids = new Set(chosen.map((o) => o.id));
  const pay = r.reward * payMult(r);
  const right = votes.filter((v) => ids.has(v.optionId)).map((v) => v.playerId);
  if (pay) for (const pid of right) s.ledger.push({ id: newId(), playerId: pid, delta: pay, kind: "vote", ref: r.id, note: "הצביע כמו הרוב", at: now });
  r.losers = chosen.map((o) => o.playerId).filter((x): x is ID => !!x);
  r.loserReason = "voted";
  r.refunded = false;
  r.lines = { voted: fill(r.losers.length > 1 ? LINES.votedN : LINES.voted1, andList(r.losers.map((id) => nameOf(s, id)))) };
  if (right.length) r.lines.majority = `הצביעו כמו הרוב: ${andList(right.map((id) => nameOf(s, id)))}`;
}

/** A vote closes when time is up or everyone voted, and settles itself. Nobody voted? Everybody drinks. */
export function closeVote(s: GameState, r: RoundRec, now: number) {
  r.status = "closed";
  r.closesAt = Math.min(r.closesAt ?? now, now);
  const { count, top } = tally(s, r);
  const win = top > 0 ? r.options.find((o) => count.get(o.id) === top) : undefined;
  if (win) return resolveWith(s, r, win, now);
  r.losers = s.players.filter((p) => p.token && !r.noBet.includes(p.id)).map((p) => p.id);
  Object.assign(r, { status: "resolved", winnerId: null, resolvedAt: now, refunded: true, loserReason: "voted", lines: { voted: sample(LINES.noVotes) } });
  s.lastResolvedId = r.id;
  if (s.activeRoundId === r.id) s.tv = { mode: "round", at: now, step: 0 };
  if (r.losers.length) pushFeed(s, now, "shot", `🥃 ${r.lines.voted}`, r.losers, r.id);
}

/** Right calls in a row on challenges and questions, newest first. Rounds you sat out don't break it. */
function winsInARow(s: GameState, pid: ID) {
  const played = s.rounds
    .filter((x) => (x.kind === "challenge" || x.kind === "quiz") && x.status === "resolved" && !x.refunded && s.bets.some((b) => b.roundId === x.id && b.playerId === pid))
    .sort((a, b) => (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0));
  let n = 0;
  for (const x of played) {
    if (!s.ledger.some((e) => e.playerId === pid && e.ref === x.id && ((e.kind === "bet" && e.delta > 0) || e.kind === "quiz"))) break;
    n++;
  }
  return n;
}

/** Three right in a row (then five, seven...) gets the TV and a bonus from the bank. */
function streaks(s: GameState, r: RoundRec, now: number) {
  for (const pid of new Set(s.bets.filter((b) => b.roundId === r.id).map((b) => b.playerId))) {
    const k = winsInARow(s, pid);
    if (k < 3 || k % 2 === 0) continue;
    const bonus = 50 * (k - 1);
    s.ledger.push({ id: newId(), playerId: pid, delta: bonus, kind: "streak", ref: r.id, note: `🔥 ${k} ברצף`, at: now });
    const line = sample(LINES.streak).replaceAll("{n}", nameOf(s, pid)).replaceAll("{k}", String(k));
    pushFeed(s, now, "streak", `🔥 ${line}. בונוס מהבנק: +${fmt(bonus)}`, [pid], r.id, { line, amount: bonus, streak: k });
  }
}

/** The lead changed hands: the TV crowns the new king. Not on a tie, not at the starting line, at most every 20 seconds. */
function watchKing(s: GameState, now: number) {
  const st = standings(s).filter((p) => s.players.some((x) => x.id === p.id && x.token));
  if (st.length < 2 || st[0].balance === st[1].balance || st[0].id === s.king) return;
  if (st[0].balance <= s.settings.startBalance || now - s.kingAt < 20_000) return;
  const old = s.king && s.players.some((x) => x.id === s.king) ? s.king : null;
  s.king = st[0].id;
  s.kingAt = now;
  const line = old ? sample(LINES.king).replaceAll("{n}", st[0].name).replaceAll("{o}", nameOf(s, old)) : fill(LINES.kingFirst, st[0].name);
  pushFeed(s, now, "king", `👑 ${line}`, [st[0].id], null, { line });
}

/** A mission survived its catch window: the holder is named, and whoever he played pays him. */
function payMission(s: GameState, m: Mission, now: number) {
  const holder = m.assignedTo;
  if (!holder) return;
  s.ledger = s.ledger.filter((e) => !(e.kind === "mission" && e.ref === m.id));
  const targets = [...new Set(Object.values(m.targets).filter((t): t is ID => !!t && t !== holder && s.players.some((p) => p.id === t)))];
  s.ledger.push({ id: newId(), playerId: holder, delta: m.reward, kind: "mission", ref: m.id, note: "משימה סודית", at: now });
  let left = m.reward;
  targets.forEach((t, i) => {
    const share = i === targets.length - 1 ? left : Math.floor(m.reward / targets.length);
    left -= share;
    s.ledger.push({ id: newId(), playerId: t, delta: -share, kind: "mission", ref: m.id, note: `${nameOf(s, holder)} עבד עליך`, at: now });
  });
  Object.assign(m, { status: "done", doneAt: now });
  const who = nameOf(s, holder);
  const line = targets.length
    ? sample(targets.length > 1 ? LINES.revealN : LINES.reveal)
        .replaceAll("{n}", who)
        .replaceAll("{t}", andList(targets.map((t) => nameOf(s, t))))
        .replaceAll("{r}", fmt(m.reward))
    : `${who} סגר משימה סודית ואף אחד לא תפס! +${fmt(m.reward)}`;
  pushFeed(s, now, "reveal", `🕵️ ${line}`, [holder, ...targets], m.id, { line, amount: m.reward });
}

/** Missions whose catch window is over, and nobody is still accusing their holder. */
function dueMissions(s: GameState, now: number) {
  const win = s.settings.catchWindow * 1000;
  return s.missions.filter(
    (m) =>
      m.status === "pending" &&
      m.assignedTo &&
      m.claimedAt &&
      now >= m.claimedAt + win - 30 &&
      !s.accusations.some((a) => a.status === "pending" && a.suspect === m.assignedTo),
  );
}

/** Time-based things: betting closing, missions paying out. Returns true if anything changed. */
export function tick(s: GameState, now: number): boolean {
  const before = new Map(s.players.filter((p) => p.token).map((p) => [p.id, balanceOf(s, p.id)]));
  let changed = false;
  const r = activeRound(s);
  if (r && r.status === "open" && r.closesAt && now >= r.closesAt - 30) {
    if (r.kind === "quiz") closeQuiz(s, r, now);
    else if (r.kind === "vote") closeVote(s, r, now);
    else r.status = "closed";
    changed = true;
  }
  for (const m of dueMissions(s, now)) {
    payMission(s, m, now);
    changed = true;
  }
  if (changed) {
    watchBroke(s, before, now);
    watchKing(s, now);
  }
  return changed;
}

/** When the next time-based thing is due (missions held up by an accusation wait for the host instead). */
export function nextDue(s: GameState): number | null {
  const times: number[] = [];
  const r = activeRound(s);
  if (r && r.status === "open" && r.closesAt) times.push(r.closesAt);
  const win = s.settings.catchWindow * 1000;
  for (const m of s.missions)
    if (m.status === "pending" && m.claimedAt && !s.accusations.some((a) => a.status === "pending" && a.suspect === m.assignedTo))
      times.push(m.claimedAt + win);
  return times.length ? Math.min(...times) : null;
}

function pushShout(s: GameState, sh: Omit<Shout, "id" | "at" | "hidden">, now: number) {
  s.shouts.push({ id: newId(), at: now, hidden: false, ...sh });
  if (s.shouts.length > 40) s.shouts = s.shouts.slice(-40);
}

/** Whoever drops under the bailout line becomes the show: a task on the TV, and a bailout waiting for the host. */
function watchBroke(s: GameState, before: Map<ID, number>, now: number) {
  for (const [pid, was] of before) {
    const pl = s.players.find((p) => p.id === pid);
    if (!pl?.token || was < BROKE_AT || balanceOf(s, pid) >= BROKE_AT) continue;
    if (s.bailouts.some((b) => b.playerId === pid && b.status === "pending")) continue;
    const task = sample(isLate(s) ? [...BROKE_TASKS, POOL_TASK] : BROKE_TASKS);
    const id = newId();
    s.bailouts.push({ id, playerId: pid, at: now, status: "pending", dare: task });
    const line = fill(LINES.broke, pl.name);
    pushFeed(s, now, "broke", `💸 ${line}. המשימה: ${task}`, [pid], id, { line, task });
  }
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
  const m = payMult(r);
  for (const b of bets) {
    // the double and the final multiply the profit; the groom's card doubles his again
    const delta = b.optionId === winId ? (Math.floor((b.amount * pot) / W) - b.amount) * m * (b.double ? 2 : 1) : -b.amount;
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
    const delta = (r.reward + (i === 0 ? r.bonus : 0)) * payMult(r);
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
  s.feed = s.feed.filter((e) => !(e.ref === r.id && (e.kind === "shot" || e.kind === "result" || e.kind === "streak")));
  s.ledger = s.ledger.filter((e) => !(e.kind === "streak" && e.ref === r.id));
  if (r.kind === "quiz") {
    settleQuiz(s, r, win.id, now);
    quizLines(s, r);
  } else if (r.kind === "vote") settleVote(s, r, win, now);
  else {
    settle(s, r, win.id, now);
    if (r.kind === "challenge") verdict(s, r, win.id);
  }
  Object.assign(r, { status: "resolved", winnerId: win.id, resolvedAt: now });
  s.lastResolvedId = r.id;
  if (r.kind !== "night" && s.activeRoundId === r.id) s.tv = { mode: "round", at: now, step: 0 };
  if ((r.kind === "quiz" || r.kind === "vote") && r.losers.length) pushFeed(s, now, "shot", `🥃 ${r.lines.shot ?? r.lines.slow ?? r.lines.voted ?? "שוט!"}`, r.losers, r.id);
  if (r.kind === "challenge" || r.kind === "quiz") streaks(s, r, now);
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
    : lastRound.losers.length
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
    isLate(s) ? ["🌊 המקום האחרון קופץ לבריכה!", [last]] : ["😇 הפעם אף אחד לא שותה", []],
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
      pl = { id: newId(), name, ticker: ipoTicker(s), photo: null, isGroom: false, token: newId(24), joinedAt: now, hat: null, item: null };
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
    if (r.status === "open" && r.openedAt && c.now < r.openedAt) fail("רגע, עוד מגרילים 🎰");
    if (!bettingOpen(r, c.now)) fail(r.kind === "quiz" ? "הזמן לענות נגמר" : "ההימורים כבר נסגרו");
    if (r.noBet.includes(pl.id)) fail(r.kind === "quiz" ? "על השאלה הזאת אתה לא עונה 😉" : "משתתפי האתגר לא מהמרים בסיבוב הזה");
    const opt = r.options.find((o) => o.id === c.p.optionId) ?? fail("האפשרות הזאת לא קיימת");
    if (r.kind === "quiz" || r.kind === "vote") {
      if (r.kind === "vote" && opt.playerId === pl.id) fail("להצביע לעצמך? יפה, אבל לא 😉");
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
      if (s.players.every((x) => !x.token || r.noBet.includes(x.id) || answered.has(x.id))) (r.kind === "quiz" ? closeQuiz : closeVote)(s, r, c.now);
      return { ticket };
    }
    // the final: everything you have can go on the table
    let max = r.final ? available(s, pl.id, r.id) : Math.min(r.maxBet, available(s, pl.id, r.id));
    let room = Infinity;
    if (r.kind === "night" && s.settings.nightCap > 0) {
      room = s.settings.nightCap - nightStaked(s, pl.id, r.id);
      if (room <= 0) fail(`על הימורי לילה אפשר לשים עד ${fmt(s.settings.nightCap)} ביחד, כדי שיישאר לאתגרים`);
      max = Math.min(max, room);
    }
    if (max <= 0) fail(`נגמרו לך ה${s.settings.currency}. אפשר לבקש חילוץ 🆘`);
    const min = Math.min(r.minBet, max);
    const amount = Math.round(Number(c.p.amount));
    if (!Number.isFinite(amount) || amount < min || amount > max)
      fail(amount > max && max === room ? `על הימורי לילה אפשר עד ${fmt(s.settings.nightCap)} ביחד. נשאר לך ${fmt(room)}` : `אפשר להמר על ${min} עד ${max}`);
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
    if (m.status === "done" || m.status === "pending") fail("המשימה כבר סומנה כבוצעה");
    if (s.feed.some((e) => e.kind === "mission" && e.ref === m.id && c.now - e.at < 30_000)) fail("רק עכשיו ביטלת אותה. נסה שוב עוד חצי דקה");
    Object.assign(m, { status: "pending", claimedAt: c.now, doneAt: null });
    const win = s.settings.catchWindow;
    if (win <= 0) return void payMission(s, m, c.now);
    const span = win === 90 ? "דקה וחצי" : win === 60 ? "דקה" : win === 120 ? "שתי דקות" : `${win} שניות`;
    const line = sample(LINES.alert).replaceAll("{t}", span);
    pushFeed(s, c.now, "mission", `🚨 ${line}`, [], m.id, { line, until: c.now + win * 1000 });
  },

  unclaimMission(s, c) {
    const pl = me(s, c);
    const m = findMission(s, c.p.missionId);
    if (m.assignedTo !== pl.id || (m.status !== "done" && m.status !== "pending")) fail("אי אפשר לבטל את המשימה הזאת");
    s.ledger = s.ledger.filter((e) => !(e.kind === "mission" && e.ref === m.id));
    for (const e of s.feed) if (e.kind === "mission" && e.ref === m.id && e.data?.until && e.data.until > c.now) e.data.until = c.now;
    m.status = "open";
    m.doneAt = null;
    m.claimedAt = null;
  },

  /** Stuck with a mission that can't work? Swap it for another one from the pool, for a price. */
  swapMyMission(s, c) {
    const pl = me(s, c);
    const m = findMission(s, c.p.missionId);
    if (m.assignedTo !== pl.id) fail("המשימה הזאת לא שלך");
    if (m.status !== "open") fail("אפשר להחליף רק משימה שעוד לא סימנת");
    if (available(s, pl.id) < SWAP_PRICE) fail(`החלפה עולה ${SWAP_PRICE} שקדים, ואין לך מספיק פנויים`);
    const free = s.missions.filter((x) => x.assignedTo === null && x.status === "open" && x.id !== m.id && fits(s, x, pl));
    if (!free.length) fail("אין משימות פנויות במאגר להחלפה");
    const same = free.filter((x) => x.reward === m.reward);
    const pick = sample(same.length ? same : free);
    resetMission(m);
    if (!giveMission(s, pick, pl)) fail("לא הצלחנו להחליף. נסו שוב");
    s.ledger.push({ id: newId(), playerId: pl.id, delta: -SWAP_PRICE, kind: "swap", ref: pick.id, note: "🔄 החלפת משימה", at: c.now });
    return { id: pick.id };
  },

  /** The groom's golden cards: each one works once a night, and the TV makes a scene of it. */
  groomCard(s, c) {
    const pl = me(s, c);
    if (!pl.isGroom) fail("קלפי זהב יש רק לחתן 🃏");
    const card = String(c.p.card) as GroomCard;
    if (!(card in s.cards)) fail("הקלף הזה לא קיים");
    if (s.cards[card]) fail("כבר שלפת את הקלף הזה הלילה");
    const r = activeRound(s);
    if (card === "veto") {
      if (!r || r.kind !== "challenge" || (r.status !== "open" && r.status !== "closed")) fail("וטו מטילים על אתגר שפתוח עכשיו");
      s.bets = s.bets.filter((b) => b.roundId !== r.id);
      disarmRound(s, r);
      resetRound(r);
      s.activeRoundId = null;
      if (s.draw?.roundId === r.id) s.draw = null;
      s.tv = { mode: "board", at: c.now, step: 0 };
      const line = sample(LINES.veto);
      pushFeed(s, c.now, "card", `🛑 ${line}`, [pl.id], r.id, { line, card });
    } else if (card === "double") {
      if (!r || r.kind !== "challenge" || !bettingOpen(r, c.now)) fail("מכפילים הימור על אתגר שפתוח עכשיו להימורים");
      const b = s.bets.find((x) => x.roundId === r.id && x.playerId === pl.id) ?? fail("קודם מהמרים, ואז מכפילים");
      b.double = true;
      const line = sample(LINES.doubled);
      pushFeed(s, c.now, "card", `💥 ${line}`, [pl.id], r.id, { line, card });
    } else {
      const t = findPlayer(s, c.p.target);
      if (t.id === pl.id) fail("בחר מישהו אחר 😉");
      const line = fill(LINES.drink, t.name);
      pushFeed(s, c.now, "card", `🥃 ${line}`, [t.id], null, { line, card });
    }
    s.cards[card] = true;
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

  /** Zynga style: buy someone (or yourself) a hat or a drink for their picture. */
  gift(s, c) {
    const pl = me(s, c);
    const to = findPlayer(s, c.p.to);
    const it = SHOP.find((x) => x.id === c.p.item) ?? fail("המתנה הזאת לא קיימת");
    if (s.ledger.some((e) => e.kind === "gift" && e.playerId === pl.id && c.now - e.at < 5000)) fail("רגע, לאט עם המתנות 🙂");
    if (available(s, pl.id) - it.price < BROKE_AT) fail(`אחרי המתנה לא יישאר לך כמעט כלום. תשאיר לעצמך לפחות ${BROKE_AT} 😉`);
    if (it.slot === "hat") to.hat = it.emoji;
    else to.item = it.emoji;
    s.ledger.push({ id: newId(), playerId: pl.id, delta: -it.price, kind: "gift", ref: to.id, note: `${it.emoji} ${it.name} ל${to.name}`, at: c.now });
    const text =
      to.id === pl.id
        ? `🎁 ${pl.name} קנה לעצמו ${it.name} ${it.emoji}. ${sample(LINES.selfGift)}`
        : `🎁 ${pl.name} קנה ל${to.name} ${it.name} ${it.emoji}. ${sample(LINES.gift)}`;
    pushFeed(s, c.now, "gift", text, to.id === pl.id ? [pl.id] : [pl.id, to.id], to.id, { amount: it.price });
  },

  shout(s, c) {
    const pl = me(s, c);
    const text = str(c.p.text, 90);
    if (!text) fail("כתבו משהו");
    const last = s.shouts.findLast((x) => x.author === pl.id);
    if (last && c.now - last.at < 4000) fail("רגע, לאט לאט 🙂");
    pushShout(s, { author: pl.id, anon: !!c.p.anon, text, photo: null }, c.now);
  },

  shoutPhoto(s, c) {
    const pl = me(s, c);
    const photo = media(c.p.photo) ?? fail("התמונה לא עלתה. נסו שוב");
    const last = s.shouts.findLast((x) => x.author === pl.id && x.photo);
    if (last && c.now - last.at < 15_000) fail("תמונה אחת כל 15 שניות 🙂");
    pushShout(s, { author: pl.id, anon: !!c.p.anon, text: str(c.p.text, 60) || null, photo }, c.now);
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
    let options: RoundOption[] = (Array.isArray(d.options) ? d.options : [])
      .map((o: any) => {
        const playerId = o?.playerId && s.players.some((x) => x.id === o.playerId) ? String(o.playerId) : null;
        const label = str(o?.label, 40) || (playerId ? s.players.find((x) => x.id === playerId)!.name : "");
        let id = str(o?.id, 24) || playerId || newId(6);
        if (seen.has(id)) id = newId(6);
        seen.add(id);
        return { id, label, playerId };
      })
      .filter((o) => o.label);
    const kind: RoundKind = d.kind === "night" || d.kind === "quiz" || d.kind === "vote" ? d.kind : "challenge";
    // a vote is always about everybody
    if (kind === "vote") options = s.players.map((x) => ({ id: x.id, label: x.name, playerId: x.id }));
    if (options.length < 2) fail("צריך לפחות 2 אפשרויות");
    if (options.length > 10) fail("אפשר עד 10 אפשרויות");
    const minBet = int(d.minBet, 50, 1, 1_000_000);
    const maxBet = int(d.maxBet, 500, minBet, 1_000_000);
    const seconds = kind === "night" ? 0 : int(d.seconds, kind === "quiz" ? 25 : kind === "vote" ? 40 : 60, 0, 900);
    const bonus = kind === "vote" ? 0 : int(d.bonus, kind === "quiz" ? 50 : s.settings.bankBonus, 0, 1_000_000);
    const reward = kind === "quiz" || kind === "vote" ? int(d.reward, 100, 0, 1_000_000) : 0;
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
      lines: {},
      task: null,
      game: null,
      mult: 1,
      final: false,
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
      armRound(s, r, !!p.final);
    }
    Object.assign(r, { status: "open", closesAt: seconds > 0 ? now + seconds * 1000 : null, winnerId: null, resolvedAt: null, refunded: false, losers: [], loserReason: null, lines: {}, task: null });
    s.activeRoundId = r.id;
    s.tv = { mode: "round", at: now, step: 0 };
  },

  /** The host decides when, the pool decides what: a random challenge or quiz, opened after the TV's reel spins. */
  drawRound(s, { p, now }) {
    // the final only lands on a challenge
    const final = !!p.final;
    const mix = p.kind === "any" && !final;
    const kind: RoundKind = final ? "challenge" : p.kind === "quiz" ? "quiz" : p.kind === "vote" ? "vote" : "challenge";
    const cur = activeRound(s);
    let skip: ID | null = null;
    if (cur && (cur.status === "open" || cur.status === "closed")) {
      if (!p.redraw) fail(`הסיבוב ״${cur.title}״ עדיין פעיל. קודם הכריזו תוצאה או בטלו אותו`);
      if (s.bets.some((b) => b.roundId === cur.id)) fail("כבר יש הימורים על הסיבוב הזה. בטלו אותו קודם");
      disarmRound(s, cur);
      resetRound(cur);
      skip = cur.id;
    }
    const pool = s.rounds.filter((r) => (mix ? r.kind !== "night" : r.kind === kind) && r.status === "draft" && r.id !== skip);
    const forced = SURPRISES.find((x) => x.id === p.pick);
    if (!pool.length && !mix) fail(kind === "quiz" ? "נגמרו שאלות הידע במאגר" : kind === "vote" ? "נגמרו ההצבעות במאגר" : "נגמרו האתגרים במאגר");
    // the mixed wheel lands on a surprise now and then (always when the pool is empty)
    const surprise = mix ? (forced ?? (!pool.length || Math.random() < 0.2 ? sample(SURPRISES) : undefined)) : undefined;
    const r = surprise ? undefined : sample(pool);
    type Seg = { t: string; k: string };
    const ofRound = (x: RoundRec): Seg => ({ t: `${x.emoji} ${x.title}`, k: x.kind === "quiz" ? "q" : x.kind === "vote" ? "v" : "c" });
    const ofSurprise = (x: (typeof SURPRISES)[number]): Seg => ({ t: x.label, k: "s" });
    const chosen = surprise ? ofSurprise(surprise) : ofRound(r!);
    // a few surprises always show on the mixed wheel, so it looks like anything can happen
    const extra = mix ? shuffle(SURPRISES.filter((x) => x !== surprise)).slice(0, 3).map(ofSurprise) : [];
    const others = shuffle([
      ...s.rounds.filter((x) => (mix ? x.kind !== "night" : x.kind === kind) && x !== r).map(ofRound),
      ...(mix ? SURPRISES.filter((x) => x !== surprise).map(ofSurprise) : []),
    ]);
    const seen = new Set([chosen.t]);
    const list: Seg[] = [];
    for (const x of [...extra, ...others]) if (!seen.has(x.t)) seen.add(x.t) && list.push(x);
    const segs = shuffle(list.slice(0, 11));
    const index = Math.floor(Math.random() * (segs.length + 1));
    segs.splice(index, 0, chosen);
    s.draw = { at: now, roundId: r?.id ?? null, titles: segs.map((x) => x.t), kinds: segs.map((x) => x.k), index, surprise: surprise?.id ?? null };
    s.tv = { mode: s.tv.mode === "round" || r ? "round" : s.tv.mode, at: now, step: 0 };
    if (surprise) {
      const st = standings(s);
      const line = surprise.line.replaceAll("{king}", st[0]?.name ?? "המלך").replaceAll("{last}", st[st.length - 1]?.name ?? "השקד המר");
      if (surprise.id === "double") s.doubleNext = true;
      if (surprise.id === "rain")
        for (const pl of s.players.filter((x) => x.token))
          s.ledger.push({ id: newId(), playerId: pl.id, delta: 50, kind: "adjust", ref: null, note: "גשם של שקדים מגלגל הבלגן", at: now });
      const who = surprise.id === "king" ? [st[0]?.id] : surprise.id === "bitter" ? [st[st.length - 1]?.id] : s.players.filter((x) => x.token).map((x) => x.id);
      pushFeed(s, now, "spin", `🎡 ${surprise.label} ${line}`, who.filter((x): x is ID => !!x), null, { line, until: now + DRAW_MS, surprise: surprise.id });
      if (cur && cur.status === "resolved") s.activeRoundId = cur.id;
      return { title: surprise.label, surprise: surprise.id };
    }
    s.bets = s.bets.filter((b) => b.roundId !== r!.id);
    const start = now + DRAW_MS;
    Object.assign(r!, { status: "open", openedAt: start, closesAt: r!.seconds > 0 ? start + r!.seconds * 1000 : null, winnerId: null, resolvedAt: null, refunded: false, losers: [], loserReason: null, lines: {}, task: null });
    armRound(s, r!, final);
    s.activeRoundId = r!.id;
    return { id: r!.id, title: r!.title, final: r!.final, mult: r!.mult };
  },

  hideShout(s, { p }) {
    const sh = s.shouts.find((x) => x.id === p.shoutId) ?? fail("ההודעה לא נמצאה");
    sh.hidden = true;
  },

  /** Pick a game and two guys, and betting opens right away. */
  quickDuel(s, { p, now }) {
    const key = String(p.game);
    const g = GAMES[key] ?? fail("בחרו משחק");
    const a = findPlayer(s, p.a);
    const b = findPlayer(s, p.b);
    if (a.id === b.id) fail("בחרו שני שחקנים שונים");
    const cur = activeRound(s);
    if (cur && (cur.status === "open" || cur.status === "closed")) fail(`הסיבוב ״${cur.title}״ עדיין פעיל. קודם הכריזו תוצאה או בטלו אותו`);
    const seconds = int(p.seconds, 60, 0, 900);
    const r: RoundRec = {
      id: `duel-${newId()}`,
      kind: "challenge",
      emoji: g.emoji,
      title: `${g.name}: ${a.name} נגד ${b.name}. מי ינצח?`,
      note: g.note,
      image: null,
      options: [
        { id: a.id, label: a.name, playerId: a.id },
        { id: b.id, label: b.name, playerId: b.id },
      ],
      minBet: 50,
      maxBet: 500,
      seconds,
      bonus: s.settings.bankBonus,
      reward: 0,
      correctId: null,
      noBet: [a.id, b.id],
      status: "open",
      openedAt: now,
      closesAt: seconds > 0 ? now + seconds * 1000 : null,
      winnerId: null,
      resolvedAt: null,
      refunded: false,
      losers: [],
      loserReason: null,
      lines: {},
      task: null,
      game: key,
      mult: 1,
      final: false,
    };
    armRound(s, r, !!p.final);
    const firstNight = s.rounds.findIndex((x) => x.kind === "night");
    s.rounds.splice(firstNight < 0 ? s.rounds.length : firstNight, 0, r);
    s.activeRoundId = r.id;
    s.tv = { mode: "round", at: now, step: 0 };
    return { id: r.id };
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
    if (r.status === "closed" || (r.closesAt !== null && r.closesAt <= now)) fail("ההימורים כבר נחשפו לכולם, אז אי אפשר לפתוח שוב. אפשר לבטל את הסיבוב ולפתוח מחדש");
    const add = int(p.seconds, 30, 5, 600) * 1000;
    const base = r.status === "open" && r.closesAt && r.closesAt > now ? r.closesAt : now;
    r.status = "open";
    r.closesAt = base + add;
  },

  closeRound(s, { p, now }) {
    const r = findRound(s, p.roundId);
    if (r.status !== "open") fail("ההימורים כבר סגורים");
    if (r.kind === "quiz") return void closeQuiz(s, r, now);
    if (r.kind === "vote") return void closeVote(s, r, now);
    r.status = "closed";
    r.closesAt = Math.min(r.closesAt ?? now, now);
  },

  resolveRound(s, { p, now }) {
    const r = findRound(s, p.roundId);
    if (r.status === "draft") fail("הסיבוב עוד לא נפתח");
    const win = r.options.find((o) => o.id === p.optionId) ?? fail("בחרו את האפשרות שניצחה");
    if (r.status === "resolved" && r.winnerId === win.id) return;
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
    s.ledger = s.ledger.filter((e) => !((e.kind === "bet" || e.kind === "quiz" || e.kind === "vote" || e.kind === "streak") && e.ref === r.id));
    s.feed = s.feed.filter((e) => !(e.ref === r.id && (e.kind === "shot" || e.kind === "streak")));
    Object.assign(r, { status: "closed", winnerId: null, resolvedAt: null, refunded: false, losers: [], loserReason: null, lines: {}, task: null });
  },

  cancelRound(s, { p, now }) {
    const r = findRound(s, p.roundId);
    s.ledger = s.ledger.filter((e) => !((e.kind === "bet" || e.kind === "quiz" || e.kind === "vote" || e.kind === "streak") && e.ref === r.id));
    s.bets = s.bets.filter((b) => b.roundId !== r.id);
    disarmRound(s, r);
    resetRound(r);
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
      if (moved && existing.status !== "open") fail("משימה שכבר סומנה, בוצעה או נשרפה אי אפשר להעביר");
      if (existing.status !== "open" && reward !== existing.reward) fail("אי אפשר לשנות פרס של משימה שכבר סומנה או בוצעה");
      if (existing.status !== "open" && [...slotsOf(template)].some((k) => !existing.targets[k])) fail("אי אפשר להוסיף שמות למשימה שכבר סומנה או בוצעה");
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
      m.claimedAt ??= now;
      payMission(s, m, now);
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
      const worth = Math.max(m.reward, s.settings.catchReward);
      s.ledger = s.ledger.filter((e) => !(e.kind === "mission" && e.ref === m.id));
      Object.assign(m, { status: "burned", caughtBy: a.by, doneAt: null, claimedAt: null });
      Object.assign(a, { status: "right", missionId: m.id });
      s.ledger.push({ id: newId(), playerId: a.by, delta: worth, kind: "catch", ref: a.id, note: `תפס את ${suspect}`, at: now });
      s.ledger.push({ id: newId(), playerId: a.suspect, delta: -worth, kind: "catch", ref: a.id, note: `נתפס על ידי ${by}`, at: now });
      dealTo(s, findPlayer(s, a.suspect));
      pushFeed(s, now, "caught", `🕵️ ${by} תפס את ${suspect} על חם! המשימה: ${m.text}. ${by} גונב לו ${fmt(worth)} שקדים. ${sample(LINES.caught)}`, [a.by, a.suspect], a.id, { amount: worth, mission: m.id });
    } else {
      a.status = "wrong";
      s.ledger.push({ id: newId(), playerId: a.by, delta: -s.settings.falsePenalty, kind: "penalty", ref: a.id, note: "האשמת שווא", at: now });
      s.ledger.push({ id: newId(), playerId: a.suspect, delta: s.settings.falsePenalty, kind: "penalty", ref: a.id, note: "פיצוי על האשמת שווא", at: now });
      pushFeed(s, now, "miss", `🤡 האשמת שווא! ${by} חשד ב${suspect} ופספס. ${sample(LINES.miss)}`, [a.by, a.suspect], a.id);
    }
  },

  judgeBailout(s, { p, now }) {
    const b = s.bailouts.find((x) => x.id === p.bailoutId && x.status === "pending") ?? fail("הבקשה כבר טופלה");
    if (!p.approve) {
      b.status = "denied";
      return;
    }
    const amount = s.settings.bailoutAmount;
    Object.assign(b, { status: "granted", dare: b.dare ?? sample(DARES) });
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
    const pl: PlayerRec = { id: newId(), name, ticker, photo: media(d.photo), isGroom, token: null, joinedAt: null, hat: null, item: null };
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
      prize1: str(d.prize1, 120) || cur.prize1,
      prize2: str(d.prize2, 120) || cur.prize2,
      prize3: str(d.prize3, 120) || cur.prize3,
      prizeLast: str(d.prizeLast, 120) || cur.prizeLast,
      nightCap: int(d.nightCap, cur.nightCap, 0, 1_000_000),
      catchWindow: int(d.catchWindow, cur.catchWindow, 0, 900),
    };
  },

  resetGame(s, { p, now }) {
    Object.assign(s, { bets: [], ledger: [], accusations: [], bailouts: [], feed: [], shouts: [], wheel: null, draw: null, seq: 0, activeRoundId: null, lastResolvedId: null });
    Object.assign(s, { doubleNext: false, king: null, kingAt: 0, cards: { veto: false, double: false, drink: false } });
    for (const pl of s.players) Object.assign(pl, { hat: null, item: null });
    s.rounds = s.rounds.filter((r) => !r.id.startsWith("duel-"));
    for (const r of s.rounds)
      resetRound(r);
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
  const before = new Map(s.players.filter((p) => p.token).map((p) => [p.id, balanceOf(s, p.id)]));
  const out = route(s, c);
  if (c.a !== "reseed" && c.a !== "resetGame") {
    watchBroke(s, before, c.now);
    watchKing(s, c.now);
  }
  return out;
}

function route(s: GameState, c: Ctx): unknown {
  if (Object.hasOwn(PLAYER, c.a)) return PLAYER[c.a](s, c);
  if (Object.hasOwn(ADMIN, c.a)) {
    if (!c.admin) fail("צריך הרשאת מנחה");
    return ADMIN[c.a](s, c);
  }
  fail("פעולה לא מוכרת");
}
