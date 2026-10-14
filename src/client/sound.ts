import { useSyncExternalStore } from "react";

/* Every sound is synthesized with Web Audio — no files to load, nothing to fail on villa Wi-Fi. */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = (() => {
  try {
    return localStorage.getItem("sgn.muted") === "1";
  } catch {
    return false;
  }
})();
const subs = new Set<() => void>();

export function unlockAudio() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.7;
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") void ctx.resume();
  } catch {
    /* no audio on this device */
  }
}

for (const ev of ["pointerdown", "keydown", "touchend"]) window.addEventListener(ev, unlockAudio, { passive: true });

export function setMuted(m: boolean) {
  muted = m;
  try {
    localStorage.setItem("sgn.muted", m ? "1" : "0");
  } catch {
    /* ignore */
  }
  subs.forEach((f) => f());
}

export function useMuted() {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => {
        subs.delete(f);
      };
    },
    () => muted,
  );
}

function tone(freq: number, at: number, dur: number, type: OscillatorType = "sine", peak = 0.2, glideTo?: number) {
  if (!ctx || !master) return;
  const t0 = ctx.currentTime + at;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(master);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

function noise(at: number, dur: number, peak = 0.2, freq = 2000, q = 0.8) {
  if (!ctx || !master) return;
  const t0 = ctx.currentTime + at;
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = "bandpass";
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.value = peak;
  src.connect(f).connect(g).connect(master);
  src.start(t0);
}

function play(fn: () => void) {
  if (muted) return;
  unlockAudio();
  if (ctx) fn();
}

const coinPing = (at: number, vol = 0.07) => {
  tone(1975, at, 0.09, "square", vol);
  tone(2637, at + 0.07, 0.32, "square", vol);
};

export const sfx = {
  tap: () => play(() => tone(720, 0, 0.05, "triangle", 0.1)),
  chip: () =>
    play(() => {
      noise(0, 0.045, 0.5, 3800, 1.4);
      noise(0.06, 0.035, 0.3, 4600, 1.4);
    }),
  coin: () => play(() => coinPing(0)),
  win: () =>
    play(() => {
      [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, i * 0.085, 0.3, "triangle", 0.2));
      for (let i = 0; i < 6; i++) coinPing(0.45 + i * 0.09, 0.045);
    }),
  lose: () =>
    play(() => {
      tone(392, 0, 0.32, "sawtooth", 0.09, 370);
      tone(370, 0.36, 0.32, "sawtooth", 0.09, 349);
      tone(349, 0.72, 0.9, "sawtooth", 0.09, 233);
    }),
  tick: () => play(() => tone(1250, 0, 0.035, "square", 0.05)),
  open: () =>
    play(() => {
      tone(880, 0, 1.1, "sine", 0.22);
      tone(1320, 0.01, 0.8, "sine", 0.1);
      tone(1760, 0.02, 0.5, "sine", 0.05);
    }),
  close: () =>
    play(() => {
      tone(140, 0, 0.3, "sine", 0.5, 55);
      noise(0, 0.1, 0.5, 700, 0.7);
    }),
  drumroll: (secs = 1.6) =>
    play(() => {
      const n = Math.floor(secs / 0.045);
      for (let i = 0; i < n; i++) noise(i * 0.045, 0.05, 0.12 + (i / n) * 0.25, 1600, 0.6);
      tone(98, secs, 0.5, "sine", 0.5, 60);
      noise(secs, 0.5, 0.4, 5000, 0.3);
    }),
  secret: () =>
    play(() => {
      noise(0, 0.35, 0.08, 6500, 0.5);
      tone(988, 0.25, 0.16, "sine", 0.14);
      tone(1319, 0.38, 0.5, "sine", 0.14);
      coinPing(0.7, 0.05);
    }),
  join: () =>
    play(() => {
      tone(659, 0, 0.12, "triangle", 0.15);
      tone(988, 0.1, 0.25, "triangle", 0.15);
    }),
  fanfare: () =>
    play(() => {
      const seq: [number, number, number][] = [
        [523, 0, 0.14],
        [523, 0.15, 0.14],
        [523, 0.3, 0.14],
        [659, 0.45, 0.4],
        [784, 0.9, 0.2],
        [659, 1.1, 0.14],
        [784, 1.25, 0.2],
        [1047, 1.45, 0.9],
      ];
      for (const [f, t, d] of seq) {
        tone(f, t, d, "square", 0.07);
        tone(f / 2, t, d, "triangle", 0.12);
      }
      for (let i = 0; i < 8; i++) coinPing(1.5 + i * 0.08, 0.04);
    }),
};
