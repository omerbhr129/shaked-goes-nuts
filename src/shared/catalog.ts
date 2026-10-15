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
  { id: "rose", emoji: "🌹", name: "ורד", price: 20, slot: "item" },
  { id: "bottle", emoji: "🍼", name: "בקבוק תינוק", price: 10, slot: "item" },
  { id: "tp", emoji: "🧻", name: "נייר טואלט", price: 10, slot: "item" },
];

/** One-on-one games: the host's quick duel, and the winner pictures. */
export const GAMES: Record<string, { emoji: string; name: string; note: string }> = {
  pingpong: { emoji: "🏓", name: "פינג פונג", note: "משחק קצר עד 4 נקודות." },
  foosball: { emoji: "⚽", name: "כדורגל שולחן", note: "משחק קצר עד 4 גולים." },
  airhockey: { emoji: "🏒", name: "הוקי אוויר", note: "משחק קצר עד 4 גולים." },
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
