import type { ClientView, PlayerStats } from "../shared/types";
import { fmt, ranked } from "./lib";

export type AwardStep =
  | { kind: "title" }
  | { kind: "award"; emoji: string; title: string; desc: string; ids: string[] }
  | { kind: "podium"; emoji: string; title: string; ids: string[]; values: Record<string, string> }
  | { kind: "final" }
  | { kind: "punish"; id: string | null };

/** The ceremony, step by step. Awards nobody earned are skipped. Shared by the TV and the host. */
export function awardSteps(view: ClientView): AwardStep[] {
  const stats = view.pub.stats ?? [];
  const steps: AwardStep[] = [{ kind: "title" }];
  const best = (pick: (s: PlayerStats) => number, sign = 1) => {
    if (!stats.length) return null;
    const top = Math.max(...stats.map((s) => pick(s) * sign));
    if (top <= 0) return null;
    return { value: top * sign, ids: stats.filter((s) => pick(s) * sign === top).map((s) => s.id) };
  };
  const award = (emoji: string, title: string, b: ReturnType<typeof best>, desc: (v: number) => string) => {
    if (b) steps.push({ kind: "award", emoji, title, desc: desc(b.value), ids: b.ids });
  };

  award("🔮", "הנביא", best((s) => s.betsWon), (v) => (v === 1 ? "צדק בהימור אחד" : `צדק ב־${v} הימורים`));
  award("🎰", "המכה של הלילה", best((s) => s.bestWin), (v) => `+${fmt(v)} שקדים בהימור אחד`);
  award("🕳️", "הבור הכי עמוק", best((s) => s.worstLoss, -1), (v) => `−${fmt(Math.abs(v))} שקדים בהימור אחד`);
  award("🧠", "גאון הלילה", best((s) => s.quizRight), (v) => (v === 1 ? "תשובה נכונה אחת בשאלות הידע" : `${v} תשובות נכונות בשאלות הידע`));
  award("🥃", "אלוף השוטים", best((s) => s.shots), (v) => (v === 1 ? "שוט אחד על חשבון הבורסה" : `${v} שוטים על חשבון הבורסה`));
  award("🕵️", "הבלש", best((s) => s.catches), (v) => `תפס ${v === 1 ? "סוכן אחד" : `${v} סוכנים`} על חם`);
  award("🤡", "הפרנואיד", best((s) => s.falseAccusations), (v) => `${v === 1 ? "האשמת שווא אחת" : `${v} האשמות שווא`}`);
  award("🆘", "תלוי בבנק", best((s) => s.bailouts), (v) => `${v === 1 ? "חילוץ אחד" : `${v} חילוצים`} מהבנק המרכזי`);

  const missionTop = [...stats].sort((a, b) => b.missionsDone - a.missionsDone || b.missionAlmonds - a.missionAlmonds).filter((s) => s.missionsDone > 0);
  if (missionTop.length)
    steps.push({
      kind: "podium",
      emoji: "🤫",
      title: "הסוכנים החשאיים",
      ids: missionTop.slice(0, 3).map((s) => s.id),
      values: Object.fromEntries(missionTop.map((s) => [s.id, `${s.missionsDone} משימות`])),
    });

  const betTop = [...stats].sort((a, b) => b.betProfit - a.betProfit).filter((s) => s.betsWon + s.betsLost > 0);
  if (betTop.length)
    steps.push({
      kind: "podium",
      emoji: "🎲",
      title: "מלכי ההימורים",
      ids: betTop.slice(0, 3).map((s) => s.id),
      values: Object.fromEntries(betTop.map((s) => [s.id, `${s.betProfit >= 0 ? "+" : "−"}${fmt(Math.abs(s.betProfit))}`])),
    });

  steps.push({ kind: "final" });
  const list = ranked(view.pub.players);
  steps.push({ kind: "punish", id: list.length > 1 ? list[list.length - 1].id : null });
  return steps;
}
