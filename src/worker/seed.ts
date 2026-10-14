import type { Audience, GameState, Mission, PlayerRec, RoundOption, RoundRec } from "../shared/types";

const PLAYERS: [id: string, name: string, ticker: string, groom?: boolean][] = [
  ["itay", "איתי", "SHKD", true],
  ["benharoosh", "בן הרוש", "BNHR"],
  ["ayalon", "איילון", "AYLN"],
  ["drori", "דרורי", "DROR"],
  ["birman", "בירמן", "BIRM"],
  ["yali", "יאלי", "YALI"],
  ["sisu", "סיסו", "SISU"],
  ["shmay", "שמאי", "SHMI"],
];

const NAME = Object.fromEntries(PLAYERS.map(([id, name]) => [id, name]));
const FRIENDS = PLAYERS.filter((p) => !p[3]).map((p) => p[0]);

const yesNo = (): RoundOption[] => [
  { id: "yes", label: "כן", playerId: null },
  { id: "no", label: "לא", playerId: null },
];
const vs = (...ids: string[]): RoundOption[] => ids.map((id) => ({ id, label: NAME[id], playerId: id }));
const labels = (...ls: string[]): RoundOption[] => ls.map((label, i) => ({ id: `o${i + 1}`, label, playerId: null }));

type RoundSeed = [emoji: string, title: string, note: string, options: RoundOption[], noBet: string[]];

const ROUNDS: RoundSeed[] = [
  ["🏀", "איתי יקלע 3 כדורים לכוסות תוך 30 שניות?", "בירפונג של החתן. שלוש קליעות לפני שנגמר הזמן = כן.", yesNo(), ["itay"]],
  ["💪", "מי ינצח בהורדת ידיים?", "החתן נגד בירמן. הטוב משלושה.", vs("itay", "birman"), ["itay", "birman"]],
  ["🥜", "כמה שקדים איתי יתפוס בפה מתוך 5 זריקות?", "זורקים ממרחק 3 מטרים. מה שנופל על הרצפה לא נחשב.", labels("0–1", "2–3", "4–5"), ["itay"]],
  ["🥤", "מי יבנה פירמידה של 10 כוסות מהר יותר?", "דרורי נגד סיסו. נפלה הפירמידה? מתחילים מחדש.", vs("drori", "sisu"), ["drori", "sisu"]],
  ["😂", "יאלי יצליח להצחיק את איתי תוך 30 שניות?", "איתי חייב להישאר רציני. חיוך קטן = כן.", yesNo(), ["yali", "itay"]],
  ["🎵", "איתי יזהה לפחות 4 מתוך 5 שירים?", "5 שניות מכל שיר. את השירים בוחרים החברים.", yesNo(), ["itay"]],
  ["🏝️", "את מי איתי ייקח איתו לחודש על אי בודד?", "איתי בוחר בלייב. אסור לשחד אותו (בקול רם).", vs(...FRIENDS), ["itay"]],
  ["🕺", "מי ינצח בקרב הריקודים?", "30 שניות לכל אחד. הקהל מכריע במחיאות כפיים.", vs("ayalon", "shmay"), ["ayalon", "shmay"]],
  ["💍", "איתי יענה נכון על 4 מתוך 5 שאלות על שחף?", "השאלות הוכנו מראש. 4 תשובות נכונות = כן.", yesNo(), ["itay"]],
  ["🍋", "בן הרוש יאכל פלח לימון בלי לעשות פרצוף?", "פרצוף אחד = לא. השופט: החתן.", yesNo(), ["benharoosh"]],
  ["🫡", "מי יעשה יותר שכיבות סמיכה בדקה?", "בירמן נגד שמאי. ספירה בקול של כל הווילה.", vs("birman", "shmay"), ["birman", "shmay"]],
  ["📞", "איתי ישכנע את שחף להגיד בטלפון ״אני מתה על החברים שלך״?", "דקה אחת, רמקול פתוח, אסור להסביר לה למה.", yesNo(), ["itay"]],
  ["🧠", "מי ינצח בחידון ״מי מכיר את איתי הכי טוב״?", "10 שאלות על החתן. איתי בודק את התשובות.", vs(...FRIENDS), ["itay"]],
  ["🎤", "איתי ישיר את כל הפזמון בקריוקי בלי להציץ במילים?", "את השיר בוחרים החברים. טעות אחת = לא.", yesNo(), ["itay"]],
];

type MissionSeed = [text: string, reward: number, audience: Audience];

const MISSIONS: MissionSeed[] = [
  // friends → the groom
  ["תגרום לאיתי להגיד ״אני הכי מאוהב בעולם״ — בלי לבקש ממנו ישירות", 200, "friends"],
  ["תגרום לאיתי להצטלם איתך בפוזה של פלמינגו (על רגל אחת)", 150, "friends"],
  ["תגרום לאיתי לחקות את שחף", 200, "friends"],
  ["תגרום לאיתי לקרוא לך ״אחי היקר״", 150, "friends"],
  ["תגרום לאיתי לרקוד איתך סלואו לפחות 10 שניות", 200, "friends"],
  ["תגרום לאיתי להגיד את המילה ״פיסטוק״", 100, "friends"],
  ["תגרום לאיתי לספר איך הוא הכיר את שחף — בלי שישים לב שכיוונת לשם", 100, "friends"],
  ["תגרום לאיתי לתת לך היי־פייב 3 פעמים בתוך 10 דקות", 100, "friends"],
  ["תגרום לאיתי לשיר איתך דואט, לפחות שורה אחת", 150, "friends"],
  ["תגרום לאיתי להודות שאתה החבר הכי טוב שלו", 200, "friends"],
  ["תגרום לאיתי ללבוש משהו שלך — כובע, משקפיים או חולצה", 150, "friends"],
  ["תמציא עם איתי לחיצת יד סודית ותגרום לו לעשות אותה איתך פעמיים", 150, "friends"],
  // anyone
  ["תגרום לשלושה חברים לעשות איתך ״לחיים״ באותו רגע", 100, "all"],
  ["תשכנע חבר לספר סיפור מביך על עצמו", 150, "all"],
  ["תגרום למישהו לשיר לפחות 10 שניות", 100, "all"],
  ["תשכנע חבר לעשות איתך תחרות שכיבות סמיכה", 150, "all"],
  ["תגרום לחבר לקרוא לך ״הבוס״", 200, "all"],
  ["תגרום לשני חברים להתווכח על משהו טיפשי לפחות דקה", 150, "all"],
  ["תגרום למישהו לחקות חיה", 150, "all"],
  ["תכניס את המילה ״אבוקדו״ לשיחה 3 פעמים בלי שישאלו למה", 100, "all"],
  ["תשכנע מישהו שהווילה רדופה — ותגרום לו לספר את זה למישהו אחר", 200, "all"],
  ["תגרום לשלושה חברים להצטלם איתך סלפי עם פרצוף מפחיד", 150, "all"],
  ["תגרום למישהו להביא לך שתייה בלי שביקשת ישירות", 100, "all"],
  ["תגרום לחבר להגיד ״וואלה צודק״ שלוש פעמים על דברים שאמרת", 150, "all"],
  ["תגרום למישהו להחמיא לך על השיער", 100, "all"],
  ["תגרום לחבר לנאום נאום קצר לכבוד החתן", 150, "all"],
  ["תגרום לחבר להכין לך משהו לאכול", 150, "all"],
  ["תגרום לשני אנשים לצעוק ״SHAKED GOES NUTS״ ביחד", 200, "all"],
  ["תגרום לחבר לעשות איתך ריקוד מסונכרן לפחות 10 שניות", 200, "all"],
  ["תגרום למישהו לספר לך את הסיפור הכי מביך שלו מהצבא", 200, "all"],
  ["תגרום לחבר לדבר במבטא צרפתי במשך דקה", 150, "all"],
  ["תגרום למישהו להגיד לך ״אני אוהב אותך, אחי״", 100, "all"],
  // groom only
  ["תגרום לשלושה חברים להגיד לך ״מזל טוב״ בתוך דקה אחת", 150, "groom"],
  ["תגרום לשני חברים להרים אותך על הידיים", 200, "groom"],
  ["תגרום לחבר להגיד שלוש מחמאות על שחף", 150, "groom"],
  ["תגרום לחבר לשיר לך שיר אהבה (לפחות שורה)", 200, "groom"],
  ["תגרום למישהו להגיד ״החתן תמיד צודק״", 150, "groom"],
  ["תשכנע את כולם לצילום קבוצתי — ותעמוד באמצע", 100, "groom"],
  ["תגרום לחבר להודות שהוא מקנא בך", 150, "groom"],
];

export function seedState(now: number): GameState {
  const players: PlayerRec[] = PLAYERS.map(([id, name, ticker, groom]) => ({
    id,
    name,
    ticker,
    photo: null,
    isGroom: !!groom,
    token: null,
    joinedAt: null,
  }));
  const rounds: RoundRec[] = ROUNDS.map(([emoji, title, note, options, noBet], i) => ({
    id: `r${i + 1}`,
    emoji,
    title,
    note,
    image: null,
    options,
    minBet: 50,
    maxBet: 500,
    seconds: 60,
    noBet,
    status: "draft",
    openedAt: null,
    closesAt: null,
    winnerId: null,
    resolvedAt: null,
  }));
  const missions: Mission[] = MISSIONS.map(([text, reward, audience], i) => ({
    id: `m${i + 1}`,
    text,
    reward,
    audience,
    assignedTo: null,
    status: "open",
    claimedAt: null,
    doneAt: null,
  }));
  return {
    v: 1,
    seq: 0,
    settings: { currency: "שקדים", startBalance: 1000, allowJoinNew: true },
    players,
    rounds,
    bets: [],
    missions,
    ledger: [],
    tv: { mode: "lobby", at: now },
    activeRoundId: null,
  };
}
