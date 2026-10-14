import { AnimatePresence, motion } from "motion/react";
import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import type { ClientView, PlayerPub, PublicBet, RoundPub } from "../../shared/types";
import { type AwardStep, awardSteps } from "../awards";
import { LETTERS, cls, fmt, fmtX, kingAndLast, mmss, multiplier, photoOf, potOf, ranked, signed } from "../lib";
import { type Game, useServerNow } from "../net";
import { QR } from "../qr";
import { sfx } from "../sound";
import { Avatar, Change, Coin, FunnyFace, Led, Marquee, Money, Podium, Spark, burst } from "../ui";

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
          סורקים, בוחרים שם ומקבלים {fmt(startBalance)} {currency} ושלוש משימות סודיות. מהמרים על מה שקורה הלילה. מי שמסיים הכי עשיר, מנצח.
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

/* ---------------- live round ---------------- */

/** A multiplier that flips like a departures board when it moves. */
function Odds({ value }: { value: number | null }) {
  const text = value === null ? "—" : fmtX(value);
  return (
    <span className="odds">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span key={text} initial={{ y: -24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 24, opacity: 0 }} transition={{ duration: 0.3 }}>
          {text}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

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
  const many = r.options.length > 3;
  const deltaOf = (pid: string) => r.results?.find((x) => x.playerId === pid)?.delta ?? 0;

  return (
    <div className={cls("tvround", many && "many")}>
      <header className="tvround-head">
        <span className="tvround-num">
          סיבוב {r.number} מתוך {view.pub.roundsTotal}
        </span>
        <div className="tv-pot">
          <span className="tv-pot-label">בקופה</span>
          <span className="tv-pot-amount">
            <Led value={potOf(r)} />
            <Coin size={34} />
          </span>
          <span className="tv-pot-note">כולל {fmt(r.bonus)} בונוס מהבנק</span>
        </div>
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
                  <Avatar p={p} size={many ? 110 : 160} />
                  <span className="tvopt-label">{o.label}</span>
                </div>
              ) : (
                <span className="tvopt-big">{o.label}</span>
              )}
              <div className="tvopt-stats">
                <Odds value={multiplier(r, o.id)} />
                <span className="tvopt-count">
                  {st.count === 1 ? "הימור אחד" : `${st.count} הימורים`} · <Money n={st.total} size={many ? 18 : 24} />
                </span>
              </div>
              <div className="tvopt-bar">
                <motion.div initial={false} animate={{ scaleX: r.staked ? st.total / r.staked : 0 }} transition={{ type: "spring", stiffness: 90, damping: 18 }} />
              </div>
              {r.bets && (
                <div className="tvopt-backers">
                  {backers.map((b) => (
                    <Backer key={b.playerId} b={b} p={people[b.playerId]} delta={showResult && !r.refunded ? deltaOf(b.playerId) : null} />
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
        {showResult && (r.refunded ? <div className="tv-banner">אף אחד לא צדק! כל ההימורים חוזרים לבעלים</div> : <Results r={r} people={people} />)}
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

function Backer({ b, p, delta }: { b: PublicBet; p?: PlayerPub; delta: number | null }) {
  if (!p) return null;
  const dir = delta === null ? null : delta >= 0 ? "up" : "down";
  return (
    <motion.span className={cls("backer", dir)} initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 400, damping: 20 }}>
      <Avatar p={p} size={46} />
      <span className="num">{delta === null ? fmt(b.amount) : signed(delta)}</span>
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
  const results = r.results ?? [];
  if (!results.length) return <div className="tv-banner">אף אחד לא הימר בסיבוב הזה</div>;
  const winners = results.filter((x) => x.delta >= 0).sort((a, b) => b.delta - a.delta);
  const losers = results.filter((x) => x.delta < 0).sort((a, b) => a.delta - b.delta);
  const item = (x: { playerId: string; delta: number }, i: number, base: number) => {
    const p = people[x.playerId];
    if (!p) return null;
    return (
      <motion.span key={x.playerId} className="results-item" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: base + 0.15 * i }}>
        <Avatar p={p} size={52} />
        <span>{p.name}</span>
        <Money n={x.delta} sign size={24} />
      </motion.span>
    );
  };
  return (
    <div className="results">
      <div className="results-col up">
        <span className="results-label">הרוויחו</span>
        {winners.length ? winners.map((x, i) => item(x, i, 0)) : <span className="results-none">אף אחד 😅</span>}
      </div>
      <div className="results-col down">
        <span className="results-label">הפסידו</span>
        {losers.length ? losers.map((x, i) => item(x, i, 0.3)) : <span className="results-none">אף אחד 🎉</span>}
      </div>
    </div>
  );
}

/* ---------------- quiz ---------------- */

export function QuizScreen({ view, game }: { view: ClientView; game: Game }) {
  const r = view.pub.round!;
  const now = useServerNow(game, r.status === "open", 200);
  const open = r.status === "open" && (r.closesAt === null || now < r.closesAt);
  const people = useMemo(() => byId(view.pub.players), [view.pub.players]);
  const resolvedKey = r.status === "resolved" ? `${r.id}:${r.resolvedAt}` : null;
  const [phase, setPhase] = useState<"suspense" | "answer" | "shot" | null>(null);

  // reveal: drum roll → the right answer lights up → the shot screen for whoever got it wrong
  useLayoutEffect(() => {
    if (!resolvedKey || !r.resolvedAt) return;
    const fresh = Date.now() + game.offset - r.resolvedAt < 8000;
    if (!fresh) {
      setPhase("answer");
      return;
    }
    setPhase("suspense");
    sfx.drumroll(1.4);
    const t1 = window.setTimeout(() => {
      setPhase("answer");
      sfx.win();
      burst("win");
    }, 1500);
    const t2 = r.losers.length
      ? window.setTimeout(() => {
          setPhase("shot");
          sfx.gotcha();
        }, 4300)
      : 0;
    const t3 = r.losers.length ? window.setTimeout(() => setPhase("answer"), 17000) : 0;
    return () => [t1, t2, t3].forEach((t) => t && window.clearTimeout(t));
  }, [resolvedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const secsLeft = open && r.closesAt ? Math.ceil((r.closesAt - now) / 1000) : null;
  useEffect(() => {
    if (secsLeft !== null && secsLeft > 0 && secsLeft <= 5) sfx.tick();
  }, [secsLeft]);

  const reveal = r.status === "resolved" && phase !== "suspense";
  const answered = new Set(r.bettors);
  const eligible = view.pub.players.filter((p) => p.claimed && !r.noBet.includes(p.id));
  const rightOnes = (r.results ?? []).filter((x) => x.delta > 0).sort((a, b) => b.delta - a.delta);

  return (
    <div className={cls("tvquiz", r.options.length > 4 && "many")}>
      <header className="tvround-head">
        <span className="tvround-num">❓ שאלת ידע · סיבוב {r.number}</span>
        <div className="tv-pot">
          <span className="tv-pot-label">תשובה נכונה</span>
          <span className="tv-pot-amount">
            <Led value={r.reward} />
            <Coin size={34} />
          </span>
          <span className="tv-pot-note">הכי מהיר עוד {fmt(r.bonus)} · טועים שותים 🥃</span>
        </div>
        <RoundClock r={r} open={open} now={now} suspense={phase === "suspense"} />
      </header>
      <h1 className="tvround-title">
        <span className="tvround-emoji" aria-hidden="true">
          {r.emoji}
        </span>
        {r.title}
      </h1>
      {r.note && <p className="tvround-note">{r.note}</p>}

      <div className="quiz-grid">
        {r.options.map((o, i) => {
          const st = r.stats.find((s) => s.optionId === o.id);
          const p = o.playerId ? people[o.playerId] : undefined;
          const right = reveal && r.winnerId === o.id;
          const wrong = reveal && r.winnerId !== o.id;
          const who = (r.bets ?? []).filter((b) => b.optionId === o.id);
          return (
            <motion.div key={o.id} layout className={cls("qopt", right && "right", wrong && "wrong")}>
              <span className="qopt-letter">{LETTERS[i]}</span>
              {p && <Avatar p={p} size={r.options.length > 4 ? 64 : 84} />}
              <span className="qopt-label">{o.label}</span>
              {r.bets && <span className="qopt-count num">{st?.count ?? 0}</span>}
              {r.bets && who.length > 0 && (
                <span className="qopt-who">
                  {who.map((b) => (people[b.playerId] ? <Avatar key={b.playerId} p={people[b.playerId]} size={36} /> : null))}
                </span>
              )}
            </motion.div>
          );
        })}
      </div>

      <footer className="tvround-foot">
        {open && (
          <div className="waiting">
            <div className="waiting-group">
              <span className="waiting-label">כבר ענו</span>
              <div className="waiting-faces">
                {eligible
                  .filter((p) => answered.has(p.id))
                  .map((p) => (
                    <motion.span key={p.id} initial={{ scale: 0, y: 20 }} animate={{ scale: 1, y: 0 }}>
                      <Avatar p={p} size={64} />
                    </motion.span>
                  ))}
              </div>
            </div>
            {eligible.some((p) => !answered.has(p.id)) && (
              <div className="waiting-group dim">
                <span className="waiting-label">עוד לא ענו</span>
                <div className="waiting-faces">
                  {eligible
                    .filter((p) => !answered.has(p.id))
                    .map((p) => (
                      <Avatar key={p.id} p={p} size={56} />
                    ))}
                </div>
              </div>
            )}
          </div>
        )}
        {!open && r.status !== "resolved" && <div className="tv-banner">⏳ הזמן נגמר! מה התשובה?</div>}
        {phase === "suspense" && <div className="tv-banner pulse">והתשובה הנכונה היא…</div>}
        {reveal && phase !== "shot" && (
          <div className="results">
            <div className="results-col up">
              <span className="results-label">צדקו</span>
              {rightOnes.length ? (
                rightOnes.map((x, i) =>
                  people[x.playerId] ? (
                    <motion.span key={x.playerId} className="results-item" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 * i }}>
                      <Avatar p={people[x.playerId]} size={52} />
                      <span>{people[x.playerId].name}</span>
                      <Money n={x.delta} sign size={24} />
                      {i === 0 && <span aria-label="הכי מהיר">⚡</span>}
                    </motion.span>
                  ) : null,
                )
              ) : (
                <span className="results-none">אף אחד 😬</span>
              )}
            </div>
            <div className="results-col down">
              <span className="results-label">שותים 🥃</span>
              {r.losers.length ? (
                r.losers.map((id) =>
                  people[id] ? (
                    <span key={id} className="results-item">
                      <Avatar p={people[id]} size={52} />
                      <span>{people[id].name}</span>
                    </span>
                  ) : null,
                )
              ) : (
                <span className="results-none">אף אחד 🎉</span>
              )}
            </div>
          </div>
        )}
      </footer>

      <AnimatePresence>{phase === "shot" && <ShotOverlay r={r} people={people} />}</AnimatePresence>
    </div>
  );
}

const andList = (names: string[]) => (names.length > 1 ? `${names.slice(0, -1).join(", ")} ו${names[names.length - 1]}` : names[0] ?? "");

/** "X answered wrong, Y didn't answer at all": everybody hears exactly why they drink. */
function shotLine(r: RoundPub, who: PlayerPub[]) {
  const answered = new Set((r.bets ?? []).map((b) => b.playerId));
  const wrong = who.filter((p) => answered.has(p.id)).map((p) => p.name);
  const silent = who.filter((p) => !answered.has(p.id)).map((p) => p.name);
  if (r.loserReason === "slow") return `${andList(wrong)}, צדקת אבל ענית אחרון. המשימה שלך: לשתות שוט!`;
  if (!silent.length) return wrong.length === 1 ? `${wrong[0]}, ענית לא נכון. המשימה שלך: לשתות שוט!` : `${andList(wrong)}, עניתם לא נכון. המשימה שלכם: לשתות שוט!`;
  if (!wrong.length) return silent.length === 1 ? `${silent[0]}, לא ענית בזמן. המשימה שלך: לשתות שוט!` : `${andList(silent)}, לא עניתם בזמן. המשימה שלכם: לשתות שוט!`;
  return `${andList(wrong)} ${wrong.length > 1 ? "ענו" : "ענה"} לא נכון, ו${andList(silent)} ${silent.length > 1 ? "לא ענו" : "לא ענה"} בכלל. המשימה של כולם: לשתות שוט!`;
}

/** The big moment: faces of whoever got it wrong, and their task. */
function ShotOverlay({ r, people }: { r: RoundPub; people: Record<string, PlayerPub> }) {
  const who = r.losers.map((id) => people[id]).filter((p): p is PlayerPub => !!p);
  const size = who.length <= 2 ? 330 : who.length <= 4 ? 250 : 190;
  return (
    <motion.div className="shot" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div className="shot-title" initial={{ scale: 0.4, rotate: -10 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 260, damping: 12 }}>
        🥃 שוט!
      </motion.div>
      <div className="shot-faces">
        {who.map((p, i) => (
          <motion.div key={p.id} className="shot-person" initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.4 + i * 0.18, type: "spring", stiffness: 200, damping: 15 }}>
            <FunnyFace p={p} size={size} />
            <span className="shot-glass" aria-hidden="true">
              🥃
            </span>
            <b>{p.name}</b>
          </motion.div>
        ))}
      </div>
      <motion.p className="shot-text" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1 }}>
        {shotLine(r, who)}
      </motion.p>
    </motion.div>
  );
}

/* ---------------- the exchange: podium + board ---------------- */

export function BoardScreen({ view }: { view: ClientView }) {
  const list = ranked(view.pub.players);
  const start = view.pub.settings.startBalance;
  const { king, last } = kingAndLast(view.pub.players);
  const kingP = list.find((p) => p.id === king);
  const lastP = list.find((p) => p.id === last);
  return (
    <div className="tvboard">
      <header className="tvboard-head">
        <Marquee size="s" />
        <h1>📈 הבורסה</h1>
        <span className="tvboard-sub">
          {view.pub.roundsDone} מתוך {view.pub.roundsTotal} סיבובים הוכרעו
        </span>
      </header>
      <div className="tvboard-body">
        <section className="tvboard-podium">
          <Podium list={list.slice(0, 3)} size="l" value={(p) => <Led value={p.balance} />} />
          <div className="tvboard-roles">
            {kingP && (
              <p>
                👑 <b>{kingP.name}</b> הוא המלך: בוחר מי מתמודד באתגר הבא
              </p>
            )}
            {lastP && (
              <p>
                🍋 <b>{lastP.name}</b> הוא השקד המר: הגלגל אוהב אותו
              </p>
            )}
          </div>
        </section>
        <ol className="tvboard-list">
          {list.map((p, i) => (
            <motion.li layout transition={{ type: "spring", stiffness: 110, damping: 20 }} key={p.id} className={cls("tvrow", i === 0 && "lead")}>
              <span className="tvrow-rank num">{i + 1}</span>
              <Avatar p={p} size={58} badge={p.id === king ? "👑" : p.id === last ? "🍋" : null} />
              <span className="tvrow-name">
                {p.name}
                <small>{p.ticker}</small>
              </span>
              <Spark data={p.spark} w={170} h={46} />
              <span className="tvrow-bal">
                <Led value={p.balance} />
              </span>
              <Change balance={p.balance} start={start} />
            </motion.li>
          ))}
        </ol>
      </div>
    </div>
  );
}

/* ---------------- night bets ---------------- */

export function NightScreen({ view }: { view: ClientView }) {
  const people = byId(view.pub.players);
  const list = view.pub.night;
  return (
    <div className="tvnight">
      <header className="tvnight-head">
        <h1>🌙 הימורי הלילה</h1>
        <p>פתוחים כל הלילה בטלפון, בלשונית בורסה. הקופה מתחלקת בין מי שצדק.</p>
      </header>
      {!list.length && <div className="tv-banner">המנחה עוד לא פתח הימורי לילה</div>}
      <div className={cls("night-grid", list.length > 4 && "dense")}>
        {list.map((r) => {
          const ordered = [...r.options].sort(
            (a, b) => (r.stats.find((s) => s.optionId === b.id)?.total ?? 0) - (r.stats.find((s) => s.optionId === a.id)?.total ?? 0),
          );
          return (
            <div key={r.id} className={cls("ncard", r.status)}>
              <div className="ncard-head">
                <span className="ncard-emoji" aria-hidden="true">
                  {r.emoji}
                </span>
                <b>{r.title}</b>
              </div>
              <div className="ncard-pot">
                <Money n={potOf(r)} size={24} />
                <span>{r.status === "resolved" ? "הוכרע" : r.status === "closed" ? "נסגר" : `${r.bettors.length} הימרו`}</span>
              </div>
              <ul className="ncard-opts">
                {ordered.slice(0, list.length > 4 ? 5 : 8).map((o) => {
                  const st = r.stats.find((s) => s.optionId === o.id);
                  const p = o.playerId ? people[o.playerId] : undefined;
                  return (
                    <li key={o.id} className={cls(r.winnerId === o.id && "win", r.status === "resolved" && r.winnerId !== o.id && "lose")}>
                      {p && <Avatar p={p} size={30} />}
                      <span className="ncard-label">{o.label}</span>
                      <span className="ncard-x">{fmtX(multiplier(r, o.id))}</span>
                      <span className="ncard-bar">
                        <span style={{ transform: `scaleX(${r.staked ? (st?.total ?? 0) / r.staked : 0})` }} />
                      </span>
                    </li>
                  );
                })}
                {list.length > 4 && ordered.length > 5 && <li className="ncard-more">ועוד {ordered.length - 5} אפשרויות</li>}
              </ul>
            </div>
          );
        })}
      </div>
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
                <Avatar p={p} size={56} />
                <b>{p.name}</b>
                <span className="reveal-score num">
                  {done}/{e.missions.filter((m) => m.status !== "burned").length}
                </span>
              </div>
              <ul>
                {e.missions.map((m, j) => (
                  <li key={j} className={m.status}>
                    <span className="mark" aria-hidden="true">
                      {m.status === "done" ? "✓" : m.status === "burned" ? "🔥" : "✗"}
                    </span>
                    <span>
                      {m.text}
                      {m.status === "burned" && m.caughtBy && <em> (נתפס ע״י {people[m.caughtBy]?.name})</em>}
                    </span>
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

export function AwardsScreen({ view }: { view: ClientView }) {
  const steps = awardSteps(view);
  const idx = Math.min(view.pub.tv.step, steps.length - 1);
  const step = steps[idx];
  const people = byId(view.pub.players);

  useEffect(() => {
    if (step.kind === "final") {
      sfx.fanfare();
      burst("big");
    } else if (step.kind === "award" || step.kind === "podium") {
      sfx.drumroll(1);
      const id = window.setTimeout(() => burst("win"), 1100);
      return () => window.clearTimeout(id);
    } else if (step.kind === "punish") sfx.gotcha();
  }, [idx]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="tvawards">
      <AnimatePresence mode="wait">
        <motion.div key={idx} className="award-stage" initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.04 }} transition={{ duration: 0.5 }}>
          <AwardView step={step} people={people} view={view} />
        </motion.div>
      </AnimatePresence>
      <span className="award-progress num">
        {idx + 1}/{steps.length}
      </span>
    </div>
  );
}

function AwardView({ step, people, view }: { step: AwardStep; people: Record<string, PlayerPub>; view: ClientView }) {
  if (step.kind === "title")
    return (
      <div className="award-title">
        <Marquee size="l" lights />
        <h1>🏆 טקס פרסי השקד הזהב</h1>
        <p>הרגע שכולם חיכו לו. מי עבד על מי, מי הימר נכון, ומי שותה.</p>
      </div>
    );
  if (step.kind === "award")
    return (
      <div className="award-card">
        <span className="award-emoji" aria-hidden="true">
          {step.emoji}
        </span>
        <h1>{step.title}</h1>
        <div className="award-winners">
          {step.ids.map((id, i) =>
            people[id] ? (
              <motion.span key={id} className="award-person" initial={{ scale: 0, rotate: -8 }} animate={{ scale: 1, rotate: 0 }} transition={{ delay: 1 + i * 0.2, type: "spring", stiffness: 220, damping: 14 }}>
                {step.emoji === "🥃" ? <FunnyFace p={people[id]} size={220} /> : <Avatar p={people[id]} size={220} />}
                <b>{people[id].name}</b>
              </motion.span>
            ) : null,
          )}
        </div>
        <motion.p className="award-desc" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.4 }}>
          {step.desc}
        </motion.p>
      </div>
    );
  if (step.kind === "podium")
    return (
      <div className="award-card">
        <h1>
          {step.emoji} {step.title}
        </h1>
        <motion.div initial={{ opacity: 0, y: 60 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1, type: "spring", stiffness: 120, damping: 16 }}>
          <Podium list={step.ids.map((id) => people[id]).filter((p): p is PlayerPub => !!p)} size="l" value={(p) => <span className="award-value">{step.values[p.id]}</span>} />
        </motion.div>
      </div>
    );
  if (step.kind === "final") return <WinnerScreen view={view} embedded />;
  const loser = step.id ? people[step.id] : undefined;
  return (
    <div className="award-card">
      <span className="award-emoji" aria-hidden="true">
        🍋
      </span>
      <h1>השקד המר של הלילה</h1>
      {loser && (
        <span className="award-person">
          <FunnyFace p={loser} size={240} />
          <b>{loser.name}</b>
        </span>
      )}
      <p className="award-desc">מקום אחרון. עכשיו מסובבים את גלגל העונשים.</p>
    </div>
  );
}

export function WinnerScreen({ view, embedded }: { view: ClientView; embedded?: boolean }) {
  const list = ranked(view.pub.players);
  useEffect(() => {
    if (embedded) return;
    sfx.fanfare();
    burst("big");
    const id = window.setInterval(() => burst("win"), 5000);
    return () => window.clearInterval(id);
  }, [embedded]);
  return (
    <div className={cls("tvwin", embedded && "embedded")}>
      <Marquee size="m" lights />
      <motion.h1 className="tvwin-title" initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
        מלך השקדים של הלילה
      </motion.h1>
      <motion.div className="tvwin-podium" initial={{ opacity: 0, y: 80 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.8, type: "spring", stiffness: 110, damping: 15 }}>
        <Podium list={list.slice(0, 3)} size="l" value={(p) => <Led value={p.balance} />} />
      </motion.div>
    </div>
  );
}
