import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DrawState, FeedEvent, PlayerPub } from "../../shared/types";
import { cls, photoOf } from "../lib";
import { prefetchLine, sfx, speak } from "../sound";
import { Money, burst } from "../ui";

/* The TV's big moments: AI pictures of the guys, full screen, with a line the announcer reads out. */

export type SpotKind = "fast" | "win" | "lose" | "shot" | "slow" | "mission" | "broke" | "champ";

const AI: Record<SpotKind, (id: string) => string> = {
  fast: (id) => `/photos/ai/fast/${id}.jpg`,
  win: (id) => `/photos/ai/king/${id}.jpg`,
  mission: (id) => `/photos/ai/king/${id}.jpg`,
  shot: (id) => `/photos/shot/${id}.jpg`,
  lose: (id) => `/photos/ai/broke/${id}.jpg`,
  slow: (id) => `/photos/ai/slow/${id}.jpg`,
  broke: (id) => `/photos/ai/broke/${id}.jpg`,
  champ: (id) => `/photos/ai/champ/champ/${id}.jpg`,
};

/** Drinking tasks get the shot picture, anything else the crying-in-the-rain one. */
export const loseKind = (task: string | null): SpotKind => (task && /שוט|לגימה|בירה|שותים/.test(task) ? "shot" : "lose");

/** A full-screen sequence (round results, a flash) holds back the news queue until it is done. */
export const tvBusy = { until: 0 };
export const holdTv = (ms: number) => {
  tvBusy.until = Math.max(tvBusy.until, Date.now() + ms);
};

function AiImg({ kind, p, className, first }: { kind: SpotKind; p: PlayerPub; className?: string; first?: string }) {
  const chain = [...(first ? [first] : []), AI[kind](p.id), `/photos/ai/king/${p.id}.jpg`, `/photos/funny/${p.id}.jpg`, photoOf(p)];
  const [i, setI] = useState(0);
  return i < chain.length ? <img className={className} src={chain[i]} alt="" draggable={false} onError={() => setI((x) => x + 1)} /> : null;
}

export function Spotlight({
  kind,
  title,
  people,
  line,
  sub,
  task,
  amount,
  img,
}: {
  img?: (p: PlayerPub) => string;
  kind: SpotKind;
  title: string;
  people: PlayerPub[];
  line?: string;
  sub?: string;
  task?: string | null;
  amount?: number;
}) {
  const one = people.length === 1;
  const hero = one && kind === "fast";
  const size = people.length <= 2 ? 440 : people.length <= 4 ? 350 : people.length <= 6 ? 290 : 240;
  return (
    <motion.div className={cls("spot", `spot-${kind}`, hero ? "hero" : one ? "one" : "many")} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.35 }}>
      {hero && (
        <div className="spot-bleed">
          <AiImg kind={kind} p={people[0]} className="spot-kenburns" first={img?.(people[0])} />
        </div>
      )}
      {one && !hero && (
        <>
          <div className="spot-blur" aria-hidden="true">
            <AiImg kind={kind} p={people[0]} first={img?.(people[0])} />
          </div>
          <motion.div className="spot-frame" initial={{ scale: 0.6, rotate: -6, opacity: 0 }} animate={{ scale: 1, rotate: -2, opacity: 1 }} transition={{ type: "spring", stiffness: 160, damping: 14 }}>
            <AiImg kind={kind} p={people[0]} className="spot-kenburns" first={img?.(people[0])} />
          </motion.div>
        </>
      )}
      <div className="spot-text">
        <motion.div className="spot-title" initial={{ scale: 2.4, rotate: -8, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }} transition={{ type: "spring", stiffness: 260, damping: 13, delay: 0.15 }}>
          {title}
        </motion.div>
        {one && <div className="spot-name">{people[0].name}</div>}
        {!one && (
          <div className="spot-cards">
            {people.map((p, i) => (
              <motion.div key={p.id} className="spot-card" style={{ width: size }} initial={{ y: 90, opacity: 0, rotate: i % 2 ? 6 : -6 }} animate={{ y: 0, opacity: 1, rotate: i % 2 ? 2 : -2 }} transition={{ delay: 0.35 + i * 0.12, type: "spring", stiffness: 180, damping: 15 }}>
                <AiImg kind={kind} p={p} first={img?.(p)} />
                <b>{p.name}</b>
              </motion.div>
            ))}
          </div>
        )}
        {amount ? (
          <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.6, type: "spring", stiffness: 260, damping: 12 }}>
            <Money n={amount} sign size={64} className="spot-amount" />
          </motion.div>
        ) : null}
        {line && (
          <motion.p className="spot-line" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.8 }}>
            {line}
          </motion.p>
        )}
        {sub && (
          <motion.p className="spot-sub" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.1 }}>
            {sub}
          </motion.p>
        )}
        {task && (
          <motion.div className="spot-task" initial={{ scale: 0.3, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 1.4, type: "spring", stiffness: 220, damping: 12 }}>
            <span>המשימה</span>
            <b>{task}</b>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}

/* ---------- גלגל הבלגן: the host spins, the wheel lands on a challenge, a question or a surprise ---------- */

export const DRAW_MS = 8000;
const SPIN = 6200;
const SURPRISE_MS = 9000;

const WHEEL = [
  ["#E9B949", "#1C1206"],
  ["#11523C", "#F3E3C3"],
  ["#F3E3C3", "#1C1206"],
  ["#0B3B2B", "#FFE39A"],
];

/** Short enough to read on a segment: the emoji and the first words. */
const segLabel = (t: string) => {
  const words = t.replace(/[?!.]+$/, "").split(" ");
  let out = "";
  for (const w of words) {
    if ((out + " " + w).trim().length > 17) break;
    out = (out + " " + w).trim();
  }
  return out.length < t.length - 1 ? `${out}…` : out;
};

function slice(a0: number, a1: number, r: number) {
  const p = (a: number) => `${(Math.sin((a * Math.PI) / 180) * r).toFixed(2)} ${(-Math.cos((a * Math.PI) / 180) * r).toFixed(2)}`;
  return `M 0 0 L ${p(a0)} A ${r} ${r} 0 0 1 ${p(a1)} Z`;
}

/** How long the TV is taken by this spin (the wheel, and the surprise if it landed on one). */
export const spinLength = (d: DrawState) => (d.surprise ? SPIN + 1800 + SURPRISE_MS : DRAW_MS);

export function BigWheel({ draw, players, feed }: { draw: DrawState; players: PlayerPub[]; feed: FeedEvent[] }) {
  const [phase, setPhase] = useState<"spin" | "land" | "surprise">("spin");
  const n = draw.titles.length;
  const seg = 360 / n;
  // land somewhere inside the segment, not dead center (the same spot on every screen)
  const jitter = ((draw.at % 997) / 997 - 0.5) * seg * 0.55;
  const target = 360 * 7 - (draw.index * seg + seg / 2) + jitter;
  const said = feed.find((e) => e.kind === "spin" && e.at === draw.at);

  useEffect(() => {
    const timers: number[] = [];
    let t = 0;
    let gap = 38;
    while (t < SPIN - 160) {
      timers.push(window.setTimeout(() => sfx.wheelTick(), t));
      gap *= 1.07;
      t += gap;
    }
    timers.push(window.setTimeout(() => sfx.drumroll(1.1), SPIN - 1300));
    if (said) prefetchLine(`feed:${said.id}`);
    timers.push(
      window.setTimeout(() => {
        setPhase("land");
        sfx.ding();
        sfx.boing();
        burst("big");
      }, SPIN),
    );
    if (draw.surprise)
      timers.push(
        window.setTimeout(() => {
          setPhase("surprise");
          sfx.gotcha();
          if (said) speak(`feed:${said.id}`);
        }, SPIN + 1800),
      );
    holdTv(spinLength(draw));
    return () => timers.forEach((x) => window.clearTimeout(x));
  }, [draw.at]); // eslint-disable-line react-hooks/exhaustive-deps

  // who the surprise is about
  const people = (said?.players ?? []).map((id) => players.find((p) => p.id === id)).filter((p): p is PlayerPub => !!p);
  const groom = players.find((p) => p.isGroom);
  const surpriseKind: SpotKind = draw.surprise === "king" || draw.surprise === "rain" ? "win" : draw.surprise === "sing" ? "mission" : "shot";
  const surprisePeople = draw.surprise === "sing" && groom ? [groom] : people;

  return (
    <motion.div className={cls("bigwheel", phase !== "spin" && "landed")} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div className="bw-title" initial={{ y: -60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ type: "spring", stiffness: 200, damping: 16 }}>
        🎡 גלגל הבלגן
      </motion.div>
      <div className="bw-stage">
        <div className="bw-pointer" aria-hidden="true" />
        <motion.svg className="bw-wheel" viewBox="-112 -112 224 224" initial={{ rotate: 0 }} animate={{ rotate: target }} transition={{ duration: SPIN / 1000, ease: [0.12, 0.72, 0.14, 1] }}>
          <defs>
            <clipPath id="bw-hub">
              <circle r="24" />
            </clipPath>
          </defs>
          <circle r="110" fill="#4A2A12" stroke="#C9922F" strokeWidth="3" />
          {draw.titles.map((t, i) => {
            const surprise = draw.kinds?.[i] === "s";
            const [bg, fg] = surprise ? ["#8E1B22", "#FFE39A"] : WHEEL[i % WHEEL.length];
            const mid = i * seg + seg / 2;
            // readable where the wheel comes to rest: labels that would end up upside down are turned around
            const rest = (((mid + target) % 360) + 360) % 360;
            const turn = rest > 0 && rest < 180 ? 270 : 90;
            return (
              <g key={i}>
                <path d={slice(i * seg, (i + 1) * seg, 100)} fill={bg} stroke="#4A2A12" strokeWidth="0.9" />
                <g transform={`rotate(${mid})`}>
                  <text x="0" y="-63" transform={`rotate(${turn} 0 -63)`} fill={fg} fontSize={n > 10 ? 6.4 : 7.4} fontWeight="800" textAnchor="middle" dominantBaseline="middle" fontFamily="Rubik, sans-serif">
                    {segLabel(t)}
                  </text>
                </g>
              </g>
            );
          })}
          {Array.from({ length: 28 }, (_, i) => {
            const a = (i * 360) / 28;
            return <circle key={i} className={cls("bw-bulb", i % 2 === 1 && "odd")} cx={Math.sin((a * Math.PI) / 180) * 105} cy={-Math.cos((a * Math.PI) / 180) * 105} r="2.6" />;
          })}
          <circle r="27" fill="#E9B949" stroke="#4A2A12" strokeWidth="2" />
          <image href="/photos/itay-face.jpg" x="-24" y="-24" width="48" height="48" clipPath="url(#bw-hub)" preserveAspectRatio="xMidYMid slice" />
        </motion.svg>
      </div>
      <AnimatePresence>
        {phase !== "spin" && (
          <motion.div className="bw-result" initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 240, damping: 14 }}>
            <span>{draw.surprise ? "🎉 הפתעה!" : draw.kinds?.[draw.index] === "q" ? "❓ יצאה שאלה:" : "🎯 יצא אתגר:"}</span>
            <b>{draw.titles[draw.index]}</b>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {phase === "surprise" && surprisePeople.length > 0 && (
          <Spotlight key="surprise" kind={surpriseKind} title={draw.titles[draw.index]} people={surprisePeople} line={said?.data?.line} />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/* ---------- while bets are open: music, and Itay popping up from the edges ---------- */

const POPS = ["baby", "ballerina", "sumo", "mafia", "mermaid", "chain", "cat", "grill", "titanic"].map((n) => `/photos/ai/itay/${n}.jpg`);
const SLOTS = [
  { x: -46, y: 150, r: -11 },
  { x: 1666, y: 130, r: 10 },
  { x: -56, y: 520, r: 8 },
  { x: 1676, y: 500, r: -9 },
  { x: 120, y: 330, r: -4 },
  { x: 1500, y: 330, r: 5 },
];

interface Pop {
  id: number;
  src: string;
  slot: number;
}

export function BettingVibes({ active, avoidLeft }: { active: boolean; avoidLeft?: boolean }) {
  const [pops, setPops] = useState<Pop[]>([]);
  const n = useRef(0);
  const last = useRef(-1);

  useEffect(() => {
    if (!active) {
      setPops([]);
      return;
    }
    const add = () => {
      let pick = Math.floor(Math.random() * POPS.length);
      if (pick === last.current) pick = (pick + 1) % POPS.length;
      last.current = pick;
      setPops((cur) => {
        const used = new Set(cur.map((p) => p.slot));
        const free = SLOTS.map((_, i) => i).filter((i) => !used.has(i) && !(avoidLeft && SLOTS[i].x < 500));
        if (!free.length) return cur;
        const id = ++n.current;
        window.setTimeout(() => setPops((c) => c.filter((p) => p.id !== id)), 2600);
        return [...cur, { id, src: POPS[pick], slot: free[Math.floor(Math.random() * free.length)] }];
      });
      sfx.pop();
    };
    const first = window.setTimeout(add, 900);
    const every = window.setInterval(add, 2300);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(every);
    };
  }, [active, avoidLeft]);

  return (
    <div className="pops" aria-hidden="true">
      <AnimatePresence>
        {pops.map((p) => {
          const s = SLOTS[p.slot];
          return (
            <motion.img
              key={p.id}
              src={p.src}
              alt=""
              className="pop"
              style={{ left: s.x, top: s.y }}
              initial={{ scale: 0, rotate: s.r * 3, opacity: 0 }}
              animate={{ scale: 1, rotate: s.r, opacity: 1 }}
              exit={{ scale: 0, rotate: -s.r * 2, opacity: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 14 }}
            />
          );
        })}
      </AnimatePresence>
    </div>
  );
}
