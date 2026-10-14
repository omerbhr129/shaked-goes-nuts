import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientView, PlayerPub, TvMode } from "../../shared/types";
import { awardSteps } from "../awards";
import { cls, fmt, useMedia } from "../lib";
import { creds, type Game, useGame } from "../net";
import { QR } from "../qr";
import { sfx } from "../sound";
import { Avatar, ConnBanner, Marquee, Money, MuteButton, Sheet, ask, toast } from "../ui";
import { MissionsTab } from "./Missions";
import { PlayersTab } from "./Players";
import { RoundsTab } from "./Rounds";
import { RodeoItay } from "../rodeo";

// /admin#key=123456 logs the host in once and keeps the code on this device
{
  const m = location.hash.match(/key=([^&]+)/);
  if (m) {
    creds.key = decodeURIComponent(m[1]);
    history.replaceState(null, "", location.pathname);
  }
}

export type Run = (a: string, p?: Record<string, unknown>, ok?: string) => Promise<unknown>;

export function useRun(game: Game): Run {
  return useCallback(
    async (a, p = {}, ok) => {
      try {
        const r = await game.act(a, p);
        if (ok) toast(ok, "ok");
        return r ?? true;
      } catch (e) {
        toast((e as Error).message, "err", 5000);
        return undefined;
      }
    },
    [game],
  );
}

type Tab = "rounds" | "missions" | "players" | "tv";

export function AdminApp() {
  const { game, view, status } = useGame("admin");
  const [tab, setTab] = useState<Tab>("rounds");
  const run = useRun(game);
  const wide = useMedia("(min-width: 1100px)");
  useInboxAlerts(view);

  if (!view)
    return (
      <div className="splash">
        <Marquee size="m" />
        <RodeoItay size={220} />
      </div>
    );
  if (!view.admin) return <AdminLogin game={game} />;

  const online = view.pub.players.filter((p) => p.online).length;
  const tabs: [Tab, string][] = [
    ["rounds", "🎲 סיבובים"],
    ["missions", "🤫 משימות"],
    ["players", "👥 שחקנים"],
    ["tv", "📺 מסך"],
  ];

  return (
    <div className={cls("admin", wide && "wide")}>
      <ConnBanner status={status} />
      <div className="admin-head">
        <header className="admin-top">
          <Marquee size="s" />
          <div className="admin-top-info">
            <b>מסך מנחה</b>
            <span>
              {online} מתוך {view.pub.players.length} מחוברים
            </span>
          </div>
          <MuteButton />
        </header>
        <nav className="admin-tabs" aria-label="ניהול">
          {tabs.map(([id, label]) => (
            <button key={id} type="button" className={cls("admin-tab", tab === id && "on")} onClick={() => setTab(id)} aria-current={tab === id ? "page" : undefined}>
              {label}
            </button>
          ))}
        </nav>
        <Inbox view={view} run={run} />
      </div>
      <main className="admin-main">
        {tab === "rounds" && <RoundsTab game={game} view={view} run={run} />}
        {tab === "missions" && <MissionsTab view={view} run={run} />}
        {tab === "players" && <PlayersTab game={game} view={view} run={run} />}
        {tab === "tv" && <TvTab view={view} run={run} wide={wide} />}
      </main>
    </div>
  );
}

function useInboxAlerts(view: ClientView | null) {
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!view?.admin) return;
    const pending = [...view.admin.accusations.filter((a) => a.status === "pending"), ...view.admin.bailouts.filter((b) => b.status === "pending")];
    const prev = seen.current;
    seen.current = new Set(pending.map((x) => x.id));
    if (!prev) return;
    if (pending.some((x) => !prev.has(x.id))) {
      toast("📥 יש בקשה חדשה לטיפול", "info", 5000);
      sfx.coin();
      navigator.vibrate?.([40, 40, 40]);
    }
  }, [view]);
}

/** Catches and bailouts waiting for the host's ruling. */
function Inbox({ view, run }: { view: ClientView; run: Run }) {
  const [open, setOpen] = useState(false);
  const admin = view.admin!;
  const accs = admin.accusations.filter((a) => a.status === "pending");
  const bails = admin.bailouts.filter((b) => b.status === "pending");
  const people = Object.fromEntries(view.pub.players.map((p) => [p.id, p])) as Record<string, PlayerPub>;
  const { falsePenalty, catchReward, bailoutAmount } = view.pub.settings;
  const n = accs.length + bails.length;
  if (!n) return null;
  const parts = [accs.length && (accs.length === 1 ? "האשמה אחת" : `${accs.length} האשמות`), bails.length && (bails.length === 1 ? "בקשת חילוץ" : `${bails.length} בקשות חילוץ`)].filter(Boolean);
  return (
    <>
      <button type="button" className="inbox-bar" onClick={() => setOpen(true)}>
        <span>📥 לטיפול: {parts.join(" ו")}</span>
        <b>פתיחה</b>
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="לטיפול" wide>
        <div className="stack">
          {accs.map((a) => {
            const by = people[a.by];
            const sus = people[a.suspect];
            const options = admin.missions.filter((m) => m.assignedTo === a.suspect && m.status !== "burned");
            return (
              <div key={a.id} className="inbox-item">
                <div className="inbox-who">
                  {by && <Avatar p={by} size={36} />}
                  <span>
                    <b>{by?.name}</b> טוען שתפס את <b>{sus?.name}</b>
                  </span>
                  {sus && <Avatar p={sus} size={36} />}
                </div>
                <blockquote className="inbox-quote">״{a.text}״</blockquote>
                <p className="muted">
                  זה מתאים לאחת המשימות של {sus?.name}? אם כן, המשימה נשרפת ו{by?.name} מקבל {catchReward}.
                </p>
                <div className="mission-picks">
                  {options.map((m) => (
                    <button key={m.id} type="button" className="mission-pick" onClick={() => run("judgeAccusation", { accusationId: a.id, missionId: m.id }, `צדק! +${catchReward} ל${by?.name}`)}>
                      <span aria-hidden="true">{m.status === "done" ? "✅" : "✉️"}</span>
                      <span>{m.text}</span>
                    </button>
                  ))}
                </div>
                <button type="button" className="btn btn-danger" onClick={() => run("judgeAccusation", { accusationId: a.id }, `האשמת שווא: −${falsePenalty} ל${by?.name}`)}>
                  ✗ אף אחת. טעה (−{falsePenalty})
                </button>
              </div>
            );
          })}
          {bails.map((b) => {
            const p = people[b.playerId];
            return (
              <div key={b.id} className="inbox-item">
                <div className="inbox-who">
                  {p && <Avatar p={p} size={36} />}
                  <span>
                    🆘 <b>{p?.name}</b> מבקש חילוץ. יתרה: <Money n={p?.balance ?? 0} size={14} />
                  </span>
                </div>
                <p className="muted">באישור הוא מקבל {fmt(bailoutAmount)}, והטלוויזיה מגרילה לו עונש קטן.</p>
                <div className="row-actions">
                  <button type="button" className="btn btn-gold" onClick={() => run("judgeBailout", { bailoutId: b.id, approve: true }, "החילוץ אושר")}>
                    לאשר חילוץ
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => run("judgeBailout", { bailoutId: b.id, approve: false }, "הבקשה נדחתה")}>
                    לדחות
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </Sheet>
    </>
  );
}

function AdminLogin({ game }: { game: Game }) {
  const [code, setCode] = useState("");
  const [tried, setTried] = useState(!!creds.key);
  return (
    <div className="admin-login">
      <Marquee size="m" />
      <h1>כניסת מנחה</h1>
      {tried && <p className="error-text">הקוד לא נכון. נסו שוב.</p>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          creds.key = code.trim();
          setTried(true);
          game.rehello();
          void game.refresh();
        }}
      >
        <label className="field">
          <span>קוד מנחה</span>
          <input inputMode="numeric" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
        </label>
        <button type="submit" className="btn btn-gold" disabled={!code.trim()}>
          כניסה
        </button>
      </form>
    </div>
  );
}

export function WheelButtons({ run }: { run: Run }) {
  return (
    <div className="row-actions">
      <button type="button" className="btn btn-gold" onClick={() => run("spinWheel", { kind: "drink" }, "הגלגל מסתובב בטלוויזיה")}>
        🎡 גלגל השתייה
      </button>
      <button
        type="button"
        className="btn btn-ghost"
        onClick={async () => {
          if (await ask({ title: "גלגל העונשים?", body: "המקום האחרון כרגע מקבל עונש מהגלגל. מתאים לסוף הלילה.", ok: "לסובב" }))
            await run("spinWheel", { kind: "punish" }, "גלגל העונשים מסתובב");
        }}
      >
        🍋 גלגל העונשים
      </button>
    </div>
  );
}

function TvTab({ view, run, wide }: { view: ClientView; run: Run; wide: boolean }) {
  const [peek, setPeek] = useState(false);
  const modes: [TvMode, string, string][] = [
    ["lobby", "🎰 מסך פתיחה", "הלוגו, תעודת המניה של איתי וקוד QR להצטרפות"],
    ["round", "🎲 הסיבוב הנוכחי", "האתגר או שאלת הידע: השאלה, הקופה והתוצאה"],
    ["board", "📈 הבורסה", "פודיום, מי המלך ומי השקד המר, וגרף לכל אחד"],
    ["night", "🌙 הימורי הלילה", "כל הקופות והיחסים של הימורי הלילה"],
    ["missions", "🤫 חשיפת המשימות", "מציג את המשימות של כולם. לסוף הערב בלבד"],
    ["awards", "🏆 טקס פרסים", "פרסים מצחיקים, שלושה פודיומים, והשקד המר"],
    ["winner", "👑 הכרזת המנצח", "רק הפודיום הסופי, עם קונפטי"],
  ];
  const origin = location.origin;
  const setMode = async (m: TvMode) => {
    if (m === "missions" || m === "awards" || m === "winner") {
      const ok = await ask({
        title: m === "missions" ? "לחשוף את כל המשימות?" : m === "awards" ? "להתחיל את טקס הפרסים?" : "להכריז על המנצח?",
        body: m === "missions" ? "כל המשימות הסודיות של כולם יופיעו בטלוויזיה." : "מתאים לסוף הלילה, אחרי הסיבוב האחרון.",
        ok: "כן, לטלוויזיה",
      });
      if (!ok) return;
    }
    await run("setTv", { mode: m });
  };
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast("הועתק", "ok");
    } catch {
      toast(text);
    }
  };
  const steps = view.pub.tv.mode === "awards" ? awardSteps(view) : [];
  const step = Math.min(view.pub.tv.step, Math.max(0, steps.length - 1));
  const stepName = (i: number) => {
    const s = steps[i];
    if (!s) return "";
    return s.kind === "title" ? "פתיחה" : s.kind === "final" ? "👑 הפודיום הסופי" : s.kind === "punish" ? "🍋 השקד המר" : `${s.emoji} ${s.title}`;
  };

  return (
    <section className="tv-tab">
      <div className="tv-tab-ctl stack">
      <h2 className="section-title">מה מוצג בטלוויזיה</h2>
      <div className="tv-modes">
        {modes.map(([m, label, desc]) => (
          <button key={m} type="button" className={cls("tv-mode", view.pub.tv.mode === m && "on")} onClick={() => setMode(m)} aria-pressed={view.pub.tv.mode === m}>
            <b>{label}</b>
            <span>{desc}</span>
          </button>
        ))}
      </div>

      {view.pub.tv.mode === "awards" && (
        <div className="awards-ctl felt">
          <h3>🏆 טקס הפרסים</h3>
          <p>
            שלב {step + 1} מתוך {steps.length}: <b>{stepName(step)}</b>
          </p>
          <div className="row-actions">
            <button type="button" className="btn btn-ghost" disabled={step === 0} onClick={() => run("tvStep", { delta: -1, max: steps.length - 1 })}>
              ◀ הקודם
            </button>
            <button type="button" className="btn btn-gold" disabled={step >= steps.length - 1} onClick={() => run("tvStep", { delta: 1, max: steps.length - 1 })}>
              {step + 1 < steps.length ? `הבא: ${stepName(step + 1)}` : "זה הסוף"}
            </button>
          </div>
          {steps[step]?.kind === "punish" && <p className="muted">עכשיו לוחצים על ״גלגל העונשים״ למטה.</p>}
        </div>
      )}

      <div className="felt wheels">
        <h3>הגלגלים</h3>
        <p className="muted">הגלגל מסתובב על כל מסך שמוצג בטלוויזיה, ומי שנבחר מקבל התראה בטלפון.</p>
        <WheelButtons run={run} />
      </div>

      <div className="links felt">
        <h3>קישורים</h3>
        <div className="link-row">
          <span>לשחקנים</span>
          <code dir="ltr">{origin}</code>
          <button type="button" className="btn btn-ghost btn-s" onClick={() => copy(origin)}>
            העתקה
          </button>
        </div>
        <div className="link-row">
          <span>לטלוויזיה</span>
          <code dir="ltr">{origin}/tv</code>
          <a className="btn btn-ghost btn-s" href="/tv" target="_blank" rel="noreferrer">
            פתיחה
          </a>
        </div>
        <div className="links-qr">
          <QR url={origin} size={200} />
        </div>
      </div>
      </div>

      <div className="tv-tab-preview">
        {wide || peek ? (
          <div className="tv-preview felt">
            <div className="tv-preview-head">
              <h3>👁 מה רואים עכשיו בטלוויזיה</h3>
              {!wide && (
                <button type="button" className="link-btn" onClick={() => setPeek(false)}>
                  הסתרה
                </button>
              )}
            </div>
            <div className="tv-preview-frame">
              <iframe src="/tv?preview=1" title="תצוגה מקדימה של הטלוויזיה" loading="lazy" />
            </div>
          </div>
        ) : (
          <button type="button" className="btn btn-ghost" onClick={() => setPeek(true)}>
            👁 להציג כאן מה רואים בטלוויזיה
          </button>
        )}
      </div>
    </section>
  );
}
