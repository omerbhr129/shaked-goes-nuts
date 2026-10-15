import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DrawState, PlayerPub } from "../../shared/types";
import { cls, photoOf } from "../lib";
import { sfx, startMusic, stopMusic } from "../sound";
import { Money } from "../ui";

/* The TV's big moments: AI pictures of the guys, full screen, with a line the announcer reads out. */

export type SpotKind = "fast" | "win" | "lose" | "shot" | "slow" | "mission" | "broke";

const AI: Record<SpotKind, (id: string) => string> = {
  fast: (id) => `/photos/ai/fast/${id}.jpg`,
  win: (id) => `/photos/ai/king/${id}.jpg`,
  mission: (id) => `/photos/ai/king/${id}.jpg`,
  shot: (id) => `/photos/shot/${id}.jpg`,
  lose: (id) => `/photos/ai/broke/${id}.jpg`,
  slow: (id) => `/photos/ai/slow/${id}.jpg`,
  broke: (id) => `/photos/ai/broke/${id}.jpg`,
};

/** Drinking tasks get the shot picture, anything else the crying-in-the-rain one. */
export const loseKind = (task: string | null): SpotKind => (task && /שוט|לגימה|בירה|שותים/.test(task) ? "shot" : "lose");

/** A full-screen sequence (round results, a flash) holds back the news queue until it is done. */
export const tvBusy = { until: 0 };
export const holdTv = (ms: number) => {
  tvBusy.until = Math.max(tvBusy.until, Date.now() + ms);
};

function AiImg({ kind, p, className }: { kind: SpotKind; p: PlayerPub; className?: string }) {
  const chain = [AI[kind](p.id), `/photos/funny/${p.id}.jpg`, photoOf(p)];
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
}: {
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
          <AiImg kind={kind} p={people[0]} className="spot-kenburns" />
        </div>
      )}
      {one && !hero && (
        <>
          <div className="spot-blur" aria-hidden="true">
            <AiImg kind={kind} p={people[0]} />
          </div>
          <motion.div className="spot-frame" initial={{ scale: 0.6, rotate: -6, opacity: 0 }} animate={{ scale: 1, rotate: -2, opacity: 1 }} transition={{ type: "spring", stiffness: 160, damping: 14 }}>
            <AiImg kind={kind} p={people[0]} className="spot-kenburns" />
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
                <AiImg kind={kind} p={p} />
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

/* ---------- the random draw: a slot reel of titles that lands on the chosen round ---------- */

export const DRAW_MS = 3500;
const ITEM = 150;

export function DrawReel({ draw }: { draw: DrawState }) {
  const strip = useMemo(() => {
    const others = draw.titles.slice(0, -1);
    return [...others, ...others, ...others, draw.titles[draw.titles.length - 1]];
  }, [draw.at]); // eslint-disable-line react-hooks/exhaustive-deps
  const [landed, setLanded] = useState(false);
  useEffect(() => {
    const timers: number[] = [];
    let t = 0;
    let gap = 45;
    while (t < 2700) {
      timers.push(window.setTimeout(() => sfx.wheelTick(), t));
      gap *= 1.09;
      t += gap;
    }
    timers.push(
      window.setTimeout(() => {
        setLanded(true);
        sfx.ding();
        sfx.boing();
      }, 2850),
    );
    return () => timers.forEach((x) => window.clearTimeout(x));
  }, [draw.at]);
  return (
    <motion.div className="reel-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="reel-title">🎰 מגרילים את הסיבוב הבא…</div>
      <div className="reel-window">
        <motion.div className="reel-strip" initial={{ y: ITEM }} animate={{ y: ITEM - (strip.length - 1) * ITEM }} transition={{ duration: 2.8, ease: [0.15, 0.55, 0.12, 1] }}>
          {strip.map((t, i) => (
            <div key={i} className={cls("reel-item", landed && i === strip.length - 1 && "landed")} style={{ height: ITEM }}>
              {t}
            </div>
          ))}
        </motion.div>
      </div>
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

export function BettingVibes({ active }: { active: boolean }) {
  const [pops, setPops] = useState<Pop[]>([]);
  const n = useRef(0);
  const last = useRef(-1);

  useEffect(() => {
    if (!active) {
      stopMusic();
      setPops([]);
      return;
    }
    startMusic();
    const add = () => {
      let pick = Math.floor(Math.random() * POPS.length);
      if (pick === last.current) pick = (pick + 1) % POPS.length;
      last.current = pick;
      setPops((cur) => {
        const used = new Set(cur.map((p) => p.slot));
        const free = SLOTS.map((_, i) => i).filter((i) => !used.has(i));
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
      stopMusic();
    };
  }, [active]);

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
