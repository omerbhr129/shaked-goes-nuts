/** Things the phones, the TV and the server must agree on. */

export interface ShopItem {
  id: string;
  emoji: string;
  name: string;
  price: number;
  /** a hat sits on the head, an item next to the face */
  slot: "hat" | "item";
}

export const SHOP: ShopItem[] = [
  { id: "tophat", emoji: "🎩", name: "צילינדר", price: 40, slot: "hat" },
  { id: "crown", emoji: "👑", name: "כתר מזויף", price: 50, slot: "hat" },
  { id: "cap", emoji: "🧢", name: "כובע מצחייה", price: 20, slot: "hat" },
  { id: "straw", emoji: "👒", name: "כובע קש", price: 20, slot: "hat" },
  { id: "grad", emoji: "🎓", name: "כובע בוגר", price: 30, slot: "hat" },
  { id: "helmet", emoji: "🪖", name: "קסדה", price: 30, slot: "hat" },
  { id: "poop", emoji: "💩", name: "קקי על הראש", price: 10, slot: "hat" },
  { id: "beer", emoji: "🍺", name: "בירה", price: 10, slot: "item" },
  { id: "shot", emoji: "🥃", name: "שוט", price: 10, slot: "item" },
  { id: "champagne", emoji: "🍾", name: "שמפניה", price: 30, slot: "item" },
  { id: "cocktail", emoji: "🍹", name: "קוקטייל", price: 20, slot: "item" },
  { id: "cigar", emoji: "🚬", name: "סיגריה", price: 20, slot: "item" },
  { id: "joint", emoji: "🌿", name: "ג׳וינט", price: 20, slot: "item" },
  { id: "rose", emoji: "🌹", name: "ורד", price: 20, slot: "item" },
  { id: "bottle", emoji: "🍼", name: "בקבוק תינוק", price: 10, slot: "item" },
  { id: "tp", emoji: "🧻", name: "נייר טואלט", price: 10, slot: "item" },
];

/** One-on-one games: the host's quick duel, and the winner pictures. */
export const GAMES: Record<string, { emoji: string; name: string; note: string }> = {
  pingpong: { emoji: "🏓", name: "פינג פונג", note: "משחק קצר עד 4 נקודות." },
  foosball: { emoji: "⚽", name: "כדורגל שולחן", note: "משחק קצר עד 4 גולים." },
  arm: { emoji: "💪", name: "הורדת ידיים", note: "הטוב משלושה, יד ימין." },
  handstand: { emoji: "🤸", name: "עמידת ידיים", note: "מי מחזיק יותר זמן. מותר להישען על הקיר, אסור ליפול." },
  chug: { emoji: "🍺", name: "צ׳אג בירה", note: "שותים עד הסוף, בלי לשפוך." },
  pushups: { emoji: "🫡", name: "שכיבות סמיכה", note: "מי עושה יותר בדקה. כל הווילה סופרת." },
  dance: { emoji: "🕺", name: "קרב ריקודים", note: "30 שניות לכל אחד. מחיאות הכפיים מכריעות." },
  pyramid: { emoji: "🥤", name: "פירמידת כוסות", note: "10 כוסות. נפלה? מתחילים מחדש." },
  breath: { emoji: "🏊", name: "עצירת נשימה", note: "בבריכה, צוללים ביחד. מי שעולה ראשון יוצא." },
};

/** What a phone can throw at the TV. */
export const REACTIONS = ["🔥", "😂", "🍺", "🥃", "👑", "🥜", "💩", "🤡", "❤️", "🎉", "🙈", "💸"];

/** The host's soundboard: plays on the TV right away. `line` is read out by the announcer, `fx` is a sound effect. */
export interface Sound {
  id: string;
  emoji: string;
  label: string;
  line?: string;
  fx: "siren" | "fanfare" | "applause" | "drumroll" | "horn" | "boo" | "boing" | "gotcha" | "alert" | "win";
}

export const SOUNDS: Sound[] = [
  { id: "attention", emoji: "📢", label: "שימו לב!", line: "שימו לב יא זונות! שימו לב!", fx: "siren" },
  { id: "cheers", emoji: "🥂", label: "לחיים!", line: "לחיים יא זונות! כוסות למעלה!", fx: "fanfare" },
  { id: "applause", emoji: "👏", label: "מחיאות כפיים", fx: "applause" },
  { id: "drums", emoji: "🥁", label: "תופים", fx: "drumroll" },
  { id: "horn", emoji: "📯", label: "צופר", fx: "horn" },
  { id: "groom", emoji: "🤵", label: "לכבוד החתן", line: "כולם לכבוד החתן! איתי! איתי! איתי!", fx: "fanfare" },
  { id: "shot", emoji: "🥃", label: "שוט!", line: "שוט! שוט! שוט! יאללה יא זונות, למטה!", fx: "gotcha" },
  { id: "boo", emoji: "👎", label: "בוז!", line: "בוווז! יא נוב, בוז!", fx: "boo" },
  { id: "wow", emoji: "😱", label: "וואו!", line: "וואלה אחי, מה זה הדבר הזה?!", fx: "boing" },
  { id: "quiet", emoji: "🤫", label: "שקט!", line: "שקט יא זונות! תנו לשמוע!", fx: "alert" },
  { id: "yalla", emoji: "⏰", label: "יאללה, מהר!", line: "יאללה יאללה, מה אתם ישנים? תהמרו כבר!", fx: "alert" },
  { id: "king", emoji: "👑", label: "תשתחוו למלך", line: "כולם להשתחוות למלך! יאללה, ראש לרצפה!", fx: "win" },
];

/** What the groom's golden cards do, for his phone and the TV. */
export const CARDS = {
  veto: { emoji: "🛑", name: "וטו", text: "מבטל את האתגר שפתוח עכשיו. כל ההימורים חוזרים." },
  double: { emoji: "×2", name: "הכפלה", text: "מכפיל את מה שתרוויח מההימור שלך על האתגר הפתוח." },
  drink: { emoji: "🥃", name: "אתה שותה!", text: "בוחרים חבר, והוא שותה עכשיו מול כולם." },
} as const;

/** "How to play" on the TV at the start of the night: the host clicks through, the announcer reads each one. */
export const RULES: { emoji: string; title: string; text: string; line: string }[] = [
  {
    emoji: "💰",
    title: "ברוכים הבאים לבורסה של איתי",
    text: "לכל אחד יש 1,000 שקדים. מי שמסיים את הלילה הכי עשיר מנצח, ובבוקר כולם משתחווים לו.",
    line: "ברוכים הבאים לבורסה של איתי, יא זונות! לכל אחד אלף שקדים. מי שמסיים הכי עשיר, מנצח.",
  },
  {
    emoji: "🎡",
    title: "גלגל הבלגן",
    text: "המנחה מסובב, ויוצא אתגר, שאלה, הצבעה או הפתעה. מהמרים בטלפון, ואף אחד לא רואה על מה עד שהזמן נגמר.",
    line: "המנחה מסובב את גלגל הבלגן. יוצא אתגר, שאלה או הצבעה, ואתם מהמרים בטלפון. בסוד.",
  },
  {
    emoji: "🤫",
    title: "משימות סודיות",
    text: "לכל אחד 3 משימות בטלפון. ביצעת? לוחצים ״ביצעתי״. הטלוויזיה מכריזה בלי שם, ולכולם יש חצי דקה לתפוס אותך.",
    line: "לכל אחד שלוש משימות סודיות. ביצעתם? לוחצים ביצעתי, ולכולם יש חצי דקה לתפוס אתכם.",
  },
  {
    emoji: "🕵️",
    title: "תפסתי!",
    text: "חושדים במישהו? בטלפון: משימות ← ״תפסתי מישהו״. צדקתם? גונבים לו את השקדים. טעיתם? משלמים לו 50.",
    line: "חושדים במישהו? לוחצים תפסתי בטלפון. צדקתם, גונבים לו את השקדים. טעיתם, אתם משלמים.",
  },
  {
    emoji: "🥃",
    title: "שאלות והצבעות",
    text: "בשאלת ידע, מי שטועה שותה. בהצבעה, מי שנבחר שותה, ומי שהצביע כמו הרוב מרוויח.",
    line: "שאלת ידע? מי שטועה, שותה. הצבעה? מי שנבחר, שותה. פשוט.",
  },
  {
    emoji: "💸",
    title: "נגמרו השקדים?",
    text: "יורדים מתחת ל־100? משימה מביכה מול כולם, והבנק מחלץ. ובסוף הלילה: טקס פרסים.",
    line: "נגמרו לכם השקדים? משימה מביכה מול כולם, והבנק מחלץ אתכם. ובסוף, טקס פרסים.",
  },
  {
    emoji: "👇",
    title: "לא בטוחים מה עושים?",
    text: "בטלפון, הפס הצבעוני מעל הלשוניות תמיד אומר מה עכשיו. יאללה, מתחילים!",
    line: "לא בטוחים מה עושים? הפס הצבעוני בטלפון תמיד אומר מה עכשיו. יאללה, מתחילים!",
  },
];
