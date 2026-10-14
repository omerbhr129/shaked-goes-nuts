import { useState } from "react";
import type { ClientView } from "../../shared/types";
import { cls, fmt } from "../lib";
import { creds, type Game } from "../net";
import { sfx } from "../sound";
import { Avatar, Marquee, toast } from "../ui";

export function JoinScreen({ game, view }: { game: Game; view: ClientView }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [showNew, setShowNew] = useState(false);
  const { startBalance, currency, allowJoinNew } = view.pub.settings;

  const join = async (payload: { playerId?: string; name?: string }, key: string) => {
    setBusy(key);
    try {
      const r = await game.act<{ token: string }>("join", payload);
      creds.token = r.token;
      game.rehello();
      sfx.join();
    } catch (e) {
      toast((e as Error).message, "err", 5000);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="join">
      <Marquee size="m" />
      <p className="join-lede">
        מסיבת הרווקים של איתי. כל אחד מקבל {fmt(startBalance)} {currency}, מהמר על מה שקורה הלילה ומבצע משימות סודיות. מי שמסיים הכי עשיר, מנצח.
      </p>
      <h1 className="join-title">בחרו את השם שלכם</h1>
      <div className="join-grid">
        {view.pub.players.map((p) => (
          <button
            key={p.id}
            type="button"
            className={cls("join-card", p.claimed && "taken", p.isGroom && "groom")}
            disabled={!!busy}
            onClick={() =>
              p.claimed
                ? toast(`${p.name} כבר מחובר ממכשיר אחר. אם זה אתם, בקשו מהמנחה לשחרר את השם.`, "info", 5000)
                : join({ playerId: p.id }, p.id)
            }
          >
            <span className="card-corner top" aria-hidden="true">
              {p.ticker}
            </span>
            <Avatar p={p} size={72} />
            <span className="join-name">{p.name}</span>
            <span className="join-sub">{busy === p.id ? "מתחבר…" : p.claimed ? "כבר בפנים" : p.isGroom ? "החתן 👑" : "פנוי"}</span>
            <span className="card-corner bottom" aria-hidden="true">
              {p.ticker}
            </span>
          </button>
        ))}
      </div>
      {allowJoinNew &&
        (showNew ? (
          <form
            className="join-new"
            onSubmit={(e) => {
              e.preventDefault();
              void join({ name: newName }, "new");
            }}
          >
            <label className="field">
              <span>השם שלכם</span>
              <input value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={16} autoFocus enterKeyHint="go" />
            </label>
            <button type="submit" className="btn btn-gold" disabled={newName.trim().length < 2 || !!busy}>
              הצטרפות
            </button>
          </form>
        ) : (
          <button type="button" className="link-btn" onClick={() => setShowNew(true)}>
            השם שלי לא ברשימה
          </button>
        ))}
    </div>
  );
}
