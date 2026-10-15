import { type CSSProperties, useEffect, useState } from "react";
import { cls } from "./lib";

// almonds thrown off the ride: [start x, start y, dx, dy, spin, delay]
const FLYING: [number, number, number, number, number, number][] = [
  [150, 236, -118, -150, -220, 0],
  [176, 232, 112, -168, 260, 0.22],
  [140, 250, -158, -58, -160, 0.48],
  [190, 246, 146, -92, 200, 0.7],
  [160, 228, -46, -204, -300, 0.95],
  [170, 230, 64, -212, 320, 1.2],
];

/** The first open of the night shows the rodeo for a moment, even on a fast connection. */
export function useIntro(ms = 2800) {
  const [on, setOn] = useState(() => {
    try {
      return !sessionStorage.getItem("sgn.intro");
    } catch {
      return false;
    }
  });
  useEffect(() => {
    if (!on) return;
    const id = window.setTimeout(() => {
      setOn(false);
      try {
        sessionStorage.setItem("sgn.intro", "1");
      } catch {
        /* private mode */
      }
    }, ms);
    return () => window.clearTimeout(id);
  }, [on, ms]);
  return on;
}

const RODEO = ["/photos/ai/rodeo-1.jpg", "/photos/ai/rodeo-2.jpg"];
const LOADING = [
  "מחממים את השקדים…",
  "סופרים את הצ׳יפים…",
  "מוודאים שאיתי עדיין רווק…",
  "מנקים את שולחן הפינג פונג…",
  "מדליקים את המנגל…",
  "מקררים את השוטים…",
  "מחממים את הבריכה…",
  "פותחים את הבורסה…",
];

/** The loading screen: the AI picture of Itay riding a golden almond, bucking, with silly status lines. */
export function RodeoPhoto({ size = 300 }: { size?: number }) {
  const [src] = useState(() => RODEO[Math.floor(Math.random() * RODEO.length)]);
  const [line, setLine] = useState(() => Math.floor(Math.random() * LOADING.length));
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const id = window.setInterval(() => setLine((x) => (x + 1) % LOADING.length), 1100);
    return () => window.clearInterval(id);
  }, []);
  return (
    <div className="rodeo-photo" style={{ width: size }}>
      {failed ? (
        <RodeoItay size={size} />
      ) : (
        <div className="rodeo-frame">
          <img src={src} alt="איתי בטוקסידו רוכב על שקד זהב ענק בקזינו" onError={() => setFailed(true)} />
        </div>
      )}
      <p className="rodeo-line" key={line}>
        {LOADING[line]}
      </p>
    </div>
  );
}

/** The loading-screen star: the groom as a bobblehead, riding a bucking mechanical almond. */
export function RodeoItay({ size = 260, className }: { size?: number; className?: string }) {
  return (
    <div className={cls("rodeo", className)} style={{ width: size }} role="img" aria-label="איתי רוכב על שקד ענק כמו בשור מכני">
      <svg viewBox="0 0 320 360" width="100%" aria-hidden="true">
        <defs>
          <linearGradient id="rd-almond" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ffe9a8" />
            <stop offset="0.45" stopColor="#e9b949" />
            <stop offset="1" stopColor="#9c6a17" />
          </linearGradient>
          <linearGradient id="rd-gold" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffe39a" />
            <stop offset="1" stopColor="#c9922f" />
          </linearGradient>
          <clipPath id="rd-face">
            <ellipse cx="165" cy="84" rx="48" ry="56" />
          </clipPath>
          <path id="rd-nut" d="M0 -10 C 7 -5, 7 5, 0 10 C -7 5, -7 -5, 0 -10 Z" />
        </defs>

        <ellipse className="rd-shadow" cx="166" cy="338" rx="112" ry="12" fill="#000" opacity="0.45" />

        <g>
          {FLYING.map(([x, y, dx, dy, r, delay], i) => (
            <use
              key={i}
              href="#rd-nut"
              x={x}
              y={y}
              className="rd-fly"
              fill="url(#rd-almond)"
              stroke="#6e4a22"
              strokeWidth="1.5"
              style={{ "--dx": `${dx}px`, "--dy": `${dy}px`, "--r": `${r}deg`, animationDelay: `${delay}s` } as CSSProperties}
            />
          ))}
        </g>

        <g className="rd-bull">
          {/* tail */}
          <path d="M284 270 C 302 262, 306 246, 296 236" stroke="#8a5a2b" strokeWidth="5" fill="none" strokeLinecap="round" />
          {/* the far horn, behind the body */}
          <path d="M92 230 C 86 212, 92 200, 104 196 C 100 208, 102 220, 108 228 Z" fill="#d8c79f" stroke="#4a2a12" strokeWidth="2" />
          {/* the almond */}
          <path d="M46 266 C 74 212, 198 196, 270 238 C 298 254, 298 288, 272 300 C 198 336, 76 328, 46 266 Z" fill="url(#rd-almond)" stroke="#6e4a22" strokeWidth="3" />
          <g stroke="#9c6a17" strokeWidth="2" fill="none" opacity="0.5" strokeLinecap="round">
            <path d="M92 250 C 142 236, 202 236, 252 256" />
            <path d="M84 276 C 142 266, 212 268, 264 280" />
            <path d="M104 302 C 152 304, 200 304, 242 298" />
          </g>
          {/* the near horn */}
          <path d="M70 240 C 56 222, 60 206, 74 198 C 70 214, 74 226, 84 234 Z" fill="#f3e3c3" stroke="#4a2a12" strokeWidth="2" />
          {/* an angry eye */}
          <circle cx="82" cy="260" r="6.5" fill="#1c1206" />
          <circle cx="84.5" cy="257.5" r="2" fill="#fff" />
          <path d="M70 247 L 95 254" stroke="#1c1206" strokeWidth="4.5" strokeLinecap="round" />
          {/* snorting */}
          <g className="rd-steam" fill="#f3e3c3">
            <circle cx="40" cy="262" r="5" />
            <circle cx="36" cy="272" r="4" style={{ animationDelay: "0.3s" }} />
          </g>
          {/* saddle */}
          <path d="M134 224 C 148 210, 188 208, 202 222 L 206 240 C 186 248, 152 248, 130 240 Z" fill="#8e1b22" stroke="#4a2a12" strokeWidth="2" />
          <path d="M140 232 C 156 238, 184 238, 198 232" stroke="#e9b949" strokeWidth="2" fill="none" strokeDasharray="4 4" />

          <g className="rd-rider">
            {/* leg and shoe */}
            <path d="M162 224 C 152 246, 142 262, 128 272" stroke="#15100a" strokeWidth="17" strokeLinecap="round" fill="none" />
            <ellipse cx="121" cy="277" rx="14" ry="7.5" fill="#050302" />
            <ellipse cx="116" cy="274" rx="5" ry="2" fill="#fff" opacity="0.35" />
            {/* tuxedo */}
            <path d="M130 148 C 138 136, 192 136, 200 148 L 196 216 C 182 226, 148 226, 134 216 Z" fill="#15100a" />
            <path d="M152 140 L 178 140 L 165 198 Z" fill="#f3e3c3" />
            <path d="M150 140 L 165 198 L 138 162 Z" fill="#2c2117" />
            <path d="M180 140 L 165 198 L 192 162 Z" fill="#2c2117" />
            <circle cx="165" cy="172" r="2.2" fill="#15100a" />
            <circle cx="165" cy="184" r="2.2" fill="#15100a" />
            <path d="M151 146 L 165 152 L 151 159 Z M179 146 L 165 152 L 179 159 Z" fill="url(#rd-gold)" stroke="#8a5a2b" strokeWidth="1" />
            <circle cx="165" cy="152.5" r="3.6" fill="#c9922f" />
            {/* holding the reins */}
            <path d="M136 158 C 120 174, 108 188, 98 198" stroke="#15100a" strokeWidth="13" strokeLinecap="round" fill="none" />
            <circle cx="96" cy="200" r="7.5" fill="#d9a07a" />
            <path d="M96 200 C 88 214, 82 226, 78 236" stroke="#8a5a2b" strokeWidth="2.5" fill="none" />
            {/* bobblehead */}
            <rect x="157" y="126" width="16" height="20" rx="6" fill="#d9a07a" />
            <g className="rd-head">
              <ellipse cx="165" cy="84" rx="52.5" ry="60.5" fill="#f3e3c3" />
              <image href="/photos/funny/itay.jpg" x="104" y="26" width="122" height="122" clipPath="url(#rd-face)" />
            </g>
            {/* yee-haw: the other arm waves a cowboy hat (drawn over the head) */}
            <g className="rd-wave">
              <path d="M194 156 C 210 142, 222 122, 230 102" stroke="#15100a" strokeWidth="13" strokeLinecap="round" fill="none" />
              <circle cx="231" cy="99" r="7.5" fill="#d9a07a" />
              <g transform="translate(244 80) rotate(-12)">
                <path d="M-36 2 C -30 12, -14 13, 0 13 C 14 13, 30 12, 36 2 C 34 14, 18 21, 0 21 C -18 21, -34 14, -36 2 Z" fill="#6f4318" stroke="#3a210c" strokeWidth="2" />
                <path d="M-16 13 C -19 -2, -14 -16, -6 -15 C -3 -10, 3 -10, 6 -15 C 14 -16, 19 -2, 16 13 Z" fill="#9a5f26" stroke="#3a210c" strokeWidth="2" />
                <path d="M-16.5 8 C -6 11, 6 11, 16.5 8" stroke="#e9b949" strokeWidth="3.5" fill="none" />
              </g>
            </g>
          </g>
        </g>
      </svg>
    </div>
  );
}
