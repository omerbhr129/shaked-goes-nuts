import { useState } from "react";
import type { Audience, ClientView, Mission, PlayerPub } from "../../shared/types";
import { cls } from "../lib";
import { Avatar, Money, Sheet, ask } from "../ui";
import type { Run } from "./AdminApp";

const AUD: Record<Audience, string> = { all: "לכולם", friends: "לחברים (לא לחתן)", groom: "רק לחתן" };
const STATUS_ICON: Record<Mission["status"], string> = { open: "✉️", pending: "⏳", done: "✅", burned: "🔥" };

const ago = (t: number | null) => {
  if (!t) return "";
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? "עכשיו" : m < 60 ? `לפני ${m} דק׳` : `לפני ${Math.floor(m / 60)} שע׳`;
};

export function MissionsTab({ view, run }: { view: ClientView; run: Run }) {
  const { missions, accusations } = view.admin!;
  const players = view.pub.players;
  const people = Object.fromEntries(players.map((p) => [p.id, p])) as Record<string, PlayerPub>;
  const pool = missions.filter((m) => !m.assignedTo);
  const recent = missions
    .filter((m) => m.status === "done")
    .sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0))
    .slice(0, 8);
  const decided = accusations.filter((a) => a.status !== "pending").slice(0, 6);
  const [edit, setEdit] = useState<Mission | "new" | null>(null);
  const [assignFor, setAssignFor] = useState<PlayerPub | null>(null);

  return (
    <section className="stack">
      <p className="muted">
        כל מי שנכנס מקבל 3 משימות אוטומטית. מי שמסמן ״ביצעתי״ מקבל את השקדים מיד. כאן אפשר לבטל סימון שנראה לכם חשוד, להחליף משימות ולכתוב חדשות.
      </p>

      {recent.length > 0 && (
        <div className="felt recent">
          <h2 className="section-title">בוצעו לאחרונה</h2>
          {recent.map((m) => {
            const p = m.assignedTo ? people[m.assignedTo] : undefined;
            return (
              <div key={m.id} className="mrow done">
                <span className="mrow-icon" aria-hidden="true">
                  {p ? <Avatar p={p} size={28} /> : "✅"}
                </span>
                <span className="mrow-text">
                  <b>{p?.name}</b>: {m.text} <small className="muted">{ago(m.doneAt)}</small>
                </span>
                <Money n={m.reward} size={14} />
                <div className="mrow-actions">
                  <button
                    type="button"
                    className="mini"
                    onClick={async () => {
                      if (await ask({ title: "לבטל את הסימון?", body: `${p?.name} יאבד ${m.reward} והמשימה תחזור להיות פתוחה.`, ok: "ביטול הסימון", danger: true }))
                        await run("reviewMission", { missionId: m.id, approve: false }, "הסימון בוטל");
                    }}
                  >
                    לא מאשר
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {decided.length > 0 && (
        <div className="felt recent">
          <h2 className="section-title">🕵️ תפיסות</h2>
          {decided.map((a) => (
            <p key={a.id} className="catch-log">
              {a.status === "right" ? "✅" : "❌"} <b>{people[a.by]?.name}</b> נגד <b>{people[a.suspect]?.name}</b>: ״{a.text}״
            </p>
          ))}
        </div>
      )}

      <div className="section-head">
        <h2 className="section-title">משימות לפי שחקן</h2>
        <button type="button" className="btn btn-ghost btn-s" onClick={() => run("dealMissions", {}, "חולקו")}>
          השלמת חלוקה
        </button>
      </div>

      {players.map((p) => {
        const mine = missions.filter((m) => m.assignedTo === p.id);
        if (!mine.length) return null;
        return (
          <div key={p.id} className="mp felt">
            <div className="mp-head">
              <Avatar p={p} size={36} />
              <b>{p.name}</b>
              <span className="muted">
                {mine.filter((m) => m.status === "done").length} בוצעו
                {mine.some((m) => m.status === "burned") && ` · ${mine.filter((m) => m.status === "burned").length} נשרפו`}
              </span>
              <button type="button" className="link-btn" onClick={() => setAssignFor(p)}>
                + הוספה
              </button>
            </div>
            {mine.map((m) => (
              <div key={m.id} className={cls("mrow", m.status)}>
                <span className="mrow-icon" aria-hidden="true">
                  {STATUS_ICON[m.status]}
                </span>
                <span className="mrow-text">
                  {m.text}
                  {m.status === "burned" && m.caughtBy && <small className="muted"> · נתפס ע״י {people[m.caughtBy]?.name}</small>}
                </span>
                <Money n={m.reward} size={14} />
                {m.status !== "burned" && (
                  <div className="mrow-actions">
                    {m.status === "open" && (
                      <button type="button" className="mini" onClick={() => run("swapMission", { missionId: m.id }, "המשימה הוחלפה")}>
                        החלפה
                      </button>
                    )}
                    {m.status === "open" ? (
                      <button type="button" className="mini" onClick={() => run("reviewMission", { missionId: m.id, approve: true }, "סומנה כבוצעה")}>
                        סימון כבוצעה
                      </button>
                    ) : (
                      <button type="button" className="mini" onClick={() => run("reviewMission", { missionId: m.id, approve: false }, "הסימון בוטל")}>
                        ביטול סימון
                      </button>
                    )}
                    <button type="button" className="mini" onClick={() => setEdit(m)}>
                      עריכה
                    </button>
                    {m.status === "open" && (
                      <button type="button" className="mini" onClick={() => run("assignMission", { missionId: m.id, playerId: null }, "הוחזרה למאגר")}>
                        למאגר
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        );
      })}

      <div className="section-head">
        <h2 className="section-title">מאגר פנוי ({pool.length})</h2>
        <button type="button" className="btn btn-ghost btn-s" onClick={() => setEdit("new")}>
          + משימה חדשה
        </button>
      </div>
      <ul className="pool">
        {pool.map((m) => (
          <li key={m.id} className="mrow">
            <span className="mrow-text">{m.text}</span>
            <span className="aud">{AUD[m.audience]}</span>
            <Money n={m.reward} size={14} />
            <div className="mrow-actions">
              <button type="button" className="mini" onClick={() => setEdit(m)}>
                עריכה
              </button>
              <button
                type="button"
                className="mini"
                onClick={async () => {
                  if (await ask({ title: "למחוק את המשימה?", body: m.text, ok: "מחיקה", danger: true })) await run("deleteMission", { missionId: m.id }, "נמחקה");
                }}
              >
                מחיקה
              </button>
            </div>
          </li>
        ))}
      </ul>

      <Sheet open={!!edit} onClose={() => setEdit(null)} title={edit === "new" ? "משימה חדשה" : "עריכת משימה"}>
        {edit && <MissionForm key={edit === "new" ? "new" : edit.id} value={edit === "new" ? null : edit} players={players} run={run} onDone={() => setEdit(null)} />}
      </Sheet>

      <Sheet open={!!assignFor} onClose={() => setAssignFor(null)} title={assignFor ? `משימה ל${assignFor.name}` : ""} wide>
        {assignFor && (
          <div className="stack">
            <button type="button" className="btn btn-ghost" onClick={() => setEdit("new")}>
              + לכתוב משימה חדשה
            </button>
            <ul className="pool">
              {pool
                .filter((m) => m.audience === "all" || (m.audience === "groom") === assignFor.isGroom)
                .map((m) => (
                  <li key={m.id} className="mrow">
                    <span className="mrow-text">{m.text}</span>
                    <Money n={m.reward} size={14} />
                    <button
                      type="button"
                      className="btn btn-gold btn-s"
                      onClick={async () => {
                        await run("assignMission", { missionId: m.id, playerId: assignFor.id }, `נוספה ל${assignFor.name}`);
                        setAssignFor(null);
                      }}
                    >
                      הוספה
                    </button>
                  </li>
                ))}
            </ul>
          </div>
        )}
      </Sheet>
    </section>
  );
}

function MissionForm({ value, players, run, onDone }: { value: Mission | null; players: PlayerPub[]; run: Run; onDone: () => void }) {
  const [text, setText] = useState(value?.text ?? "");
  const [reward, setReward] = useState(value?.reward ?? 150);
  const [audience, setAudience] = useState<Audience>(value?.audience ?? "all");
  const [assignedTo, setAssignedTo] = useState<string>(value?.assignedTo ?? "");
  return (
    <form
      className="form"
      onSubmit={async (e) => {
        e.preventDefault();
        const ok = await run("saveMission", { mission: { id: value?.id, text, reward, audience, assignedTo: assignedTo || null } }, "המשימה נשמרה");
        if (ok) onDone();
      }}
    >
      <label className="field">
        <span>המשימה</span>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} required placeholder="למשל: תגרום לחתן להגיד ״פיסטוק״" />
      </label>
      <div className="field">
        <span>פרס</span>
        <div className="choice-row">
          {[100, 150, 200].map((n) => (
            <button key={n} type="button" className={cls("btn btn-s", reward === n ? "btn-gold" : "btn-ghost")} onClick={() => setReward(n)}>
              {n}
            </button>
          ))}
          <input className="num-input" type="number" inputMode="numeric" value={reward} onChange={(e) => setReward(Number(e.target.value))} aria-label="פרס אחר" />
        </div>
      </div>
      <label className="field">
        <span>למי מתאימה</span>
        <select value={audience} onChange={(e) => setAudience(e.target.value as Audience)}>
          {(Object.keys(AUD) as Audience[]).map((a) => (
            <option key={a} value={a}>
              {AUD[a]}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>משויכת ל</span>
        <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} disabled={value?.status === "done" || value?.status === "burned"}>
          <option value="">אף אחד (במאגר)</option>
          {players.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <div className="sheet-actions">
        <button type="submit" className="btn btn-gold">
          שמירה
        </button>
        <button type="button" className="btn btn-ghost" onClick={onDone}>
          ביטול
        </button>
      </div>
    </form>
  );
}
