import confetti from "canvas-confetti";
import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { PlayerPub } from "../shared/types";
import { cls, fmt, pct, photoOf, ranked, reducedMotion, signed } from "./lib";
import type { ConnStatus } from "./net";
import { setMuted, sfx, useMuted } from "./sound";

/* ---------- shared SVG paint (defined once so gradients never collide) ---------- */

export function SvgDefs() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id="coin-face" cx="35%" cy="30%" r="75%">
          <stop offset="0" stopColor="#FFF1C4" />
          <stop offset=".5" stopColor="#E9B949" />
          <stop offset="1" stopColor="#9C6B12" />
        </radialGradient>
        <linearGradient id="almond-fill" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#B07A45" />
          <stop offset="1" stopColor="#6E4420" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/** The house currency: a gold coin stamped with an almond (שקד). */
export function Coin({ size = 18 }: { size?: number }) {
  return (
    <svg className="coin" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="15" fill="url(#coin-face)" stroke="#7A520C" strokeWidth="1.2" />
      <circle cx="16" cy="16" r="11.6" fill="none" stroke="#7A520C" strokeOpacity=".5" strokeWidth=".9" strokeDasharray="1.4 1.3" />
      <path d="M16 7.6c3.6 2.5 5.1 5.7 4.6 9-.5 3-2.4 5.7-4.6 7.2-2.2-1.5-4.1-4.2-4.6-7.2-.5-3.3 1-6.5 4.6-9z" fill="url(#almond-fill)" />
      <path d="M16 10.2c.8 3.6.8 8.6 0 11.6" stroke="#D9A46A" strokeWidth=".9" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export function Money({ n, size = 18, sign = false, className }: { n: number; size?: number; sign?: boolean; className?: string }) {
  return (
    <span className={cls("money", className)}>
      <span className="num">{sign ? signed(n) : fmt(n)}</span>
      <Coin size={size} />
    </span>
  );
}

/* ---------- people ---------- */

type AvatarPerson = Pick<PlayerPub, "id" | "name" | "photo" | "isGroom"> & { hat?: string | null; item?: string | null };

export function Avatar({ p, size = 44, className, badge }: { p: AvatarPerson; size?: number; className?: string; badge?: string | null }) {
  const src = photoOf(p);
  const [failed, setFailed] = useState<string | null>(null);
  const face = (
    <span
      className={cls("avatar", p.isGroom && "groom", className)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.44) }}
    >
      {failed === src ? (
        <span className="avatar-initial" aria-hidden="true">
          {p.name.slice(0, 1)}
        </span>
      ) : (
        <img src={src} alt="" draggable={false} onError={() => setFailed(src)} />
      )}
    </span>
  );
  const hat = p.hat ?? null;
  const item = p.item ?? null;
  if (!badge && !hat && !item) return face;
  // what friends bought him: a hat on the head, something next to the face
  return (
    <span className="avatar-wrap">
      {face}
      {hat && (
        <span className="avatar-hat" style={{ fontSize: Math.max(14, Math.round(size * 0.52)) }} aria-hidden="true">
          {hat}
        </span>
      )}
      {badge && (
        <span className={cls("avatar-badge", hat && "side")} style={{ fontSize: Math.max(12, Math.round(size * (hat ? 0.3 : 0.36))) }} aria-hidden="true">
          {badge}
        </span>
      )}
      {item && (
        <span className="avatar-item" style={{ fontSize: Math.max(12, Math.round(size * 0.38)) }} aria-hidden="true">
          {item}
        </span>
      )}
    </span>
  );
}

/** For drinking / losing moments: the AI "shot" image if there is one, else a funny photo, else the profile photo. */
export function FunnyFace({ p, size = 200, className }: { p: AvatarPerson; size?: number; className?: string }) {
  const chain = [`/photos/shot/${p.id}.jpg`, `/photos/funny/${p.id}.jpg`, photoOf(p)];
  const [i, setI] = useState(0);
  return (
    <span className={cls("avatar funny-face", p.isGroom && "groom", className)} style={{ width: size, height: size, fontSize: Math.round(size * 0.44) }}>
      {i < chain.length ? (
        <img src={chain[i]} alt="" draggable={false} onError={() => setI((x) => x + 1)} />
      ) : (
        <span className="avatar-initial" aria-hidden="true">
          {p.name.slice(0, 1)}
        </span>
      )}
    </span>
  );
}

/** The leader as an AI king on a throne of almonds (the profile photo if the picture is missing). */
export function KingFace({ p, size }: { p: AvatarPerson; size: number }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <Avatar p={p} size={size} badge="👑" />;
  return (
    <span className="avatar king-face" style={{ width: size, height: size }}>
      <img src={`/photos/ai/king/${p.id}.jpg`} alt="" draggable={false} onError={() => setFailed(true)} />
    </span>
  );
}

/** Top three on steps: second, first, third. */
export function Podium({ list, size = "m", value, king }: { list: PlayerPub[]; size?: "s" | "m" | "l"; value?: (p: PlayerPub) => ReactNode; king?: boolean }) {
  const [first, second, third] = list;
  const dims = { s: [52, 68], m: [84, 112], l: [150, 210] }[size];
  const step = (p: PlayerPub | undefined, place: number) =>
    p && (
      <div className={cls("pod", `pod-${place}`)} key={p.id} dir="rtl">
        {king && place === 1 ? <KingFace p={p} size={dims[1]} /> : <Avatar p={p} size={place === 1 ? dims[1] : dims[0]} badge={place === 1 ? "👑" : null} />}
        <span className="pod-name">{p.name}</span>
        <span className="pod-value">{value ? value(p) : <Money n={p.balance} size={size === "l" ? 26 : 15} />}</span>
        <span className="pod-block num">{place}</span>
      </div>
    );
  return (
    <div className={cls("podium2", `podium2-${size}`)} dir="ltr">
      {step(second, 2)}
      {step(first, 1)}
      {step(third, 3)}
    </div>
  );
}

/* ---------- numbers that move ---------- */

export function useTween(value: number, ms = 900) {
  const [shown, setShown] = useState(value);
  const cur = useRef(value);
  useEffect(() => {
    const from = cur.current;
    if (from === value) return;
    if (reducedMotion()) {
      cur.current = value;
      setShown(value);
      return;
    }
    const start = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / ms);
      const v = Math.round(from + (value - from) * (1 - (1 - k) ** 3));
      cur.current = v;
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return shown;
}

/** Slot-machine style credit meter. */
export function Led({ value, className }: { value: number; className?: string }) {
  const shown = useTween(value);
  return <span className={cls("led", className)}>{fmt(shown)}</span>;
}

export function Change({ balance, start }: { balance: number; start: number }) {
  const p = pct(balance, start);
  const dir = p > 0.05 ? "up" : p < -0.05 ? "down" : "flat";
  return (
    <span className={cls("change", dir)}>
      <span aria-hidden="true">{dir === "up" ? "▲" : dir === "down" ? "▼" : "■"}</span>
      <span className="num">{Math.abs(p).toFixed(1)}%</span>
    </span>
  );
}

export function Spark({ data, w = 120, h = 34 }: { data: number[]; w?: number; h?: number }) {
  const pts = data.length > 1 ? data : [data[0] ?? 0, data[0] ?? 0];
  const min = Math.min(...pts);
  const span = Math.max(...pts) - min || 1;
  const xy = pts.map((v, i) => [(i / (pts.length - 1)) * (w - 6) + 3, h - 4 - ((v - min) / span) * (h - 8)]);
  const d = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const [lx, ly] = xy[xy.length - 1];
  return (
    <svg className={cls("spark", pts[pts.length - 1] >= pts[0] ? "up" : "down")} width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <path d={d} />
      <circle cx={lx} cy={ly} r="3" />
    </svg>
  );
}

/* ---------- brand ---------- */

/** Vegas marquee sign. `lights` animates the bulbs (TV attract mode only). */
export function Marquee({ size = "m", lights = false }: { size?: "s" | "m" | "l"; lights?: boolean }) {
  return (
    <div className={cls("marquee", `marquee-${size}`, lights && "lights")} role="img" aria-label="Shaked Goes Nuts">
      <span className="marquee-text" aria-hidden="true">
        <span className="m1">SHAKED</span>
        <span className="m2">GOES NUTS</span>
      </span>
    </div>
  );
}

export function Ticker({ players, start }: { players: PlayerPub[]; start: number }) {
  const items = ranked(players).map((p) => (
    <span className="tick" key={p.id}>
      <b>{p.ticker}</b>
      <span className="tick-px">{fmt(p.balance)}</span>
      <Change balance={p.balance} start={start} />
    </span>
  ));
  return (
    <div className="ticker" dir="ltr" aria-hidden="true">
      <div className="ticker-track" style={{ animationDuration: `${Math.max(24, players.length * 5)}s` }}>
        <div className="ticker-group">{items}</div>
        <div className="ticker-group">{items}</div>
      </div>
    </div>
  );
}

/* ---------- feedback ---------- */

type ToastKind = "ok" | "err" | "info";
interface ToastItem {
  id: number;
  text: string;
  kind: ToastKind;
}
let toasts: ToastItem[] = [];
let toastSeq = 0;
const toastSubs = new Set<() => void>();
const emitToasts = () => toastSubs.forEach((f) => f());

export function toast(text: string, kind: ToastKind = "info", ms = 3400) {
  const item = { id: ++toastSeq, text, kind };
  toasts = [...toasts.slice(-2), item];
  emitToasts();
  window.setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== item.id);
    emitToasts();
  }, ms);
}

export function Toaster() {
  const list = useSyncExternalStore(
    (f) => {
      toastSubs.add(f);
      return () => {
        toastSubs.delete(f);
      };
    },
    () => toasts,
  );
  return (
    <div className="toaster" role="status" aria-live="polite">
      <AnimatePresence initial={false}>
        {list.map((t) => (
          <motion.div
            key={t.id}
            className={cls("toast", t.kind)}
            initial={{ opacity: 0, y: -14, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
          >
            {t.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

export function Sheet({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  // portal: a sheet opened from a sticky, blurred header would otherwise be trapped inside it
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className="sheet-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div
            className={cls("sheet", wide && "wide")}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 34, stiffness: 360 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sheet-grip" aria-hidden="true" />
            {title && <h2 className="sheet-title">{title}</h2>}
            <div className="sheet-body">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

interface AskOptions {
  title: string;
  body?: string;
  ok: string;
  cancel?: string;
  danger?: boolean;
}
let askReq: (AskOptions & { resolve: (v: boolean) => void }) | null = null;
const askSubs = new Set<() => void>();

/** Promise-based confirmation sheet. */
export function ask(opts: AskOptions): Promise<boolean> {
  return new Promise((resolve) => {
    askReq?.resolve(false);
    askReq = { ...opts, resolve };
    askSubs.forEach((f) => f());
  });
}

export function AskHost() {
  const req = useSyncExternalStore(
    (f) => {
      askSubs.add(f);
      return () => {
        askSubs.delete(f);
      };
    },
    () => askReq,
  );
  const last = useRef(req);
  if (req) last.current = req;
  const r = req ?? last.current;
  const done = (v: boolean) => {
    const cur = askReq;
    askReq = null;
    askSubs.forEach((f) => f());
    cur?.resolve(v);
  };
  return (
    <Sheet open={!!req} onClose={() => done(false)} title={r?.title}>
      {r?.body && <p className="sheet-text">{r.body}</p>}
      <div className="sheet-actions">
        <button type="button" className={cls("btn", r?.danger ? "btn-danger" : "btn-gold")} onClick={() => done(true)}>
          {r?.ok}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => done(false)}>
          {r?.cancel ?? "ביטול"}
        </button>
      </div>
    </Sheet>
  );
}

export function MuteButton({ className }: { className?: string }) {
  const muted = useMuted();
  return (
    <button
      type="button"
      className={cls("icon-btn", className)}
      onClick={() => {
        setMuted(!muted);
        if (muted) sfx.tap();
      }}
      aria-label={muted ? "הפעלת צלילים" : "השתקת צלילים"}
      aria-pressed={muted}
    >
      {muted ? "🔇" : "🔊"}
    </button>
  );
}

export function ConnBanner({ status }: { status: ConnStatus }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (status === "online") {
      setShow(false);
      return;
    }
    const id = window.setTimeout(() => setShow(true), 3000);
    return () => window.clearTimeout(id);
  }, [status]);
  return (
    <AnimatePresence>
      {show && (
        <motion.div className="conn-banner" role="status" initial={{ y: -40 }} animate={{ y: 0 }} exit={{ y: -40 }}>
          אין חיבור כרגע. מתחברים שוב…
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ---------- celebration ---------- */

let coinShape: confetti.Shape | null = null;
export function burst(kind: "win" | "big" | "coins" = "win") {
  if (reducedMotion()) return;
  const colors = ["#E9B949", "#FFE39A", "#F3E3C3", "#5CF29B", "#B07A45"];
  try {
    coinShape ??= confetti.shapeFromText({ text: "🪙", scalar: 2.2 });
  } catch {
    coinShape = null;
  }
  if (kind === "coins" && coinShape) {
    confetti({ particleCount: 40, spread: 100, startVelocity: 38, gravity: 1.1, origin: { y: 0.35 }, shapes: [coinShape], scalar: 2.2, ticks: 220 });
    return;
  }
  confetti({ particleCount: kind === "big" ? 160 : 90, spread: 85, startVelocity: 45, origin: { y: 0.6 }, colors, scalar: 1.1 });
  if (kind === "big") {
    window.setTimeout(() => confetti({ particleCount: 110, angle: 60, spread: 70, origin: { x: 0, y: 0.7 }, colors }), 250);
    window.setTimeout(() => confetti({ particleCount: 110, angle: 120, spread: 70, origin: { x: 1, y: 0.7 }, colors }), 420);
    if (coinShape)
      window.setTimeout(
        () => confetti({ particleCount: 50, spread: 120, startVelocity: 40, origin: { y: 0.3 }, shapes: [coinShape!], scalar: 2.4, ticks: 260 }),
        600,
      );
  }
}
