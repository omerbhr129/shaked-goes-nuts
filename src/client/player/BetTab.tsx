import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, useEffect, useState } from "react";
import type { ClientView, PlayerPub, RoundPub } from "../../shared/types";
import { cls, fmt, fmtX, mmss, multiplier, potOf, projectedPayout, ranked } from "../lib";
import { type Game, useServerNow } from "../net";
import { sfx } from "../sound";
import { Avatar, Change, Coin, Money, Spark, toast } from "../ui";

export function BetTab({ game, view, me }: { game: Game; view: ClientView; me: PlayerPub }) {
  const round = view.pub.round;
  const night = view.pub.night;
  const now = useServerNow(game, !!round && round.status === "open");
  const open = !!round && round.status === "open" && (round.closesAt === null || now < round.closesAt);

  let featured: ReactNode = null;
  if (round) {
    if (open) featured = <BetForm key={round.id} game={game} view={view} me={me} round={round} now={now} />;
    else if (round.status === "resolved") featured = <Resolved view={view} me={me} round={round} />;
    else featured = <Locked view={view} me={me} round={round} />;
  }

  return (
    <section className="stack">
      {featured ?? <Idle hasNight={night.length > 0} />}
      {night.length > 0 && <NightSection game={game} view={view} me={me} night={night} now={now} />}
      {!round && <MyStock view={view} me={me} />}
    </section>
  );
}

function Idle({ hasNight }: { hasNight: boolean }) {
  return (
    <div className="idle felt">
      <span className="idle-dice" aria-hidden="true">
        🎲
      </span>
      <h2>אין אתגר פתוח כרגע</h2>
      <p>{hasNight ? "כשהמנחה יפתח אתגר הוא יקפוץ כאן. בינתיים יש הימורי לילה למטה." : "כשהמנחה יפתח סיבוב, הוא יופיע כאן. בינתיים אפשר לעבוד על המשימות הסודיות."}</p>
    </div>
  );
}

function MyStock({ view, me }: { view: ClientView; me: PlayerPub }) {
  const list = ranked(view.pub.players);
  const rank = list.findIndex((p) => p.id === me.id) + 1;
  return (
    <div className="mystock felt">
      <div className="mystock-head">
        <span className="mystock-ticker">{me.ticker}</span>
        <span>
          מקום {rank} מתוך {list.length}
        </span>
      </div>
      <Spark data={me.spark} w={320} h={72} />
      <div className="mystock-foot">
        <Money n={me.balance} size={20} />
        <Change balance={me.balance} start={view.pub.settings.startBalance} />
      </div>
    </div>
  );
}

function QuestionCard({ round, children, label }: { round: RoundPub; children: ReactNode; label?: string }) {
  return (
    <div className="qcard felt">
      <div className="qcard-top">
        <span className="qcard-num">{label ?? `סיבוב ${round.number}`}</span>
        <span className="pot-chip">
          בקופה <Money n={potOf(round)} size={15} />
        </span>
        <span className="qcard-emoji" aria-hidden="true">
          {round.emoji}
        </span>
      </div>
      <h2 className="qcard-title">{round.title}</h2>
      {round.note && <p className="qcard-note">{round.note}</p>}
      {round.image && <img className="qcard-img" src={round.image} alt="" />}
      {children}
    </div>
  );
}

function Countdown({ round, now }: { round: RoundPub; now: number }) {
  const left = Math.max(0, (round.closesAt ?? now) - now);
  const total = Math.max(left, (round.closesAt ?? now) - (round.openedAt ?? now), 1);
  const urgent = left <= 10_000;
  const secs = Math.ceil(left / 1000);
  useEffect(() => {
    if (urgent && secs > 0 && secs <= 5) sfx.tick();
  }, [secs, urgent]);
  return (
    <div className={cls("countdown", urgent && "urgent")} role="timer">
      <div className="countdown-row">
        <span>ההימורים נסגרים בעוד</span>
        <span className="num countdown-time">{mmss(left)}</span>
      </div>
      <div className="countdown-bar">
        <div style={{ transform: `scaleX(${Math.min(1, left / total)})` }} />
      </div>
    </div>
  );
}

const optionLabel = (round: RoundPub, id: string | null | undefined) => round.options.find((o) => o.id === id)?.label ?? "";

/** The betting form for one round: pick an option, pick chips, see what it would pay. */
function BetForm({ game, view, me, round, now, compact }: { game: Game; view: ClientView; me: PlayerPub; round: RoundPub; now: number; compact?: boolean }) {
  const myBet = view.me!.bets[round.id] ?? null;
  const max = Math.min(round.maxBet, view.me!.available + (myBet?.amount ?? 0));
  const min = Math.min(round.minBet, max);
  const clamp = (n: number) => Math.max(min, Math.min(max, Math.round(n)));
  const [optionId, setOptionId] = useState<string | null>(myBet?.optionId ?? null);
  const [amount, setAmount] = useState(() => clamp(myBet?.amount ?? 100));
  const [editing, setEditing] = useState(!myBet);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setAmount((a) => Math.max(min, Math.min(max, a)));
  }, [min, max]);

  // a plain function, not a component: a component declared here would remount every countdown tick
  const wrap = (content: ReactNode) =>
    compact ? <div className="night-body">{content}</div> : <QuestionCard round={round}>{content}</QuestionCard>;

  if (round.noBet.includes(me.id)) {
    return wrap(
      <>
        {!compact && round.closesAt && <Countdown round={round} now={now} />}
        <div className="notice">אתם בתוך האתגר הזה, אז כאן לא מהמרים. בהצלחה! 💪</div>
      </>,
    );
  }

  if (max <= 0) {
    return wrap(<div className="notice">אין לך כרגע {view.pub.settings.currency} פנויים להימור. אפשר להשלים משימה סודית או לבקש חילוץ.</div>);
  }

  const submit = async () => {
    if (!optionId) return;
    setBusy(true);
    try {
      await game.act("bet", { roundId: round.id, optionId, amount });
      sfx.chip();
      navigator.vibrate?.(25);
      toast("ההימור נקלט", "ok");
      setEditing(false);
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async () => {
    setBusy(true);
    try {
      await game.act("unbet", { roundId: round.id });
      toast("ההימור בוטל");
      setEditing(true);
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  const players = view.pub.players;
  const payout = optionId ? projectedPayout(round, optionId, amount, myBet) : 0;

  return wrap(
    <>
      {!compact && round.closesAt && <Countdown round={round} now={now} />}
      {myBet && !editing ? (
        <>
          <Ticket
            ticket={myBet.ticket}
            amount={myBet.amount}
            label={optionLabel(round, myBet.optionId)}
            payout={projectedPayout(round, myBet.optionId, myBet.amount, myBet)}
            note="הסכום ישתנה לפי ההימורים של כולם, עד שההימורים נסגרים"
          />
          <div className="row-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setEditing(true)} disabled={busy}>
              שינוי ההימור
            </button>
            <button type="button" className="btn btn-ghost" onClick={withdraw} disabled={busy}>
              ביטול ההימור
            </button>
          </div>
        </>
      ) : (
        <>
          <div className={cls("options", round.options.length > 3 && "many")} role="radiogroup" aria-label="על מה מהמרים?">
            {round.options.map((o) => {
              const st = round.stats.find((s) => s.optionId === o.id);
              const p = o.playerId ? players.find((x) => x.id === o.playerId) : undefined;
              const m = multiplier(round, o.id);
              return (
                <button
                  key={o.id}
                  type="button"
                  role="radio"
                  aria-checked={optionId === o.id}
                  className={cls("opt", optionId === o.id && "on")}
                  onClick={() => {
                    setOptionId(o.id);
                    sfx.tap();
                  }}
                >
                  {p && <Avatar p={p} size={40} />}
                  <span className="opt-label">{o.label}</span>
                  <span className="opt-odds">{m === null ? "אף אחד עוד לא" : fmtX(m)}</span>
                  {!!st?.count && <span className="opt-count">{st.count} הימרו</span>}
                </button>
              );
            })}
          </div>

          <div className="amount">
            <div className="amount-row">
              <button type="button" className="step" onClick={() => setAmount((a) => clamp(a - 50))} aria-label="להוריד 50">
                −
              </button>
              <div className="amount-screen" aria-live="polite">
                <span className="led">{fmt(amount)}</span>
                <Coin size={24} />
              </div>
              <button type="button" className="step" onClick={() => setAmount((a) => clamp(a + 50))} aria-label="להוסיף 50">
                +
              </button>
            </div>
            <div className="chips">
              {[50, 100, 200, 500]
                .filter((c) => c >= min && c <= max)
                .map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={cls("chip", `chip-${c}`, amount === c && "on")}
                    onClick={() => {
                      setAmount(c);
                      sfx.chip();
                    }}
                  >
                    {c}
                  </button>
                ))}
              <button
                type="button"
                className={cls("chip chip-max", amount === max && "on")}
                onClick={() => {
                  setAmount(max);
                  sfx.chip();
                }}
              >
                מקס׳
              </button>
            </div>
            <p className="amount-hint">
              אפשר להמר על {fmt(min)} עד {fmt(max)}
            </p>
          </div>

          {optionId && (
            <div className="payout-line">
              <span>אם תצדקו:</span>
              <Money n={payout} size={18} />
              <span className="payout-x">({fmtX(amount ? payout / amount : null)})</span>
            </div>
          )}
          <button type="button" className="btn btn-gold btn-xl" disabled={!optionId || busy} onClick={submit}>
            {busy ? "שולח…" : optionId ? `להמר ${fmt(amount)} על ״${optionLabel(round, optionId)}״` : "בחרו על מה להמר"}
          </button>
          {myBet && (
            <button type="button" className="link-btn" onClick={() => setEditing(false)}>
              להשאיר את ההימור הקודם
            </button>
          )}
        </>
      )}
    </>,
  );
}

export function Ticket({ ticket, amount, label, payout, note }: { ticket: number; amount: number; label: string; payout?: number; note?: string }) {
  return (
    <div className="ticket">
      <div className="ticket-head">
        <span>כרטיס הימור</span>
        <span className="num">#{String(ticket).padStart(4, "0")}</span>
      </div>
      <div className="ticket-main">
        <Money n={amount} size={22} />
        <span>על</span>
        <strong>״{label}״</strong>
      </div>
      {payout !== undefined && (
        <div className="ticket-payout">
          אם תצדקו מקבלים בערך <Money n={payout} size={16} />
        </div>
      )}
      {note && <div className="ticket-note">{note}</div>}
      <div className="barcode" aria-hidden="true" />
    </div>
  );
}

function Locked({ view, me, round }: { view: ClientView; me: PlayerPub; round: RoundPub }) {
  const myBet = view.me!.bets[round.id];
  return (
    <QuestionCard round={round}>
      <div className="stamp">ההימורים נסגרו</div>
      {myBet ? (
        <Ticket
          ticket={myBet.ticket}
          amount={myBet.amount}
          label={optionLabel(round, myBet.optionId)}
          payout={projectedPayout(round, myBet.optionId, myBet.amount, myBet)}
        />
      ) : (
        <p className="muted center">{round.noBet.includes(me.id) ? "בהצלחה באתגר!" : "לא הימרת בסיבוב הזה."}</p>
      )}
      <p className="muted center">האתגר יוצא לדרך. המנחה יכריז מי צדק.</p>
    </QuestionCard>
  );
}

function MyResult({ round, meId, bet }: { round: RoundPub; meId: string; bet?: { amount: number } }) {
  if (round.refunded) return <p className="muted center">אף אחד לא צדק, אז כל ההימורים חזרו לבעלים.</p>;
  const mine = round.results?.find((x) => x.playerId === meId);
  if (!mine || !bet) return <p className="muted center">{round.noBet.includes(meId) ? "השתתפת באתגר הזה." : "לא הימרת בסיבוב הזה."}</p>;
  const won = round.bets?.find((b) => b.playerId === meId)?.optionId === round.winnerId;
  return (
    <div className={cls("result-big", won ? "up" : "down")}>
      <span>{won ? "צדקת!" : "לא הפעם"}</span>
      <Money n={mine.delta} sign size={26} />
    </div>
  );
}

function Resolved({ view, me, round }: { view: ClientView; me: PlayerPub; round: RoundPub }) {
  return (
    <QuestionCard round={round}>
      <div className="result-line">
        התוצאה: <strong>{optionLabel(round, round.winnerId)}</strong>
      </div>
      <MyResult round={round} meId={me.id} bet={view.me!.bets[round.id]} />
      <p className="muted center">הסיבוב הבא יופיע כאן כשייפתח.</p>
    </QuestionCard>
  );
}

/* ---------- night bets ---------- */

function NightSection({ game, view, me, night, now }: { game: Game; view: ClientView; me: PlayerPub; night: RoundPub[]; now: number }) {
  const order = { open: 0, closed: 1, resolved: 2, draft: 3 } as const;
  const list = [...night].sort((a, b) => order[a.status] - order[b.status]);
  return (
    <section className="night">
      <header className="night-head">
        <h2>🌙 הימורי לילה</h2>
        <p>פתוחים כל הלילה. המנחה מכריע כשזה קורה, והקופה מתחלקת בין מי שצדק.</p>
      </header>
      {list.map((r) => (
        <NightCard key={r.id} game={game} view={view} me={me} r={r} now={now} />
      ))}
    </section>
  );
}

function NightCard({ game, view, me, r, now }: { game: Game; view: ClientView; me: PlayerPub; r: RoundPub; now: number }) {
  const [open, setOpen] = useState(false);
  const mine = view.me!.bets[r.id];
  const canBet = r.status === "open" && !r.noBet.includes(me.id);
  const status =
    r.status === "resolved" ? `הוכרע: ${optionLabel(r, r.winnerId)}` : r.status === "closed" ? "ההימורים נסגרו" : mine ? "הימרת ✓" : "פתוח להימורים";
  return (
    <article className={cls("night-card", r.status, mine && "has-bet")}>
      <button type="button" className="night-face" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="night-emoji" aria-hidden="true">
          {r.emoji}
        </span>
        <span className="night-text">
          <b>{r.title}</b>
          <small>
            {status}
            {mine && r.status !== "resolved" && (
              <>
                {" "}
                · {fmt(mine.amount)} על ״{optionLabel(r, mine.optionId)}״
              </>
            )}
          </small>
        </span>
        <span className="night-pot">
          <Money n={potOf(r)} size={14} />
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22 }} style={{ overflow: "hidden" }}>
            {r.note && <p className="night-note">{r.note}</p>}
            {r.status === "resolved" ? (
              <div className="night-body">
                <MyResult round={r} meId={me.id} bet={mine} />
              </div>
            ) : canBet ? (
              <BetForm game={game} view={view} me={me} round={r} now={now} compact />
            ) : (
              <div className="night-body">
                {mine ? (
                  <Ticket ticket={mine.ticket} amount={mine.amount} label={optionLabel(r, mine.optionId)} payout={projectedPayout(r, mine.optionId, mine.amount, mine)} />
                ) : (
                  <p className="muted center">{r.noBet.includes(me.id) ? "את זה משאירים לאחרים 😉" : "ההימורים על זה נסגרו."}</p>
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </article>
  );
}
