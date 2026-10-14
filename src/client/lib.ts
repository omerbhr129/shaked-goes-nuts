import type { PlayerPub } from "../shared/types";

export const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
export const signed = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "") + fmt(Math.abs(n));
export const pct = (balance: number, start: number) => (start ? ((balance - start) / start) * 100 : 0);
export const cls = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

export const reducedMotion = () =>
  typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export function mmss(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function photoOf(p: Pick<PlayerPub, "id" | "photo">) {
  return p.photo ?? `/photos/${p.id}.jpg`;
}

export function ranked(players: PlayerPub[]) {
  return [...players].sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name, "he"));
}

/** Shrink a camera photo before upload: phones produce 4–12 MB images we never need. */
export async function resizeImage(file: File, max = 900, quality = 0.82): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => rej(new Error("לא הצלחנו לקרוא את התמונה"));
      im.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
    return await new Promise<Blob>((res, rej) =>
      canvas.toBlob((b) => (b ? res(b) : rej(new Error("לא הצלחנו לעבד את התמונה"))), "image/jpeg", quality),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Keep the screen awake (TV, and phones during a live round). */
export async function keepAwake(): Promise<() => void> {
  try {
    const nav = navigator as Navigator & { wakeLock?: { request(t: "screen"): Promise<{ release(): Promise<void> }> } };
    const lock = await nav.wakeLock?.request("screen");
    return () => void lock?.release();
  } catch {
    return () => {};
  }
}

export function lsGet(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
export function lsSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}
