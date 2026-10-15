import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { ClientView, FeedEvent, PlayerPub, ShoutPub } from "../../shared/types";
import { mmss } from "../lib";
import { type Game, useServerNow } from "../net";
import { type Theme, sfx, speak, startMusic, stopMusic } from "../sound";
import { Avatar } from "../ui";
import { DRAW_MS } from "./Moments";

/* What the room throws at the TV, live: emojis, messages, photos. Plus the music under it all. */

interface Floater {
  id: number;
  e: string;
  x: number;
  drift: number;
}

/** Emojis from the phones float up from the bottom, like reactions on a live stream. */
export function FxLayer({ game }: { game: Game }) {
  const [items, setItems] = useState<Floater[]>([]);
  const n = useRef(0);
  useEffect(
    () =>
      game.onFx((fx) => {
        if (fx.kind !== "emoji") return;
        const id = ++n.current;
        setItems((cur) => [...cur.slice(-40), { id, e: fx.e, x: 60 + Math.random() * 1800, drift: (Math.random() - 0.5) * 240 }]);
        window.setTimeout(() => setItems((cur) => cur.filter((f) => f.id !== id)), 3600);
      }),
    [game],
  );
  return (
    <div className="fx-layer" aria-hidden="true">
      {items.map((f) => (
        <motion.span
          key={f.id}
          className="fx-emoji"
          style={{ left: f.x }}
          initial={{ y: 0, x: 0, scale: 0.4, opacity: 0 }}
          animate={{ y: -820, x: f.drift, scale: [0.4, 1.3, 1], opacity: [0, 1, 1, 0] }}
          transition={{ duration: 3.4, ease: "easeOut" }}
        >
          {f.e}
        </motion.span>
      ))}
    </div>
  );
}

/** Messages pop up as bubbles; a photo from someone's gallery takes the middle of the screen for a moment. */
export function ShoutsLayer({ shouts, players, feed }: { shouts: ShoutPub[]; players: PlayerPub[]; feed: FeedEvent[] }) {
  const seen = useRef<Set<string> | null>(null);
  const [bubbles, setBubbles] = useState<ShoutPub[]>([]);
  const [photos, setPhotos] = useState<ShoutPub[]>([]);

  // a gift is a bubble too: from the buyer, with the line
  const seenGifts = useRef<Set<string> | null>(null);
  useEffect(() => {
    const gifts = feed.filter((e) => e.kind === "gift");
    if (!seenGifts.current) {
      seenGifts.current = new Set(gifts.map((e) => e.id));
      return;
    }
    for (const e of gifts) {
      if (seenGifts.current.has(e.id)) continue;
      seenGifts.current.add(e.id);
      const b: ShoutPub = { id: e.id, at: e.at, by: e.players[0] ?? null, text: e.text.replace(/^🎁\s*/, "🎁 "), photo: null };
      setBubbles((q) => [...q.slice(-2), b]);
      sfx.coin();
      speak(`feed:${e.id}`);
      window.setTimeout(() => setBubbles((q) => q.filter((x) => x.id !== b.id)), 8000);
    }
  }, [feed]);
  useEffect(() => {
    if (!seen.current) {
      seen.current = new Set(shouts.map((s) => s.id));
      return;
    }
    const fresh = shouts.filter((s) => !seen.current!.has(s.id));
    for (const s of shouts) seen.current.add(s.id);
    for (const s of fresh) {
      if (s.photo) {
        setPhotos((q) => [...q, s]);
        sfx.whoosh();
      } else {
        setBubbles((q) => [...q.slice(-2), s]);
        sfx.pop();
        window.setTimeout(() => setBubbles((q) => q.filter((x) => x.id !== s.id)), 9000);
      }
    }
  }, [shouts]);
  const photo = photos[0];
  useEffect(() => {
    if (!photo) return;
    const id = window.setTimeout(() => setPhotos((q) => q.slice(1)), 7000);
    return () => window.clearTimeout(id);
  }, [photo?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const who = (s: ShoutPub) => (s.by ? players.find((p) => p.id === s.by) : undefined);
  return (
    <>
      <div className="shouts" aria-live="polite">
        <AnimatePresence>
          {bubbles.map((s) => {
            const p = who(s);
            return (
              <motion.div key={s.id} className="shout" layout initial={{ x: -400, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -400, opacity: 0 }} transition={{ type: "spring", stiffness: 220, damping: 22 }}>
                {p ? <Avatar p={p} size={64} /> : <span className="shout-anon">🕵️</span>}
                <div>
                  <b>{p ? p.name : "אנונימי"}</b>
                  <p>{s.text}</p>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
      <AnimatePresence>
        {photo && (
          <motion.figure key={photo.id} className="shout-photo" initial={{ scale: 0.3, rotate: -14, opacity: 0 }} animate={{ scale: 1, rotate: -3, opacity: 1 }} exit={{ scale: 0.6, rotate: 10, opacity: 0 }} transition={{ type: "spring", stiffness: 200, damping: 16 }}>
            <img src={photo.photo!} alt="" />
            <figcaption>
              📸 {who(photo)?.name ?? "אנונימי"}
              {photo.text && <span> · {photo.text}</span>}
            </figcaption>
          </motion.figure>
        )}
      </AnimatePresence>
    </>
  );
}

/** While a finished mission can still be caught, a clock ticks in the corner. */
export function CatchClock({ feed, game }: { feed: FeedEvent[]; game: Game }) {
  const now = useServerNow(game, true, 500);
  const closed = new Set(feed.filter((e) => e.kind === "reveal" || e.kind === "caught").map((e) => e.data?.mission ?? e.ref));
  const live = feed.filter((e) => e.kind === "mission" && e.data?.until && e.data.until > now && !closed.has(e.ref)).sort((a, b) => a.data!.until! - b.data!.until!);
  if (!live.length) return null;
  return (
    <motion.div className="catch-clock" initial={{ y: -80 }} animate={{ y: 0 }}>
      <span aria-hidden="true">🕵️</span>
      <span>{live.length > 1 ? `${live.length} משימות באוויר` : "משימה באוויר"}</span>
      <b className="num">{mmss(live[0].data!.until! - now)}</b>
      <small>תפסו אותו בטלפון!</small>
    </motion.div>
  );
}

/** The anonymous alert: somebody just did a mission, nobody knows who. */
export function MysterySpot({ line, until, offset }: { line: string; until?: number; offset: number }) {
  const [now, setNow] = useState(() => Date.now() + offset);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now() + offset), 250);
    return () => window.clearInterval(id);
  }, [offset]);
  return (
    <motion.div className="spot spot-mission mystery" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="mystery-body">
        <motion.div className="mystery-face" initial={{ scale: 0.3, rotate: -20 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 200, damping: 12 }}>
          🕵️
        </motion.div>
        <motion.div className="spot-title" initial={{ scale: 2.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 260, damping: 13, delay: 0.15 }}>
          🚨 משימה סודית בוצעה!
        </motion.div>
        <motion.p className="spot-line" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.7 }}>
          {line}
        </motion.p>
        {until && until > now && (
          <div className="mystery-clock">
            יש לכם <b className="num">{mmss(until - now)}</b> לתפוס אותו. בטלפון: ״תפסתי!״
          </div>
        )}
      </div>
    </motion.div>
  );
}

/** One soundtrack for the room: betting music while bets are open, thinking music for a quiz, a lounge in between. */
export function MusicDirector({ view, game, armed }: { view: ClientView; game: Game; armed: boolean }) {
  const r = view.pub.round;
  const live = !!r && r.status === "open";
  const now = useServerNow(game, live, 500);
  const draw = view.pub.draw;
  const drawing = live && !!draw && draw.roundId === r!.id && now < draw.at + DRAW_MS;
  const betting = live && !drawing && (r!.closesAt === null || now < r!.closesAt);
  const theme: Theme | null = drawing ? null : betting && view.pub.tv.mode === "round" ? (r!.kind === "quiz" ? "quiz" : "bet") : "lounge";
  useEffect(() => {
    if (!armed) return;
    if (theme) startMusic(theme);
    else stopMusic();
  }, [theme, armed]);
  useEffect(() => () => stopMusic(), []);
  return null;
}
