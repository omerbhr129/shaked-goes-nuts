import { useState } from "react";
import type { Bet, ClientView, PlayerPub, RoundKind, RoundOption, RoundPub, RoundRec, RoundStatus } from "../../shared/types";
import { cls, fmt, fmtX, mmss, multiplier, potOf, resizeImage } from "../lib";
import { type Game, useServerNow } from "../net";
import { Avatar, Money, Sheet, ask, toast } from "../ui";
import { type Run, WheelButtons } from "./AdminApp";

const STATUS: Record<RoundStatus, string> = { draft: "מוכן", open: "פתוח", closed: "סגור", resolved: "הוכרע" };

export function RoundsTab({ game, view, run }: { game: Game; view: ClientView; run: Run }) {
  const rounds = view.admin!.rounds;
  const challenges = rounds.filter((r) => r.kind === "challenge");
  const night = rounds.filter((r) => r.kind === "night");
  const [editing, setEditing] = useState<RoundRec | RoundKind | null>(null);
  const [opening, setOpening] = useState<RoundRec | null>(null);
  const [resolving, setResolving] = useState<RoundRec | null>(null);
  const live = view.pub.round;
  const busyElsewhere = live && (live.status === "open" || live.status === "closed");

  return (
    <section className="stack">
      {live && <LiveRound game={game} view={view} run={run} />}

      <div className="section-head">
        <h2 className="section-title">🎲 אתגרים</h2>
        <button type="button" className="btn btn-gold btn-s" onClick={() => setEditing("challenge")}>
          + אתגר
        </button>
      </div>
      <ol className="round-list">
        {challenges.map((r, i) => (
          <li key={r.id} className={cls("round-item", r.status, live?.id === r.id && "live")}>
            <div className="round-item-main">
              <span className="round-n num">{i + 1}</span>
              <span className="round-emoji" aria-hidden="true">
                {r.emoji}
              </span>
              <div className="round-text">
                <b>{r.title}</b>
                <small>{r.options.map((o) => o.label).join(" / ")}</small>
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

      <OpenSheet round={opening} onClose={() => setOpening(null)} run={run} />
      <ResolveSheet round={resolving} bets={view.admin!.bets} onClose={() => setResolving(null)} run={run} />
      <Sheet open={!!editing} onClose={() => setEditing(null)} title={typeof editing === "string" ? (editing === "night" ? "הימור לילה חדש" : "אתגר חדש") : "עריכה"} wide>
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
  const choices: [number, string][] = [
    [30, "30 שניות"],
    [60, "דקה"],
    [90, "דקה וחצי"],
    [120, "2 דקות"],
    [0, "בלי טיימר"],
  ];
  return (
    <Sheet open={!!round} onClose={onClose} title="פתיחת הימורים">
      {round && (
        <>
          <p className="sheet-text">
            {round.emoji} {round.title}
          </p>
          <p className="muted">כמה זמן יהיה לכולם להמר? בלי טיימר, סוגרים ידנית.</p>
          <div className="choice-grid">
            {choices.map(([s, label]) => (
              <button
                key={s}
                type="button"
                className={cls("btn", s === round.seconds ? "btn-gold" : "btn-ghost")}
                onClick={async () => {
                  onClose();
                  await run("openRound", { roundId: round.id, seconds: s }, "הסיבוב נפתח ומוצג בטלוויזיה");
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
                <span className="live-opt-sum">
                  <span className="odds-chip">{fmtX(multiplier(r, o.id))}</span>
                  <span className="muted">{bs.length} הימורים</span>
                  <Money n={total} size={14} />
                </span>
              </div>
              {bs.length > 0 && (
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
      {open && missing.length > 0 && <p className="muted">עוד לא הימרו: {missing.map((p) => p.name).join(", ")}</p>}
      <div className="live-actions">
        {open && (
          <button type="button" className="btn btn-gold" onClick={() => run("closeRound", { roundId: r.id }, "ההימורים נסגרו")}>
            🔒 לסגור הימורים עכשיו
          </button>
        )}
        {r.status !== "resolved" && (
          <button type="button" className="btn btn-ghost" onClick={() => run("extendRound", { roundId: r.id, seconds: 30 }, open ? "נוספו 30 שניות" : "ההימורים נפתחו שוב ל־30 שניות")}>
            {open ? "+30 שניות" : "לפתוח שוב ל־30 שניות"}
          </button>
        )}
        {r.status === "resolved" && (
          <>
            <button type="button" className="btn btn-gold" onClick={() => run("setTv", { mode: "board" }, "מצב המסחר בטלוויזיה")}>
              📈 מצב המסחר בטלוויזיה
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

type Draft = Pick<RoundRec, "kind" | "emoji" | "title" | "note" | "image" | "options" | "minBet" | "maxBet" | "seconds" | "bonus" | "noBet"> & { id?: string };

function RoundForm({ value, kind, game, view, onDone }: { value: RoundRec | null; kind: RoundKind; game: Game; view: ClientView; onDone: () => void }) {
  const players = view.pub.players;
  const locked = !!value && value.status !== "draft";
  const [d, setD] = useState<Draft>(() =>
    value
      ? structuredClone(value)
      : {
          kind,
          emoji: kind === "night" ? "🌙" : "🎲",
          title: "",
          note: "",
          image: null,
          options: [
            { id: "yes", label: "כן", playerId: null },
            { id: "no", label: "לא", playerId: null },
          ],
          minBet: 50,
          maxBet: 500,
          seconds: kind === "night" ? 0 : 60,
          bonus: kind === "night" ? 300 : view.pub.settings.bankBonus,
          noBet: [],
        },
  );
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
      await game.act("saveRound", { round: d });
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
          <textarea value={d.title} onChange={(e) => set({ title: e.target.value })} rows={2} required placeholder="למשל: איתי יקלע 3 כדורים תוך 30 שניות?" />
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
        <legend>אפשרויות {locked && <small className="muted">(אחרי הפתיחה אי אפשר לשנות)</small>}</legend>
        {d.options.map((o, i) => (
          <div key={i} className="opt-edit">
            {o.playerId && players.find((p) => p.id === o.playerId) && <Avatar p={players.find((p) => p.id === o.playerId)!} size={32} />}
            <input value={o.label} onChange={(e) => setOpt(i, { label: e.target.value })} aria-label={`אפשרות ${i + 1}`} />
            <button type="button" className="icon-btn" aria-label="הסרת אפשרות" onClick={() => set({ options: d.options.filter((_, j) => j !== i) })}>
              ✕
            </button>
          </div>
        ))}
        <div className="opt-tools">
          <button type="button" className="btn btn-ghost btn-s" onClick={() => set({ options: [...d.options, { id: "", label: "", playerId: null }] })}>
            + אפשרות
          </button>
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
        </div>
        <span className="muted">או לבחור שחקנים כאפשרויות:</span>
        <div className="player-chips">
          {players.map((p) => (
            <button key={p.id} type="button" className={cls("pchip", d.options.some((o) => o.playerId === p.id) && "on")} onClick={() => togglePlayerOption(p)}>
              <Avatar p={p} size={24} /> {p.name}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="field" disabled={locked}>
        <legend>מי בתוך האתגר (ולכן לא מהמר)</legend>
        <div className="player-chips">
          {players.map((p) => (
            <button key={p.id} type="button" className={cls("pchip", d.noBet.includes(p.id) && "on")} onClick={() => toggleNoBet(p.id)}>
              <Avatar p={p} size={24} /> {p.name}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="form-row" disabled={locked}>
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
        {d.kind === "challenge" && (
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
