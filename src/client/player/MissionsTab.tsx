import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import type { ClientView, Mission } from "../../shared/types";
import { cls, fmt, mmss } from "../lib";
import { type Game, useServerNow } from "../net";
import { sfx } from "../sound";
import { Avatar, Money, Sheet, ask, burst, toast } from "../ui";

const tierOf = (reward: number) => (reward >= 200 ? "קשה" : reward >= 150 ? "בינונית" : "קלה");

export function MissionsTab({ game, view }: { game: Game; view: ClientView }) {
  const me = view.me!;
  const missions = me.missions;
  const done = missions.filter((m) => m.status === "done");
  const earned = done.reduce((a, m) => a + m.reward, 0);
  const allDone = missions.length > 0 && done.length === missions.length;
  const nameOf = (id: string | null) => view.pub.players.find((p) => p.id === id)?.name ?? "מישהו";

  return (
    <section className="stack">
      <header className="missions-head">
        <h2>המשימות הסודיות שלך</h2>
        <p>
          רק אתם רואים אותן. ביצעתם? לוחצים ״ביצעתי״, והטלוויזיה מכריזה שמשימה בוצעה, בלי שם. אם תוך {view.pub.settings.catchWindow} שניות אף אחד לא תופס אתכם, מי
          שעבדתם עליו משלם לכם. מי שתופס אתכם גונב לכם את השקדים.
        </p>
        <div className="missions-progress">
          <span>
            {done.length} מתוך {missions.length} בוצעו
          </span>
          {earned > 0 && <Money n={earned} sign size={16} />}
        </div>
      </header>

      {!missions.length && (
        <div className="idle felt">
          <span className="idle-dice" aria-hidden="true">
            ✉️
          </span>
          <h2>המשימות בדרך</h2>
          <p>המשימות מחולקות אוטומטית. אם הן לא מופיעות תוך רגע, תגידו למנחה.</p>
        </div>
      )}

      {missions.map((m) => (
        <Envelope key={m.id} m={m} game={game} view={view} />
      ))}

      {allDone && <ExtraMission game={game} />}

      {me.burned.length > 0 && (
        <div className="burned felt">
          <h3>🔥 משימות שנשרפו</h3>
          {me.burned.map((b, i) => (
            <p key={i}>
              ״{b.text}״ <span className="muted">· תפס אותך {nameOf(b.by)}</span>
            </p>
          ))}
        </div>
      )}

      <CatchCard game={game} view={view} />
    </section>
  );
}

function Envelope({ m, game, view }: { m: Mission; game: Game; view: ClientView }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = m.status === "pending";
  const now = useServerNow(game, pending, 500);
  const left = pending && m.claimedAt ? Math.max(0, m.claimedAt + view.pub.settings.catchWindow * 1000 - now) : 0;
  const names = [...new Set(Object.values(m.targets))].map((id) => view.pub.players.find((p) => p.id === id)?.name).filter(Boolean);
  const payer = names.length ? names.join(" ו") : "הבנק";

  // close the letter by itself so nobody reads over your shoulder
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => setOpen(false), 25_000);
    return () => window.clearTimeout(id);
  }, [open]);

  const claim = async () => {
    const ok = await ask({
      title: "המשימה בוצעה?",
      body: `הטלוויזיה תכריז שמשימה סודית בוצעה, בלי שם. לכולם יש ${view.pub.settings.catchWindow} שניות לתפוס אותך. לא תפסו? ${payer} משלם לך ${fmt(m.reward)}. תפסו? התופס גונב לך את השקדים.`,
      ok: "ביצעתי!",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await game.act("claimMission", { missionId: m.id });
      sfx.secret();
      burst("coins");
      navigator.vibrate?.([30, 50, 30]);
      toast(`🤫 ההתראה עלתה. עכשיו תשרוד ${view.pub.settings.catchWindow} שניות…`, "ok");
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  // a mission that can't work tonight: swap it for another one from the pool
  const swap = async () => {
    const ok = await ask({
      title: "🔄 להחליף את המשימה?",
      body: "מקבלים משימה אחרת מהמאגר, בדרך כלל באותו שווי. ההחלפה עולה 50 שקדים, ואף אחד לא יודע שהחלפת.",
      ok: "להחליף ב־50",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await game.act("swapMyMission", { missionId: m.id });
      sfx.coin();
      toast("🔄 יש לך משימה חדשה", "ok");
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  const unclaim = async () => {
    const ok = await ask({ title: "לבטל את הסימון?", body: "השקדים חוזרים למי ששילם, והמשימה חוזרת להיות פתוחה.", ok: "ביטול הסימון" });
    if (!ok) return;
    setBusy(true);
    try {
      await game.act("unclaimMission", { missionId: m.id });
      toast("הסימון בוטל");
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  const hint = m.status === "done" ? "בוצעה" : pending ? `⏳ ${mmss(left)}` : open ? "הקישו לסגירה" : "הקישו לפתיחה";

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
              {pending ? (
                <div className="env-done">
                  <span>
                    ⏳ {mmss(left)} לשרוד. לא יתפסו אותך? {payer} משלם לך <Money n={m.reward} size={16} />
                  </span>
                  <button type="button" className="link-btn" onClick={unclaim} disabled={busy}>
                    ביטול
                  </button>
                </div>
              ) : m.status === "done" ? (
                <div className="env-done">
                  <span>
                    בוצעה <Money n={m.reward} sign size={16} /> {names.length > 0 && <small className="muted">({payer} שילם)</small>}
                  </span>
                  <button type="button" className="link-btn" onClick={unclaim} disabled={busy}>
                    ביטול הסימון
                  </button>
                </div>
              ) : (
                <>
                  <button type="button" className="btn btn-gold" onClick={claim} disabled={busy}>
                    ✅ ביצעתי!
                  </button>
                  <button type="button" className="link-btn" onClick={swap} disabled={busy || view.me!.available < 150}>
                    🔄 בלתי אפשרית? להחליף ב־50 שקדים
                  </button>
                </>
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

function ExtraMission({ game }: { game: Game }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="notice">
      <p>סוכן מצטיין. כל המשימות בוצעו 😎</p>
      <button
        type="button"
        className="btn btn-gold btn-s"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await game.act("extraMission");
            sfx.secret();
            toast("משימת בונוס חדשה במעטפה", "ok");
          } catch (e) {
            toast((e as Error).message, "err");
          } finally {
            setBusy(false);
          }
        }}
      >
        עוד משימה, בבקשה
      </button>
    </div>
  );
}

/** "Caught you!" — accuse someone of doing a mission right now. The host rules on it. */
function CatchCard({ game, view }: { game: Game; view: ClientView }) {
  const me = view.me!;
  const { falsePenalty } = view.pub.settings;
  const [sheet, setSheet] = useState(false);
  const [suspect, setSuspect] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const acc = me.accusation;
  const nameOf = (id: string) => view.pub.players.find((p) => p.id === id)?.name ?? "";
  const pending = acc?.status === "pending";

  const send = async () => {
    if (!suspect) return;
    setBusy(true);
    try {
      await game.act("accuse", { suspectId: suspect, text });
      toast("נשלח למנחה. אם צדקתם, תשמעו על זה בטלוויזיה 🕵️", "ok");
      setSheet(false);
      setSuspect(null);
      setText("");
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="catch felt">
      <div className="catch-head">
        <span className="catch-icon" aria-hidden="true">
          🕵️
        </span>
        <div>
          <h3>תפסתם מישהו על חם?</h3>
          <p>
            מנחשים מה המשימה שלו. צדקתם? גונבים לו את שווי המשימה, והיא נשרפת. טעיתם? <b>{falsePenalty}</b> עוברים אליו.
          </p>
        </div>
      </div>
      {pending ? (
        <p className="catch-status">⏳ ההאשמה שלך נגד {nameOf(acc.suspect)} אצל המנחה</p>
      ) : (
        <>
          {acc && (
            <p className="catch-status">
              {acc.status === "right" ? `✅ צדקת לגבי ${nameOf(acc.suspect)}! גנבת לו את השקדים` : `❌ טעית לגבי ${nameOf(acc.suspect)}. ${falsePenalty} עברו אליו`}
            </p>
          )}
          <button type="button" className="btn btn-ghost" onClick={() => setSheet(true)}>
            🕵️ תפסתי מישהו!
          </button>
        </>
      )}
      <Sheet open={sheet} onClose={() => setSheet(false)} title="את מי תפסתם?">
        <div className="form">
          <div className="suspects">
            {view.pub.players
              .filter((p) => p.id !== me.id)
              .map((p) => (
                <button key={p.id} type="button" className={cls("suspect", suspect === p.id && "on")} onClick={() => setSuspect(p.id)} aria-pressed={suspect === p.id}>
                  <Avatar p={p} size={52} />
                  <span>{p.name}</span>
                </button>
              ))}
          </div>
          <label className="field">
            <span>מה לדעתכם המשימה שלו?</span>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={160} placeholder="למשל: הוא ניסה לגרום לאיתי להגיד ״פיסטוק״" />
          </label>
          <div className="sheet-actions">
            <button type="button" className="btn btn-gold" disabled={!suspect || text.trim().length < 3 || busy} onClick={send}>
              שליחה למנחה
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setSheet(false)}>
              ביטול
            </button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
