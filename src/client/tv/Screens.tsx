import { motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import type { ClientView, PlayerPub, PublicBet, RoundPub } from "../../shared/types";
import { cls, fmt, mmss, photoOf, ranked } from "../lib";
import { type Game, useServerNow } from "../net";
import { QR } from "../qr";
import { sfx } from "../sound";
import { Avatar, Change, Led, Marquee, Money, Spark, burst } from "../ui";

const byId = (players: PlayerPub[]) => Object.fromEntries(players.map((p) => [p.id, p])) as Record<string, PlayerPub>;

/* ---------------- lobby ---------------- */

function useGallery(groom: PlayerPub | undefined) {
  const [photos, setPhotos] = useState<string[]>([]);
  useEffect(() => {
    fetch("/photos/gallery.json")
      .then((r) => (r.ok ? r.json() : []))
      .then((list: unknown) => setPhotos(Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : []))
      .catch(() => setPhotos([]));
  }, []);
  const all = photos.length ? photos : groom ? [photoOf(groom)] : [];
  const [i, setI] = useState(0);
  useEffect(() => {
    if (all.length < 2) return;
    const id = window.setInterval(() => setI((x) => (x + 1) % all.length), 6000);
    return () => window.clearInterval(id);
  }, [all.length]);
  return all.length ? all[i % all.length] : null;
}

export function Lobby({ view }: { view: ClientView }) {
  const players = view.pub.players;
  const groom = players.find((p) => p.isGroom);
  const photo = useGallery(groom);
  const { startBalance, currency } = view.pub.settings;
  const joined = players.filter((p) => p.claimed).length;
  return (
    <div className="lobby">
      <div className="cert">
        <div className="cert-inner">
          <div className="cert-kicker">תעודת מניה רגילה</div>
          <div className="cert-photo">
            {photo && <motion.img key={photo} src={photo} alt="" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1.2 }} />}
          </div>
          <div className="cert-name">{groom ? `${groom.name} שקד בע״מ` : "החתן בע״מ"}</div>
          <dl className="cert-rows">
            <div>
              <dt>סימול</dt>
              <dd dir="ltr">{groom?.ticker ?? "SHKD"}</dd>
            </div>
            <div>
              <dt>מחיר פתיחה</dt>
              <dd>
                {fmt(startBalance)} {currency}
              </dd>
            </div>
            <div>
              <dt>מיזוג צפוי עם שחף</dt>
              <dd dir="ltr">17.11.2026</dd>
            </div>
          </dl>
        </div>
      </div>
      <div className="lobby-side">
        <Marquee size="l" lights />
        <h1 className="lobby-h">הבורסה של החתן נפתחה</h1>
        <p className="lobby-p">
          סורקים, בוחרים שם ומקבלים {fmt(startBalance)} {currency}. מהמרים על מה שקורה הלילה ומבצעים משימות סודיות. מי שמסיים הכי עשיר, מנצח.
        </p>
        <div className="lobby-qr">
          <QR url={location.origin} size={260} />
          <div className="lobby-url">
            <span>סורקים, או נכנסים לכתובת</span>
            <b dir="ltr">{location.host}</b>
          </div>
        </div>
      </div>
      <div className="lobby-players" aria-label={`${joined} מחוברים`}>
        {players.map((p) => (
          <div key={p.id} className={cls("lp", p.claimed && "in")}>
            <Avatar p={p} size={92} />
            <span>{p.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- round ---------------- */

export function RoundScreen({ view, game }: { view: ClientView; game: Game }) {
  const r = view.pub.round!;
  const now = useServerNow(game, r.status === "open", 200);
  const open = r.status === "open" && (r.closesAt === null || now < r.closesAt);
  const people = useMemo(() => byId(view.pub.players), [view.pub.players]);

  // Suspense: a fresh result gets a drum roll before the reveal.
  const resolvedKey = r.status === "resolved" ? `${r.id}:${r.resolvedAt}` : null;
  const [suspense, setSuspense] = useState(false);
  useEffect(() => {
    if (!resolvedKey || !r.resolvedAt) return;
    if (Date.now() + game.offset - r.resolvedAt > 8000) return;
    setSuspense(true);
    sfx.drumroll(1.6);
    const id = window.setTimeout(() => {
      setSuspense(false);
      sfx.win();
      burst("big");
    }, 1750);
    return () => window.clearTimeout(id);
  }, [resolvedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // last seconds tick out loud
  const secsLeft = open && r.closesAt ? Math.ceil((r.closesAt - now) / 1000) : null;
  useEffect(() => {
    if (secsLeft !== null && secsLeft > 0 && secsLeft <= 5) sfx.tick();
  }, [secsLeft]);

  const showResult = r.status === "resolved" && !suspense;
  const pot = r.stats.reduce((a, s) => a + s.total, 0);
  const many = r.options.length > 3;

  return (
    <div className={cls("tvround", many && "many")}>
      <header className="tvround-head">
        <span className="tvround-num">
          סיבוב {r.number} מתוך {view.pub.roundsTotal}
        </span>
        <Marquee size="s" />
        <RoundClock r={r} open={open} now={now} suspense={suspense} />
      </header>

      <h1 className="tvround-title">
        <span className="tvround-emoji" aria-hidden="true">
          {r.emoji}
        </span>
        {r.title}
      </h1>
      {r.note && <p className="tvround-note">{r.note}</p>}

      <div className="tvopts">
        {r.options.map((o) => {
          const st = r.stats.find((s) => s.optionId === o.id) ?? { count: 0, total: 0 };
          const p = o.playerId ? people[o.playerId] : undefined;
          const win = showResult && r.winnerId === o.id;
          const lose = showResult && r.winnerId !== o.id;
          const backers = (r.bets ?? []).filter((b) => b.optionId === o.id);
          return (
            <motion.div key={o.id} layout className={cls("tvopt", win && "win", lose && "lose", p && "has-photo")}>
              {p ? (
                <div className="tvopt-person">
                  <Avatar p={p} size={many ? 110 : 170} />
                  <span className="tvopt-label">{o.label}</span>
                </div>
              ) : (
                <span className="tvopt-big">{o.label}</span>
              )}
              <div className="tvopt-stats">
                <span>{st.count === 1 ? "הימור אחד" : `${st.count} הימורים`}</span>
                <Money n={st.total} size={many ? 22 : 28} />
              </div>
              <div className="tvopt-bar">
                <motion.div initial={false} animate={{ scaleX: pot ? st.total / pot : 0 }} transition={{ type: "spring", stiffness: 90, damping: 18 }} />
              </div>
              {r.bets && (
                <div className="tvopt-backers">
                  {backers.map((b) => (
                    <Backer key={b.playerId} b={b} p={people[b.playerId]} outcome={showResult ? (win ? "up" : "down") : null} />
                  ))}
                </div>
              )}
              {win && <div className="tvopt-badge">התוצאה</div>}
            </motion.div>
          );
        })}
      </div>

      <footer className="tvround-foot">
        {open && <Waiting r={r} people={view.pub.players} />}
        {!open && r.status !== "resolved" && <div className="tv-banner">🔒 ההימורים נסגרו. האתגר מתחיל!</div>}
        {r.status === "resolved" && suspense && <div className="tv-banner pulse">והתוצאה היא…</div>}
        {showResult && <Results r={r} people={people} />}
      </footer>
    </div>
  );
}

function RoundClock({ r, open, now, suspense }: { r: RoundPub; open: boolean; now: number; suspense: boolean }) {
  if (open && r.closesAt) {
    const left = Math.max(0, r.closesAt - now);
    const total = Math.max(left, r.closesAt - (r.openedAt ?? now), 1);
    const frac = Math.min(1, left / total);
    const C = 2 * Math.PI * 54;
    return (
      <div className={cls("ring", left <= 10_000 && "urgent")} role="timer">
        <svg viewBox="0 0 120 120" width="140" height="140" aria-hidden="true">
          <circle cx="60" cy="60" r="54" className="ring-bg" />
          <circle cx="60" cy="60" r="54" className="ring-fg" strokeDasharray={C} strokeDashoffset={C * (1 - frac)} />
        </svg>
        <span className="ring-text num">{mmss(left)}</span>
      </div>
    );
  }
  const label = open ? "ההימורים פתוחים" : r.status === "resolved" ? (suspense ? "רגע…" : "הוכרע") : "סגור";
  return <span className={cls("status-pill", open && "live")}>{label}</span>;
}

function Backer({ b, p, outcome }: { b: PublicBet; p?: PlayerPub; outcome: "up" | "down" | null }) {
  if (!p) return null;
  return (
    <motion.span className={cls("backer", outcome)} initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 400, damping: 20 }}>
      <Avatar p={p} size={46} />
      <span className="num">{outcome === "up" ? "+" : outcome === "down" ? "−" : ""}{fmt(b.amount)}</span>
    </motion.span>
  );
}

function Waiting({ r, people }: { r: RoundPub; people: PlayerPub[] }) {
  const eligible = people.filter((p) => !r.noBet.includes(p.id) && p.claimed);
  const done = new Set(r.bettors);
  const waiting = eligible.filter((p) => !done.has(p.id));
  return (
    <div className="waiting">
      <div className="waiting-group">
        <span className="waiting-label">כבר הימרו</span>
        <div className="waiting-faces">
          {eligible
            .filter((p) => done.has(p.id))
            .map((p) => (
              <motion.span key={p.id} initial={{ scale: 0, y: 20 }} animate={{ scale: 1, y: 0 }}>
                <Avatar p={p} size={64} />
              </motion.span>
            ))}
        </div>
      </div>
      {waiting.length > 0 && (
        <div className="waiting-group dim">
          <span className="waiting-label">מחכים ל־</span>
          <div className="waiting-faces">
            {waiting.map((p) => (
              <Avatar key={p.id} p={p} size={56} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Results({ r, people }: { r: RoundPub; people: Record<string, PlayerPub> }) {
  const bets = r.bets ?? [];
  if (!bets.length) return <div className="tv-banner">אף אחד לא הימר בסיבוב הזה</div>;
  const winners = bets.filter((b) => b.optionId === r.winnerId).sort((a, b) => b.amount - a.amount);
  const losers = bets.filter((b) => b.optionId !== r.winnerId).sort((a, b) => b.amount - a.amount);
  return (
    <div className="results">
      <div className="results-col up">
        <span className="results-label">הרוויחו</span>
        {winners.length ? (
          winners.map((b, i) => (
            <motion.span key={b.playerId} className="results-item" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 * i }}>
              <Avatar p={people[b.playerId] ?? { id: b.playerId, name: "?", photo: null, isGroom: false }} size={52} />
              <span>{people[b.playerId]?.name}</span>
              <Money n={b.amount} sign size={24} />
            </motion.span>
          ))
        ) : (
          <span className="results-none">אף אחד 😅</span>
        )}
      </div>
      <div className="results-col down">
        <span className="results-label">הפסידו</span>
        {losers.length ? (
          losers.map((b, i) => (
            <motion.span key={b.playerId} className="results-item" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 + 0.15 * i }}>
              <Avatar p={people[b.playerId] ?? { id: b.playerId, name: "?", photo: null, isGroom: false }} size={52} />
              <span>{people[b.playerId]?.name}</span>
              <Money n={-b.amount} sign size={24} />
            </motion.span>
          ))
        ) : (
          <span className="results-none">אף אחד 🎉</span>
        )}
      </div>
    </div>
  );
}

/* ---------------- leaderboard ---------------- */

export function BoardScreen({ view }: { view: ClientView }) {
  const list = ranked(view.pub.players);
  const start = view.pub.settings.startBalance;
  return (
    <div className="tvboard">
      <header className="tvboard-head">
        <Marquee size="s" />
        <h1>מצב המסחר</h1>
        <span className="tvboard-sub">
          {view.pub.roundsDone} מתוך {view.pub.roundsTotal} סיבובים הוכרעו
        </span>
      </header>
      <ol className="tvboard-list">
        {list.map((p, i) => (
          <motion.li layout transition={{ type: "spring", stiffness: 110, damping: 20 }} key={p.id} className={cls("tvrow", i === 0 && "lead")}>
            <span className="tvrow-rank num">{i + 1}</span>
            <Avatar p={p} size={68} />
            <span className="tvrow-name">{p.name}</span>
            <span className="tvrow-ticker">{p.ticker}</span>
            <Spark data={p.spark} w={300} h={56} />
            <span className="tvrow-bal">
              <Led value={p.balance} />
            </span>
            <Change balance={p.balance} start={start} />
          </motion.li>
        ))}
      </ol>
    </div>
  );
}

/* ---------------- end of night ---------------- */

export function RevealScreen({ view }: { view: ClientView }) {
  const people = byId(view.pub.players);
  const entries = (view.pub.reveal ?? []).filter((e) => people[e.playerId] && e.missions.length);
  useEffect(() => sfx.secret(), []);
  return (
    <div className="tvreveal">
      <header className="tvreveal-head">
        <h1>המשימות הסודיות נחשפות 🤫</h1>
        <p>מי עבד על מי כל הערב</p>
      </header>
      <div className="reveal-grid">
        {entries.map((e, i) => {
          const p = people[e.playerId];
          const done = e.missions.filter((m) => m.status === "done").length;
          return (
            <motion.div
              key={e.playerId}
              className="reveal-card"
              initial={{ opacity: 0, y: 40, rotateX: -70 }}
              animate={{ opacity: 1, y: 0, rotateX: 0 }}
              transition={{ delay: 0.4 + i * 0.45, duration: 0.7, ease: [0.2, 0.8, 0.2, 1] }}
            >
              <div className="reveal-head">
                <Avatar p={p} size={60} />
                <b>{p.name}</b>
                <span className="reveal-score num">
                  {done}/{e.missions.length}
                </span>
              </div>
              <ul>
                {e.missions.map((m, j) => (
                  <li key={j} className={m.status}>
                    <span className="mark" aria-hidden="true">
                      {m.status === "done" ? "✓" : "✗"}
                    </span>
                    <span>{m.text}</span>
                  </li>
                ))}
              </ul>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

export function WinnerScreen({ view }: { view: ClientView }) {
  const [first, second, third] = ranked(view.pub.players);
  const { currency } = view.pub.settings;
  useEffect(() => {
    sfx.fanfare();
    burst("big");
    const id = window.setInterval(() => burst("win"), 5000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <div className="tvwin">
      <Marquee size="m" lights />
      <motion.h1 className="tvwin-title" initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
        מלך השקדים של הלילה
      </motion.h1>
      <div className="podium" dir="ltr">
        {second && <Podium p={second} place={2} currency={currency} delay={1.2} />}
        {first && <Podium p={first} place={1} currency={currency} delay={2} />}
        {third && <Podium p={third} place={3} currency={currency} delay={0.6} />}
      </div>
    </div>
  );
}

function Podium({ p, place, currency, delay }: { p: PlayerPub; place: number; currency: string; delay: number }) {
  const big = place === 1;
  return (
    <motion.div
      className={cls("podium-step", `p${place}`)}
      initial={{ opacity: 0, y: 80 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, type: "spring", stiffness: 120, damping: 14 }}
      dir="rtl"
    >
      {big && (
        <span className="crown" aria-hidden="true">
          👑
        </span>
      )}
      <Avatar p={p} size={big ? 250 : 150} />
      <span className="podium-name">{p.name}</span>
      <span className="podium-bal">
        <Led value={p.balance} /> <small>{currency}</small>
      </span>
      <span className="podium-block num">{place}</span>
    </motion.div>
  );
}
