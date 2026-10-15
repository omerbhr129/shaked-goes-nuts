import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { ClientView, FeedEvent, PlayerPub, ShoutPub } from "../../shared/types";
import { cls, mmss } from "../lib";
import { type Game, useServerNow } from "../net";
import { type Theme, sfx, speak, startMusic, stopMusic } from "../sound";
import { Avatar } from "../ui";
import { spinLength } from "./Moments";

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
export function ShoutsLayer({ shouts, players, feed, bubbles: showBubbles }: { shouts: ShoutPub[]; players: PlayerPub[]; feed: FeedEvent[]; bubbles: boolean }) {
  const seen = useRef<Set<string> | null>(null);
  const [bubbles, setBubbles] = useState<ShoutPub[]>([]);
  const [photos, setPhotos] = useState<ShoutPub[]>([]);
  const bubbleRef = useRef(showBubbles);
  bubbleRef.current = showBubbles;
  useEffect(() => {
    if (!showBubbles) setBubbles([]);
  }, [showBubbles]);

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
      if (bubbleRef.current) setBubbles((q) => [...q.slice(-2), b]);
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
        if (bubbleRef.current) setBubbles((q) => [...q.slice(-2), s]);
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
export function CatchClock({ feed, game, compact }: { feed: FeedEvent[]; game: Game; compact?: boolean }) {
  const now = useServerNow(game, true, 500);
  const closed = new Set(feed.filter((e) => e.kind === "reveal" || e.kind === "caught").map((e) => e.data?.mission ?? e.ref));
  const live = feed.filter((e) => e.kind === "mission" && e.data?.until && e.data.until > now && !closed.has(e.ref)).sort((a, b) => a.data!.until! - b.data!.until!);
  const first = live[0];
  const left = first ? first.data!.until! - now : 0;
  const pct = first ? Math.max(0, Math.min(100, (left / Math.max(1, first.data!.until! - first.at)) * 100)) : 0;
  // stays up for the whole catch window, so nobody forgets there is someone to catch
  return (
    <AnimatePresence>
      {first && (
        <motion.div
          key="catch"
          className={cls("catch-clock", compact && "compact", left < 15_000 && "hurry")}
          initial={compact ? { y: 200 } : { x: -520 }}
          animate={compact ? { y: 0 } : { x: 0 }}
          exit={compact ? { y: 200 } : { x: -520 }}
          transition={{ type: "spring", stiffness: 180, damping: 22 }}
        >
          <div className="cc-head">
            <span className="cc-siren" aria-hidden="true">
              🚨
            </span>
            {live.length > 1 ? `${live.length} משימות סודיות באוויר!` : "משימה סודית באוויר!"}
          </div>
          <b className="cc-time num">{mmss(left)}</b>
          {compact ? (
            <p className="cc-hint">
              <b>תפסו אותו בטלפון!</b>
            </p>
          ) : (
            <>
              <div className="cc-bar" aria-hidden="true">
                <i style={{ width: `${pct}%` }} />
              </div>
              <p className="cc-hint">
                מישהו פה עשה משהו. חושדים במישהו?
                <br />
                <b>בטלפון: משימות ← 🕵️ תפסתי מישהו!</b>
              </p>
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>
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
  const draw = view.pub.draw;
  const live = !!r && r.status === "open";
  const now = useServerNow(game, live || (!!draw && Date.now() + game.offset < draw.at + spinLength(draw)), 500);
  const drawing = !!draw && now < draw.at + spinLength(draw);
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

/* ---------- the room's log, Twitch style: everything that happens, older lines fading out ---------- */

interface Line {
  id: string;
  at: number;
  who: PlayerPub | null;
  name?: string;
  kind: "msg" | "sys" | "emoji" | "gift";
  text: string;
}

const fromShout = (s: ShoutPub, people: Record<string, PlayerPub>): Line => ({
  id: `s:${s.id}`,
  at: s.at,
  who: s.by ? people[s.by] ?? null : null,
  name: s.by ? people[s.by]?.name : "🕵️ אנונימי",
  kind: "msg",
  text: s.photo ? `📸 ${s.text ?? "שלח תמונה למסך"}` : (s.text ?? ""),
});

const fromFeed = (e: FeedEvent, people: Record<string, PlayerPub>): Line => ({
  id: `f:${e.id}`,
  at: e.at,
  who: e.kind === "mission" ? null : (people[e.players[0]] ?? null),
  kind: e.kind === "gift" ? "gift" : "sys",
  text: e.text,
});

export function ChatLog({ view, game }: { view: ClientView; game: Game }) {
  const players = view.pub.players;
  const people = Object.fromEntries(players.map((p) => [p.id, p])) as Record<string, PlayerPub>;
  const peopleRef = useRef(people);
  peopleRef.current = people;

  // history first: what the server still has, oldest to newest
  const [lines, setLines] = useState<Line[]>(() =>
    [...view.pub.feed.map((e) => fromFeed(e, people)), ...view.pub.shouts.map((s) => fromShout(s, people))].sort((a, b) => a.at - b.at).slice(-14),
  );
  const push = (l: Line) => setLines((cur) => (cur.some((x) => x.id === l.id) ? cur : [...cur.slice(-29), l]));

  const seen = useRef(new Set([...view.pub.feed.map((e) => `f:${e.id}`), ...view.pub.shouts.map((s) => `s:${s.id}`)]));
  useEffect(() => {
    for (const e of view.pub.feed)
      if (!seen.current.has(`f:${e.id}`)) {
        seen.current.add(`f:${e.id}`);
        const line = fromFeed(e, peopleRef.current);
        const wait = e.kind === "spin" && e.data?.until ? e.data.until - (Date.now() + game.offset) : 0;
        if (wait > 0) window.setTimeout(() => push(line), wait);
        else push(line);
      }
    for (const s of view.pub.shouts)
      if (!seen.current.has(`s:${s.id}`)) {
        seen.current.add(`s:${s.id}`);
        push(fromShout(s, peopleRef.current));
      }
  }, [view.pub.feed, view.pub.shouts]); // eslint-disable-line react-hooks/exhaustive-deps

  // emojis: a burst from the same guy becomes one line
  useEffect(
    () =>
      game.onFx((fx) => {
        if (fx.kind !== "emoji") return;
        const who = peopleRef.current[fx.by] ?? null;
        const now = Date.now();
        setLines((cur) => {
          const last = cur[cur.length - 1];
          if (last && last.kind === "emoji" && last.who?.id === fx.by && now - last.at < 5000 && last.text.length < 40)
            return [...cur.slice(0, -1), { ...last, at: now, text: last.text + fx.e }];
          return [...cur.slice(-29), { id: `e:${now}:${fx.by}`, at: now, who, kind: "emoji", text: fx.e }];
        });
      }),
    [game],
  );

  // who just walked in
  const claimed = useRef(new Set(players.filter((p) => p.claimed).map((p) => p.id)));
  useEffect(() => {
    for (const p of players)
      if (p.claimed && !claimed.current.has(p.id)) {
        claimed.current.add(p.id);
        push({ id: `j:${p.id}:${Date.now()}`, at: Date.now(), who: p, kind: "sys", text: `✅ ${p.name} נכנס לבורסה` });
      } else if (!p.claimed) claimed.current.delete(p.id);
  }, [players]); // eslint-disable-line react-hooks/exhaustive-deps

  // the live round: opened, every bet (never on what), closed, the result
  const r = view.pub.round;
  const track = useRef<{ key: string | null; status: string | null; bettors: Set<string> }>({
    key: r ? `${r.id}:${r.openedAt}` : null,
    status: r?.status ?? null,
    bettors: new Set(r?.bettors ?? []),
  });
  useEffect(() => {
    const t = track.current;
    const key = r ? `${r.id}:${r.openedAt}` : null;
    const now = Date.now();
    if (!r) {
      Object.assign(t, { key: null, status: null, bettors: new Set() });
      return;
    }
    if (key !== t.key) {
      Object.assign(t, { key, status: null, bettors: new Set() });
    }
    if (r.status !== t.status) {
      if (r.status === "open") push({ id: `o:${key}`, at: now, who: null, kind: "sys", text: `▶ נפתח: ${r.emoji} ${r.title}` });
      if (r.status === "closed") push({ id: `c:${key}`, at: now, who: null, kind: "sys", text: r.kind === "quiz" ? "🔒 הזמן לענות נגמר" : "🔒 ההימורים נסגרו" });
      if (r.status === "resolved") {
        const label = r.options.find((o) => o.id === r.winnerId)?.label ?? "";
        push({ id: `r:${key}:${r.resolvedAt}`, at: now, who: null, kind: "sys", text: `🏁 ${r.kind === "quiz" ? "התשובה" : "התוצאה"}: ${label}` });
      }
      t.status = r.status;
    }
    for (const id of r.bettors)
      if (!t.bettors.has(id)) {
        t.bettors.add(id);
        const p = peopleRef.current[id];
        if (p) push({ id: `b:${key}:${id}`, at: now, who: p, kind: "sys", text: r.kind === "quiz" ? `❓ ${p.name} ענה` : `🎲 ${p.name} הימר` });
      }
  }, [r?.id, r?.openedAt, r?.status, r?.bettors.length, r?.resolvedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = lines.slice(-12);
  return (
    <aside className="chat" aria-label="מה קורה בחדר">
      <div className="chat-head">💬 מה קורה בחדר</div>
      <div className="chat-lines">
        <AnimatePresence initial={false}>
          {shown.map((l, i) => {
            const age = shown.length - 1 - i;
            const opacity = Math.max(0.22, 1 - age * 0.085);
            return (
              <motion.div
                key={l.id}
                layout
                className={cls("chat-line", l.kind)}
                initial={{ opacity: 0, x: -60 }}
                animate={{ opacity, x: 0 }}
                exit={{ opacity: 0 }}
                transition={{ type: "spring", stiffness: 260, damping: 26 }}
              >
                {l.who ? <Avatar p={l.who} size={38} /> : <span className="chat-dot">{l.kind === "msg" ? "🕵️" : "📢"}</span>}
                <span className="chat-text">
                  {l.kind === "msg" || l.kind === "emoji" ? <b>{l.name ?? l.who?.name ?? "מישהו"}:</b> : null} {l.text}
                </span>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </aside>
  );
}
