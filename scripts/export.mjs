// Saves everything from a party before the site comes down: every photo and video people sent,
// the messages that went to the TV, the final standings and a full backup of the game.
// Usage: node scripts/export.mjs <baseUrl> <adminKey> [folder]
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.argv[2];
const KEY = process.argv[3];
const DIR = process.argv[4] ?? "party-export";
if (!BASE || !KEY) throw new Error("usage: node scripts/export.mjs <baseUrl> <adminKey> [folder]");
const H = { "x-key": KEY };

const listRes = await fetch(`${BASE}/api/export`, { headers: H });
if (!listRes.ok) throw new Error(`export list failed: ${listRes.status} (wrong host code?)`);
const { items } = await listRes.json();
const view = await (await fetch(`${BASE}/api/view`, { headers: H })).json();
const { pub, admin } = view;

const name = (id) => pub.players.find((p) => p.id === id)?.name ?? "מישהו";
// anonymous stays anonymous: the host can see who it was, but this folder gets passed around
const who = (s) => (s.anon ? "אנונימי" : name(s.author));
const clock = (t) => new Date(t).toLocaleTimeString("he-IL", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hour12: false }).replace(":", "-");
const clean = (t) => (t ?? "").replace(/[\/\\:*?"<>|\n\r]+/g, " ").trim().slice(0, 40);

// a readable name for every file, from whoever sent it
const label = new Map();
const shouts = [...admin.shouts].sort((a, b) => a.at - b.at);
for (const s of shouts)
  for (const url of [s.photo, s.video]) if (url?.startsWith("/media/")) label.set(url.slice(7), `${clock(s.at)} ${who(s)}${s.text ? ` - ${clean(s.text)}` : ""}`);
for (const r of admin.rounds) {
  if (r.image?.startsWith("/media/")) label.set(r.image.slice(7), `תמונה לסיבוב - ${clean(r.title)}`);
  for (const o of r.options) if (o.photo?.startsWith("/media/")) label.set(o.photo.slice(7), `תחרות תמונות - ${clean(o.label)}`);
}
for (const p of pub.players) if (p.photo?.startsWith("/media/")) label.set(p.photo.slice(7), `תמונת פרופיל - ${p.name}`);

const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm", "video/3gpp": "3gp", "video/x-m4v": "m4v" };
mkdirSync(join(DIR, "תמונות"), { recursive: true });
mkdirSync(join(DIR, "סרטונים"), { recursive: true });

const taken = new Set();
let saved = 0;
let unsent = 0;
const skipped = [];
for (const it of items) {
  const res = await fetch(`${BASE}/media/${it.id}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!res.ok || (it.size != null && buf.length !== it.size)) throw new Error(`${it.id}: got ${buf.length} bytes (${res.status}), expected ${it.size}`);
  const video = it.type.startsWith("video/");
  // leftovers from testing: tiny placeholder images, and "videos" without a real container header
  const realVideo = buf.subarray(4, 8).toString("latin1") === "ftyp" || buf.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  if ((video && !realVideo) || (!video && buf.length < 1000)) {
    skipped.push(it.id);
    continue;
  }
  let base = label.get(it.id);
  if (!base) base = `הועלתה ולא נשלחה למסך ${++unsent}`;
  let file = base;
  for (let n = 2; taken.has(file); n++) file = `${base} (${n})`;
  taken.add(file);
  writeFileSync(join(DIR, video ? "סרטונים" : "תמונות", `${file}.${EXT[it.type] ?? "bin"}`), buf);
  saved++;
}

const ranked = [...pub.players].sort((a, b) => b.balance - a.balance);
const summary = [
  "סיכום הערב",
  "",
  "הדירוג הסופי:",
  ...ranked.map((p, i) => `${i + 1}. ${p.name} - ${p.balance.toLocaleString("en-US")} שקדים`),
  "",
  "הודעות שנשלחו למסך:",
  ...shouts.map((s) => `${clock(s.at)}  ${who(s)}: ${s.video ? "[סרטון] " : s.photo ? "[תמונה] " : ""}${s.text ?? ""}`),
];
writeFileSync(join(DIR, "סיכום הערב.txt"), summary.join("\n") + "\n");
writeFileSync(join(DIR, "גיבוי נתוני המשחק.json"), JSON.stringify(view, null, 1));

console.log(`saved ${saved} of ${items.length} files to ${DIR}${skipped.length ? `, skipped ${skipped.length} test leftovers` : ""}`);
