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
    // iOS can leave it "interrupted" after a call or another app's audio, not just "suspended"
    if (ctx.state !== "running") void ctx.resume();
  } catch {
    /* no audio on this device */
  }
}

for (const ev of ["pointerdown", "keydown", "touchend"]) window.addEventListener(ev, unlockAudio, { passive: true });

export function setMuted(m: boolean) {
  muted = m;
  if (m) stopMusic();
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
  if (!ctx) return;
  voice(ctx.currentTime + at, freq, dur, type, peak, glideTo);
}

/** One note at an absolute time, into the given bus (the music has its own, so it can be ducked). */
function voice(t0: number, freq: number, dur: number, type: OscillatorType, peak: number, glideTo?: number, bus?: AudioNode) {
  if (!ctx || !master) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(bus ?? master);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

function noise(at: number, dur: number, peak = 0.2, freq = 2000, q = 0.8) {
  if (!ctx) return;
  hiss(ctx.currentTime + at, dur, peak, freq, q);
}

function hiss(t0: number, dur: number, peak: number, freq: number, q: number, bus?: AudioNode) {
  if (!ctx || !master) return;
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
  src.connect(f).connect(g).connect(bus ?? master);
  src.start(t0);
}

let silent = false;
/** Silence this page only (not saved): used by the TV preview inside the host screen. */
export function silence() {
  silent = true;
}

function play(fn: () => void) {
  if (muted || silent) return;
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
  alert: () =>
    play(() => {
      for (let i = 0; i < 3; i++) {
        tone(880, i * 0.32, 0.16, "square", 0.07, 660);
        tone(660, i * 0.32 + 0.16, 0.16, "square", 0.07, 880);
      }
    }),
  gotcha: () =>
    play(() => {
      tone(523, 0, 0.12, "square", 0.1);
      tone(392, 0.12, 0.12, "square", 0.1);
      tone(262, 0.24, 0.45, "square", 0.1, 180);
      noise(0.24, 0.3, 0.25, 1200, 0.6);
    }),
  wheelTick: () => play(() => noise(0, 0.03, 0.35, 3200, 2)),
  ding: () =>
    play(() => {
      tone(1568, 0, 1.2, "sine", 0.25);
      tone(2093, 0.02, 1, "sine", 0.12);
    }),
  join: () =>
    play(() => {
      tone(659, 0, 0.12, "triangle", 0.15);
      tone(988, 0.1, 0.25, "triangle", 0.15);
    }),
  boom: () =>
    play(() => {
      tone(90, 0, 0.7, "sine", 0.7, 32);
      noise(0, 0.45, 0.6, 380, 0.5);
      noise(0.03, 0.3, 0.35, 140, 0.4);
    }),
  siren: () =>
    play(() => {
      for (let i = 0; i < 2; i++) {
        tone(620, i * 0.8, 0.4, "sawtooth", 0.05, 1050);
        tone(1050, i * 0.8 + 0.4, 0.4, "sawtooth", 0.05, 620);
      }
    }),
  /** the sad trombone: wah, wah, wah, waaah */
  sad: () =>
    play(() => {
      const f = [311, 294, 277];
      f.forEach((x, i) => tone(x, i * 0.42, 0.38, "sawtooth", 0.08, x * 0.96));
      tone(262, 1.3, 1.2, "sawtooth", 0.08, 220);
    }),
  whoosh: () =>
    play(() => {
      noise(0, 0.35, 0.25, 900, 0.4);
      noise(0.12, 0.35, 0.25, 2600, 0.4);
    }),
  boing: () => play(() => tone(170, 0, 0.4, "sine", 0.25, 720)),
  pop: () => play(() => tone(520, 0, 0.09, "sine", 0.14, 1250)),
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

/* ---------- music: original synthesized loops (no files, no rights issues), one theme at a time ---------- */

export type Theme = "bet" | "quiz" | "lounge";

const midi = (m: number) => 440 * 2 ** ((m - 69) / 12);

// betting: a silly, bouncy casino loop
const BET_CHORDS = [
  [36, [60, 64, 67]],
  [33, [57, 60, 64]],
  [29, [53, 57, 60]],
  [31, [55, 59, 62]],
] as const;
const BET_TUNE = [
  [72, 0, 76, 79, 76, 0, 72, 74],
  [76, 0, 72, 69, 72, 0, 76, 77],
  [77, 81, 77, 72, 74, 0, 77, 76],
  [74, 71, 67, 71, 74, 79, 0, 0],
  [79, 0, 76, 72, 76, 0, 79, 81],
  [81, 0, 76, 72, 69, 0, 72, 76],
  [77, 0, 81, 84, 81, 77, 74, 77],
  [76, 74, 72, 0, 67, 0, 72, 0],
];
// quiz: a ticking clock over a plucked bass, thinking music
const QUIZ_BASS = [
  [45, 52, 45, 52],
  [41, 48, 41, 48],
  [38, 45, 38, 45],
  [40, 47, 40, 44],
];
const QUIZ_BELLS = [
  [69, 72, 76, 74],
  [65, 69, 72, 71],
  [74, 77, 81, 79],
  [76, 74, 71, 68],
];
// between rounds: a lazy casino lounge, Cmaj7 Am7 Dm7 G7
const LOUNGE = [
  [60, 64, 67, 71],
  [57, 60, 64, 67],
  [62, 65, 69, 72],
  [55, 59, 62, 65],
];
const LOUNGE_BASS = [
  [36, 40, 43, 45],
  [33, 36, 40, 43],
  [38, 41, 45, 47],
  [31, 35, 38, 41],
];

const BPM: Record<Theme, number> = { bet: 140, quiz: 120, lounge: 92 };
const LEVEL: Record<Theme, number> = { bet: 0.55, quiz: 0.5, lounge: 0.42 };

let bus: GainNode | null = null;
let theme: Theme | null = null;
let musicTimer = 0;
let nextAt = 0;
let step = 0;

function playStep(th: Theme, i: number, t: number) {
  if (!bus) return;
  const st = 60 / BPM[th] / 2;
  const bar = Math.floor(i / 8);
  const pos = i % 8;
  if (th === "bet") {
    const [root, chord] = BET_CHORDS[bar % 4];
    if (pos % 2 === 0) voice(t, midi(root + [0, 7, 12, 7][pos / 2]), st * 1.6, "triangle", 0.32, undefined, bus);
    else for (const n of chord) voice(t, midi(n), 0.07, "square", 0.025, undefined, bus);
    const m = BET_TUNE[bar % BET_TUNE.length][pos];
    if (m) voice(t, midi(m), st * 0.7, "square", 0.05, undefined, bus);
    if (pos === 0 || pos === 4) voice(t, 120, 0.18, "sine", 0.5, 45, bus);
    if (pos === 2 || pos === 6) hiss(t, 0.12, 0.22, 1800, 0.7, bus);
    hiss(t, 0.03, 0.06, 8000, 1, bus);
    if (pos === 6 && bar % 4 === 3) voice(t, 380, 0.32, "sine", 0.12, 1500, bus);
  } else if (th === "quiz") {
    voice(t, pos % 2 ? 2600 : 1900, 0.025, "square", 0.022, undefined, bus);
    if (pos % 2 === 0) {
      voice(t, midi(QUIZ_BASS[bar % 4][pos / 2]), 0.22, "triangle", 0.3, undefined, bus);
      voice(t, midi(QUIZ_BELLS[bar % 4][pos / 2]), 0.55, "sine", 0.06, undefined, bus);
    }
    if (pos === 0 && bar % 4 === 0) hiss(t, 0.3, 0.05, 900, 0.5, bus);
  } else {
    const swing = pos % 2 ? st * 0.18 : 0;
    if (pos === 0 || pos === 3) for (const n of LOUNGE[bar % 4]) voice(t + swing, midi(n), 1.2, "sine", 0.035, undefined, bus);
    if (pos % 2 === 0) voice(t, midi(LOUNGE_BASS[bar % 4][pos / 2]), 0.5, "triangle", 0.2, undefined, bus);
    hiss(t + swing, 0.06, pos % 2 ? 0.05 : 0.03, 6000, 0.8, bus);
    if (pos === 6 && bar % 2 === 1) voice(t + swing, midi(LOUNGE[bar % 4][3] + 12), 0.7, "sine", 0.045, undefined, bus);
  }
}

/** Play a theme on this screen (switching from whatever was playing). Safe to call repeatedly. */
export function startMusic(th: Theme = "bet") {
  if (muted || silent) return;
  if (theme === th && musicTimer) return;
  stopMusic();
  unlockAudio();
  if (!ctx || !master) return;
  bus = ctx.createGain();
  bus.gain.value = 0.0001;
  bus.gain.setTargetAtTime(LEVEL[th], ctx.currentTime, 0.3);
  bus.connect(master);
  theme = th;
  step = 0;
  nextAt = ctx.currentTime + 0.08;
  musicTimer = window.setInterval(() => {
    if (!ctx || !theme) return;
    while (nextAt < ctx.currentTime + 0.3) {
      playStep(theme, step++, nextAt);
      nextAt += 60 / BPM[theme] / 2;
    }
  }, 60);
}

export function stopMusic() {
  if (!musicTimer) return;
  window.clearInterval(musicTimer);
  musicTimer = 0;
  theme = null;
  const b = bus;
  bus = null;
  if (b && ctx) {
    b.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.12);
    window.setTimeout(() => b.disconnect(), 900);
  }
}

function duck(on: boolean) {
  if (bus && ctx && theme) bus.gain.setTargetAtTime(on ? 0.1 : LEVEL[theme], ctx.currentTime, 0.15);
}

/* ---------- the announcer: lines the game wrote, read out by the server's voice ---------- */

const voices = new Map<string, Promise<ArrayBuffer | null>>();

function loadLine(ref: string) {
  let p = voices.get(ref);
  if (!p) {
    const ctl = new AbortController();
    const t = window.setTimeout(() => ctl.abort(), 9000);
    p = fetch("/api/tts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ref }), signal: ctl.signal })
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .then((b) => (b && b.byteLength > 500 ? b : null))
      .catch(() => null)
      .finally(() => window.clearTimeout(t));
    voices.set(ref, p);
    // a failed line can be tried again later
    void p.then((b) => {
      if (!b) voices.delete(ref);
    });
    // keep a handful ready, not the whole night
    if (voices.size > 24) voices.delete(voices.keys().next().value as string);
  }
  return p;
}

/** Start making the audio early, so it is ready when its moment comes. */
export function prefetchLine(ref: string) {
  if (!muted && !silent) void loadLine(ref);
}

let speaking: Promise<void> = Promise.resolve();

/** Say a line out loud; lines queue up instead of talking over each other. */
export function speak(ref: string) {
  if (muted || silent) return;
  const data = loadLine(ref);
  speaking = speaking.then(async () => {
    const buf = await data;
    voices.delete(ref);
    unlockAudio();
    if (!buf || muted || !ctx || !master) return;
    let audio: AudioBuffer;
    try {
      audio = await ctx.decodeAudioData(buf.slice(0));
    } catch {
      return;
    }
    const src = ctx.createBufferSource();
    src.buffer = audio;
    src.connect(master);
    duck(true);
    await new Promise<void>((done) => {
      const t = window.setTimeout(done, audio.duration * 1000 + 800);
      src.onended = () => {
        window.clearTimeout(t);
        done();
      };
      src.start();
    });
    duck(false);
  });
}
