import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientView, TvMode } from "../../shared/types";
import { cls } from "../lib";
import { creds, type Game, useGame } from "../net";
import { QR } from "../qr";
import { sfx } from "../sound";
import { ConnBanner, Marquee, MuteButton, ask, toast } from "../ui";
import { MissionsTab } from "./Missions";
import { PlayersTab } from "./Players";
import { RoundsTab } from "./Rounds";

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
  usePendingAlerts(view);

  if (!view) return <div className="splash"><Marquee size="m" /></div>;
  if (!view.admin) return <AdminLogin game={game} />;

  const pending = view.admin.missions.filter((m) => m.status === "pending").length;
  const online = view.pub.players.filter((p) => p.online).length;
  const tabs: [Tab, string, number?][] = [
    ["rounds", "🎲 סיבובים"],
    ["missions", "🤫 משימות", pending],
    ["players", "👥 שחקנים"],
    ["tv", "📺 מסך"],
  ];

  return (
    <div className="admin">
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
        {tabs.map(([id, label, badge]) => (
          <button key={id} type="button" className={cls("admin-tab", tab === id && "on")} onClick={() => setTab(id)} aria-current={tab === id ? "page" : undefined}>
            {label}
            {!!badge && <span className="badge">{badge}</span>}
          </button>
        ))}
      </nav>
      </div>
      <main className="admin-main">
        {tab === "rounds" && <RoundsTab game={game} view={view} run={run} />}
        {tab === "missions" && <MissionsTab view={view} run={run} />}
        {tab === "players" && <PlayersTab game={game} view={view} run={run} />}
        {tab === "tv" && <TvTab view={view} run={run} />}
      </main>
    </div>
  );
}

function usePendingAlerts(view: ClientView | null) {
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!view?.admin) return;
    const pending = view.admin.missions.filter((m) => m.status === "pending");
    const prev = seen.current;
    seen.current = new Set(pending.map((m) => m.id));
    if (!prev) return;
    for (const m of pending)
      if (!prev.has(m.id)) {
        const who = view.pub.players.find((p) => p.id === m.assignedTo)?.name ?? "מישהו";
        toast(`🤫 ${who} מבקש אישור למשימה`, "info", 6000);
        sfx.coin();
        navigator.vibrate?.([40, 40, 40]);
      }
  }, [view]);
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

function TvTab({ view, run }: { view: ClientView; run: Run }) {
  const modes: [TvMode, string, string][] = [
    ["lobby", "🎰 מסך פתיחה", "הלוגו, תעודת המניה של איתי וקוד QR להצטרפות"],
    ["round", "🎲 הסיבוב הנוכחי", "השאלה, ספירה לאחור, ההימורים והתוצאה"],
    ["board", "📈 טבלת המובילים", "מי הכי עשיר עכשיו, עם גרף לכל אחד"],
    ["missions", "🤫 חשיפת המשימות", "מציג את המשימות של כולם. לסוף הערב בלבד"],
    ["winner", "👑 הכרזת המנצח", "פודיום, כתר וקונפטי"],
  ];
  const origin = location.origin;
  const setMode = async (m: TvMode) => {
    if (m === "missions" || m === "winner") {
      const ok = await ask({
        title: m === "missions" ? "לחשוף את כל המשימות?" : "להכריז על המנצח?",
        body: m === "missions" ? "כל המשימות הסודיות של כולם יופיעו בטלוויזיה." : "הטלוויזיה תציג את הפודיום עם שלושת העשירים של הלילה.",
        ok: m === "missions" ? "חשיפה" : "הכרזה",
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
  return (
    <section className="stack">
      <h2 className="section-title">מה מוצג בטלוויזיה</h2>
      <div className="tv-modes">
        {modes.map(([m, label, desc]) => (
          <button key={m} type="button" className={cls("tv-mode", view.pub.tv.mode === m && "on")} onClick={() => setMode(m)} aria-pressed={view.pub.tv.mode === m}>
            <b>{label}</b>
            <span>{desc}</span>
          </button>
        ))}
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
    </section>
  );
}
