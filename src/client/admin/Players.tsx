import { useState } from "react";
import type { ClientView, PlayerPub } from "../../shared/types";
import { cls, fmt, resizeImage } from "../lib";
import type { Game } from "../net";
import { Avatar, Money, Sheet, ask, toast } from "../ui";
import type { Run } from "./AdminApp";

export function PlayersTab({ game, view, run }: { game: Game; view: ClientView; run: Run }) {
  const players = view.pub.players;
  const joined = view.admin!.joined;
  const [edit, setEdit] = useState<PlayerPub | "new" | null>(null);
  const [money, setMoney] = useState<PlayerPub | null>(null);

  return (
    <section className="stack">
      <div className="section-head">
        <h2 className="section-title">שחקנים</h2>
        <button type="button" className="btn btn-gold btn-s" onClick={() => setEdit("new")}>
          + שחקן
        </button>
      </div>
      <ul className="plist">
        {players.map((p) => (
          <li key={p.id} className="prow felt">
            <div className="prow-main">
              <span className="prow-avatar">
                <Avatar p={p} size={48} />
                <span className={cls("dot", p.online ? "on" : p.claimed ? "away" : "off")} aria-hidden="true" />
              </span>
              <div className="prow-text">
                <b>
                  {p.name} {p.isGroom && "👑"}
                </b>
                <small>
                  {p.ticker} ·{" "}
                  {p.claimed
                    ? `${p.online ? "מחובר" : "לא מחובר כרגע"}${joined[p.id] ? `, נכנס ב־${new Date(joined[p.id]!).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}` : ""}`
                    : "עוד לא נכנס"}
                </small>
              </div>
              <Money n={p.balance} size={16} />
            </div>
            <div className="row-actions">
              <button type="button" className="mini" onClick={() => setEdit(p)}>
                עריכה
              </button>
              <button type="button" className="mini" onClick={() => setMoney(p)}>
                ± {view.pub.settings.currency}
              </button>
              {p.claimed && (
                <button
                  type="button"
                  className="mini"
                  onClick={async () => {
                    if (
                      await ask({
                        title: `לשחרר את ${p.name}?`,
                        body: "המכשיר שמחובר עכשיו לשם הזה יתנתק, ואפשר יהיה להיכנס לשם הזה מטלפון אחר. היתרה והמשימות נשמרות.",
                        ok: "שחרור",
                      })
                    )
                      await run("releasePlayer", { playerId: p.id }, `${p.name} שוחרר`);
                  }}
                >
                  שחרור מכשיר
                </button>
              )}
              <button
                type="button"
                className="mini danger"
                onClick={async () => {
                  if (await ask({ title: `למחוק את ${p.name}?`, body: "ההימורים והיתרה שלו יימחקו, והמשימות שלו יחזרו למאגר.", ok: "מחיקה", danger: true }))
                    await run("deletePlayer", { playerId: p.id }, "נמחק");
                }}
              >
                מחיקה
              </button>
            </div>
          </li>
        ))}
      </ul>

      <Settings view={view} run={run} />

      <Sheet open={!!edit} onClose={() => setEdit(null)} title={edit === "new" ? "שחקן חדש" : "עריכת שחקן"}>
        {edit && <PlayerForm key={edit === "new" ? "new" : edit.id} value={edit === "new" ? null : edit} game={game} run={run} onDone={() => setEdit(null)} />}
      </Sheet>
      <Sheet open={!!money} onClose={() => setMoney(null)} title={money ? `${view.pub.settings.currency} ל${money.name}` : ""}>
        {money && <MoneyForm p={money} currency={view.pub.settings.currency} run={run} onDone={() => setMoney(null)} />}
      </Sheet>
    </section>
  );
}

function PlayerForm({ value, game, run, onDone }: { value: PlayerPub | null; game: Game; run: Run; onDone: () => void }) {
  const [name, setName] = useState(value?.name ?? "");
  const [ticker, setTicker] = useState(value?.ticker ?? "");
  const [isGroom, setIsGroom] = useState(value?.isGroom ?? false);
  const [photo, setPhoto] = useState<string | null>(value?.photo ?? null);
  const [busy, setBusy] = useState(false);
  const preview = { id: value?.id ?? "new", name: name || "?", photo, isGroom };

  const onFile = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    try {
      setPhoto(await game.upload(await resizeImage(file, 640)));
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="form"
      onSubmit={async (e) => {
        e.preventDefault();
        const ok = await run("savePlayer", { player: { id: value?.id, name, ticker, isGroom, photo } }, "נשמר");
        if (ok) onDone();
      }}
    >
      <div className="image-pick">
        <Avatar p={preview} size={84} />
        <label className="btn btn-ghost btn-s">
          {busy ? "מעלה…" : "העלאת תמונה"}
          <input type="file" accept="image/*" hidden onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
        {photo && (
          <button type="button" className="btn btn-ghost btn-s" onClick={() => setPhoto(null)}>
            לתמונה המקורית
          </button>
        )}
      </div>
      <label className="field">
        <span>שם</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={16} required />
      </label>
      <label className="field">
        <span>סימול מניה (באנגלית, עד 5 אותיות)</span>
        <input dir="ltr" value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} maxLength={5} />
      </label>
      <label className="check">
        <input type="checkbox" checked={isGroom} onChange={(e) => setIsGroom(e.target.checked)} />
        <span>זה החתן 👑</span>
      </label>
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

function MoneyForm({ p, currency, run, onDone }: { p: PlayerPub; currency: string; run: Run; onDone: () => void }) {
  const [amount, setAmount] = useState(100);
  const [note, setNote] = useState("");
  const send = async (sign: 1 | -1) => {
    const ok = await run("adjust", { playerId: p.id, delta: sign * Math.abs(amount), note }, `${sign > 0 ? "נוספו" : "הורדו"} ${fmt(Math.abs(amount))} ${currency}`);
    if (ok) onDone();
  };
  return (
    <div className="form">
      <p className="muted">
        יתרה עכשיו: <Money n={p.balance} size={14} />. מתאים לבונוס, קנס או חילוץ למי שנגמר לו הכסף.
      </p>
      <div className="choice-row">
        {[50, 100, 200, 500].map((n) => (
          <button key={n} type="button" className={cls("btn btn-s", amount === n ? "btn-gold" : "btn-ghost")} onClick={() => setAmount(n)}>
            {n}
          </button>
        ))}
        <input className="num-input" type="number" inputMode="numeric" value={amount} onChange={(e) => setAmount(Number(e.target.value))} aria-label="סכום" />
      </div>
      <label className="field">
        <span>סיבה (לא חובה)</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="למשל: חילוץ ממשלתי" />
      </label>
      <div className="sheet-actions">
        <button type="button" className="btn btn-gold" onClick={() => send(1)}>
          + להוסיף
        </button>
        <button type="button" className="btn btn-danger" onClick={() => send(-1)}>
          − להוריד
        </button>
      </div>
    </div>
  );
}

function Settings({ view, run }: { view: ClientView; run: Run }) {
  const s = view.pub.settings;
  const [f, setF] = useState({
    currency: s.currency,
    startBalance: s.startBalance,
    bankBonus: s.bankBonus,
    catchReward: s.catchReward,
    falsePenalty: s.falsePenalty,
    bailoutAmount: s.bailoutAmount,
    prize1: s.prize1,
    prize2: s.prize2,
    prize3: s.prize3,
    prizeLast: s.prizeLast,
    nightCap: s.nightCap,
    catchWindow: s.catchWindow,
  });
  const text = (k: "prize1" | "prize2" | "prize3" | "prizeLast") => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const num = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: Number(e.target.value) }));
  return (
    <div className="settings felt">
      <h3>הגדרות</h3>
      <div className="form-row">
        <label className="field">
          <span>שם המטבע</span>
          <input value={f.currency} onChange={(e) => setF((x) => ({ ...x, currency: e.target.value }))} maxLength={16} />
        </label>
        <label className="field">
          <span>יתרת פתיחה</span>
          <input type="number" inputMode="numeric" value={f.startBalance} onChange={num("startBalance")} />
        </label>
        <label className="field">
          <span>בונוס הבנק לאתגר חדש</span>
          <input type="number" inputMode="numeric" value={f.bankBonus} onChange={num("bankBonus")} />
        </label>
        <label className="field">
          <span>פרס על תפיסה</span>
          <input type="number" inputMode="numeric" value={f.catchReward} onChange={num("catchReward")} />
        </label>
        <label className="field">
          <span>קנס על האשמת שווא</span>
          <input type="number" inputMode="numeric" value={f.falsePenalty} onChange={num("falsePenalty")} />
        </label>
        <label className="field">
          <span>סכום חילוץ</span>
          <input type="number" inputMode="numeric" value={f.bailoutAmount} onChange={num("bailoutAmount")} />
        </label>
        <label className="field">
          <span>תקרה להימורי לילה (ביחד)</span>
          <input type="number" inputMode="numeric" value={f.nightCap} onChange={num("nightCap")} />
        </label>
        <label className="field">
          <span>שניות לתפוס משימה</span>
          <input type="number" inputMode="numeric" value={f.catchWindow} onChange={num("catchWindow")} />
        </label>
      </div>
      <div className="prize-fields">
        <span className="muted">מה מקבלים בבוקר (מופיע בטלפונים ובהכרזת המנצח):</span>
        <label className="field">
          <span>🥇 מקום ראשון</span>
          <input value={f.prize1} onChange={text("prize1")} maxLength={120} />
        </label>
        <label className="field">
          <span>🥈 מקום שני</span>
          <input value={f.prize2} onChange={text("prize2")} maxLength={120} />
        </label>
        <label className="field">
          <span>🥉 מקום שלישי</span>
          <input value={f.prize3} onChange={text("prize3")} maxLength={120} />
        </label>
        <label className="field">
          <span>🍋 מקום אחרון</span>
          <input value={f.prizeLast} onChange={text("prizeLast")} maxLength={120} />
        </label>
      </div>
      <label className="check">
        <input type="checkbox" checked={s.allowJoinNew} onChange={(e) => run("saveSettings", { settings: { allowJoinNew: e.target.checked } }, "נשמר")} />
        <span>לאפשר הצטרפות עם שם שלא ברשימה</span>
      </label>
      <button type="button" className="btn btn-ghost btn-s" onClick={() => run("saveSettings", { settings: f }, "ההגדרות נשמרו")}>
        שמירת הגדרות
      </button>

      <h3 className="danger-title">איפוס</h3>
      <p className="muted">לפני המסיבה: אחרי הבדיקות, אפסו כדי שכולם יתחילו מ־{fmt(s.startBalance)}. הסיבובים והמשימות שכתבתם נשמרים, והמשימות יחולקו מחדש כשכל אחד ייכנס.</p>
      <div className="row-actions">
        <button
          type="button"
          className="btn btn-danger btn-s"
          onClick={async () => {
            if (
              await ask({
                title: "לאפס את המשחק?",
                body: "כל ההימורים והיתרות יתאפסו, הסיבובים יחזרו לרשימה, והמשימות יחולקו מחדש. כל המכשירים ינותקו ויצטרכו לבחור שם מחדש.",
                ok: "איפוס",
                danger: true,
              })
            )
              await run("resetGame", { unclaim: true, undeal: true }, "המשחק אופס");
          }}
        >
          איפוס משחק
        </button>
        <button
          type="button"
          className="btn btn-danger btn-s"
          onClick={async () => {
            if (
              await ask({
                title: "לטעון את התוכן ההתחלתי?",
                body: "כל הסיבובים, המשימות והשחקנים יחזרו לגרסה המקורית. שינויים שעשיתם יימחקו.",
                ok: "טעינה מחדש",
                danger: true,
              })
            )
              await run("reseed", {}, "התוכן ההתחלתי נטען");
          }}
        >
          טעינת התוכן ההתחלתי
        </button>
      </div>
    </div>
  );
}
