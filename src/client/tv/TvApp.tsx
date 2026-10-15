import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ClientView, FeedEvent, PlayerPub, TvMode, WheelSpin } from "../../shared/types";
import { cls, keepAwake } from "../lib";
import { RodeoPhoto, useIntro } from "../rodeo";
import { type Game, useGame, useServerNow } from "../net";
import { prefetchLine, sfx, silence, speak, unlockAudio } from "../sound";
import { Avatar, Marquee, Ticker, burst } from "../ui";
import { BettingVibes, DRAW_MS, DrawReel, Spotlight, holdTv, tvBusy } from "./Moments";
import { AwardsScreen, BoardScreen, Lobby, NightScreen, QuizScreen, RevealScreen, RoundScreen, WinnerScreen } from "./Screens";

// the host screen embeds a silent copy of the TV as a preview
const PREVIEW = new URLSearchParams(location.search).has("preview");
if (PREVIEW) silence();

function effectiveMode(view: ClientView): TvMode {
  const m = view.pub.tv.mode;
  if (m === "round" && !view.pub.round) return "board";
  return m;
}

/** A fixed 1920×1080 stage scaled to whatever screen the TV is. */
function Stage({ children }: { children: ReactNode }) {
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const fit = () => setScale(Math.min(window.innerWidth / 1920, window.innerHeight / 1080));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  return (
    <div className="tv-viewport">
      <div className="tv-stage" style={{ transform: `translate(-50%, -50%) scale(${scale})` }}>
        {children}
      </div>
    </div>
  );
}

export function TvApp() {
  const { game, view, status } = useGame("tv");
  const intro = useIntro(PREVIEW ? 0 : 3200);
  const [armed, setArmed] = useState(PREVIEW);
  useTvSounds(view);

  const arm = async () => {
    unlockAudio();
    sfx.join();
    try {
      await document.documentElement.requestFullscreen?.();
    } catch {
      /* fullscreen not allowed here */
    }
    void keepAwake();
    setArmed(true);
  };

  if (!view || (intro && !PREVIEW))
    return (
      <Stage>
        <div className="tv-frame tv-center">
          <div className="tv-intro">
            <Marquee size="m" lights />
            <RodeoPhoto size={640} />
          </div>
        </div>
      </Stage>
    );

  const mode = effectiveMode(view);
  const sceneKey = mode === "round" ? `round:${view.pub.round?.id}` : mode;
  return (
    <>
      <Stage>
        <div className="tv-frame">
          <AnimatePresence mode="wait">
            <motion.div
              key={sceneKey}
              className="tv-scene"
              initial={{ opacity: 0, scale: 0.985 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.01 }}
              transition={{ duration: 0.45 }}
            >
              {mode === "lobby" && <Lobby view={view} />}
              {mode === "round" && (view.pub.round?.kind === "quiz" ? <QuizScreen view={view} game={game} /> : <RoundScreen view={view} game={game} />)}
              {mode === "board" && <BoardScreen view={view} />}
              {mode === "night" && <NightScreen view={view} />}
              {mode === "missions" && <RevealScreen view={view} />}
              {mode === "awards" && <AwardsScreen view={view} />}
              {mode === "winner" && <WinnerScreen view={view} />}
            </motion.div>
          </AnimatePresence>
          <Ticker players={view.pub.players} start={view.pub.settings.startBalance} />
          <RoundExtras view={view} game={game} />
          <NewsBanner feed={view.pub.feed} players={view.pub.players} skipShots={mode === "round"} />
          <WheelOverlay wheel={view.pub.wheel} players={view.pub.players} offset={game.offset} feed={view.pub.feed} />
          <span className={cls("tv-conn", status)} aria-hidden="true" />
        </div>
      </Stage>
      {!armed && (
        <button type="button" className="tv-arm" onClick={arm}>
          🔊 לחצו כאן להפעלת סאונד ומסך מלא
        </button>
      )}
    </>
  );
}

/** Sounds that belong to the room, not to one phone: joins, bets landing, the gavel. */
function useTvSounds(view: ClientView | null) {
  const prev = useRef<{ claimed: number; roundKey: string | null; status: string | null; bettors: number } | null>(null);
  useEffect(() => {
    if (!view) return;
    const r = view.pub.round;
    const cur = {
      claimed: view.pub.players.filter((p) => p.claimed).length,
      roundKey: r ? `${r.id}:${r.openedAt}` : null,
      status: r?.status ?? null,
      bettors: r?.bettors.length ?? 0,
    };
    const p = prev.current;
    prev.current = cur;
    if (!p) return;
    if (cur.claimed > p.claimed) sfx.join();
    if (r && cur.status === "open" && (cur.roundKey !== p.roundKey || p.status !== "open")) sfx.open();
    else if (r && cur.roundKey === p.roundKey && cur.status === "open" && cur.bettors > p.bettors) sfx.chip();
    if (r && cur.roundKey === p.roundKey && p.status === "open" && cur.status === "closed") sfx.close();
  }, [view]);
}

/** While a round is live: the draw reel when it was picked at random, then music and Itay popping up until bets close. */
function RoundExtras({ view, game }: { view: ClientView; game: Game }) {
  const r = view.pub.round;
  const draw = view.pub.draw;
  const live = !!r && r.status === "open";
  const now = useServerNow(game, live, 250);
  const drawing = live && !!draw && draw.roundId === r!.id && now < draw.at + DRAW_MS;
  const betting = live && !drawing && view.pub.tv.mode === "round" && (r!.closesAt === null || now < r!.closesAt);
  return (
    <>
      <BettingVibes active={betting} />
      <AnimatePresence>{drawing && draw && <DrawReel key={draw.at} draw={draw} />}</AnimatePresence>
    </>
  );
}

const NEWS_TAG: Record<string, string> = { mission: "מבזק", caught: "נתפס!", miss: "פספוס", bailout: "חילוץ", result: "הוכרע", shot: "שוט!", broke: "פשט רגל" };
const BIG = new Set(["mission", "broke"]);

/** Breaking news: a strip for small things, the whole screen for a finished mission or someone going broke. */
function NewsBanner({ feed, players, skipShots }: { feed: FeedEvent[]; players: PlayerPub[]; skipShots: boolean }) {
  const [queue, setQueue] = useState<FeedEvent[]>([]);
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!seen.current) {
      seen.current = new Set(feed.map((e) => e.id));
      return;
    }
    // the wheel and the quiz screen show their own big moments
    const fresh = feed.filter((e) => !seen.current!.has(e.id) && e.kind !== "wheel" && !(skipShots && e.kind === "shot"));
    for (const e of feed) seen.current.add(e.id);
    if (fresh.length) setQueue((q) => [...q, ...fresh]);
  }, [feed]);

  // wait while a round's own moments are playing, then show it and read it out
  const next = queue[0];
  const [ready, setReady] = useState<string | null>(null);
  useEffect(() => {
    if (!next) return;
    prefetchLine(`feed:${next.id}`);
    const t = window.setTimeout(() => setReady(next.id), Math.max(0, tvBusy.until - Date.now()));
    return () => window.clearTimeout(t);
  }, [next?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const current = next && ready === next.id ? next : undefined;

  useEffect(() => {
    if (!current) return;
    const big = BIG.has(current.kind);
    if (current.kind === "mission") {
      sfx.siren();
      sfx.boom();
    } else if (current.kind === "broke") sfx.sad();
    else if (current.kind === "caught") sfx.gotcha();
    else if (current.kind === "miss") sfx.lose();
    else sfx.coin();
    speak(`feed:${current.id}`);
    const ms = current.kind === "broke" ? 10_000 : big ? 8500 : 7500;
    if (big) holdTv(ms);
    const id = window.setTimeout(() => setQueue((q) => q.slice(1)), ms);
    return () => window.clearTimeout(id);
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const people = current ? current.players.map((id) => players.find((p) => p.id === id)).filter((p): p is PlayerPub => !!p) : [];
  if (current && BIG.has(current.kind) && people.length)
    return (
      <AnimatePresence>
        <Spotlight
          key={current.id}
          kind={current.kind === "broke" ? "broke" : "mission"}
          title={current.kind === "broke" ? "💸 פשט רגל!" : "🚨 מבזק!"}
          people={people.slice(0, 1)}
          line={current.data?.line ?? current.text}
          sub={current.kind === "mission" ? "מה הוא עשה? מי שמנחש נכון בטלפון, גונב לו את השקדים 🕵️" : "אחרי שהוא מבצע, המנחה מאשר לו חילוץ מהבנק"}
          task={current.data?.task}
          amount={current.data?.amount}
        />
      </AnimatePresence>
    );
  return (
    <AnimatePresence>
      {current && (
        <motion.div
          key={current.id}
          className={cls("news", current.kind)}
          initial={{ y: -160 }}
          animate={{ y: 0 }}
          exit={{ y: -160 }}
          transition={{ type: "spring", stiffness: 220, damping: 24 }}
        >
          <span className="news-tag">{NEWS_TAG[current.kind] ?? "עדכון"}</span>
          <span className="news-text">{current.text}</span>
          {people.length > 0 && people.length <= 4 && (
            <span className="news-faces">
              {people.map((p) => (
                <Avatar key={p.id} p={p} size={72} />
              ))}
            </span>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const WHEEL_COLORS = [
  ["#E9B949", "#1C1206"],
  ["#11523C", "#F3E3C3"],
  ["#8E1B22", "#F3E3C3"],
  ["#F3E3C3", "#1C1206"],
];

function arc(a0: number, a1: number, r: number) {
  const p = (a: number) => `${(Math.sin((a * Math.PI) / 180) * r).toFixed(2)} ${(-Math.cos((a * Math.PI) / 180) * r).toFixed(2)}`;
  return `M 0 0 L ${p(a0)} A ${r} ${r} 0 0 1 ${p(a1)} Z`;
}

const short = (label: string) => {
  const words = label.split(" ");
  return words.length > 4 ? `${words.slice(0, 4).join(" ")}…` : label;
};

/** The drinking / punishment wheel: spins on every new spin the host triggers, then shows who it landed on. */
function WheelOverlay({ wheel, players, offset, feed }: { wheel: WheelSpin | null; players: PlayerPub[]; offset: number; feed: FeedEvent[] }) {
  const [phase, setPhase] = useState<"spin" | "done" | null>(null);
  const shown = useRef<string | null>(wheel?.id ?? null);

  useEffect(() => {
    if (!wheel || wheel.id === shown.current) return;
    shown.current = wheel.id;
    if (Date.now() + offset - wheel.at > 20_000) return;
    setPhase("spin");
    const timers: number[] = [];
    let t = 0;
    let gap = 55;
    while (t < 5200) {
      timers.push(window.setTimeout(() => sfx.wheelTick(), t));
      gap *= 1.07;
      t += gap;
    }
    const said = feed.find((e) => e.kind === "wheel" && e.ref === wheel.id);
    if (said) prefetchLine(`feed:${said.id}`);
    timers.push(
      window.setTimeout(() => {
        setPhase("done");
        sfx.ding();
        burst("win");
        if (said) speak(`feed:${said.id}`);
      }, 5400),
    );
    timers.push(window.setTimeout(() => setPhase(null), 16_000));
    return () => timers.forEach((x) => window.clearTimeout(x));
  }, [wheel?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!phase || !wheel) return null;
  const n = wheel.segments.length;
  const seg = 360 / n;
  const target = 360 * 6 - (wheel.index * seg + seg / 2);
  const who = wheel.players.map((id) => players.find((p) => p.id === id)).filter((p): p is PlayerPub => !!p);

  return (
    <motion.div className="wheel-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div className="wheel-title">{wheel.kind === "punish" ? "🍋 גלגל העונשים" : "🎡 גלגל השתייה"}</div>
      <div className="wheel-wrap">
        <div className="wheel-pointer" aria-hidden="true" />
        <motion.svg className="wheel" viewBox="-104 -104 208 208" initial={{ rotate: 0 }} animate={{ rotate: target }} transition={{ duration: 5.2, ease: [0.1, 0.75, 0.15, 1] }}>
          <circle r="103" fill="#4A2A12" stroke="#C9922F" strokeWidth="3" />
          {wheel.segments.map((label, i) => {
            const [bg, fg] = WHEEL_COLORS[i % WHEEL_COLORS.length];
            const mid = i * seg + seg / 2;
            return (
              <g key={i}>
                <path d={arc(i * seg, (i + 1) * seg, 98)} fill={bg} stroke="#4A2A12" strokeWidth="0.8" />
                <g transform={`rotate(${mid})`}>
                  <text x="0" y="-56" transform="rotate(90 0 -56)" fill={fg} fontSize={n > 8 ? 6.2 : 7.2} fontWeight="800" textAnchor="middle" dominantBaseline="middle" fontFamily="Rubik, sans-serif">
                    {short(label)}
                  </text>
                </g>
              </g>
            );
          })}
          <circle r="14" fill="#E9B949" stroke="#4A2A12" strokeWidth="2" />
          <text y="1" fontSize="13" textAnchor="middle" dominantBaseline="middle">
            🥜
          </text>
        </motion.svg>
      </div>
      <AnimatePresence>
        {phase === "done" && (
          <motion.div className="wheel-result" initial={{ y: 60, opacity: 0, scale: 0.9 }} animate={{ y: 0, opacity: 1, scale: 1 }} transition={{ type: "spring", stiffness: 200, damping: 16 }}>
            <div className="wheel-label">{wheel.label}</div>
            {who.length > 0 && who.length < players.length && (
              <div className="wheel-who">
                {who.map((p) => (
                  <span key={p.id} className="wheel-person">
                    <Avatar p={p} size={110} />
                    <b>{p.name}</b>
                  </span>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
