import type { Audience, GameState, ID, Mission, PlayerRec, RoundKind, RoundOption, RoundRec, Settings } from "../shared/types";

const PLAYERS: [id: string, name: string, ticker: string, groom?: boolean][] = [
  ["itay", "איתי", "SHKD", true],
  ["benharoosh", "בן הרוש", "BNHR"],
  ["ayalon", "איילון", "AYLN"],
  ["drori", "דרורי", "DROR"],
  ["birman", "בירמן", "BIRM"],
  ["yali", "יהלי", "YHLI"],
  ["sisu", "סיסו", "SISU"],
  ["shmay", "שמאי", "SHMI"],
];

const NAME = Object.fromEntries(PLAYERS.map(([id, name]) => [id, name]));
const ALL = PLAYERS.map((p) => p[0]);
const FRIENDS = PLAYERS.filter((p) => !p[3]).map((p) => p[0]);

const yesNo = (): RoundOption[] => [
  { id: "yes", label: "כן", playerId: null },
  { id: "no", label: "לא", playerId: null },
];
const vs = (...ids: string[]): RoundOption[] => ids.map((id) => ({ id, label: NAME[id], playerId: id }));
const labels = (...ls: string[]): RoundOption[] => ls.map((label, i) => ({ id: `o${i + 1}`, label, playerId: null }));

type RoundSeed = [emoji: string, title: string, note: string, options: RoundOption[], noBet: string[], game?: string];
type QuizSeed = [emoji: string, title: string, note: string, options: RoundOption[], correct: ID | null, noBet: string[]];

// Challenges: the host opens one at a time, everyone bets into a shared pot.
const CHALLENGES: RoundSeed[] = [
  ["🏀", "איתי יקלע 3 כדורים לכוסות תוך 30 שניות?", "בירפונג של החתן. שלוש קליעות לפני שנגמר הזמן = כן.", yesNo(), ["itay"]],
  ["🥜", "כמה שקדים איתי יתפוס בפה מתוך 5 זריקות?", "זורקים מ־3 מטרים. מה שנופל לרצפה לא נחשב. כן, זה השם של המשחק.", labels("0–1", "2–3", "4–5"), ["itay"]],
  ["💪", "מי ינצח בהורדת ידיים?", "החתן נגד איילון. הטוב משלושה, יד ימין.", vs("itay", "ayalon"), ["itay", "ayalon"], "arm"],
  ["🙈", "איתי יזהה לפחות 3 מ־5 חברים רק לפי מגע בפנים?", "עיניים מכוסות, 10 שניות לכל פרצוף, אסור לדבר.", yesNo(), ["itay"]],
  ["😂", "יהלי יצליח להצחיק את איתי תוך 30 שניות?", "איתי חייב להישאר רציני. חיוך אחד = כן.", yesNo(), ["yali", "itay"]],
  ["🏝️", "את מי איתי ייקח איתו לחודש על אי בודד?", "איתי בוחר בלייב. אסור לשחד אותו בקול רם.", vs(...FRIENDS), ["itay"]],
  ["📱", "כמה תמונות של שחף יש לאיתי בגלריה מהחודש האחרון?", "סופרים ביחד בטלפון שלו. איתי לא נוגע.", labels("פחות מ־50", "50–150", "יותר מ־150"), ["itay"]],
  ["🥤", "מי יבנה פירמידה של 10 כוסות מהר יותר?", "דרורי נגד סיסו. נפלה? מתחילים מחדש.", vs("drori", "sisu"), ["drori", "sisu"], "pyramid"],
  ["🌶️", "דרורי יחזיק פלפל חריף בפה דקה שלמה בלי לשתות?", "דקה בטיימר. לגימה אחת של מים = לא.", yesNo(), ["drori"]],
  ["🍋", "בן הרוש יאכל פלח לימון בלי לעשות פרצוף?", "פרצוף אחד = לא. השופט: החתן.", yesNo(), ["benharoosh"]],
  ["🏊", "מי יחזיק הכי הרבה זמן את הנשימה מתחת למים?", "בבריכה, כולם צוללים ביחד. מי שעולה ראשון יוצא.", vs("ayalon", "yali", "sisu", "shmay"), ["ayalon", "yali", "sisu", "shmay"], "breath"],
  ["🕺", "מי ינצח בקרב הריקודים?", "איילון נגד שמאי, 30 שניות לכל אחד. מחיאות הכפיים מכריעות.", vs("ayalon", "shmay"), ["ayalon", "shmay"], "dance"],
  ["🍺", "צ׳אג: מי יסיים כוס בירה ראשון?", "איתי נגד סיסו. שותים עד הסוף, בלי לשפוך.", vs("itay", "sisu"), ["itay", "sisu"], "chug"],
  ["📞", "איתי ישכנע את שחף להגיד בטלפון ״אני מתה על החברים שלך״?", "דקה אחת, רמקול פתוח, אסור להסביר לה למה.", yesNo(), ["itay"]],
  ["🫡", "מי יעשה יותר שכיבות סמיכה בדקה?", "בירמן נגד שמאי. כל הווילה סופרת בקול.", vs("birman", "shmay"), ["birman", "shmay"], "pushups"],
  ["🎭", "איתי יחקה 3 חברים, והחבר׳ה ינחשו את כולם?", "עשר שניות לכל חיקוי. ניחוש אחד לא נכון = לא.", yesNo(), ["itay"]],
  ["🎤", "איתי ישיר את כל הפזמון בקריוקי בלי להציץ במילים?", "את השיר בוחרים החברים. טעות אחת = לא.", yesNo(), ["itay"]],
  // the villa's table games: one on one, short games to 4
  ["🏒", "הוקי אוויר: איתי נגד בירמן. מי ינצח?", "משחק קצר עד 4 גולים. גול עצמי = לגימה.", vs("itay", "birman"), ["itay", "birman"], "airhockey"],
  ["🏒", "הוקי אוויר: סיסו נגד שמאי. מי ינצח?", "משחק קצר עד 4 גולים.", vs("sisu", "shmay"), ["sisu", "shmay"], "airhockey"],
  ["🏓", "פינג פונג: דרורי נגד יהלי. מי ינצח?", "משחק קצר עד 4 נקודות. מגישים לסירוגין.", vs("drori", "yali"), ["drori", "yali"], "pingpong"],
  ["🏓", "פינג פונג: איילון נגד בן הרוש. מי ינצח?", "משחק קצר עד 4 נקודות.", vs("ayalon", "benharoosh"), ["ayalon", "benharoosh"], "pingpong"],
  ["🏓", "פינג פונג: איתי נגד שמאי. מי ינצח?", "משחק קצר עד 4 נקודות. החתן מגיש ראשון.", vs("itay", "shmay"), ["itay", "shmay"], "pingpong"],
  ["⚽", "כדורגל שולחן: בירמן נגד סיסו. מי ינצח?", "משחק קצר עד 4 גולים. אסור לסובב מוטות 360.", vs("birman", "sisu"), ["birman", "sisu"], "foosball"],
  ["⚽", "כדורגל שולחן: יהלי נגד איילון. מי ינצח?", "משחק קצר עד 4 גולים.", vs("yali", "ayalon"), ["yali", "ayalon"], "foosball"],
  ["⚽", "כדורגל שולחן זוגות: מי ינצח?", "איתי ודרורי נגד בן הרוש ובירמן. משחק קצר עד 4 גולים.", labels("איתי ודרורי", "בן הרוש ובירמן"), ["itay", "drori", "benharoosh", "birman"], "foosball"],
  ["🍔", "איתי יהפוך 6 המבורגרים על האש בלי שאף אחד ייפול?", "במנגל של הווילה, עם מרית אחת. נפל אחד = לא.", yesNo(), ["itay"]],
  ["🤸", "עמידת ידיים: סיסו נגד איתי. מי יחזיק יותר זמן?", "מותר להישען על הקיר, אסור ליפול.", vs("sisu", "itay"), ["sisu", "itay"], "handstand"],
  // not everything has to be physical: bets on what Itay knows, remembers and does
  ["🧠", "איתי יזכור את התאריך המדויק שבו הוא ושחף התחילו לצאת?", "בלי לבדוק בטלפון. שחף מאשרת בווטסאפ.", yesNo(), ["itay"]],
  ["📱", "איתי יצליח לדקלם את המספר של שחף בעל פה?", "בלי טלפון ביד. ספרה אחת לא נכונה = לא.", yesNo(), ["itay"]],
  ["🧮", "איתי יפתור 17×23 בראש תוך 10 שניות?", "בלי מחשבון ובלי אצבעות. התשובה: 391.", yesNo(), ["itay"]],
  ["🗺️", "איתי ימצא את ירכא במפה בלי שמות, תוך 15 שניות?", "גוגל מפות במצב לוויין, מזום של כל הארץ.", yesNo(), ["itay"]],
  ["📸", "כמה לייקים יש לפוסט האחרון של איתי באינסטגרם?", "בודקים ביחד בטלפון.", labels("פחות מ־100", "100–250", "יותר מ־250"), []],
  ["💬", "כמה הודעות שחף שלחה לאיתי מאז שהגענו?", "סופרים בווטסאפ שלו. איתי לא נוגע בטלפון.", labels("0–5", "6–20", "יותר מ־20"), ["itay"]],
  ["🤥", "איתי יספר 3 דברים על עצמו, אחד מהם שקר. רוב החבר׳ה ינחשו מה השקר?", "כל אחד אומר בקול, אחר כך איתי מגלה.", yesNo(), ["itay"]],
  ["😳", "איתי יספר את הסיפור הכי מביך שלו בלי לצחוק באמצע?", "חיוך אחד = לא.", yesNo(), ["itay"]],
];

// Quiz questions: everyone answers on the phone. Right = almonds, wrong = a shot on the big screen.
// correct = null means "איתי עונה בלייב" and the host taps the right answer at reveal.
const QUIZ: QuizSeed[] = [
  ["🍕", "אוכל אחד לכל החיים. מה איתי בוחר?", "כולם עונים, ואז איתי אומר את התשובה שלו בקול.", labels("פיצה", "שווארמה", "סושי", "המבורגר"), null, ["itay"]],
  ["🥜", "שקד הוא בעצם…", "שאלת ידע. יש רק תשובה אחת נכונה.", labels("אגוז", "זרע של פרי", "קטנייה", "גרעין של תמר"), "o2", []],
  ["😴", "כמה שעות איתי ישן בלילה רגיל?", "איתי עונה.", labels("פחות מ־6", "6", "7", "8 ומעלה"), null, ["itay"]],
  ["🌍", "איזו מדינה מגדלת הכי הרבה שקדים בעולם?", "שאלת ידע.", labels("ארצות הברית", "ספרד", "איראן", "טורקיה"), "o1", []],
  ["👶", "כמה ילדים איתי רוצה?", "איתי עונה.", labels("1", "2", "3", "4 ומעלה"), null, ["itay"]],
  ["📱", "איזו אפליקציה איתי פותח הכי הרבה?", "בודקים בזמן מסך בטלפון שלו.", labels("אינסטגרם", "וואטסאפ", "טיקטוק", "יוטיוב"), null, ["itay"]],
  ["🤵", "מה איתי ילבש לחתונה?", "איתי עונה.", labels("חליפה שחורה", "חליפה כחולה", "חליפה בהירה", "בלי חליפה בכלל"), null, ["itay"]],
  ["🍳", "מה איתי הכי יודע לבשל?", "איתי עונה, החבר׳ה מאשרים.", labels("שקשוקה", "פסטה", "חביתה", "כלום, רק וולט"), null, ["itay"]],
  ["🕰️", "מי מהחבר׳ה מכיר את איתי הכי מזמן?", "איתי עונה.", vs(...FRIENDS), null, ["itay"]],
];

// Night bets: open all night next to the challenges, settled when it actually happens.
const NIGHT: RoundSeed[] = [
  ["😴", "מי יירדם ראשון הלילה?", "נרדם באמת, לא עצם עיניים לרגע. המנחה מאשר.", vs(...ALL), []],
  ["♠️", "מי ינצח בטורניר הפוקר?", "ההימורים נסגרים כשמחולקת היד הראשונה.", vs(...ALL), []],
  ["📞", "איתי יתקשר לשחף לפני חצות?", "שיחה אמיתית, לא הודעה.", yesNo(), ["itay"]],
  ["🦉", "איתי עדיין יהיה ער ב־03:00?", "ער = מדבר ועונה לשאלות.", yesNo(), ["itay"]],
  ["🌊", "איתי ייזרק לבריכה הלילה?", "עם בגדים או בלי, זה נחשב.", yesNo(), ["itay"]],
  ["🔥", "לפחות נתח בשר אחד יישרף על האש?", "שרוף = שחור. המנחה שופט.", yesNo(), []],
  ["☀️", "מי יתעורר אחרון מחר בבוקר?", "מי שיוצא אחרון מהמיטה.", vs(...ALL), []],
];

// Secret missions. {G} = the groom, {X} / {Y} = other players picked when the mission is dealt.
// Nobody ever gets a mission about himself.
type MissionSeed = [template: string, reward: number, audience: Audience];

const MISSIONS: MissionSeed[] = [
  // about the groom (never dealt to the groom)
  ["תגרום ל{G} להציע לך נישואין על ברך אחת", 200, "friends"],
  ["תגרום ל{G} להגיד בקול ״אני אגוז קשה״", 150, "friends"],
  ["תגרום ל{G} להודות שהוא בוכה בסרטים של דיסני", 150, "friends"],
  ["תגרום ל{G} לנאום לך נאום חתונה, כאילו אתה הכלה", 200, "friends"],
  ["תגרום ל{G} להראות לך את הריקוד שהוא מתכנן לחתונה", 150, "friends"],
  ["תגרום ל{G} ללבוש מגבת כמו גלימה של סופרמן לפחות 2 דקות", 150, "friends"],
  ["תגרום ל{G} להגיד ״שחף תמיד צודקת״ בלי שתבקש ממנו", 100, "friends"],
  ["תגרום ל{G} לעשות 10 שכיבות סמיכה כשאתה יושב לו על הגב", 200, "friends"],
  ["תגרום ל{G} להאכיל אותך ביס מהצלחת שלו", 100, "friends"],
  ["תגרום ל{G} לחקות איך שחף מעירה לו על משהו", 150, "friends"],
  ["תגרום ל{G} להגיד עם כוס ביד ״זאת הפעם האחרונה שאני רווק״", 100, "friends"],
  ["תגרום ל{G} להפסיד לך בכדורגל שולחן ולהגיד ״אתה המלך״", 200, "friends"],
  // about another player
  ["תגרום ל{X} לקרוא לך ״אבא״", 150, "all"],
  ["תגרום ל{X} להצטלם איתך בפוזת טיטאניק", 150, "all"],
  ["תגרום ל{X} למרוח לך קרם הגנה על הגב", 150, "all"],
  ["תגרום ל{X} לעשות לך מסאז׳ בכתפיים לפחות 10 שניות", 100, "all"],
  ["תגרום ל{X} להחליף איתך נעליים לחצי שעה", 200, "all"],
  ["תגרום ל{X} לבקש ממך סליחה על משהו שהוא בכלל לא עשה", 150, "all"],
  ["תגרום ל{X} לחקות תרנגולת מול כולם", 150, "all"],
  ["תגרום ל{X} להאכיל אותך ביד", 100, "all"],
  ["תגרום ל{X} להגיד ״אני קרנבל של רגשות״ בלי שתבקש ממנו", 200, "all"],
  ["תגרום ל{X} לענות לך ״כן המפקד״ שלוש פעמים", 100, "all"],
  ["תגרום ל{X} לסדר לך את השיער", 100, "all"],
  ["תגרום ל{X} לצלם אותך 10 פעמים עד שתהיה מרוצה מהתמונה", 100, "all"],
  ["תגרום ל{X} לדבר במבטא רוסי לפחות דקה", 150, "all"],
  ["תגרום ל{X} להוריד את החולצה בלי לבקש ממנו ישירות", 200, "all"],
  ["תגרום ל{X} להניח את הראש שלו על הכתף שלך", 150, "all"],
  ["תגרום ל{X} להתקשר אליך כשאתה עומד ממש לידו", 150, "all"],
  ["תגרום ל{X} להכריז בקול ״אני הכי חתיך פה״", 150, "all"],
  ["תגרום ל{X} לרקוד על כיסא לפחות 10 שניות", 200, "all"],
  ["תגרום ל{X} לספר לך את הסיפור הכי מביך שלו מהצבא", 150, "all"],
  ["תגרום ל{X} ללכת על ארבע לפחות 3 מטרים", 200, "all"],
  ["תגרום ל{X} לקרוא לך ״המלך״ שלוש פעמים", 200, "all"],
  ["תגרום ל{X} לנשק לך את הלחי", 150, "all"],
  ["תגרום ל{X} לזרוק לך שקד לפה מ־3 מטרים, ולתפוס", 100, "all"],
  ["תגרום ל{X} לשיר לך ״יום הולדת שמח״, למרות שאין לך יום הולדת", 150, "all"],
  ["תתנהג מוזר עד ש{X} ישאל אותך ״אחי, אתה בסדר?״", 100, "all"],
  ["תגרום ל{X} להיכנס איתך לבריכה עם הבגדים", 200, "all"],
  ["תנצח את {X} בפינג פונג ותעשה לו ריקוד ניצחון מוגזם בפרצוף", 150, "all"],
  ["תגרום ל{X} לשחק איתך הוקי אוויר עם יד אחת מאחורי הגב", 150, "all"],
  ["תגרום ל{X} להתערב איתך על שוט ולהפסיד לך בפינג פונג", 200, "all"],
  ["תגרום ל{X} לעמוד מתחת למפל בבריכה עם הבגדים", 200, "all"],
  ["תגרום ל{X} לצעוק ״אני מלך העולם״ מהמרפסת עם הנוף", 150, "all"],
  ["תגרום ל{X} להביא לך משהו מהמנגל ולהגיש לך אותו כמו מלצר", 100, "all"],
  // about two other players
  ["תגרום ל{X} ול{Y} לרקוד סלואו ביחד", 200, "all"],
  ["תגרום ל{X} ול{Y} להתווכח מי מהם יותר יפה", 150, "all"],
  ["תגרום ל{X} להגיד ל{Y} ״אתה הכי יפה פה״", 150, "all"],
  ["תגרום ל{X} להרים את {Y} על הידיים", 200, "all"],
  ["תגרום ל{X} ול{Y} להחליף חולצות", 200, "all"],
  ["תגרום ל{X} ול{Y} לשחק כדורגל שולחן כשהם מדברים רק באנגלית", 150, "all"],
  // only for the groom
  ["תגרום ל{X} לנאום לכבודך עם כוס ביד", 150, "groom"],
  ["תגרום ל{X} לפנות לך את המקום שלו על הספה, בלי לבקש ישירות", 100, "groom"],
  ["תגרום ל{X} להגיד ״שחף זכתה בלוטו״", 150, "groom"],
  ["תגרום ל{X} לשיר לך שיר אהבה (לפחות שורה)", 200, "groom"],
  ["תגרום ל{X} להרים אותך על הידיים", 200, "groom"],
  ["תגרום ל{X} לנגב לך את הפה אחרי שאכלת", 150, "groom"],
  ["תגרום ל{X} לשחק נגדך הוקי אוויר בעיניים עצומות", 150, "groom"],
  ["תגרום ל{X} לעמוד לידך במנגל ולהגיד ״כן, שף״", 100, "groom"],
];

/** Ids that say nothing: an alert carries the mission id, and ordered ids would give away whose list it came from. */
function randomId() {
  const a = new Uint8Array(8);
  crypto.getRandomValues(a);
  return [...a].map((b) => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32]).join("");
}

export const DEFAULT_SETTINGS: Settings = {
  currency: "שקדים",
  startBalance: 1000,
  allowJoinNew: false,
  bankBonus: 200,
  catchReward: 100,
  falsePenalty: 50,
  bailoutAmount: 300,
  prize1: "מלך השקדים: כולם משתחווים לו בבוקר, והשקד המר הוא המשרת האישי שלו עד הצהריים",
  prize2: "בוחר לשקד המר תלבושת, שהוא חייב ללבוש עד שמגיעים הביתה",
  prize3: "זכות וטו: פטור מפקודה אחת של המלך",
  prizeLast: "השקד המר: משרת אישי של המלך, מכין לכולם שקשוקה, ומעלה סטורי עם התמונה העצובה שלו מהמשחק",
  nightCap: 300,
  catchWindow: 90,
};

function round(kind: RoundKind, seed: RoundSeed, i: number): RoundRec {
  const [emoji, title, note, options, noBet] = seed;
  return {
    id: `${kind === "night" ? "n" : "r"}${i + 1}`,
    kind,
    emoji,
    title,
    note,
    image: null,
    options,
    minBet: 50,
    maxBet: 500,
    seconds: kind === "night" ? 0 : 60,
    bonus: kind === "night" ? 300 : 200,
    reward: 0,
    correctId: null,
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
    game: seed[5] ?? null,
  };
}

function quiz(seed: QuizSeed, i: number): RoundRec {
  const [emoji, title, note, options, correct, noBet] = seed;
  return { ...round("quiz", [emoji, title, note, options, noBet], i), id: `q${i + 1}`, seconds: 25, bonus: 50, reward: 100, correctId: correct };
}

/** Challenges with a quiz question after every two. */
function interleave(): RoundRec[] {
  const ch = CHALLENGES.map((r, i) => round("challenge", r, i));
  const qz = QUIZ.map(quiz);
  const out: RoundRec[] = [];
  while (ch.length || qz.length) {
    out.push(...ch.splice(0, 2));
    if (qz.length) out.push(qz.shift()!);
  }
  return out;
}

export function seedState(now: number): GameState {
  const players: PlayerRec[] = PLAYERS.map(([id, name, ticker, groom]) => ({
    id,
    name,
    ticker,
    photo: null,
    isGroom: !!groom,
    token: null,
    joinedAt: null,
    hat: null,
    item: null,
  }));
  const missions: Mission[] = MISSIONS.map(([template, reward, audience]) => ({
    id: randomId(),
    template,
    text: template,
    targets: {},
    reward,
    audience,
    assignedTo: null,
    status: "open",
    claimedAt: null,
    doneAt: null,
    caughtBy: null,
  }));
  return {
    v: 1,
    seq: 0,
    settings: { ...DEFAULT_SETTINGS },
    players,
    rounds: [...interleave(), ...NIGHT.map((r, i) => round("night", r, i))],
    bets: [],
    missions,
    ledger: [],
    accusations: [],
    bailouts: [],
    feed: [],
    wheel: null,
    tv: { mode: "lobby", at: now, step: 0 },
    activeRoundId: null,
    lastResolvedId: null,
    draw: null,
    shouts: [],
  };
}
