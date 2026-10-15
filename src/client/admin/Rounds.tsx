import { useEffect, useState } from "react";
import type { Bet, ClientView, PlayerPub, RoundKind, RoundOption, RoundPub, RoundRec, RoundStatus } from "../../shared/types";
import { GAMES } from "../../shared/catalog";
import { LETTERS, cls, fmt, fmtX, mmss, multiplier, potOf, resizeImage } from "../lib";
import { type Game, useServerNow } from "../net";
import { Avatar, Money, Sheet, ask, toast } from "../ui";
import { type Run, WheelButtons } from "./AdminApp";

const STATUS: Record<RoundStatus, string> = { draft: "מוכן", open: "פתוח", closed: "סגור", resolved: "הוכרע" };

export function RoundsTab({ game, view, run }: { game: Game; view: ClientView; run: Run }) {
  const rounds = view.admin!.rounds;
  const challenges = rounds.filter((r) => r.kind !== "night");
  const night = rounds.filter((r) => r.kind === "night");
  const [editing, setEditing] = useState<RoundRec | RoundKind | null>(null);
  const [opening, setOpening] = useState<RoundRec | null>(null);
  const [resolving, setResolving] = useState<RoundRec | null>(null);
  const live = view.pub.round;
  const busyElsewhere = live && (live.status === "open" || live.status === "closed");
  const left = (kind: RoundKind) => rounds.filter((r) => r.kind === kind && r.status === "draft").length;

  return (
    <section className="rounds-tab">
      <div className="rounds-col stack">
      {!busyElsewhere && <DrawBar game={game} view={view} run={run} left={left} />}
      {!busyElsewhere && <QuickDuel view={view} run={run} />}
      {live && (live.kind === "quiz" ? <LiveQuiz game={game} view={view} run={run} /> : <LiveRound game={game} view={view} run={run} />)}

      <div className="section-head">
        <h2 className="section-title">🎲 אתגרים ושאלות</h2>
        <div className="row-actions">
          <button type="button" className="btn btn-ghost btn-s" onClick={() => setEditing("quiz")}>
            + שאלת ידע
          </button>
          <button type="button" className="btn btn-gold btn-s" onClick={() => setEditing("challenge")}>
            + אתגר
          </button>
        </div>
      </div>
      <ol className="round-list">
        {challenges.map((r, i) => (
          <li key={r.id} className={cls("round-item", r.status, r.kind, live?.id === r.id && "live")}>
            <div className="round-item-main">
              <span className="round-n num">{i + 1}</span>
              <span className="round-emoji" aria-hidden="true">
                {r.emoji}
              </span>
              <div className="round-text">
                <b>
                  {r.kind === "quiz" && <span className="quiz-tag">❓ שאלת ידע</span>}
                  {r.title}
                </b>
                <small>{r.kind === "quiz" ? quizLine(r) : r.options.map((o) => o.label).join(" / ")}</small>
              </div>
              <span className={cls("status-tag", r.status)}>{STATUS[r.status]}</span>
            </div>
            <div className="round-item-actions">
              {r.status === "draft" && (
                <button type="button" className="btn btn-gold btn-s" disabled={!!busyElsewhere} onClick={() => setOpening(r)}>
                  ▶ פתיחה
                </button>
              )}
              <RowTools r={r} run={run} onEdit={() => setEditing(r)} isLive={live?.id === r.id} />
            </div>
          </li>
        ))}
      </ol>
      </div>

      <div className="rounds-col stack">
      <div className="section-head">
        <h2 className="section-title">🌙 הימורי לילה</h2>
        <button type="button" className="btn btn-ghost btn-s" onClick={() => setEditing("night")}>
          + הימור לילה
        </button>
      </div>
      <p className="muted">פתוחים במקביל לאתגרים. סוגרים כשמתחיל הדבר, ומכריזים כשהוא קורה.</p>
      {night.some((r) => r.status === "draft") && (
        <button type="button" className="btn btn-gold" onClick={() => run("openAllNight", {}, "כל הימורי הלילה נפתחו")}>
          🌙 לפתוח את כל הימורי הלילה
        </button>
      )}
      <ol className="round-list">
        {night.map((r) => {
          const bets = view.admin!.bets.filter((b) => b.roundId === r.id);
          const pot = bets.reduce((a, b) => a + b.amount, 0) + r.bonus;
          return (
            <li key={r.id} className={cls("round-item", r.status)}>
              <div className="round-item-main">
                <span className="round-n" />
                <span className="round-emoji" aria-hidden="true">
                  {r.emoji}
                </span>
                <div className="round-text">
                  <b>{r.title}</b>
                  <small>
                    {r.status === "resolved"
                      ? `הוכרע: ${r.options.find((o) => o.id === r.winnerId)?.label ?? ""}`
                      : `${bets.length} הימורים · בקופה ${fmt(pot)}`}
                  </small>
                </div>
                <span className={cls("status-tag", r.status)}>{STATUS[r.status]}</span>
              </div>
              <div className="round-item-actions">
                {r.status === "draft" && (
                  <button type="button" className="btn btn-gold btn-s" onClick={() => run("openRound", { roundId: r.id }, "נפתח להימורים")}>
                    ▶ פתיחה
                  </button>
                )}
                {r.status === "open" && (
                  <button type="button" className="btn btn-ghost btn-s" onClick={() => run("closeRound", { roundId: r.id }, "ההימורים נסגרו")}>
                    🔒 סגירה
                  </button>
                )}
                {(r.status === "open" || r.status === "closed") && (
                  <button type="button" className="btn btn-gold btn-s" onClick={() => setResolving(r)}>
                    ✓ הכרזה
                  </button>
                )}
                <RowTools r={r} run={run} onEdit={() => setEditing(r)} isLive={false} />
              </div>
            </li>
          );
        })}
      </ol>
      </div>

      <OpenSheet round={opening} onClose={() => setOpening(null)} run={run} />
      <ResolveSheet round={resolving} bets={view.admin!.bets} onClose={() => setResolving(null)} run={run} />
      <Sheet open={!!editing} onClose={() => setEditing(null)} title={typeof editing === "string" ? NEW_TITLE[editing] : "עריכה"} wide>
        {editing && (
          <RoundForm
            key={typeof editing === "string" ? editing : editing.id}
            value={typeof editing === "string" ? null : editing}
            kind={typeof editing === "string" ? editing : editing.kind}
            game={game}
            view={view}
            onDone={() => setEditing(null)}
          />
        )}
      </Sheet>
    </section>
  );
}

/** How long the TV plays a result for: the same steps as tv/Screens.tsx. */
function resultMs(r: RoundPub) {
  const L = r.lines ?? {};
  if (r.kind === "quiz") return 1500 + 2700 + (L.fast ? 6500 : 0) + (L.slow ? 7000 : r.losers.length ? 9500 : 0);
  return 1750 + 3200 + (L.duel ? 7000 : 0) + (L.win ? 6500 : 0) + (L.lose ? 8500 : 0);
}

/** גלגל הבלגן: challenges, questions and surprises on one wheel. Never locked: while the TV still plays the last result, a tap queues the spin. */
function DrawBar({ game, view, run, left }: { game: Game; view: ClientView; run: Run; left: (k: RoundKind) => number }) {
  const r = view.pub.round;
  const draw = view.pub.draw;
  const now = useServerNow(game, true, 500);
  const busyUntil = Math.max(r?.status === "resolved" && r.resolvedAt ? r.resolvedAt + resultMs(r) : 0, draw?.surprise ? draw.at + 17_000 : 0);
  const wait = Math.ceil((busyUntil - now) / 1000);
  const [queued, setQueued] = useState<string | null>(null);
  const spin = async (kind: string) => {
    const res = (await run("drawRound", { kind })) as { title?: string } | undefined;
    if (res?.title) toast(`🎡 יצא: ${res.title}`, "ok", 4000);
  };
  useEffect(() => {
    if (!queued || wait > 0) return;
    setQueued(null);
    void spin(queued);
  }, [queued, wait]); // eslint-disable-line react-hooks/exhaustive-deps
  const press = (kind: string) => (wait > 0 ? setQueued(kind) : void spin(kind));
  return (
    <div className="draw-bar felt">
      <p>אתם מחליטים מתי, הגלגל מחליט מה. אתגרים, שאלות והפתעות, מול כולם בטלוויזיה.</p>
      {queued ? (
        <button type="button" className="btn btn-gold btn-xl" onClick={() => setQueued(null)}>
          ⏳ הגלגל יסתובב לבד בעוד {Math.max(wait, 0)} (הקישו לביטול)
        </button>
      ) : (
        <button type="button" className="btn btn-gold btn-xl" onClick={() => press("any")}>
          🎡 לסובב את גלגל הבלגן
        </button>
      )}
      {!queued && wait > 0 && <small className="muted">הטלוויזיה מסיימת את התוצאה ({wait}). אפשר ללחוץ, הגלגל יחכה לה</small>}
      <div className="row-actions">
        <button type="button" className="btn btn-ghost btn-s" disabled={!!queued || !left("challenge")} onClick={() => press("challenge")}>
          רק אתגר <small>({left("challenge")})</small>
        </button>
        <button type="button" className="btn btn-ghost btn-s" disabled={!!queued || !left("quiz")} onClick={() => press("quiz")}>
          רק שאלה <small>({left("quiz")})</small>
        </button>
      </div>
    </div>
  );
}

/** Pick a game and two guys: betting opens right away, and the winner gets his own picture. */
function QuickDuel({ view, run }: { view: ClientView; run: Run }) {
  const [game, setGame] = useState("pingpong");
  const [a, setA] = useState<string | null>(null);
  const [b, setB] = useState<string | null>(null);
  const name = (id: string | null) => view.pub.players.find((p) => p.id === id)?.name ?? "";
  const pick = (id: string) => {
    if (a === id) setA(null);
    else if (b === id) setB(null);
    else if (!a) setA(id);
    else setB(id);
  };
  return (
    <div className="duel-builder felt">
      <h3>⚔️ דו-קרב מהיר</h3>
      <div className="choice-row duel-games">
        {Object.entries(GAMES).map(([k, g]) => (
          <button key={k} type="button" className={cls("btn btn-s", game === k ? "btn-gold" : "btn-ghost")} onClick={() => setGame(k)}>
            {g.emoji} {g.name}
          </button>
        ))}
      </div>
      <div className="player-chips">
        {view.pub.players.map((p) => (
          <button key={p.id} type="button" className={cls("pchip", (a === p.id || b === p.id) && "on")} onClick={() => pick(p.id)}>
            <Avatar p={p} size={24} /> {p.name}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="btn btn-gold"
        disabled={!a || !b}
        onClick={async () => {
          if (await run("quickDuel", { game, a, b }, "הדו-קרב נפתח להימורים")) {
            setA(null);
            setB(null);
          }
        }}
      >
        {a && b ? `⚔️ ${GAMES[game].name}: ${name(a)} נגד ${name(b)}` : "בחרו שני שחקנים"}
      </button>
    </div>
  );
}

const NEW_TITLE: Record<RoundKind, string> = { challenge: "אתגר חדש", quiz: "שאלת ידע חדשה", night: "הימור לילה חדש" };

/** For the list: the answers, and whether the right one is already known. */
function quizLine(r: RoundRec) {
  const right = r.options.find((o) => o.id === (r.status === "resolved" ? r.winnerId : r.correctId));
  const opts = r.options.map((o, i) => `${LETTERS[i]}. ${o.label}`).join("  ");
  return right ? `${opts}  ·  ✓ ${right.label}` : `${opts}  ·  התשובה נבחרת בסוף`;
}

function RowTools({ r, run, onEdit, isLive }: { r: RoundRec; run: Run; onEdit: () => void; isLive: boolean }) {
  return (
    <>
      <button type="button" className="btn btn-ghost btn-s" onClick={onEdit}>
        עריכה
      </button>
      <button type="button" className="icon-btn" aria-label="להזיז למעלה" onClick={() => run("moveRound", { roundId: r.id, dir: "up" })}>
        ↑
      </button>
      <button type="button" className="icon-btn" aria-label="להזיז למטה" onClick={() => run("moveRound", { roundId: r.id, dir: "down" })}>
        ↓
      </button>
      {r.status === "draft" ? (
        <button
          type="button"
          className="icon-btn"
          aria-label="מחיקה"
          onClick={async () => {
            if (await ask({ title: "למחוק?", body: r.title, ok: "מחיקה", danger: true })) await run("deleteRound", { roundId: r.id }, "נמחק");
          }}
        >
          🗑
        </button>
      ) : (
        !isLive && (
          <button
            type="button"
            className="btn btn-ghost btn-s"
            onClick={async () => {
              if (
                await ask({
                  title: "לאפס?",
                  body: "הרווחים וההפסדים יבוטלו, ההימורים יימחקו, והוא יחזור לרשימה כאילו לא שוחק.",
                  ok: "איפוס",
                  danger: true,
                })
              )
                await run("cancelRound", { roundId: r.id }, "אופס");
            }}
          >
            איפוס
          </button>
        )
      )}
    </>
  );
}

function OpenSheet({ round, onClose, run }: { round: RoundRec | null; onClose: () => void; run: Run }) {
  const quiz = round?.kind === "quiz";
  const choices: [number, string][] = quiz
    ? [
        [15, "15 שניות"],
        [25, "25 שניות"],
        [40, "40 שניות"],
        [60, "דקה"],
        [0, "בלי טיימר"],
      ]
    : [
        [30, "30 שניות"],
        [60, "דקה"],
        [90, "דקה וחצי"],
        [120, "2 דקות"],
        [0, "בלי טיימר"],
      ];
  return (
    <Sheet open={!!round} onClose={onClose} title={quiz ? "פתיחת שאלה" : "פתיחת הימורים"}>
      {round && (
        <>
          <p className="sheet-text">
            {round.emoji} {round.title}
          </p>
          <p className="muted">
            {quiz
              ? "כמה זמן יש לענות? ברגע שכולם עונים השאלה נסגרת לבד" + (round.correctId ? ", והתשובה נחשפת אוטומטית." : ".")
              : "כמה זמן יהיה לכולם להמר? בלי טיימר, סוגרים ידנית."}
          </p>
          <div className="choice-grid">
            {choices.map(([s, label]) => (
              <button
                key={s}
                type="button"
                className={cls("btn", s === round.seconds ? "btn-gold" : "btn-ghost")}
                onClick={async () => {
                  onClose();
                  await run("openRound", { roundId: round.id, seconds: s }, quiz ? "השאלה נפתחה ומוצגת בטלוויזיה" : "הסיבוב נפתח ומוצג בטלוויזיה");
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </>
      )}
    </Sheet>
  );
}

function ResolveSheet({ round, bets, onClose, run }: { round: RoundRec | null; bets: Bet[]; onClose: () => void; run: Run }) {
  return (
    <Sheet open={!!round} onClose={onClose} title="מה קרה בסוף?">
      {round && (
        <>
          <p className="sheet-text">
            {round.emoji} {round.title}
          </p>
          <div className="choice-grid">
            {round.options.map((o) => {
              const n = bets.filter((b) => b.roundId === round.id && b.optionId === o.id).length;
              return (
                <button
                  key={o.id}
                  type="button"
                  className="btn btn-ghost"
                  onClick={async () => {
                    onClose();
                    await run("resolveRound", { roundId: round.id, optionId: o.id }, `הוכרע: ${o.label}`);
                  }}
                >
                  {o.label} {n > 0 && <small className="muted">({n})</small>}
                </button>
              );
            })}
          </div>
        </>
      )}
    </Sheet>
  );
}

function LiveRound({ game, view, run }: { game: Game; view: ClientView; run: Run }) {
  const r: RoundPub = view.pub.round!;
  const now = useServerNow(game, r.status === "open");
  const open = r.status === "open" && (r.closesAt === null || now < r.closesAt);
  const bets = view.admin!.bets.filter((b) => b.roundId === r.id);
  const people = Object.fromEntries(view.pub.players.map((p) => [p.id, p])) as Record<string, PlayerPub>;
  const missing = view.pub.players.filter((p) => p.claimed && !r.noBet.includes(p.id) && !bets.some((b) => b.playerId === p.id));

  const resolve = async (o: RoundOption) => {
    const ok = await ask({
      title: `״${o.label}״ ניצח?`,
      body: r.status === "resolved" ? "התוצאה הקודמת תבוטל והקופה תחולק מחדש." : "הקופה מתחלקת עכשיו בין מי שצדק, והתוצאה מוצגת בטלוויזיה.",
      ok: "כן, להכריז",
    });
    if (ok) await run("resolveRound", { roundId: r.id, optionId: o.id }, "התוצאה הוכרזה");
  };

  return (
    <section className={cls("live felt", open ? "is-open" : r.status)}>
      <div className="live-head">
        <span className="live-badge">{open ? "פתוח להימורים" : r.status === "resolved" ? "הוכרע" : "ההימורים סגורים"}</span>
        <span className="live-pot">
          בקופה <Money n={potOf(r)} size={15} />
        </span>
        {open && r.closesAt && <span className="live-timer num">{mmss(r.closesAt - now)}</span>}
      </div>
      <h3 className="live-title">
        {r.emoji} {r.title}
      </h3>
      <div className="live-opts">
        {r.options.map((o) => {
          const bs = bets.filter((b) => b.optionId === o.id);
          const total = bs.reduce((a, b) => a + b.amount, 0);
          return (
            <div key={o.id} className={cls("live-opt", r.winnerId === o.id && "win")}>
              <div className="live-opt-head">
                <b>{o.label}</b>
                {!open && (
                  <span className="live-opt-sum">
                    <span className="odds-chip">{fmtX(multiplier(r, o.id))}</span>
                    <span className="muted">{bs.length} הימורים</span>
                    <Money n={total} size={14} />
                  </span>
                )}
              </div>
              {!open && bs.length > 0 && (
                <div className="live-bettors">
                  {bs.map((b) => (
                    <span key={b.playerId} className="pill">
                      {people[b.playerId] && <Avatar p={people[b.playerId]} size={22} />}
                      {people[b.playerId]?.name}
                      <span className="num">{fmt(b.amount)}</span>
                    </span>
                  ))}
                </div>
              )}
              {!open && r.winnerId !== o.id && (
                <button type="button" className={cls("btn btn-s", r.status === "resolved" ? "btn-ghost" : "btn-gold")} onClick={() => resolve(o)}>
                  {r.status === "resolved" ? "תיקון: זה ניצח" : "✓ זה ניצח"}
                </button>
              )}
            </div>
          );
        })}
      </div>
      {open && (
        <p className="muted">
          🤫 ההימורים סודיים עד הסגירה (גם ממך).
          {bets.length > 0 && ` הימרו: ${bets.map((b) => people[b.playerId]?.name).join(", ")}.`}
          {missing.length > 0 && ` עוד לא: ${missing.map((p) => p.name).join(", ")}.`}
        </p>
      )}
      <div className="live-actions">
        {open && bets.length === 0 && (
          <button type="button" className="btn btn-ghost" onClick={() => run("drawRound", { kind: "challenge", redraw: true }, "הוגרל אתגר אחר")}>
            🔄 להגריל אחר
          </button>
        )}
        {open && (
          <button type="button" className="btn btn-gold" onClick={() => run("closeRound", { roundId: r.id }, "ההימורים נסגרו")}>
            🔒 לסגור הימורים עכשיו
          </button>
        )}
        {open && (
          <button type="button" className="btn btn-ghost" onClick={() => run("extendRound", { roundId: r.id, seconds: 30 }, "נוספו 30 שניות")}>
            +30 שניות
          </button>
        )}
        {r.status === "resolved" && (
          <>
            <button type="button" className="btn btn-gold" onClick={() => run("setTv", { mode: "board" }, "הבורסה בטלוויזיה")}>
              📈 הבורסה בטלוויזיה
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => run("undoResolve", { roundId: r.id }, "התוצאה בוטלה")}>
              ביטול התוצאה
            </button>
          </>
        )}
        <button
          type="button"
          className="btn btn-danger"
          onClick={async () => {
            if (
              await ask({
                title: "לבטל את הסיבוב?",
                body: "כל ההימורים בסיבוב יבוטלו (אף אחד לא מרוויח או מפסיד) והסיבוב יחזור לרשימה.",
                ok: "ביטול הסיבוב",
                danger: true,
              })
            )
              await run("cancelRound", { roundId: r.id }, "הסיבוב בוטל");
          }}
        >
          ביטול הסיבוב
        </button>
      </div>
      {r.status === "resolved" && (
        <div className="live-wheel">
          <p className="muted">אחרי כל סיבוב: גלגל שתייה? 🍺</p>
          <WheelButtons run={run} />
        </div>
      )}
    </section>
  );
}

function LiveQuiz({ game, view, run }: { game: Game; view: ClientView; run: Run }) {
  const r: RoundPub = view.pub.round!;
  const correct = view.admin!.rounds.find((x) => x.id === r.id)?.correctId ?? null;
  const now = useServerNow(game, r.status === "open");
  const open = r.status === "open" && (r.closesAt === null || now < r.closesAt);
  const answers = view.admin!.bets.filter((b) => b.roundId === r.id).sort((a, b) => a.at - b.at);
  const people = Object.fromEntries(view.pub.players.map((p) => [p.id, p])) as Record<string, PlayerPub>;
  const eligible = view.pub.players.filter((p) => p.claimed && !r.noBet.includes(p.id));
  const waiting = eligible.filter((p) => !answers.some((a) => a.playerId === p.id));
  const names = (ids: string[]) => ids.map((id) => people[id]?.name).filter(Boolean).join(", ");
  const rightIds = (r.results ?? []).filter((x) => x.delta > 0).map((x) => x.playerId);

  const pick = async (o: RoundOption) => {
    const ok = await ask({
      title: `״${o.label}״ זאת התשובה?`,
      body: r.status === "resolved" ? "התוצאה הקודמת תבוטל ותחושב מחדש." : "מי שצדק מקבל שקדים, ומי שטעה עולה למסך עם שוט.",
      ok: "כן, לחשוף",
    });
    if (ok) await run("resolveRound", { roundId: r.id, optionId: o.id }, "התשובה נחשפה בטלוויזיה");
  };

  return (
    <section className={cls("live felt quiz-live", open ? "is-open" : r.status)}>
      <div className="live-head">
        <span className="live-badge">{open ? "❓ פתוח לתשובות" : r.status === "resolved" ? "❓ נחשף" : "❓ הזמן נגמר"}</span>
        <span className="live-pot">
          ענו {answers.length} מתוך {eligible.length}
        </span>
        {open && r.closesAt && <span className="live-timer num">{mmss(r.closesAt - now)}</span>}
      </div>
      <h3 className="live-title">
        {r.emoji} {r.title}
      </h3>
      <div className="live-opts">
        {r.options.map((o, i) => {
          const who = answers.filter((a) => a.optionId === o.id);
          const right = r.status === "resolved" ? r.winnerId === o.id : correct === o.id;
          return (
            <div key={o.id} className={cls("live-opt", right && "win")}>
              <div className="live-opt-head">
                <b>
                  <span className="quiz-letter sm">{LETTERS[i]}</span> {o.label}
                </b>
                <span className="live-opt-sum">
                  {right && <span className="right-chip">✓ הנכונה</span>}
                  {!open && <span className="muted">{who.length} ענו</span>}
                </span>
              </div>
              {!open && who.length > 0 && (
                <div className="live-bettors">
                  {who.map((a) => (
                    <span key={a.playerId} className="pill">
                      {people[a.playerId] && <Avatar p={people[a.playerId]} size={22} />}
                      {people[a.playerId]?.name}
                    </span>
                  ))}
                </div>
              )}
              {!open && r.winnerId !== o.id && (
                <button type="button" className={cls("btn btn-s", r.status !== "resolved" && (correct === o.id || !correct) ? "btn-gold" : "btn-ghost")} onClick={() => pick(o)}>
                  {r.status === "resolved" ? "תיקון: זאת הנכונה" : "✓ זאת התשובה הנכונה"}
                </button>
              )}
            </div>
          );
        })}
      </div>
      {open && (
        <p className="muted">
          {waiting.length ? `עוד לא ענו: ${names(waiting.map((p) => p.id))}. ` : "כולם ענו! "}
          {correct ? "כשהזמן נגמר או שכולם עונים, התשובה נחשפת לבד." : "כשהזמן נגמר, בוחרים כאן את התשובה הנכונה."}
        </p>
      )}
      {r.status === "resolved" && (
        <div className="quiz-outcome">
          <p>🧠 צדקו: {rightIds.length ? names(rightIds) : "אף אחד"}</p>
          <p>
            🥃 שותים: {r.losers.length ? names(r.losers) : "אף אחד"}
            {r.loserReason === "slow" && " (כולם צדקו, הוא ענה אחרון)"}
          </p>
        </div>
      )}
      <div className="live-actions">
        {open && answers.length === 0 && (
          <button type="button" className="btn btn-ghost" onClick={() => run("drawRound", { kind: "quiz", redraw: true }, "הוגרלה שאלה אחרת")}>
            🔄 להגריל אחרת
          </button>
        )}
        {open && (
          <button type="button" className="btn btn-gold" onClick={() => run("closeRound", { roundId: r.id }, "השאלה נסגרה")}>
            🔒 לסגור עכשיו
          </button>
        )}
        {open && (
          <button type="button" className="btn btn-ghost" onClick={() => run("extendRound", { roundId: r.id, seconds: 15 }, "נוספו 15 שניות")}>
            +15 שניות
          </button>
        )}
        {r.status === "resolved" && (
          <>
            <button type="button" className="btn btn-gold" onClick={() => run("setTv", { mode: "board" }, "הבורסה בטלוויזיה")}>
              📈 הבורסה בטלוויזיה
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => run("undoResolve", { roundId: r.id }, "התוצאה בוטלה")}>
              ביטול התוצאה
            </button>
          </>
        )}
        <button
          type="button"
          className="btn btn-danger"
          onClick={async () => {
            if (await ask({ title: "לבטל את השאלה?", body: "התשובות והשקדים מהשאלה יימחקו והיא תחזור לרשימה.", ok: "ביטול השאלה", danger: true }))
              await run("cancelRound", { roundId: r.id }, "השאלה בוטלה");
          }}
        >
          ביטול השאלה
        </button>
      </div>
      {r.status === "resolved" && (
        <div className="live-wheel">
          <p className="muted">עוד סיבוב שתייה? 🍺</p>
          <WheelButtons run={run} />
        </div>
      )}
    </section>
  );
}

type Draft = Pick<RoundRec, "kind" | "emoji" | "title" | "note" | "image" | "options" | "minBet" | "maxBet" | "seconds" | "bonus" | "reward" | "noBet"> & { id?: string };

const blank = (n: number): RoundOption[] => Array.from({ length: n }, () => ({ id: "", label: "", playerId: null }));

function RoundForm({ value, kind, game, view, onDone }: { value: RoundRec | null; kind: RoundKind; game: Game; view: ClientView; onDone: () => void }) {
  const players = view.pub.players;
  const locked = !!value && value.status !== "draft";
  const quiz = kind === "quiz";
  const [d, setD] = useState<Draft>(() =>
    value
      ? structuredClone(value)
      : {
          kind,
          emoji: kind === "night" ? "🌙" : quiz ? "❓" : "🎲",
          title: "",
          note: "",
          image: null,
          options: quiz
            ? blank(4)
            : [
                { id: "yes", label: "כן", playerId: null },
                { id: "no", label: "לא", playerId: null },
              ],
          minBet: 50,
          maxBet: 500,
          seconds: kind === "night" ? 0 : quiz ? 25 : 60,
          bonus: kind === "night" ? 300 : quiz ? 50 : view.pub.settings.bankBonus,
          reward: quiz ? 100 : 0,
          noBet: [],
        },
  );
  // quiz: which option is right (by position), or −1 when the host decides at the reveal
  const [correct, setCorrect] = useState(() => (value?.correctId ? value.options.findIndex((o) => o.id === value.correctId) : -1));
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  const setOpt = (i: number, patch: Partial<RoundOption>) => set({ options: d.options.map((o, j) => (j === i ? { ...o, ...patch } : o)) });
  const togglePlayerOption = (p: PlayerPub) => {
    const has = d.options.some((o) => o.playerId === p.id);
    set({ options: has ? d.options.filter((o) => o.playerId !== p.id) : [...d.options, { id: p.id, label: p.name, playerId: p.id }] });
  };
  const toggleNoBet = (id: string) => set({ noBet: d.noBet.includes(id) ? d.noBet.filter((x) => x !== id) : [...d.noBet, id] });

  const onImage = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    try {
      set({ image: await game.upload(await resizeImage(file, 1100)) });
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      const options = d.options.filter((o) => o.label.trim() || o.playerId);
      const ci = correct >= 0 && d.options[correct] ? options.indexOf(d.options[correct]) : -1;
      await game.act("saveRound", { round: { ...d, options, correctIndex: quiz && ci >= 0 ? ci : null } });
      toast("נשמר", "ok");
      onDone();
    } catch (e) {
      toast((e as Error).message, "err", 5000);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="form-row title-row">
        <label className="field">
          <span>אימוג׳י</span>
          <input value={d.emoji} onChange={(e) => set({ emoji: e.target.value })} maxLength={8} />
        </label>
        <label className="field">
          <span>השאלה</span>
          <textarea
            value={d.title}
            onChange={(e) => set({ title: e.target.value })}
            rows={2}
            required
            placeholder={quiz ? "למשל: באיזו עיר איתי ושחף יצאו לדייט הראשון?" : "למשל: איתי יקלע 3 כדורים תוך 30 שניות?"}
          />
        </label>
      </div>
      <label className="field">
        <span>הסבר קצר (לא חובה)</span>
        <input value={d.note} onChange={(e) => set({ note: e.target.value })} placeholder="החוקים, ואיך יודעים מי צדק" />
      </label>

      <div className="field">
        <span>תמונה (לא חובה)</span>
        <div className="image-pick">
          {d.image && <img src={d.image} alt="" />}
          <label className="btn btn-ghost btn-s">
            {busy ? "מעלה…" : d.image ? "החלפה" : "העלאת תמונה"}
            <input type="file" accept="image/*" hidden onChange={(e) => onImage(e.target.files?.[0])} />
          </label>
          {d.image && (
            <button type="button" className="btn btn-ghost btn-s" onClick={() => set({ image: null })}>
              הסרה
            </button>
          )}
        </div>
      </div>

      <fieldset className="field" disabled={locked}>
        <legend>
          {quiz ? "תשובות" : "אפשרויות"} {locked && <small className="muted">(אחרי הפתיחה אי אפשר לשנות)</small>}
        </legend>
        {quiz && <span className="muted">מסמנים ✓ ליד התשובה הנכונה, ואז היא נחשפת לבד כשהזמן נגמר.</span>}
        {d.options.map((o, i) => (
          <div key={i} className={cls("opt-edit", quiz && correct === i && "right")}>
            {quiz && (
              <button
                type="button"
                className={cls("right-pick", correct === i && "on")}
                aria-pressed={correct === i}
                aria-label={`${LETTERS[i]}: התשובה הנכונה`}
                onClick={() => setCorrect(correct === i ? -1 : i)}
              >
                {correct === i ? "✓" : LETTERS[i]}
              </button>
            )}
            {o.playerId && players.find((p) => p.id === o.playerId) && <Avatar p={players.find((p) => p.id === o.playerId)!} size={32} />}
            <input value={o.label} onChange={(e) => setOpt(i, { label: e.target.value })} aria-label={`אפשרות ${i + 1}`} placeholder={quiz ? `תשובה ${LETTERS[i]}` : undefined} />
            <button
              type="button"
              className="icon-btn"
              aria-label="הסרת אפשרות"
              onClick={() => {
                set({ options: d.options.filter((_, j) => j !== i) });
                setCorrect((c) => (c === i ? -1 : c > i ? c - 1 : c));
              }}
            >
              ✕
            </button>
          </div>
        ))}
        {quiz && (
          <button type="button" className={cls("btn btn-s", correct < 0 ? "btn-gold" : "btn-ghost")} onClick={() => setCorrect(-1)}>
            {correct < 0 ? "✓ " : ""}אבחר את התשובה בסוף (למשל כשאיתי עונה בלייב)
          </button>
        )}
        <div className="opt-tools">
          <button type="button" className="btn btn-ghost btn-s" onClick={() => set({ options: [...d.options, { id: "", label: "", playerId: null }] })}>
            {quiz ? "+ תשובה" : "+ אפשרות"}
          </button>
          {!quiz && (
            <button
              type="button"
              className="btn btn-ghost btn-s"
              onClick={() =>
                set({
                  options: [
                    { id: "yes", label: "כן", playerId: null },
                    { id: "no", label: "לא", playerId: null },
                  ],
                })
              }
            >
              כן / לא
            </button>
          )}
        </div>
        <span className="muted">{quiz ? "או לבחור שחקנים כתשובות:" : "או לבחור שחקנים כאפשרויות:"}</span>
        <div className="player-chips">
          {players.map((p) => (
            <button key={p.id} type="button" className={cls("pchip", d.options.some((o) => o.playerId === p.id) && "on")} onClick={() => togglePlayerOption(p)}>
              <Avatar p={p} size={24} /> {p.name}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="field" disabled={locked}>
        <legend>{quiz ? "מי לא עונה (למשל איתי, כשהשאלה עליו)" : "מי בתוך האתגר (ולכן לא מהמר)"}</legend>
        <div className="player-chips">
          {players.map((p) => (
            <button key={p.id} type="button" className={cls("pchip", d.noBet.includes(p.id) && "on")} onClick={() => toggleNoBet(p.id)}>
              <Avatar p={p} size={24} /> {p.name}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="form-row" disabled={locked}>
        {quiz ? (
          <>
            <label className="field">
              <span>שקדים לתשובה נכונה</span>
              <input type="number" inputMode="numeric" value={d.reward} onChange={(e) => set({ reward: Number(e.target.value) })} />
            </label>
            <label className="field">
              <span>בונוס לזריז ביותר</span>
              <input type="number" inputMode="numeric" value={d.bonus} onChange={(e) => set({ bonus: Number(e.target.value) })} />
            </label>
          </>
        ) : (
          <>
            <label className="field">
              <span>הימור מינימלי</span>
              <input type="number" inputMode="numeric" value={d.minBet} onChange={(e) => set({ minBet: Number(e.target.value) })} />
            </label>
            <label className="field">
              <span>הימור מקסימלי</span>
              <input type="number" inputMode="numeric" value={d.maxBet} onChange={(e) => set({ maxBet: Number(e.target.value) })} />
            </label>
            <label className="field">
              <span>בונוס הבנק</span>
              <input type="number" inputMode="numeric" value={d.bonus} onChange={(e) => set({ bonus: Number(e.target.value) })} />
            </label>
          </>
        )}
        {d.kind !== "night" && (
          <label className="field">
            <span>טיימר (שניות)</span>
            <input type="number" inputMode="numeric" value={d.seconds} onChange={(e) => set({ seconds: Number(e.target.value) })} />
          </label>
        )}
      </fieldset>

      <div className="sheet-actions">
        <button type="submit" className="btn btn-gold" disabled={busy}>
          שמירה
        </button>
        <button type="button" className="btn btn-ghost" onClick={onDone}>
          ביטול
        </button>
      </div>
    </form>
  );
}
