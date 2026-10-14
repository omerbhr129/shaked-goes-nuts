import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import type { ClientView, Mission } from "../../shared/types";
import { cls } from "../lib";
import type { Game } from "../net";
import { sfx } from "../sound";
import { Money, ask, toast } from "../ui";

const tierOf = (reward: number) => (reward >= 200 ? "קשה" : reward >= 150 ? "בינונית" : "קלה");

export function MissionsTab({ game, view }: { game: Game; view: ClientView }) {
  const missions = view.me!.missions;
  const done = missions.filter((m) => m.status === "done");
  const earned = done.reduce((a, m) => a + m.reward, 0);

  if (!missions.length) {
    return (
      <section className="stack">
        <div className="idle felt">
          <span className="idle-dice" aria-hidden="true">
            ✉️
          </span>
          <h2>המשימות עוד לא חולקו</h2>
          <p>המנחה יחלק לכל אחד שלוש משימות סודיות. ברגע שזה יקרה, הן יופיעו כאן.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="stack">
      <header className="missions-head">
        <h2>המשימות הסודיות שלך</h2>
        <p>
          רק אתם רואים אותן. מבצעים בלי שאף אחד ישים לב, ואז מסמנים כאן. המנחה מאשר בשקט, ובסוף הלילה כולם יגלו מי עבד על מי.
        </p>
        <div className="missions-progress">
          <span>
            {done.length} מתוך {missions.length} בוצעו
          </span>
          {earned > 0 && <Money n={earned} sign size={16} />}
        </div>
      </header>
      {missions.map((m) => (
        <Envelope key={m.id} m={m} game={game} />
      ))}
    </section>
  );
}

function Envelope({ m, game }: { m: Mission; game: Game }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // close the letter by itself so nobody reads over your shoulder
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => setOpen(false), 25_000);
    return () => window.clearTimeout(id);
  }, [open]);

  const claim = async () => {
    const ok = await ask({
      title: "המשימה בוצעה?",
      body: "המנחה יקבל בקשה לאשר אותה. אף אחד אחר לא יראה.",
      ok: "שליחה לאישור",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await game.act("claimMission", { missionId: m.id });
      sfx.coin();
      toast("נשלח למנחה. מחכים לאישור 🤫", "ok");
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  const unclaim = async () => {
    setBusy(true);
    try {
      await game.act("unclaimMission", { missionId: m.id });
      toast("הבקשה בוטלה");
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  const hint = m.status === "done" ? "בוצעה" : m.status === "pending" ? "ממתינה לאישור" : open ? "הקישו לסגירה" : "הקישו לפתיחה";

  return (
    <article className={cls("envelope", `st-${m.status}`, open && "unsealed")}>
      <button
        type="button"
        className="env-face"
        onClick={() => {
          setOpen(!open);
          sfx.tap();
        }}
        aria-expanded={open}
      >
        <span className="env-flap" aria-hidden="true" />
        <span className="env-seal" aria-hidden="true">
          <svg viewBox="0 0 32 32" width="26" height="26">
            <path d="M16 5.5c4.2 2.9 6 6.7 5.4 10.6-.6 3.5-2.8 6.6-5.4 8.4-2.6-1.8-4.8-4.9-5.4-8.4-.6-3.9 1.2-7.7 5.4-10.6z" fill="#F7D9A8" fillOpacity=".9" />
          </svg>
        </span>
        <span className="env-meta">
          <span className="env-tier">משימה {tierOf(m.reward)}</span>
          <Money n={m.reward} size={18} />
        </span>
        <span className="env-hint">{hint}</span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className="env-letter"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            <div className="env-paper">
              <p className="env-text">{m.text}</p>
              {m.status === "open" && (
                <button type="button" className="btn btn-gold" onClick={claim} disabled={busy}>
                  ביצעתי! שליחה לאישור
                </button>
              )}
              {m.status === "pending" && (
                <div className="env-pending">
                  <span>ממתינה לאישור המנחה ⏳</span>
                  <button type="button" className="link-btn" onClick={unclaim} disabled={busy}>
                    ביטול הבקשה
                  </button>
                </div>
              )}
              {m.status === "done" && (
                <div className="env-done">
                  <span>אושרה</span>
                  <Money n={m.reward} sign size={18} />
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {m.status === "done" && (
        <span className="env-stamp" aria-hidden="true">
          בוצע
        </span>
      )}
    </article>
  );
}
