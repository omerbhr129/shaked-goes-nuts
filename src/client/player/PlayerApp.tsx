import { useEffect, useRef, useState } from "react";
import type { ClientView, PlayerPub } from "../../shared/types";
import { cls, fmt, keepAwake, kingAndLast, lsGet, lsSet, resizeImage, useMedia } from "../lib";
import { creds, useGame, type Game } from "../net";
import { setMuted, sfx, useMuted } from "../sound";
import { Avatar, Coin, ConnBanner, Led, Marquee, Sheet, ask, toast } from "../ui";
import { BetTab } from "./BetTab";
import { BoardTab } from "./BoardTab";
import { FunTab } from "./FunTab";
import { JoinScreen } from "./Join";
import { MissionsTab } from "./MissionsTab";
import { RodeoPhoto, useIntro } from "../rodeo";
import { FeedWatcher, MissionWatcher, ResultOverlay } from "./Overlays";
import { NowBar, RoundPop, type Tab, useGo } from "./Now";

export function PlayerApp() {
  const { game, view, status } = useGame("player");
  const intro = useIntro();
  const [tab, setTab] = useState<Tab>("bet");
  const go = useGo(setTab);
  const [howto, setHowto] = useState(() => !lsGet(HOWTO_SEEN));
  // on a laptop / big screen everything sits side by side instead of behind tabs
  const wide = useMedia("(min-width: 1080px)");

  // The host released this name (or reset the game): forget the stale token. But a socket that said
  // hello before a join can answer "not logged in" right after it, so check with the server first.
  useEffect(() => {
    if (!view || view.me || !creds.token || status !== "online") return;
    const token = creds.token;
    let alive = true;
    fetch("/api/view", { headers: { "x-token": token }, cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((v: ClientView | null) => {
        if (!alive || !v || creds.token !== token) return;
        if (!v.me) creds.token = null;
        game.rehello();
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [view, status, game]);

  // A freshly opened challenge pulls everyone to the betting tab.
  const round = view?.pub.round;
  const openKey = round && round.status === "open" ? `${round.id}:${round.openedAt}` : null;
  const lastOpen = useRef(openKey);
  useEffect(() => {
    if (openKey && openKey !== lastOpen.current) setTab("bet");
    lastOpen.current = openKey;
  }, [openKey]);

  // while a round takes bets, the phone doesn't lock itself in the middle of it
  useEffect(() => {
    if (!openKey) return;
    let release: (() => void) | null = null;
    let gone = false;
    void keepAwake().then((r) => (gone ? r() : (release = r)));
    return () => {
      gone = true;
      release?.();
    };
  }, [openKey]);

  if (!view || intro) return <Splash />;
  if (!view.me) return <JoinScreen game={game} view={view} />;
  const me = view.pub.players.find((p) => p.id === view.me!.id);
  if (!me) return <Splash />;

  const mine = view.me.bets;
  const needsBet =
    (!!round && round.status === "open" && !mine[round.id] && !round.noBet.includes(me.id)) ||
    view.pub.night.some((r) => r.status === "open" && !mine[r.id] && !r.noBet.includes(me.id));
  const openMissions = view.me.missions.filter((m) => m.status === "open").length;
  const { king } = kingAndLast(view.pub.players);

  return (
    <div className={cls("phone", wide && "wide")}>
      <ConnBanner status={status} />
      <TopBar me={me} view={view} game={game} isKing={king === me.id} onHelp={() => setHowto(true)} />
      {view.me.available < 100 && <BailoutBanner view={view} game={game} />}
      {wide && <NowBar game={game} view={view} me={me} />}
      {wide ? (
        <main className="desk">
          <section className="desk-col" aria-label="הבורסה">
            <h2 className="desk-title">📈 הבורסה</h2>
            <BetTab game={game} view={view} me={me} />
          </section>
          <section className="desk-col" aria-label="משימות">
            <MissionsTab game={game} view={view} />
            <FunTab game={game} view={view} me={me} />
          </section>
          <section className="desk-col" aria-label="דירוג">
            <BoardTab view={view} meId={me.id} />
          </section>
        </main>
      ) : (
        <>
          <main className="phone-main">
            {tab === "bet" && <BetTab game={game} view={view} me={me} />}
            {tab === "missions" && <MissionsTab game={game} view={view} />}
            {tab === "board" && <BoardTab view={view} meId={me.id} />}
            {tab === "fun" && <FunTab game={game} view={view} me={me} />}
          </main>
          <div className="dock">
            <NowBar game={game} view={view} me={me} go={go} />
            <nav className="tabbar" aria-label="מסכים">
              <TabButton on={tab === "bet"} onClick={() => setTab("bet")} icon="📈" label="הבורסה" dot={needsBet} />
              <TabButton on={tab === "missions"} onClick={() => setTab("missions")} icon="🤫" label="משימות" count={openMissions} />
              <TabButton on={tab === "board"} onClick={() => setTab("board")} icon="🏆" label="דירוג" />
              <TabButton on={tab === "fun"} onClick={() => setTab("fun")} icon="📣" label="למסך" />
            </nav>
          </div>
        </>
      )}
      <RoundPop game={game} view={view} me={me} go={go} />
      <HowTo
        view={view}
        me={me}
        open={howto}
        onClose={() => {
          lsSet(HOWTO_SEEN, "1");
          setHowto(false);
        }}
      />
      <ResultOverlay view={view} meId={me.id} />
      <MissionWatcher view={view} />
      <FeedWatcher view={view} meId={me.id} />
    </div>
  );
}

// a new key: everyone sees the rules once more, now with votes, swaps and the golden cards
const HOWTO_SEEN = "sgn.howto2";

/** The whole game on one screen: once per device, and any time from the ❔ at the top. */
function HowTo({ view, me, open, onClose }: { view: ClientView; me: PlayerPub; open: boolean; onClose: () => void }) {
  const { startBalance, currency, prize1, prizeLast, catchWindow, nightCap } = view.pub.settings;
  return (
    <Sheet open={open} onClose={onClose} title="איך משחקים">
      <ul className="howto">
        <li>
          <b>💰 יש לך {fmt(startBalance)} {currency}.</b> מי שמסיים הכי עשיר מנצח, ובבוקר: {prize1}.
        </li>
        <li>
          <b>👇 לא בטוחים מה עושים?</b> הפס הצבעוני למטה, מעל הלשוניות, תמיד אומר מה עכשיו. לוחצים עליו, והוא לוקח לשם.
        </li>
        <li>
          <b>📈 הבורסה:</b> המנחה מסובב את גלגל הבלגן, ויוצא אתגר, שאלה או הצבעה. מהמרים, עונים או מצביעים כאן. אף אחד לא רואה מה בחרתם עד שהזמן נגמר.
        </li>
        <li>
          <b>❓ שאלות ידע:</b> צודקים מקבלים {currency}. טועים, או עונים אחרונים, שותים שוט על המסך הגדול.
        </li>
        <li>
          <b>🗳️ הצבעות:</b> ״מי הכי סביר ש...״. מי שמקבל הכי הרבה קולות שותה, ומי שהצביע כמו הרוב מרוויח.
        </li>
        <li>
          <b>🤫 משימות סודיות:</b> יש לך 3. ביצעת? ״ביצעתי״, והטלוויזיה מכריזה בלי שם. לא תפסו אותך תוך {catchWindow} שניות? מי שעבדת עליו משלם לך. משימה בלתי אפשרית? מחליפים ב־50.
        </li>
        <li>
          <b>🕵️ תפסתי!</b> ראיתם מישהו עושה משימה? בלשונית משימות: ״תפסתי מישהו״. צדקתם? גונבים לו את השקדים.
        </li>
        <li>
          <b>🌙 הימורי לילה:</b> פתוחים כל הלילה, למטה בבורסה. עד {fmt(nightCap)} ביחד, כדי שיישאר לאתגרים.
        </li>
        <li>
          <b>📣 למסך:</b> אימוג׳ים, הודעות (גם בעילום שם) ותמונות קופצים בטלוויזיה. ובחנות: כובעים ושטויות לתמונה של החברים.
        </li>
        {me.isGroom && (
          <li>
            <b>🃏 רק לך, החתן:</b> 3 קלפי זהב בבורסה: וטו, הכפלה ו״אתה שותה!״. כל אחד עובד פעם אחת בלילה.
          </li>
        )}
        <li>
          <b>✏️ השם והתמונה שלך:</b> לוחצים על התמונה שלך למעלה.
        </li>
        <li>
          <b>📲 כמו אפליקציה:</b> שיתוף ← ״הוספה למסך הבית״, והמשחק נפתח על כל המסך, בלי שורת הכתובת.
        </li>
        <li>
          <b>🍋 המקום האחרון בבוקר:</b> {prizeLast}.
        </li>
      </ul>
      <div className="sheet-cta">
        <button type="button" className="btn btn-gold btn-xl" onClick={onClose}>
          יאללה, מתחילים
        </button>
      </div>
    </Sheet>
  );
}

function TabButton({ on, onClick, icon, label, dot, count }: { on: boolean; onClick: () => void; icon: string; label: string; dot?: boolean; count?: number }) {
  return (
    <button type="button" className={cls("tab", on && "on")} onClick={onClick} aria-current={on ? "page" : undefined}>
      <span className="tab-icon" aria-hidden="true">
        {icon}
        {dot && <span className="tab-dot" />}
        {!!count && <span className="tab-count">{count}</span>}
      </span>
      <span className="tab-label">{label}</span>
    </button>
  );
}

function TopBar({ me, view, game, isKing, onHelp }: { me: PlayerPub; view: ClientView; game: Game; isKing: boolean; onHelp: () => void }) {
  const [profile, setProfile] = useState(false);
  return (
    <header className="topbar">
      <button type="button" className="me-btn" onClick={() => setProfile(true)} aria-label="הפרופיל שלי">
        <Avatar p={me} size={42} badge={isKing ? "👑" : null} />
        <span className="me-name">{me.name}</span>
      </button>
      <div className="meter" aria-label={`יתרה: ${me.balance} ${view.pub.settings.currency}`}>
        <span className="meter-label">השקדים שלי</span>
        <Led value={me.balance} />
        <Coin size={20} />
      </div>
      <button type="button" className="icon-btn" onClick={onHelp} aria-label="איך משחקים">
        ❔
      </button>
      <ProfileSheet open={profile} onClose={() => setProfile(false)} me={me} game={game} />
    </header>
  );
}

function BailoutBanner({ view, game }: { view: ClientView; game: Game }) {
  const { currency, bailoutAmount } = view.pub.settings;
  const bail = view.me!.bailout;
  const pending = bail?.status === "pending";
  const [busy, setBusy] = useState(false);
  return (
    <div className="bailout" role="status">
      <span>
        {pending && bail?.dare
          ? `💸 פשטת רגל! המשימה שלך: ${bail.dare}. אחרי שתבצע, המנחה יאשר לך חילוץ של ${fmt(bailoutAmount)}.`
          : pending
            ? "🆘 בקשת החילוץ אצל המנחה. תתכוננו לעונש קטן…"
            : `🆘 נגמרו ה${currency}? אפשר לבקש חילוץ ממשלתי של ${fmt(bailoutAmount)}, בתמורה לעונש קטן.`}
      </span>
      {!pending && (
        <button
          type="button"
          className="btn btn-gold btn-s"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await game.act("requestBailout");
              toast("הבקשה נשלחה למנחה", "ok");
            } catch (e) {
              toast((e as Error).message, "err");
            } finally {
              setBusy(false);
            }
          }}
        >
          בקשת חילוץ
        </button>
      )}
    </div>
  );
}

function ProfileSheet({ open, onClose, me, game }: { open: boolean; onClose: () => void; me: PlayerPub; game: Game }) {
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(me.name);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) setName(me.name);
  }, [open, me.name]);

  const rename = async () => {
    setBusy(true);
    try {
      await game.act("rename", { name });
      toast("✏️ השם עודכן בכל המסכים", "ok");
      onClose();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    try {
      const url = await game.upload(await resizeImage(file, 640));
      await game.act("setPhoto", { photo: url });
      toast("התמונה עודכנה", "ok");
      onClose();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const leave = async () => {
    const ok = await ask({
      title: "להתנתק מהשם הזה?",
      body: "המכשיר יתנתק ותחזרו לרשימת השמות. היתרה והמשימות נשמרות למי שיתחבר לשם הזה.",
      ok: "התנתקות",
    });
    if (!ok) return;
    try {
      await game.act("leave");
      creds.token = null;
      game.rehello();
      onClose();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={me.name}>
      <div className="profile">
        <Avatar p={me} size={120} />
        <label className={cls("btn btn-gold", busy && "busy")}>
          {busy ? "מעלה…" : "📸 החלפת תמונה"}
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
        <form
          className="rename"
          onSubmit={(e) => {
            e.preventDefault();
            void rename();
          }}
        >
          <label className="field">
            <span>✏️ איך לקרוא לך?</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={16} enterKeyHint="done" autoComplete="off" />
          </label>
          <button type="submit" className="btn btn-ghost" disabled={busy || name.trim().length < 2 || name.trim() === me.name}>
            שמירת השם
          </button>
        </form>
        <SoundToggle />
        <button type="button" className="link-btn" onClick={leave}>
          זה לא הטלפון שלי? התנתקות
        </button>
      </div>
    </Sheet>
  );
}

function SoundToggle() {
  const muted = useMuted();
  return (
    <button
      type="button"
      className="btn btn-ghost"
      aria-pressed={muted}
      onClick={() => {
        setMuted(!muted);
        if (muted) sfx.tap();
      }}
    >
      {muted ? "🔇 הצלילים בטלפון כבויים. להדליק" : "🔊 הצלילים בטלפון פועלים. להשתיק"}
    </button>
  );
}

export function Splash() {
  return (
    <div className="splash">
      <Marquee size="m" />
      <RodeoPhoto size={300} />
    </div>
  );
}
