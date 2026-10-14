import { useEffect, useRef, useState } from "react";
import type { ClientView, PlayerPub } from "../../shared/types";
import { cls, fmt, kingAndLast, resizeImage } from "../lib";
import { creds, useGame, type Game } from "../net";
import { sfx } from "../sound";
import { Avatar, Coin, ConnBanner, Led, Marquee, MuteButton, Sheet, ask, toast } from "../ui";
import { BetTab } from "./BetTab";
import { BoardTab } from "./BoardTab";
import { JoinScreen } from "./Join";
import { MissionsTab } from "./MissionsTab";
import { FeedWatcher, MissionWatcher, ResultOverlay } from "./Overlays";

type Tab = "bet" | "missions" | "board";

export function PlayerApp() {
  const { game, view, status } = useGame("player");
  const [tab, setTab] = useState<Tab>("bet");

  // The host released this name (or reset the game): forget the stale token.
  useEffect(() => {
    if (view && !view.me && creds.token && status === "online") creds.token = null;
  }, [view, status]);

  // A freshly opened challenge pulls everyone to the betting tab.
  const round = view?.pub.round;
  const openKey = round && round.status === "open" ? `${round.id}:${round.openedAt}` : null;
  const lastOpen = useRef(openKey);
  useEffect(() => {
    if (openKey && openKey !== lastOpen.current) {
      setTab("bet");
      sfx.open();
      navigator.vibrate?.([30, 40, 30]);
    }
    lastOpen.current = openKey;
  }, [openKey]);

  if (!view) return <Splash />;
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
    <div className="phone">
      <ConnBanner status={status} />
      <TopBar me={me} view={view} game={game} isKing={king === me.id} />
      {view.me.available < 100 && <BailoutBanner view={view} game={game} />}
      <main className="phone-main">
        {tab === "bet" && <BetTab game={game} view={view} me={me} />}
        {tab === "missions" && <MissionsTab game={game} view={view} />}
        {tab === "board" && <BoardTab view={view} meId={me.id} />}
      </main>
      <nav className="tabbar" aria-label="מסכים">
        <TabButton on={tab === "bet"} onClick={() => setTab("bet")} icon="📈" label="בורסה" dot={needsBet} />
        <TabButton on={tab === "missions"} onClick={() => setTab("missions")} icon="🤫" label="משימות" count={openMissions} />
        <TabButton on={tab === "board"} onClick={() => setTab("board")} icon="🏆" label="דירוג" />
      </nav>
      <ResultOverlay view={view} meId={me.id} />
      <MissionWatcher view={view} />
      <FeedWatcher view={view} meId={me.id} />
    </div>
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

function TopBar({ me, view, game, isKing }: { me: PlayerPub; view: ClientView; game: Game; isKing: boolean }) {
  const [profile, setProfile] = useState(false);
  return (
    <header className="topbar">
      <button type="button" className="me-btn" onClick={() => setProfile(true)} aria-label="הפרופיל שלי">
        <Avatar p={me} size={42} badge={isKing ? "👑" : null} />
        <span className="me-name">{me.name}</span>
      </button>
      <div className="meter" aria-label={`יתרה: ${me.balance} ${view.pub.settings.currency}`}>
        <Led value={me.balance} />
        <Coin size={20} />
      </div>
      <MuteButton />
      <ProfileSheet open={profile} onClose={() => setProfile(false)} me={me} game={game} />
    </header>
  );
}

function BailoutBanner({ view, game }: { view: ClientView; game: Game }) {
  const { currency, bailoutAmount } = view.pub.settings;
  const pending = view.me!.bailout?.status === "pending";
  const [busy, setBusy] = useState(false);
  return (
    <div className="bailout" role="status">
      <span>
        {pending
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
  const fileRef = useRef<HTMLInputElement>(null);

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
      title: "להחליף שם?",
      body: "המכשיר יתנתק מהשם הזה ותחזרו למסך בחירת השם. היתרה והמשימות נשמרות.",
      ok: "החלפת שם",
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
        <button type="button" className="btn btn-ghost" onClick={leave}>
          זה לא אני. החלפת שם
        </button>
      </div>
    </Sheet>
  );
}

export function Splash() {
  return (
    <div className="splash">
      <Marquee size="m" />
      <p className="splash-text">מחברים אתכם לבורסה…</p>
    </div>
  );
}
