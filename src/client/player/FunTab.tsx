import { useRef, useState } from "react";
import { REACTIONS, SHOP, type ShopItem } from "../../shared/catalog";
import type { ClientView, PlayerPub } from "../../shared/types";
import { cls, resizeImage } from "../lib";
import type { Game } from "../net";
import { sfx } from "../sound";
import { Avatar, Money, ask, burst, toast } from "../ui";

/** Everything you can throw at the big screen, and the gift shop. */
export function FunTab({ game, view, me }: { game: Game; view: ClientView; me: PlayerPub }) {
  return (
    <section className="stack">
      <ToTheScreen game={game} view={view} />
      <GiftShop game={game} view={view} me={me} />
    </section>
  );
}

function ToTheScreen({ game, view }: { game: Game; view: ClientView }) {
  const [text, setText] = useState("");
  const [anon, setAnon] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const people = Object.fromEntries(view.pub.players.map((p) => [p.id, p])) as Record<string, PlayerPub>;

  const react = async (emoji: string) => {
    navigator.vibrate?.(10);
    try {
      await game.act("react", { emoji });
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  const send = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await game.act("shout", { text, anon });
      setText("");
      sfx.pop();
      toast("עלה למסך 📺", "ok");
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  const onPhoto = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    try {
      const url = await game.upload(await resizeImage(file, 1280));
      await game.act("shoutPhoto", { photo: url, anon, text });
      setText("");
      sfx.pop();
      toast("התמונה עלתה למסך 📸", "ok");
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const onVideo = async (file?: File) => {
    if (videoRef.current) videoRef.current.value = "";
    if (!file) return;
    if (file.size > 40_000_000) {
      toast("הסרטון גדול מדי. עד 40 מגה, בערך חצי דקה. אפשר לקצר אותו בגלריה ולנסות שוב", "err", 6000);
      return;
    }
    // some phones leave the type empty: guess it from the name
    const type = file.type || (/\.mov$/i.test(file.name) ? "video/quicktime" : "video/mp4");
    setBusy(true);
    setProgress(0);
    try {
      const url = await game.uploadWithProgress(file, type, setProgress);
      await game.act("shoutVideo", { video: url, anon, text });
      setText("");
      sfx.pop();
      toast("🎬 הסרטון עלה למסך", "ok");
    } catch (e) {
      toast((e as Error).message, "err", 6000);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const recent = [...view.pub.shouts].reverse().slice(0, 6);
  return (
    <div className="fun felt">
      <h2>📺 למסך הגדול</h2>
      <p className="muted">מה ששולחים כאן קופץ עכשיו בטלוויזיה, מול כולם.</p>
      <div className="emoji-pad" aria-label="אימוג׳י למסך">
        {REACTIONS.map((e) => (
          <button key={e} type="button" className="emoji-btn" onClick={() => react(e)} aria-label={`לשלוח ${e} למסך`}>
            {e}
          </button>
        ))}
      </div>
      <label className="field">
        <span>הודעה למסך</span>
        <textarea rows={2} maxLength={90} value={text} onChange={(e) => setText(e.target.value)} placeholder="למשל: איתי, עוד לא מאוחר לברוח 🏃" />
      </label>
      <label className="check">
        <input type="checkbox" checked={anon} onChange={(e) => setAnon(e.target.checked)} />
        <span>🕵️ לשלוח בעילום שם</span>
      </label>
      <div className="row-actions">
        <button type="button" className="btn btn-gold" disabled={busy || !text.trim()} onClick={send}>
          📣 למסך
        </button>
        <label className={cls("btn btn-ghost", busy && "busy")}>
          📸 תמונה
          <input ref={fileRef} type="file" accept="image/*" hidden disabled={busy} onChange={(e) => onPhoto(e.target.files?.[0])} />
        </label>
        <label className={cls("btn btn-ghost", busy && "busy")}>
          🎬 סרטון
          <input ref={videoRef} type="file" accept="video/*" hidden disabled={busy} onChange={(e) => onVideo(e.target.files?.[0])} />
        </label>
      </div>
      {progress !== null && (
        <div className="upload-progress" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
          <span>🎬 מעלה את הסרטון… {Math.round(progress * 100)}%</span>
          <i style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      )}
      <p className="muted small-note">סרטון עד חצי דקה. הוא מתנגן בטלוויזיה עם הסאונד.</p>
      {recent.length > 0 && (
        <ul className="shout-list" aria-label="מה עלה למסך לאחרונה">
          {recent.map((x) => (
            <li key={x.id}>
              <b>{x.by ? people[x.by]?.name ?? "מישהו" : "🕵️ אנונימי"}:</b> {x.video ? "🎬 " : x.photo ? "📸 " : ""}
              {x.text ?? (x.video ? "סרטון" : x.photo ? "תמונה" : "")}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function GiftShop({ game, view, me }: { game: Game; view: ClientView; me: PlayerPub }) {
  const groom = view.pub.players.find((p) => p.isGroom && p.id !== me.id);
  const [to, setTo] = useState(groom?.id ?? me.id);
  const [busy, setBusy] = useState(false);
  const target = view.pub.players.find((p) => p.id === to) ?? me;
  const free = view.me!.available;

  const buy = async (it: ShopItem) => {
    const forMe = target.id === me.id;
    const ok = await ask({
      title: `${it.emoji} ${it.name} ${forMe ? "לעצמך" : `ל${target.name}`}?`,
      body: `עולה ${it.price} שקדים. ${it.slot === "hat" ? "זה יופיע על הראש" : "זה יופיע ליד הפרצוף"} בתמונה ${forMe ? "שלך" : "שלו"} בכל המסכים, עד שמישהו יקנה משהו אחר.`,
      ok: `לקנות ב־${it.price}`,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await game.act("gift", { to: target.id, item: it.id });
      sfx.coin();
      burst("coins");
      toast(`🎁 ${it.emoji} נקנה!`, "ok");
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="shop felt">
      <h2>🎁 חנות מתנות</h2>
      <p className="muted">קונים לחבר (או לעצמך) כובע, או משהו ביד. זה מופיע על התמונה בכל המסכים.</p>
      <div className="shop-to" role="radiogroup" aria-label="למי קונים?">
        {view.pub.players.map((p) => (
          <button key={p.id} type="button" role="radio" aria-checked={to === p.id} className={cls("shop-person", to === p.id && "on")} onClick={() => setTo(p.id)}>
            <Avatar p={p} size={46} />
            <span>{p.id === me.id ? "אני" : p.name}</span>
          </button>
        ))}
      </div>
      <div className="shop-grid">
        {SHOP.map((it) => (
          <button key={it.id} type="button" className="shop-item" disabled={busy || free < it.price} onClick={() => buy(it)}>
            <span className="shop-emoji" aria-hidden="true">
              {it.emoji}
            </span>
            <span className="shop-name">{it.name}</span>
            <Money n={it.price} size={13} />
          </button>
        ))}
      </div>
    </div>
  );
}
