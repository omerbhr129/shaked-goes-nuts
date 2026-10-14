// End-to-end simulation: 8 phones + host + TV against a running server.
// Usage: node scripts/sim.mjs <baseUrl> <adminKey>
const BASE = process.argv[2] ?? "http://localhost:5173";
const KEY = process.argv[3];
if (!KEY) throw new Error("admin key required");

let failures = 0;
const ok = (cond, msg) => {
  if (cond) console.log("  ✓", msg);
  else {
    failures++;
    console.log("  ✗", msg);
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function act(a, p = {}, { token, key } = {}) {
  const headers = { "content-type": "application/json" };
  if (token) headers["x-token"] = token;
  if (key) headers["x-key"] = key;
  const res = await fetch(`${BASE}/api/act`, { method: "POST", headers, body: JSON.stringify({ a, p }) });
  return res.json();
}
const admin = (a, p) => act(a, p, { key: KEY });
async function view({ token, key } = {}) {
  const headers = {};
  if (token) headers["x-token"] = token;
  if (key) headers["x-key"] = key;
  return (await fetch(`${BASE}/api/view`, { headers })).json();
}
const bal = (v, id) => v.pub.players.find((p) => p.id === id).balance;

console.log("setup");
let r = await admin("reseed");
ok(r.ok, "reseed as admin");
r = await act("reseed");
ok(!r.ok && /מנחה/.test(r.err), "reseed without key is refused");
r = await admin("resetGame", { unclaim: true });
ok(r.ok, "reset game");

const ids = ["itay", "benharoosh", "ayalon", "drori", "birman", "yali", "sisu", "shmay"];
const tokens = {};
console.log("join");
for (const id of ids) {
  r = await act("join", { playerId: id });
  ok(r.ok && r.r.token && r.d.me?.id === id, `${id} joined`);
  tokens[id] = r.r.token;
}
r = await act("join", { playerId: "drori" });
ok(!r.ok, "second device cannot take a claimed name");
r = await act("join", { name: "אורח" });
ok(r.ok && r.d.me, "guest with a new name can join");
const guest = r.r;

console.log("missions are secret");
r = await admin("dealMissions");
ok(r.ok && r.r.dealt >= 24, `missions dealt (${r.r?.dealt})`);
const tv = await view();
ok(tv.pub.reveal === null && !JSON.stringify(tv).includes("תגרום"), "TV view contains no mission text");
ok(tv.me === null && tv.admin === null, "TV gets no private data");
for (const id of ids) {
  const v = await view({ token: tokens[id] });
  const mine = v.me.missions;
  ok(mine.length === 3 && mine.every((m) => m.assignedTo === id), `${id} sees exactly own 3 missions`);
  if (id === "itay") ok(mine.every((m) => m.audience !== "friends"), "groom never gets a mission about himself");
  else ok(mine.every((m) => m.audience !== "groom"), `${id} gets no groom-only mission`);
  const others = v.pub.players.filter((p) => p.id !== id);
  ok(!JSON.stringify(v).includes('"assignedTo":"' + others[0].id + '"'), `${id} view leaks nobody else's missions`);
}
const guestView = await view({ token: guest.token });
ok(guestView.me.missions.length === 3, "late guest got 3 missions automatically");

console.log("round 1: bets stay secret until close");
const v0 = await view({ key: KEY });
const r1 = v0.admin.rounds[0];
r = await admin("openRound", { roundId: r1.id, seconds: 0 });
ok(r.ok && r.d.pub.round?.status === "open" && r.d.pub.tv.mode === "round", "round opened, TV switched to round");
r = await act("bet", { roundId: r1.id, optionId: "yes", amount: 100 }, { token: tokens.itay });
ok(!r.ok, "contestant (groom) cannot bet on his own challenge");
const plan = { benharoosh: ["yes", 200], ayalon: ["no", 500], drori: ["yes", 50], birman: ["no", 100], yali: ["yes", 300], sisu: ["no", 250] };
for (const [id, [opt, amt]] of Object.entries(plan)) {
  r = await act("bet", { roundId: r1.id, optionId: opt, amount: amt }, { token: tokens[id] });
  ok(r.ok, `${id} bet ${amt} on ${opt}`);
}
r = await act("bet", { roundId: r1.id, optionId: "yes", amount: 5000 }, { token: tokens.shmay });
ok(!r.ok, "bet above the max is refused");
r = await act("bet", { roundId: r1.id, optionId: "yes", amount: 20 }, { token: tokens.shmay });
ok(!r.ok, "bet below the min is refused");
r = await act("bet", { roundId: r1.id, optionId: "no", amount: 150 }, { token: tokens.shmay });
r = await act("bet", { roundId: r1.id, optionId: "yes", amount: 150 }, { token: tokens.shmay });
ok(r.ok && r.d.me.bet.optionId === "yes", "a bet can be changed while open");
let pub = (await view()).pub;
ok(pub.round.bets === null, "individual bets hidden while open");
const yes = pub.round.stats.find((s) => s.optionId === "yes");
ok(yes.count === 4 && yes.total === 700, `live stats: yes has 4 bets / 700 (${yes.count}/${yes.total})`);
ok(pub.round.bettors.length === 7, "TV knows who has bet");

r = await admin("closeRound", { roundId: r1.id });
ok(r.ok, "host closed betting");
r = await act("bet", { roundId: r1.id, optionId: "no", amount: 100 }, { token: tokens.yali });
ok(!r.ok, "no betting after close");
pub = (await view()).pub;
ok(Array.isArray(pub.round.bets) && pub.round.bets.length === 7, "all bets revealed after close");

r = await admin("resolveRound", { roundId: r1.id, optionId: "yes" });
ok(r.ok, "host declared YES");
pub = (await view()).pub;
ok(bal({ pub }, "benharoosh") === 1200 && bal({ pub }, "ayalon") === 500 && bal({ pub }, "yali") === 1300 && bal({ pub }, "itay") === 1000, "payouts 1:1 correct");
r = await admin("resolveRound", { roundId: r1.id, optionId: "no" });
pub = (await view()).pub;
ok(bal({ pub }, "benharoosh") === 800 && bal({ pub }, "ayalon") === 1500, "changing the result recalculates");
r = await admin("undoResolve", { roundId: r1.id });
pub = (await view()).pub;
ok(pub.players.every((p) => p.balance === 1000), "undo puts every balance back");
await admin("resolveRound", { roundId: r1.id, optionId: "yes" });

console.log("missions approve flow");
const ayalonMission = (await view({ token: tokens.ayalon })).me.missions[0];
r = await act("claimMission", { missionId: ayalonMission.id }, { token: tokens.drori });
ok(!r.ok, "cannot claim someone else's mission");
r = await act("claimMission", { missionId: ayalonMission.id }, { token: tokens.ayalon });
ok(r.ok && r.d.me.missions.find((m) => m.id === ayalonMission.id).status === "pending", "player claims mission → pending");
const adminView = await view({ key: KEY });
ok(adminView.admin.missions.some((m) => m.id === ayalonMission.id && m.status === "pending"), "host sees the pending request");
r = await admin("reviewMission", { missionId: ayalonMission.id, approve: true });
pub = (await view()).pub;
ok(bal({ pub }, "ayalon") === 500 + ayalonMission.reward, `approval pays ${ayalonMission.reward}`);
ok(!JSON.stringify(pub).includes(ayalonMission.text), "approved mission text still not public");

console.log("realtime");
const ws = new WebSocket(BASE.replace(/^http/, "ws") + "/ws");
const msgs = [];
ws.onmessage = (e) => msgs.push(e.data === "pong" ? "pong" : JSON.parse(e.data));
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = rej;
});
ws.send(JSON.stringify({ t: "hello", token: tokens.sisu }));
for (let i = 0; i < 50 && !msgs.some((m) => m.t === "s"); i++) await sleep(100);
const first = msgs.find((m) => m.t === "s");
ok(first && first.d.me?.id === "sisu" && first.sid, "socket hello returns sisu's private view");
const vBefore = first.d.pub.v;
ws.send("ping");
await admin("setTv", { mode: "board" });
for (let i = 0; i < 50 && !msgs.some((m) => m.t === "s" && m.d.pub.tv.mode === "board"); i++) await sleep(100);
ok(msgs.includes("pong"), "ping/pong heartbeat works");
const latest = msgs.filter((m) => m.t === "s").at(-1);
ok(latest.d.pub.v > vBefore && latest.d.pub.tv.mode === "board", "push update arrives after a host action");
ok(latest.d.pub.players.find((p) => p.id === "sisu").online, "sisu shows online");

console.log("countdown closes betting by itself");
const r2 = v0.admin.rounds[1];
r = await admin("openRound", { roundId: r2.id, seconds: 2 });
ok(r.ok && r.d.pub.round.closesAt, "round 2 opened with 2s timer");
await act("bet", { roundId: r2.id, optionId: "itay", amount: 100 }, { token: tokens.ayalon });
await sleep(3200);
pub = (await view()).pub;
ok(pub.round.status === "closed", `alarm closed the round (status=${pub.round.status})`);
const lastPush = msgs.filter((m) => m.t === "s").at(-1);
ok(lastPush.d.pub.round?.status === "closed", "sockets were told the round closed");
r = await act("bet", { roundId: r2.id, optionId: "itay", amount: 100 }, { token: tokens.drori });
ok(!r.ok, "late bet refused");
r = await admin("cancelRound", { roundId: r2.id });
pub = (await view()).pub;
ok(r.ok && pub.round === null && bal({ pub }, "ayalon") === 500 + ayalonMission.reward, "cancel refunds and clears the round");

console.log("reveal + images");
await admin("setTv", { mode: "missions" });
pub = (await view()).pub;
ok(Array.isArray(pub.reveal) && pub.reveal.some((e) => e.missions.length === 3), "reveal mode publishes missions");
await admin("setTv", { mode: "lobby" });
pub = (await view()).pub;
ok(pub.reveal === null, "missions hidden again after reveal");

const jpeg = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
  "base64",
);
let up = await fetch(`${BASE}/api/upload`, { method: "POST", headers: { "content-type": "image/jpeg", "x-token": tokens.sisu }, body: jpeg }).then((x) => x.json());
ok(up.ok && up.url?.startsWith("/media/"), "player can upload a photo");
const img = await fetch(BASE + up.url);
ok(img.status === 200 && img.headers.get("content-type") === "image/jpeg" && (await img.arrayBuffer()).byteLength === jpeg.length, "uploaded photo is served back intact");
up = await fetch(`${BASE}/api/upload`, { method: "POST", headers: { "content-type": "image/jpeg" }, body: jpeg }).then((x) => x.json());
ok(!up.ok, "anonymous upload refused");

console.log("release + reset");
r = await admin("releasePlayer", { playerId: "shmay" });
const shmayView = await view({ token: tokens.shmay });
ok(shmayView.me === null, "released token no longer works");
r = await act("join", { playerId: "shmay" });
ok(r.ok, "name can be claimed again after release");
ws.close();
r = await admin("resetGame", { unclaim: true });
pub = (await view()).pub;
ok(r.ok && pub.players.every((p) => p.balance === 1000 && !p.claimed), "reset: everyone back to 1000 and unclaimed");
await admin("deletePlayer", { playerId: guest.playerId });
await admin("resetGame", { unclaim: true, undeal: true });

console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
