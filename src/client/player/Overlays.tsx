import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { ClientView } from "../../shared/types";
import { cls, lsGet, lsSet } from "../lib";
import { sfx } from "../sound";
import { Money, burst, toast } from "../ui";

interface Flash {
  kind: "win" | "lose" | "mission";
  amount: number;
  title: string;
  sub: string;
}

function useFlash() {
  const [flash, setFlash] = useState<Flash | null>(null);
  useEffect(() => {
    if (!flash) return;
    const id = window.setTimeout(() => setFlash(null), 4600);
    return () => window.clearTimeout(id);
  }, [flash]);
  return [flash, setFlash] as const;
}

function FlashView({ flash, onClose }: { flash: Flash | null; onClose: () => void }) {
  return (
    <AnimatePresence>
      {flash && (
        <motion.div className={cls("flash", flash.kind)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} role="alert">
          <motion.div
            className="flash-card"
            initial={{ scale: 0.6, rotate: -4 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 16 }}
          >
            <div className="flash-title">{flash.title}</div>
            <Money n={flash.amount} sign size={40} className="flash-amount" />
            <div className="flash-sub">{flash.sub}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Once per resolved round: the big win / loss moment on your phone. */
export function ResultOverlay({ view, meId }: { view: ClientView; meId: string }) {
  const [flash, setFlash] = useFlash();
  const r = view.pub.round;
  const myBet = view.me?.bet;
  const key = r && r.status === "resolved" && myBet ? `sgn.seen.${r.id}.${r.resolvedAt}.${meId}` : null;

  useEffect(() => {
    if (!key || !r || !myBet || lsGet(key)) return;
    lsSet(key, "1");
    const won = myBet.optionId === r.winnerId;
    const label = r.options.find((o) => o.id === r.winnerId)?.label ?? "";
    setFlash({
      kind: won ? "win" : "lose",
      amount: won ? myBet.amount : -myBet.amount,
      title: won ? "צדקת! 🤑" : "פספוס 😬",
      sub: `התוצאה: ״${label}״`,
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

/** Quiet celebration when the host approves one of your missions; a nudge when one is turned down. */
export function MissionWatcher({ view }: { view: ClientView }) {
  const [flash, setFlash] = useFlash();
  const prev = useRef<Map<string, string> | null>(null);
  const missions = view.me?.missions;

  useEffect(() => {
    if (!missions) return;
    const before = prev.current;
    prev.current = new Map(missions.map((m) => [m.id, m.status]));
    for (const m of missions) {
      const seenKey = `sgn.mdone.${m.id}`;
      if (m.status === "done" && !lsGet(seenKey)) {
        lsSet(seenKey, "1");
        if (before) {
          setFlash({ kind: "mission", amount: m.reward, title: "משימה אושרה 🤫", sub: "אף אחד לא יודע. בינתיים." });
          sfx.secret();
          burst("coins");
          navigator.vibrate?.([30, 50, 30]);
        }
      }
      if (before?.get(m.id) === "pending" && m.status === "open") toast("המנחה לא אישר את המשימה. אפשר לנסות שוב 💪", "info", 5000);
    }
  }, [missions]);

  return <FlashView flash={flash} onClose={() => setFlash(null)} />;
}
