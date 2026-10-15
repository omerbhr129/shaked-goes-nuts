import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ClientView, PlayerPub } from "../../shared/types";
import type { Game } from "../net";

/* When nothing has happened for a while, the TV turns into a slideshow of the night: the AI pictures,
   the photos people threw at the screen, and the gallery. Anything happening ends it at once. */

// two quiet minutes (/tv?idle=5 makes it 5 seconds, for trying it out)
const IDLE_MS = (Number(new URLSearchParams(location.search).get("idle")) || 120) * 1000;
const SLIDE_MS = 6500;

interface Slide {
  src: string;
  caption: string;
}

const ITAY: [string, string][] = [
  ["baby", "איתי בגיל שנה כבר ידע: יום אחד יהיה לו שקד משלו"],
  ["ballerina", "איתי באגם הברבורים. שחף, את בטוחה?"],
  ["sumo", "איתי אחרי המנגל של הלילה"],
  ["mafia", "הסנדק של ירכא. אל תעשו לו פרצוף"],
  ["mermaid", "בת הים הקטנה, גרסת הרווקים"],
  ["chain", "איתי הראפר. השרשרת שווה יותר מכל הבורסה"],
  ["cat", "איתי החתול. 9 נשמות, ואחת מהן של שחף"],
  ["grill", "שף איתי. השרוף זה בכוונה"],
  ["titanic", "מלך העולם, וואלה"],
];

const FOR_PLAYER: [string, (n: string) => string][] = [
  ["king", (n) => `👑 ${n} בגרסה המלכותית`],
  ["fast", (n) => `⚡ ${n}, האצבע הכי מהירה במזרח התיכון`],
  ["champ/champ", (n) => `🏆 ${n} אחרי שניצח את כולם`],
  ["slow", (n) => `🐢 ${n}, עדיין קורא את השאלה`],
  ["broke", (n) => `💸 ${n} כשהבורסה קרסה`],
];

function shuffle<T>(a: T[]): T[] {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

/** Anything that counts as the room doing something: a round moving, the feed, messages, the wheels, emojis. */
function useLastActivity(view: ClientView, game: Game) {
  const [at, setAt] = useState(() => Date.now());
  const r = view.pub.round;
  const sig = [
    view.pub.tv.mode,
    r?.id,
    r?.status,
    r?.bettors.length,
    view.pub.feed[view.pub.feed.length - 1]?.id,
    view.pub.shouts[view.pub.shouts.length - 1]?.id,
    view.pub.draw?.at,
    view.pub.wheel?.id,
    view.pub.players.filter((p) => p.claimed).length,
  ].join("|");
  useEffect(() => setAt(Date.now()), [sig]);
  useEffect(() => game.onFx(() => setAt(Date.now())), [game]);
  return at;
}

export function IdleShow({ view, game }: { view: ClientView; game: Game }) {
  const last = useLastActivity(view, game);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(id);
  }, []);
  const r = view.pub.round;
  const busy = !!r && (r.status === "open" || r.status === "closed");
  // the lobby keeps its QR code until everybody is in
  const mode = view.pub.tv.mode;
  const calm = mode === "round" || mode === "board" || (mode === "lobby" && view.pub.players.every((p) => p.claimed));
  const idle = !busy && calm && now - last > IDLE_MS;
  return <AnimatePresence>{idle && <Slideshow key={last} view={view} />}</AnimatePresence>;
}

function Slideshow({ view }: { view: ClientView }) {
  const [gallery, setGallery] = useState<string[]>([]);
  useEffect(() => {
    fetch("/photos/gallery.json")
      .then((res) => (res.ok ? res.json() : []))
      .then((list: unknown) => setGallery(Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : []))
      .catch(() => setGallery([]));
  }, []);

  const players = view.pub.players.filter((p) => p.claimed);
  const slides = useMemo<Slide[]>(() => {
    const name = (p: PlayerPub) => p.name;
    const shouts = view.pub.shouts
      .filter((s) => s.photo)
      .map((s) => ({ src: s.photo!, caption: `📸 ${s.by ? (view.pub.players.find((p) => p.id === s.by)?.name ?? "מישהו") : "🕵️ אנונימי"}${s.text ? `: ${s.text}` : " שלח למסך"}` }));
    const ai = players.flatMap((p) => FOR_PLAYER.map(([dir, cap]) => ({ src: `/photos/ai/${dir}/${p.id}.jpg`, caption: cap(name(p)) })));
    const itay = ITAY.map(([n, caption]) => ({ src: `/photos/ai/itay/${n}.jpg`, caption }));
    const old = gallery.map((src) => ({ src, caption: "📸 מהארכיון של איתי" }));
    // the room's own photos first, then everything else mixed
    return [...shuffle(shouts), ...shuffle([...itay, ...ai.filter((_, i) => i % 2 === 0), ...old])];
  }, [gallery.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const [i, setI] = useState(0);
  const ready = useRef(new Set<string>());
  useEffect(() => {
    if (!slides.length) return;
    // load the next picture ahead, so a slide never shows up empty
    const next = slides[(i + 1) % slides.length].src;
    if (!ready.current.has(next)) {
      const img = new Image();
      img.onload = () => ready.current.add(next);
      img.src = next;
    }
    const id = window.setTimeout(() => setI((x) => (x + 1) % slides.length), SLIDE_MS);
    return () => window.clearTimeout(id);
  }, [i, slides]);

  const cur = slides[i % Math.max(1, slides.length)];
  return (
    <motion.div className="idle-show" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.8 }}>
      <AnimatePresence mode="popLayout">
        {cur && (
          <motion.figure key={`${i}:${cur.src}`} className="idle-slide" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 1 }}>
            <img className="idle-blur" src={cur.src} alt="" aria-hidden="true" />
            <img className="idle-img" src={cur.src} alt="" onError={() => setI((x) => (x + 1) % slides.length)} />
            <figcaption>{cur.caption}</figcaption>
          </motion.figure>
        )}
      </AnimatePresence>
      <div className="idle-tag">🎡 הסיבוב הבא בדרך. בינתיים, תמונות מהלילה</div>
    </motion.div>
  );
}
