import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ClientView, TvMode } from "../../shared/types";
import { cls, keepAwake } from "../lib";
import { useGame } from "../net";
import { sfx, unlockAudio } from "../sound";
import { Marquee, Ticker } from "../ui";
import { BoardScreen, Lobby, RevealScreen, RoundScreen, WinnerScreen } from "./Screens";

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
  const [armed, setArmed] = useState(false);
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

  if (!view)
    return (
      <Stage>
        <div className="tv-frame tv-center">
          <Marquee size="l" lights />
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
              {mode === "round" && <RoundScreen view={view} game={game} />}
              {mode === "board" && <BoardScreen view={view} />}
              {mode === "missions" && <RevealScreen view={view} />}
              {mode === "winner" && <WinnerScreen view={view} />}
            </motion.div>
          </AnimatePresence>
          <Ticker players={view.pub.players} start={view.pub.settings.startBalance} />
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
