import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { ClientView, GroomCard, PlayerPub, RoundPub } from "../../shared/types";
import { CARDS } from "../../shared/catalog";
import { LETTERS, cls, fmt, mmss, potOf, projectedPayout, ranked, resizeImage } from "../lib";
import { type Game, useServerNow } from "../net";
import { sfx } from "../sound";
import { RodeoItay } from "../rodeo";
import { Avatar, Change, Coin, Money, Spark, ask, burst, toast } from "../ui";

export function BetTab({ game, view, me }: { game: Game; view: ClientView; me: PlayerPub }) {
  const round = view.pub.round;
  const night = view.pub.night;
  const now = useServerNow(game, !!round && round.status === "open");
  const open = !!round && round.status === "open" && (round.closesAt === null || now < round.closesAt);

  const drawing = !!round && round.status === "open" && !!round.openedAt && now < round.openedAt;
  let featured: ReactNode = null;
  if (round) {
    if (drawing) featured = <DrawCard />;
    else if (round.kind === "quiz") featured = <QuizCard key={round.id} game={game} view={view} me={me} round={round} now={now} open={open} />;
    else if (round.kind === "vote") featured = <VoteCard key={round.id} game={game} view={view} me={me} round={round} now={now} open={open} />;
    else if (round.kind === "photo") featured = <PhotoCard key={round.id} game={game} view={view} me={me} round={round} now={now} />;
    else if (open) featured = <BetForm key={round.id} game={game} view={view} me={me} round={round} now={now} />;
    else if (round.status === "resolved") featured = <Resolved view={view} me={me} round={round} />;
    else featured = <Locked view={view} me={me} round={round} />;
  }

  return (
    <section className="stack">
      {view.pub.tv.mode === "winner" && view.pub.stats && <NightSummary view={view} me={me} />}
      {featured ?? <Idle hasNight={night.length > 0} />}
      {me.isGroom && <GroomCards game={game} view={view} me={me} open={open} />}
      {night.length > 0 && <NightSection game={game} view={view} me={me} night={night} now={now} />}
      {!round && <MyStock view={view} me={me} />}
    </section>
  );
}

function DrawCard() {
  return (
    <div className="qcard felt drawcard" role="status">
      <span className="drawcard-slot" aria-hidden="true">
        🎡
      </span>
      <h2>גלגל הבלגן מסתובב…</h2>
      <p className="muted center">תסתכלו על הטלוויזיה. עוד שנייה זה מתחיל.</p>
    </div>
  );
}

function Idle({ hasNight }: { hasNight: boolean }) {
  return (
    <div className="idle felt">
      <RodeoItay size={170} />
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
        <span className={cls("qcard-num", round.final && "final")}>{label ?? (round.final ? "🏁 סיבוב הגמר" : `סיבוב ${round.number}`)}</span>
        {round.mult > 1 && <span className="mult-chip">💥 כפול</span>}
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
        <span>
          {round.kind === "quiz"
            ? "הזמן לענות נגמר בעוד"
            : round.kind === "photo" && round.phase === "collect"
              ? "שולחים תמונות עוד"
              : round.kind === "vote" || round.kind === "photo"
                ? "ההצבעה נסגרת בעוד"
                : "ההימורים נסגרים בעוד"}
        </span>
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
  const cap = round.kind === "night" ? view.pub.settings.nightCap : 0;
  const nightRoom = cap > 0 ? cap - (view.me!.nightStaked - (myBet?.amount ?? 0)) : Infinity;
  // the final: everything you have can go on the table
  const max = Math.min(round.final ? Infinity : round.maxBet, view.me!.available + (myBet?.amount ?? 0), nightRoom);
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
    return wrap(
      <div className="notice">
        {nightRoom <= 0
          ? `כבר שמת ${fmt(cap)} על הימורי לילה, זה המקסימום. השאר בשביל האתגרים 😉`
          : `אין לך כרגע ${view.pub.settings.currency} פנויים להימור. אפשר להשלים משימה סודית או לבקש חילוץ.`}
      </div>,
    );
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

  return wrap(
    <>
      {!compact && round.closesAt && <Countdown round={round} now={now} />}
      {myBet && !editing ? (
        <>
          <Ticket ticket={myBet.ticket} amount={myBet.amount} label={optionLabel(round, myBet.optionId)} note="🤫 ההימורים של כולם סודיים. כשהזמן נגמר, הכל נחשף בטלוויזיה" />
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
              const p = o.playerId ? players.find((x) => x.id === o.playerId) : undefined;
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
                {round.final ? "💰 הכל!" : "מקס׳"}
              </button>
            </div>
            <p className="amount-hint">
              אפשר להמר על {fmt(min)} עד {fmt(max)}
              {cap > 0 && ` · בהימורי לילה עד ${fmt(cap)} ביחד`}
            </p>
          </div>

          {round.final && <p className="final-line">🏁 הכל או כלום: אפשר לשים את כל השקדים, ומי שצודק לוקח כפול.</p>}
          {round.mult > 1 && <p className="final-line">💥 הסיבוב הזה כפול: מי שצודק מרוויח כפול.</p>}
          <p className="payout-line">
            🤫 אף אחד לא רואה על מה הימרתם עד שהזמן נגמר. מי שצודק מתחלק בכל הקופה, לפי הסכום שהימר.
          </p>
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

/* ---------- quiz ---------- */

function QuizCard({ game, view, me, round, now, open }: { game: Game; view: ClientView; me: PlayerPub; round: RoundPub; now: number; open: boolean }) {
  const mine = view.me!.bets[round.id];
  const [busy, setBusy] = useState(false);
  const players = view.pub.players;
  const resolved = round.status === "resolved";
  const excluded = round.noBet.includes(me.id);
  const mineRight = resolved && mine?.optionId === round.winnerId;
  const drinking = resolved && round.losers.includes(me.id);
  const gain = round.results?.find((x) => x.playerId === me.id)?.delta ?? 0;

  const answer = async (optionId: string) => {
    if (!open || busy) return;
    setBusy(true);
    try {
      await game.act("bet", { roundId: round.id, optionId, amount: 0 });
      sfx.chip();
      navigator.vibrate?.(20);
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="qcard quiz felt">
      <div className="qcard-top">
        <span className="quiz-tag">❓ שאלת ידע</span>
        {round.mult > 1 && <span className="mult-chip">💥 כפול</span>}
        <span className="pot-chip">
          תשובה נכונה <Money n={round.reward * (round.mult || 1)} size={15} />
        </span>
        <span className="qcard-emoji" aria-hidden="true">
          {round.emoji}
        </span>
      </div>
      <h2 className="qcard-title">{round.title}</h2>
      {round.note && <p className="qcard-note">{round.note}</p>}
      {open && round.closesAt && <Countdown round={round} now={now} />}
      {excluded ? (
        <div className="notice">על השאלה הזאת עונים בקול מול כולם 😉</div>
      ) : (
        <div className={cls("quiz-opts", round.options.length > 4 && "many")} role="radiogroup" aria-label="התשובה שלך">
          {round.options.map((o, i) => {
            const chosen = mine?.optionId === o.id;
            const right = resolved && round.winnerId === o.id;
            const p = o.playerId ? players.find((x) => x.id === o.playerId) : undefined;
            return (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={chosen}
                disabled={!open || busy}
                className={cls("quiz-opt", chosen && "on", right && "right", resolved && chosen && !right && "wrong")}
                onClick={() => answer(o.id)}
              >
                <span className="quiz-letter">{LETTERS[i]}</span>
                {p && <Avatar p={p} size={34} />}
                <span className="quiz-label">{o.label}</span>
                {right && <span aria-hidden="true">✓</span>}
              </button>
            );
          })}
        </div>
      )}
      {!excluded && (
        <p className={cls("quiz-status", mineRight && "up", drinking && "down")}>
          {open
            ? mine
              ? "נעול על התשובה שלך. אפשר לשנות עד שהזמן נגמר."
              : `צודקים מקבלים ${fmt(round.reward * (round.mult || 1))}, הכי מהיר עוד ${fmt(round.bonus * (round.mult || 1))}. טועים שותים 🥃`
            : !resolved
              ? "הזמן נגמר. עוד רגע התשובה."
              : mineRight
                ? `צדקת! +${fmt(gain)}`
                : drinking
                  ? round.loserReason === "slow"
                    ? "ענית אחרון. שוט! 🥃"
                    : "טעות. שוט! 🥃"
                  : "השאלה הזאת מאחורינו."}
        </p>
      )}
    </div>
  );
}

/* ---------- "who's most likely to": everyone votes ---------- */

function VoteCard({ game, view, me, round, now, open }: { game: Game; view: ClientView; me: PlayerPub; round: RoundPub; now: number; open: boolean }) {
  const mine = view.me!.bets[round.id];
  const [busy, setBusy] = useState(false);
  const players = view.pub.players;
  const resolved = round.status === "resolved";
  const chosen = resolved && round.losers.includes(me.id);
  const gain = round.results?.find((x) => x.playerId === me.id)?.delta ?? 0;
  const counts = new Map<string, number>();
  for (const b of round.bets ?? []) counts.set(b.optionId, (counts.get(b.optionId) ?? 0) + 1);

  const vote = async (optionId: string) => {
    if (!open || busy) return;
    setBusy(true);
    try {
      await game.act("bet", { roundId: round.id, optionId, amount: 0 });
      sfx.chip();
      navigator.vibrate?.(20);
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="qcard quiz vote felt">
      <div className="qcard-top">
        <span className="quiz-tag">🗳️ הצבעה</span>
        {round.mult > 1 && <span className="mult-chip">💥 כפול</span>}
        <span className="pot-chip">
          כמו הרוב <Money n={round.reward * (round.mult || 1)} size={15} />
        </span>
      </div>
      <h2 className="qcard-title">{round.title}</h2>
      {open && round.closesAt && <Countdown round={round} now={now} />}
      <div className="vote-grid" role="radiogroup" aria-label="על מי מצביעים?">
        {round.options.map((o) => {
          const p = o.playerId ? players.find((x) => x.id === o.playerId) : undefined;
          const self = o.playerId === me.id;
          const top = resolved && !!o.playerId && round.losers.includes(o.playerId);
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={mine?.optionId === o.id}
              disabled={!open || busy || self}
              className={cls("vote-opt", mine?.optionId === o.id && "on", top && "top")}
              onClick={() => vote(o.id)}
            >
              {p && <Avatar p={p} size={52} />}
              <span className="vote-name">{self ? "אתה" : o.label}</span>
              {!open && round.bets && <b className="vote-n">{counts.get(o.id) ?? 0}</b>}
            </button>
          );
        })}
      </div>
      <p className={cls("quiz-status", gain > 0 && "up", chosen && "down")}>
        {open
          ? mine
            ? "הקול שלך נקלט 🤫 אפשר לשנות עד שהזמן נגמר."
            : `מי שמקבל הכי הרבה קולות שותה. הצבעת כמו הרוב? ${fmt(round.reward * (round.mult || 1))} שקדים.`
          : !resolved
            ? "סופרים קולות…"
            : round.refunded
              ? "אף אחד לא הצביע. כולם שותים 🥃"
              : chosen
                ? "נבחרת! שוט 🥃"
                : gain > 0
                  ? `הצבעת כמו הרוב! +${fmt(gain)}`
                  : mine
                    ? "הרוב חשב אחרת."
                    : "לא הצבעת הפעם."}
      </p>
    </div>
  );
}

/* ---------- the photo contest ---------- */

function PhotoCard({ game, view, me, round: r, now }: { game: Game; view: ClientView; me: PlayerPub; round: RoundPub; now: number }) {
  const collecting = r.status === "open" && r.phase === "collect";
  const voting = r.status === "open" && r.phase === "vote" && (r.closesAt === null || now < r.closesAt);
  const resolved = r.status === "resolved";
  const mine = r.options.find((o) => o.playerId === me.id);
  const myVote = view.me!.bets[r.id];
  const gain = r.results?.find((x) => x.playerId === me.id)?.delta ?? 0;
  const wonBy = new Set((r.results ?? []).filter((x) => x.delta > 0).map((x) => x.playerId));
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const send = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    try {
      const url = await game.upload(await resizeImage(file, 1280));
      await game.act("contestPhoto", { photo: url });
      sfx.pop();
      toast("📸 התמונה בפנים! היא מופיעה בטלוויזיה", "ok");
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const vote = async (optionId: string) => {
    if (!voting || busy) return;
    setBusy(true);
    try {
      await game.act("bet", { roundId: r.id, optionId, amount: 0 });
      sfx.chip();
      navigator.vibrate?.(20);
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="qcard quiz photo felt">
      <div className="qcard-top">
        <span className="quiz-tag">📸 תחרות תמונות</span>
        <span className="pot-chip">
          לזוכה <Money n={r.reward * (r.mult || 1)} size={15} />
        </span>
      </div>
      <h2 className="qcard-title">{r.title}</h2>
      {(collecting || voting) && r.closesAt && <Countdown round={r} now={now} />}
      {collecting && (
        <>
          <p className="qcard-note">{mine ? "התמונה שלך בפנים ✓ אפשר להחליף עד שמתחילים להצביע." : "בוחרים מהגלריה את התמונה הכי מביכה של איתי מהערב, או מצלמים עכשיו."}</p>
          {mine?.photo && <img className="photo-mine" src={mine.photo} alt="התמונה ששלחת" />}
          <label className={cls("btn btn-gold btn-xl", busy && "busy")}>
            {busy ? "מעלה…" : mine ? "📸 להחליף תמונה" : "📸 לבחור תמונה"}
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => send(e.target.files?.[0])} />
          </label>
          <p className="muted center">{r.options.length === 1 ? "נשלחה תמונה אחת" : `נשלחו ${r.options.length} תמונות`}</p>
        </>
      )}
      {!collecting && r.options.length > 0 && (
        <div className="photo-grid" role="radiogroup" aria-label="על איזו תמונה מצביעים?">
          {r.options.map((o, i) => {
            const own = o.playerId === me.id;
            return (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={myVote?.optionId === o.id}
                disabled={!voting || busy || own}
                className={cls("photo-opt", myVote?.optionId === o.id && "on", resolved && o.playerId && wonBy.has(o.playerId) && "won")}
                onClick={() => vote(o.id)}
              >
                {o.photo && <img src={o.photo} alt={`תמונה ${i + 1}`} />}
                <span>{own ? "שלך" : resolved ? o.label : `#${i + 1}`}</span>
              </button>
            );
          })}
        </div>
      )}
      {!collecting && (
        <p className={cls("quiz-status", gain > 0 && "up")}>
          {voting
            ? myVote
              ? "הקול שלך נקלט 🤫 אפשר לשנות עד שהזמן נגמר."
              : "מצביעים על התמונה הכי מביכה. על שלך אי אפשר 😉"
            : !resolved
              ? "סופרים קולות…"
              : gain > 0
                ? `התמונה שלך ניצחה! +${fmt(gain)}`
                : r.refunded
                  ? "אף אחד לא הצביע."
                  : "התחרות מאחורינו."}
        </p>
      )}
    </div>
  );
}

/* ---------- the end of the night: your own summary ---------- */

function NightSummary({ view, me }: { view: ClientView; me: PlayerPub }) {
  const st = view.pub.stats?.find((x) => x.id === me.id);
  if (!st) return null;
  const list = ranked(view.pub.players);
  const rank = list.findIndex((p) => p.id === me.id) + 1;
  const { prize1, prize2, prize3, prizeLast, startBalance } = view.pub.settings;
  const prize = rank === list.length ? `🍋 ${prizeLast}` : rank === 1 ? `👑 ${prize1}` : rank === 2 ? `🥈 ${prize2}` : rank === 3 ? `🥉 ${prize3}` : null;
  const tiles: [string, string, string][] = [
    ["🎲", "הימורים", `${st.betsWon} ✓ / ${st.betsLost} ✗`],
    ["💰", "רווח מהימורים", `${st.betProfit > 0 ? "+" : ""}${fmt(st.betProfit)}`],
    ["🏆", "ההימור הכי טוב", st.bestWin ? `+${fmt(st.bestWin)}` : "—"],
    ["🤫", "משימות שבוצעו", `${st.missionsDone}`],
    ["🕵️", "תפסת", `${st.catches}`],
    ["😵", "נתפסת", `${st.timesCaught}`],
    ["🧠", "תשובות נכונות", `${st.quizRight}`],
    ["🥃", "שוטים מהמשחק", `${st.shots}`],
  ];
  return (
    <div className="summary felt">
      <h2>📋 הלילה שלך</h2>
      <div className="summary-head">
        <span className="summary-rank">
          מקום {rank} מתוך {list.length}
        </span>
        <Money n={me.balance} size={22} />
        <Change balance={me.balance} start={startBalance} />
      </div>
      {prize && <p className="summary-prize">{prize}</p>}
      <div className="summary-grid">
        {tiles.map(([icon, label, value]) => (
          <div key={label} className="summary-tile">
            <span aria-hidden="true">{icon}</span>
            <b>{value}</b>
            <small>{label}</small>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- the groom's golden cards ---------- */

function GroomCards({ game, view, me, open }: { game: Game; view: ClientView; me: PlayerPub; open: boolean }) {
  const used = view.pub.cards ?? { veto: false, double: false, drink: false };
  const r = view.pub.round;
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const keys = Object.keys(CARDS) as GroomCard[];
  if (keys.every((k) => used[k])) return null;
  const myBet = r ? view.me!.bets[r.id] : undefined;
  const live = !!r && r.kind === "challenge" && (r.status === "open" || r.status === "closed");
  const ready: Record<GroomCard, string | null> = {
    veto: live ? null : "כשיש אתגר פתוח",
    double: live && open && myBet && !myBet.double ? null : "אחרי שהימרת על אתגר פתוח",
    drink: null,
  };

  const play = async (card: GroomCard, target?: string) => {
    const info = CARDS[card];
    const who = target ? view.pub.players.find((p) => p.id === target)?.name : null;
    const ok = await ask({
      title: `${info.emoji} לשלוף את ״${info.name}״${who ? ` על ${who}` : ""}?`,
      body: `${info.text} כל קלף עובד פעם אחת בלילה, וכל הטלוויזיה תדע.`,
      ok: "לשלוף!",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await game.act("groomCard", { card, target });
      sfx.fanfare();
      burst("win");
      toast("🃏 הקלף נשלף! תסתכל על הטלוויזיה", "ok");
      setPicking(false);
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="gold-cards felt">
      <h2>🃏 קלפי הזהב של החתן</h2>
      <p className="muted">רק לך יש אותם. כל קלף עובד פעם אחת בלילה.</p>
      <div className="gc-row">
        {keys.map((k) => (
          <button
            key={k}
            type="button"
            className={cls("gcard", used[k] && "used", picking && k === "drink" && "on")}
            disabled={used[k] || busy || !!ready[k]}
            onClick={() => (k === "drink" ? setPicking(!picking) : play(k))}
          >
            <span className="gcard-emoji" aria-hidden="true" dir="ltr">
              {CARDS[k].emoji}
            </span>
            <b>{CARDS[k].name}</b>
            <small>{used[k] ? "כבר נשלף" : (ready[k] ?? CARDS[k].text)}</small>
          </button>
        ))}
      </div>
      {picking && (
        <div className="player-chips gc-pick" role="group" aria-label="מי שותה?">
          {view.pub.players
            .filter((p) => p.id !== me.id)
            .map((p) => (
              <button key={p.id} type="button" className="pchip" disabled={busy} onClick={() => play("drink", p.id)}>
                <Avatar p={p} size={24} /> {p.name}
              </button>
            ))}
        </div>
      )}
    </div>
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
        <p>
          פתוחים כל הלילה, אפשר להמר על כמה שרוצים. לוחצים על הימור כדי לפתוח אותו. המנחה מכריע כשזה קורה, והקופה מתחלקת בין מי שצדק.
        </p>
        <p className="night-count">
          הימרת על {night.filter((r) => view.me!.bets[r.id]).length} מתוך {night.length}
        </p>
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
          {canBet && !mine && <span className="night-cta">להמר ›</span>}
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
