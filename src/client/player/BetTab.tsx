import { type ReactNode, useEffect, useState } from "react";
import type { ClientView, PlayerPub, RoundPub } from "../../shared/types";
import { cls, fmt, mmss, ranked } from "../lib";
import { type Game, useServerNow } from "../net";
import { sfx } from "../sound";
import { Avatar, Change, Coin, Money, Spark, toast } from "../ui";

export function BetTab({ game, view, me }: { game: Game; view: ClientView; me: PlayerPub }) {
  const round = view.pub.round;
  const now = useServerNow(game, !!round && round.status === "open");
  if (!round) return <Idle view={view} me={me} />;
  const open = round.status === "open" && (round.closesAt === null || now < round.closesAt);
  if (open) return <BetForm key={round.id} game={game} view={view} me={me} round={round} now={now} />;
  if (round.status === "resolved") return <Resolved view={view} me={me} round={round} />;
  return <Locked view={view} me={me} round={round} />;
}

function Idle({ view, me }: { view: ClientView; me: PlayerPub }) {
  const list = ranked(view.pub.players);
  const rank = list.findIndex((p) => p.id === me.id) + 1;
  return (
    <section className="stack">
      <div className="idle felt">
        <span className="idle-dice" aria-hidden="true">
          🎲
        </span>
        <h2>אין הימור פתוח כרגע</h2>
        <p>כשהמנחה יפתח סיבוב, הוא יופיע כאן. בינתיים אפשר לעבוד על המשימות הסודיות.</p>
      </div>
      <MyStock view={view} me={me} rank={rank} total={list.length} />
    </section>
  );
}

function MyStock({ view, me, rank, total }: { view: ClientView; me: PlayerPub; rank: number; total: number }) {
  return (
    <div className="mystock felt">
      <div className="mystock-head">
        <span className="mystock-ticker">{me.ticker}</span>
        <span>
          מקום {rank} מתוך {total}
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

function QuestionCard({ round, children }: { round: RoundPub; children: ReactNode }) {
  return (
    <div className="qcard felt">
      <div className="qcard-top">
        <span className="qcard-num">סיבוב {round.number}</span>
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

function optionLabel(round: RoundPub, id: string | null | undefined) {
  return round.options.find((o) => o.id === id)?.label ?? "";
}

function BetForm({ game, view, me, round, now }: { game: Game; view: ClientView; me: PlayerPub; round: RoundPub; now: number }) {
  const myBet = view.me!.bet;
  const max = Math.min(round.maxBet, me.balance);
  const min = Math.min(round.minBet, max);
  const clamp = (n: number) => Math.max(min, Math.min(max, Math.round(n)));
  const [optionId, setOptionId] = useState<string | null>(myBet?.optionId ?? null);
  const [amount, setAmount] = useState(() => clamp(myBet?.amount ?? 100));
  const [editing, setEditing] = useState(!myBet);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setAmount((a) => Math.max(min, Math.min(max, a)));
  }, [min, max]);

  if (round.noBet.includes(me.id)) {
    return (
      <QuestionCard round={round}>
        {round.closesAt && <Countdown round={round} now={now} />}
        <div className="notice">אתם משתתפים באתגר הזה, אז בסיבוב הזה לא מהמרים. בהצלחה! 💪</div>
      </QuestionCard>
    );
  }

  if (max <= 0) {
    return (
      <QuestionCard round={round}>
        <div className="notice">
          נגמרו לך ה{view.pub.settings.currency} 🥲 אפשר להשלים משימה סודית או לבקש מהמנחה חילוץ.
        </div>
      </QuestionCard>
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
  return (
    <QuestionCard round={round}>
      {round.closesAt && <Countdown round={round} now={now} />}
      {myBet && !editing ? (
        <>
          <Ticket ticket={myBet.ticket} amount={myBet.amount} label={optionLabel(round, myBet.optionId)} note="אפשר לשנות עד שההימורים נסגרים" />
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
    </QuestionCard>
  );
}

export function Ticket({ ticket, amount, label, note }: { ticket: number; amount: number; label: string; note?: string }) {
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
      {note && <div className="ticket-note">{note}</div>}
      <div className="barcode" aria-hidden="true" />
    </div>
  );
}

function Locked({ view, me, round }: { view: ClientView; me: PlayerPub; round: RoundPub }) {
  const myBet = view.me!.bet;
  return (
    <QuestionCard round={round}>
      <div className="stamp">ההימורים נסגרו</div>
      {myBet ? (
        <Ticket ticket={myBet.ticket} amount={myBet.amount} label={optionLabel(round, myBet.optionId)} />
      ) : (
        <p className="muted center">{round.noBet.includes(me.id) ? "בהצלחה באתגר!" : "לא הימרת בסיבוב הזה."}</p>
      )}
      <p className="muted center">האתגר יוצא לדרך. המנחה יכריז מי צדק.</p>
    </QuestionCard>
  );
}

function Resolved({ view, me, round }: { view: ClientView; me: PlayerPub; round: RoundPub }) {
  const myBet = view.me!.bet;
  const won = myBet && myBet.optionId === round.winnerId;
  return (
    <QuestionCard round={round}>
      <div className="result-line">
        התוצאה: <strong>{optionLabel(round, round.winnerId)}</strong>
      </div>
      {myBet ? (
        <div className={cls("result-big", won ? "up" : "down")}>
          <span>{won ? "צדקת!" : "לא הפעם"}</span>
          <Money n={won ? myBet.amount : -myBet.amount} sign size={26} />
        </div>
      ) : (
        <p className="muted center">{round.noBet.includes(me.id) ? "השתתפת באתגר הזה." : "לא הימרת בסיבוב הזה."}</p>
      )}
      <p className="muted center">הסיבוב הבא יופיע כאן כשייפתח.</p>
    </QuestionCard>
  );
}
