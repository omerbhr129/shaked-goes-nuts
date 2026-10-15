import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { ClientView, PlayerPub } from "../../shared/types";
import { cls, mmss } from "../lib";
import { type Game, useServerNow } from "../net";
import { sfx } from "../sound";

export type Tab = "bet" | "missions" | "board" | "fun";

interface Hint {
  icon: string;
  text: string;
  tone: "go" | "alert" | "wait" | "calm";
  tab?: Tab;
  /** scroll to this part of the tab */
  anchor?: string;
}

/** What a player should do right now, in one line. */
function hintFor(view: ClientView, me: PlayerPub, now: number): Hint {
  const r = view.pub.round;
  const mine = view.me!;
  if (r && r.status === "open") {
    if (r.openedAt && now < r.openedAt) return { icon: "🎡", text: "הגלגל מסתובב! תסתכלו על הטלוויזיה", tone: "wait" };
    const t = r.closesAt ? ` (${mmss(Math.max(0, r.closesAt - now))})` : "";
    if (r.kind === "photo" && r.phase === "collect")
      return r.options.some((o) => o.playerId === me.id)
        ? { icon: "✅", text: `התמונה שלך בפנים. מחכים להצבעה${t}`, tone: "calm", tab: "bet" }
        : { icon: "📸", text: `עכשיו: לשלוח תמונה מביכה של איתי!${t}`, tone: "go", tab: "bet" };
    if (r.noBet.includes(me.id)) return { icon: "💪", text: r.kind === "quiz" ? "על השאלה הזאת עונים בקול מול כולם" : "אתה בתוך האתגר. בהצלחה!", tone: "calm", tab: "bet" };
    if (!mine.bets[r.id]) {
      if (r.kind === "quiz") return { icon: "❓", text: `עכשיו: לענות מהר!${t}`, tone: "go", tab: "bet" };
      if (r.kind === "vote") return { icon: "🗳️", text: `עכשיו: להצביע!${t}`, tone: "go", tab: "bet" };
      if (r.kind === "photo") return { icon: "🗳️", text: `עכשיו: להצביע על התמונה הכי מביכה!${t}`, tone: "go", tab: "bet" };
      return { icon: "🎲", text: `עכשיו: להמר!${t}`, tone: "go", tab: "bet" };
    }
    const did = r.kind === "vote" || r.kind === "photo" ? "הצבעת" : r.kind === "quiz" ? "ענית" : "הימרת";
    return { icon: "✅", text: `${did}. אפשר לשנות עד שהזמן נגמר${t}`, tone: "calm", tab: "bet" };
  }
  if (r && r.status === "closed") return { icon: "🔒", text: r.kind === "challenge" ? "ההימורים נסגרו. האתגר יוצא לדרך!" : "הזמן נגמר. התוצאה בטלוויזיה", tone: "wait" };
  const pending = mine.missions.find((m) => m.status === "pending" && m.claimedAt);
  if (pending) {
    const left = pending.claimedAt! + view.pub.settings.catchWindow * 1000 - now;
    if (left > 0) return { icon: "🤫", text: `המשימה שלך באוויר. עוד ${mmss(left)} לשרוד`, tone: "alert", tab: "missions" };
  }
  const myIds = new Set(mine.missions.map((m) => m.id));
  const over = new Set(view.pub.feed.filter((e) => e.kind === "reveal" || e.kind === "caught").map((e) => e.data?.mission ?? e.ref));
  const live = view.pub.feed.find((e) => e.kind === "mission" && e.data?.until && e.data.until > now && !over.has(e.ref) && !myIds.has(e.ref ?? ""));
  if (live) return { icon: "🚨", text: `משימה סודית באוויר! חושדים במישהו? עוד ${mmss(live.data!.until! - now)}`, tone: "alert", tab: "missions", anchor: ".catch" };
  const night = view.pub.night.filter((n) => n.status === "open" && !mine.bets[n.id] && !n.noBet.includes(me.id)).length;
  if (night) return { icon: "🌙", text: night === 1 ? "הימור לילה אחד מחכה לך" : `${night} הימורי לילה מחכים לך`, tone: "calm", tab: "bet", anchor: ".night" };
  const open = mine.missions.filter((m) => m.status === "open").length;
  if (open) return { icon: "🤫", text: `אין סיבוב עכשיו. זמן לעבוד על ${open === 1 ? "המשימה הסודית שלך" : `${open} המשימות הסודיות שלך`}`, tone: "calm", tab: "missions" };
  return { icon: "📣", text: "אין סיבוב עכשיו. תזרקו משהו למסך, או תקנו מתנה לחבר", tone: "calm", tab: "fun" };
}

/** Takes you to a tab, and to the right part of it. */
export function useGo(setTab: (t: Tab) => void) {
  return (tab: Tab, anchor?: string) => {
    setTab(tab);
    window.setTimeout(() => {
      const el = anchor ? document.querySelector(anchor) : null;
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      else window.scrollTo({ top: 0, behavior: "smooth" });
    }, 60);
  };
}

/** One line above the tabs that says what to do right now, and takes you there. */
export function NowBar({ game, view, me, go }: { game: Game; view: ClientView; me: PlayerPub; go?: (tab: Tab, anchor?: string) => void }) {
  const now = useServerNow(game, true, 1000);
  const h = hintFor(view, me, now);
  const can = !!h.tab && !!go;
  return (
    <button type="button" className={cls("nowbar", h.tone)} onClick={() => can && go!(h.tab!, h.anchor)} aria-disabled={!can} aria-live="polite">
      <span className="nowbar-icon" aria-hidden="true">
        {h.icon}
      </span>
      <span className="nowbar-text">{h.text}</span>
      {can && (
        <span className="nowbar-go" aria-hidden="true">
          ‹
        </span>
      )}
    </button>
  );
}

/** A round just opened (after the wheel has landed): a big card over whatever screen you're on. */
export function RoundPop({ game, view, me, go }: { game: Game; view: ClientView; me: PlayerPub; go: (tab: Tab, anchor?: string) => void }) {
  const r = view.pub.round;
  const key = r && r.status === "open" ? `${r.id}:${r.openedAt}` : null;
  const last = useRef(key);
  const timers = useRef<number[]>([]);
  const [pop, setPop] = useState<string | null>(null);

  useEffect(() => {
    if (!key || key === last.current) {
      last.current = key;
      return;
    }
    last.current = key;
    // the wheel spins first: no spoilers before it lands
    const wait = Math.max(0, (r!.openedAt ?? 0) - (Date.now() + game.offset));
    timers.current.push(
      window.setTimeout(() => {
        setPop(key);
        sfx.open();
        navigator.vibrate?.([30, 40, 30]);
      }, wait),
      window.setTimeout(() => setPop((k) => (k === key ? null : k)), wait + 6000),
    );
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  const shown = !!r && !!key && pop === key;
  const inIt = !!r && r.noBet.includes(me.id);
  const photo = r?.kind === "photo";
  const title = !r
    ? ""
    : inIt
      ? "💪 אתה באתגר!"
      : photo
        ? r.phase === "collect"
          ? "📸 תחרות תמונות!"
          : "🗳️ מצביעים על התמונות!"
        : r.kind === "quiz"
          ? "❓ שאלה חדשה!"
          : r.kind === "vote"
            ? "🗳️ הצבעה חדשה!"
            : r.crown
              ? "⚔️ הקרב על הכתר!"
              : r.final
                ? "🏁 סיבוב הגמר!"
                : "🎲 סיבוב חדש!";
  const cta = inIt
    ? "יאללה"
    : photo
      ? r.phase === "collect"
        ? "לשלוח תמונה"
        : "להצביע עכשיו"
      : r?.kind === "quiz"
        ? "לענות עכשיו"
        : r?.kind === "vote"
          ? "להצביע עכשיו"
          : "להמר עכשיו";
  return (
    <AnimatePresence>
      {shown && r && (
        <motion.div
          key={key}
          className="roundpop"
          role="alert"
          initial={{ y: -140, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -140, opacity: 0 }}
          transition={{ type: "spring", stiffness: 260, damping: 22 }}
        >
          <b className="roundpop-title">{title}</b>
          <span className="roundpop-q">
            {r.emoji} {r.title}
          </span>
          <button
            type="button"
            className="btn btn-xl roundpop-btn"
            onClick={() => {
              setPop(null);
              go("bet");
            }}
          >
            {cta}
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
