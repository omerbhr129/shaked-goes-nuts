import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { ClientView, RoundPub } from "../../shared/types";
import { cls, lsGet, lsSet } from "../lib";
import { sfx } from "../sound";
import { Money, burst, toast } from "../ui";

interface Flash {
  kind: "win" | "lose" | "mission" | "drink" | "caught";
  amount?: number;
  title: string;
  sub: string;
}

function useFlash() {
  const [flash, setFlash] = useState<Flash | null>(null);
  useEffect(() => {
    if (!flash) return;
    const id = window.setTimeout(() => setFlash(null), flash.kind === "drink" ? 7000 : 4800);
    return () => window.clearTimeout(id);
  }, [flash]);
  return [flash, setFlash] as const;
}

function FlashView({ flash, onClose }: { flash: Flash | null; onClose: () => void }) {
  return (
    <AnimatePresence>
      {flash && (
        <motion.div className={cls("flash", flash.kind)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} role="alert">
          <motion.div className="flash-card" initial={{ scale: 0.6, rotate: -4 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 300, damping: 16 }}>
            <div className="flash-title">{flash.title}</div>
            {flash.amount !== undefined && <Money n={flash.amount} sign size={40} className="flash-amount" />}
            <div className="flash-sub">{flash.sub}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Once per settled round you bet on (challenge or night): the big win / loss moment. */
export function ResultOverlay({ view, meId }: { view: ClientView; meId: string }) {
  const [flash, setFlash] = useFlash();
  const rounds: RoundPub[] = [...(view.pub.round ? [view.pub.round] : []), ...view.pub.night];
  const involved = (r: RoundPub) => !!view.me?.bets[r.id] || (r.kind === "quiz" && r.losers.includes(meId));
  const due = rounds.find((r) => r.status === "resolved" && involved(r) && !lsGet(`sgn.seen.${r.id}.${r.resolvedAt}.${meId}`));
  const key = due ? `sgn.seen.${due.id}.${due.resolvedAt}.${meId}` : null;

  useEffect(() => {
    if (!key || !due) return;
    lsSet(key, "1");
    const label = due.options.find((o) => o.id === due.winnerId)?.label ?? "";
    if (due.refunded) {
      setFlash({ kind: "drink", title: "🍻 אף אחד לא צדק!", sub: `ההימור חזר אליך. אבל ${due.task ?? "כולם שותים"}` });
      sfx.lose();
      return;
    }
    const delta = due.results?.find((x) => x.playerId === meId)?.delta ?? 0;
    const won = view.me?.bets[due.id]?.optionId === due.winnerId;
    if (due.kind === "quiz") {
      // let the TV's drum roll land first (no cleanup: the next render already forgets this round)
      window.setTimeout(() => {
        if (due.losers.includes(meId)) {
          setFlash({ kind: "drink", title: "🥃 שוט!", sub: due.loserReason === "slow" ? "צדקת, אבל ענית אחרון. לחיים!" : `התשובה הנכונה: ״${label}״. לחיים!` });
          sfx.gotcha();
          navigator.vibrate?.([120, 60, 120, 60, 300]);
        } else if (won) {
          const fastest = delta > due.reward;
          setFlash({ kind: "win", amount: delta, title: fastest ? "⚡ הכי מהיר!" : "צדקת! 🧠", sub: fastest ? `צדקת והיית הראשון. תסתכל על הטלוויזיה 😎` : `התשובה: ״${label}״` });
          sfx.win();
          burst("coins");
        }
      }, 1600);
      return;
    }
    setFlash({
      kind: won ? "win" : "lose",
      amount: delta,
      title: won ? "צדקת! 🤑" : "פספוס 😬",
      sub: `${due.kind === "night" ? "🌙 " : ""}התוצאה: ״${label}״${!won && due.task ? `. המשימה שלך: ${due.task}` : ""}`,
    });
    navigator.vibrate?.(won ? [40, 60, 40, 60, 80] : [220]);
    if (won) {
      sfx.win();
      burst("coins");
      burst("win");
    } else sfx.lose();
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  return <FlashView flash={flash} onClose={() => setFlash(null)} />;
}

/** Someone burned one of your missions. */
export function MissionWatcher({ view }: { view: ClientView }) {
  const [flash, setFlash] = useFlash();
  const count = view.me?.burned.length ?? 0;
  const prev = useRef<number | null>(null);
  useEffect(() => {
    if (prev.current !== null && count > prev.current) {
      const b = view.me!.burned[view.me!.burned.length - 1];
      const by = view.pub.players.find((p) => p.id === b.by)?.name ?? "מישהו";
      setFlash({ kind: "caught", title: "🔥 נתפסת!", sub: `${by} תפס אותך על חם והמשימה נשרפה. קיבלת משימה חדשה במקומה.` });
      sfx.gotcha();
      navigator.vibrate?.([200, 80, 200]);
    }
    prev.current = count;
  }, [count]); // eslint-disable-line react-hooks/exhaustive-deps
  return <FlashView flash={flash} onClose={() => setFlash(null)} />;
}

/** Public happenings as toasts; the drinking wheel lands on you as a full-screen moment. */
export function FeedWatcher({ view, meId }: { view: ClientView; meId: string }) {
  const [flash, setFlash] = useFlash();
  const seen = useRef<Set<string> | null>(null);
  const feed = view.pub.feed;
  useEffect(() => {
    if (!seen.current) {
      seen.current = new Set(feed.map((e) => e.id));
      return;
    }
    const mine = new Set(view.me?.missions.map((m) => m.id) ?? []);
    for (const e of feed) {
      if (seen.current.has(e.id)) continue;
      seen.current.add(e.id);
      if (e.kind === "mission") {
        if (!mine.has(e.ref ?? "")) toast(e.text, "info", 4500);
      } else if (e.kind === "reveal") {
        if (e.players[0] === meId) {
          setFlash({ kind: "win", amount: e.data?.amount, title: "🕵️ לא תפסו אותך!", sub: "עבדת עליהם בעיניים. השקדים שלך." });
          sfx.win();
          burst("coins");
        } else if (e.players.slice(1).includes(meId)) {
          setFlash({ kind: "lose", title: "😵 עבדו עליך!", sub: e.data?.line ?? e.text });
          sfx.sad();
          navigator.vibrate?.([200, 80, 200]);
        } else toast(e.text, "info", 6000);
      } else if (e.kind === "gift") {
        if (e.players[1] === meId && e.players[0] !== meId) toast(e.text, "ok", 6000);
      } else if (e.kind === "broke") {
        if (e.players.includes(meId)) {
          setFlash({ kind: "drink", title: "💸 פשטת רגל!", sub: `המשימה שלך: ${e.data?.task ?? "תשאל את המנחה"}. אחרי שתבצע, המנחה יאשר לך חילוץ.` });
          sfx.sad();
          navigator.vibrate?.([300, 100, 300]);
        } else toast(e.text, "info", 6000);
      } else if (e.kind === "shot") {
        // whoever drinks gets the big moment from the quiz result; everyone else hears about it
        if (!e.players.includes(meId)) toast(e.text, "info", 5000);
      } else if (e.kind === "wheel" && e.players.includes(meId)) {
        setFlash({ kind: "drink", title: "🍺 זה עליך!", sub: e.text.replace(/^🎡 /, "") });
        sfx.ding();
        navigator.vibrate?.([120, 60, 120, 60, 300]);
      } else if (e.kind === "caught" && e.players[0] === meId) {
        setFlash({ kind: "win", amount: view.pub.settings.catchReward, title: "🕵️ צדקת!", sub: "תפסת אותו על חם. המשימה שלו נשרפה." });
        sfx.win();
      } else if (e.kind === "caught" && e.players[1] === meId) {
        // the burned-mission flash covers this
      } else {
        toast(e.text, e.kind === "miss" && e.players[0] === meId ? "err" : "info", 5500);
      }
    }
  }, [feed]); // eslint-disable-line react-hooks/exhaustive-deps
  return <FlashView flash={flash} onClose={() => setFlash(null)} />;
}
