// End-to-end simulation: 8 phones + host + TV against a running server.
// Usage: node scripts/sim.mjs <baseUrl> <adminKey>   (resets the game when done)
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
const bal = (pub, id) => pub.players.find((p) => p.id === id).balance;
const pub = async () => (await view()).pub;

console.log("setup");
let r = await admin("reseed");
ok(r.ok, "reseed as admin");
r = await act("reseed");
ok(!r.ok && /מנחה/.test(r.err), "reseed without key is refused");
await admin("resetGame", { unclaim: true, undeal: true });

const ids = ["itay", "benharoosh", "ayalon", "drori", "birman", "yali", "sisu", "shmay"];
const tokens = {};
console.log("join + automatic missions");
for (const id of ids) {
  r = await act("join", { playerId: id });
  ok(r.ok && r.d.me?.id === id && r.d.me.missions.length === 3, `${id} joined and got 3 missions`);
  tokens[id] = r.r.token;
}
ok((await act("join", { playerId: "drori" })).ok === false, "second device cannot take a claimed name");
const yaliName = (await pub()).players.find((p) => p.id === "yali").name;
ok(yaliName === "יהלי", `name spelled ${yaliName}`);

console.log("missions are secret");
const tv0 = await view();
ok(tv0.pub.reveal === null && !JSON.stringify(tv0).includes("תגרום"), "TV view has no mission text");
for (const id of ids) {
  const v = await view({ token: tokens[id] });
  const mine = v.me.missions;
  ok(mine.every((m) => m.assignedTo === id), `${id} sees only own missions`);
  if (id === "itay") ok(mine.every((m) => m.audience !== "friends"), "groom never gets a mission about himself");
}

console.log("challenge round with a shared pot");
const v0 = await view({ key: KEY });
const r1 = v0.admin.rounds.find((x) => x.kind === "challenge");
await admin("openRound", { roundId: r1.id, seconds: 0 });
ok(!(await act("bet", { roundId: r1.id, optionId: "yes", amount: 100 }, { token: tokens.itay })).ok, "contestant cannot bet");
const plan = { benharoosh: ["yes", 200], ayalon: ["no", 500], drori: ["yes", 50], birman: ["no", 100], yali: ["yes", 300], sisu: ["no", 250], shmay: ["yes", 150] };
for (const [id, [opt, amt]] of Object.entries(plan)) ok((await act("bet", { roundId: r1.id, optionId: opt, amount: amt }, { token: tokens[id] })).ok, `${id} bet ${amt} on ${opt}`);
let p = await pub();
ok(p.round.bets === null && p.round.staked === 1550, "bets hidden while open, staked 1550");
await admin("closeRound", { roundId: r1.id });
await admin("resolveRound", { roundId: r1.id, optionId: "yes" });
p = await pub();
// pot 1550 + 200 bonus = 1750, yes holds 700 → winners get 2.5×
ok(bal(p, "benharoosh") === 1300 && bal(p, "yali") === 1450 && bal(p, "drori") === 1075 && bal(p, "shmay") === 1225, "winners split the pot (×2.5)");
ok(bal(p, "ayalon") === 500 && bal(p, "birman") === 900 && bal(p, "sisu") === 750 && bal(p, "itay") === 1000, "losers pay their stake");
await admin("resolveRound", { roundId: r1.id, optionId: "no" });
p = await pub();
ok(bal(p, "ayalon") === 1529 && bal(p, "benharoosh") === 800, "changing the result re-splits the pot");
await admin("undoResolve", { roundId: r1.id });
ok((await pub()).players.every((x) => x.balance === 1000), "undo puts every balance back");
await admin("resolveRound", { roundId: r1.id, optionId: "yes" });

console.log("night bets run in parallel");
r = await admin("openAllNight");
ok(r.ok && r.r.opened === 7, `opened ${r.r?.opened} night bets`);
const night = (await pub()).night;
const n1 = night.find((x) => x.title.includes("יירדם"));
const n2 = night.find((x) => x.title.includes("פוקר"));
ok((await act("bet", { roundId: n1.id, optionId: "sisu", amount: 300 }, { token: tokens.ayalon })).ok, "ayalon bets 300 on sisu sleeping first");
r = await act("bet", { roundId: n2.id, optionId: "drori", amount: 300 }, { token: tokens.ayalon });
ok(!r.ok, `money already on the table can't be bet twice (${r.err})`);
await act("bet", { roundId: n1.id, optionId: "sisu", amount: 100 }, { token: tokens.drori });
await act("bet", { roundId: n1.id, optionId: "itay", amount: 200 }, { token: tokens.yali });
const r2 = v0.admin.rounds.filter((x) => x.kind === "challenge")[1];
ok((await admin("openRound", { roundId: r2.id, seconds: 0 })).ok, "a challenge can open while night bets are live");
await admin("cancelRound", { roundId: r2.id });
await admin("closeRound", { roundId: n1.id });
await admin("resolveRound", { roundId: n1.id, optionId: "sisu" });
p = await pub();
// pot 600 + 300 bonus = 900, sisu holds 400
ok(bal(p, "ayalon") === 500 + 375 && bal(p, "drori") === 1075 + 125 && bal(p, "yali") === 1450 - 200, "night pot split correctly");
ok(p.feed.some((e) => e.kind === "result" && e.ref === n1.id), "night result announced in the feed");

console.log("missions: instant reward, catching, burning");
const ayalonM = (await view({ token: tokens.ayalon })).me.missions[0];
const before = bal(await pub(), "ayalon");
r = await act("claimMission", { missionId: ayalonM.id }, { token: tokens.ayalon });
p = await pub();
ok(r.ok && bal(p, "ayalon") === before + ayalonM.reward, `marking done pays ${ayalonM.reward} at once`);
const flash = p.feed.find((e) => e.kind === "mission" && e.ref === ayalonM.id);
ok(flash && flash.players.length === 0 && !flash.text.includes(ayalonM.text), "TV flash is anonymous and hides the mission");
ok(!(await act("claimMission", { missionId: ayalonM.id }, { token: tokens.drori })).ok, "cannot claim someone else's mission");
r = await act("accuse", { suspectId: "ayalon", text: "הוא ניסה לגרום לאיתי להגיד משהו" }, { token: tokens.drori });
ok(r.ok, "drori accuses ayalon");
ok(!(await act("accuse", { suspectId: "birman", text: "עוד אחד" }, { token: tokens.drori })).ok, "one open accusation at a time");
const acc = (await view({ key: KEY })).admin.accusations.find((a) => a.by === "drori" && a.status === "pending");
const droriBefore = bal(await pub(), "drori");
r = await admin("judgeAccusation", { accusationId: acc.id, missionId: ayalonM.id });
p = await pub();
ok(r.ok && bal(p, "drori") === droriBefore + 100 && bal(p, "ayalon") === before, "right catch: +100 to the catcher, reward taken back");
const ayalonNow = (await view({ token: tokens.ayalon })).me;
ok(ayalonNow.missions.length === 3 && ayalonNow.burned.length === 1 && ayalonNow.burned[0].by === "drori", "burned mission replaced with a new one");
ok(p.feed.some((e) => e.kind === "caught" && e.players[0] === "drori"), "the catch is announced");
await act("accuse", { suspectId: "birman", text: "הוא בטוח במשימה" }, { token: tokens.yali });
const acc2 = (await view({ key: KEY })).admin.accusations.find((a) => a.by === "yali" && a.status === "pending");
const yaliBefore = bal(await pub(), "yali");
await admin("judgeAccusation", { accusationId: acc2.id });
ok(bal(await pub(), "yali") === yaliBefore - 50, "false accusation costs 50");

console.log("bailout, wheel, awards");
await admin("adjust", { playerId: "sisu", delta: -2000, note: "בדיקה" });
r = await act("requestBailout", {}, { token: tokens.sisu });
ok(r.ok, "broke player asks for a bailout");
ok(!(await act("requestBailout", {}, { token: tokens.shmay })).ok, "rich players cannot ask for a bailout");
const bail = (await view({ key: KEY })).admin.bailouts.find((b) => b.status === "pending");
const sisuBefore = bal(await pub(), "sisu");
await admin("judgeBailout", { bailoutId: bail.id, approve: true });
p = await pub();
ok(bal(p, "sisu") === sisuBefore + 300 && p.feed.some((e) => e.kind === "bailout"), "bailout paid and announced with a dare");
r = await admin("spinWheel", { kind: "drink" });
p = await pub();
ok(r.ok && p.wheel && p.wheel.segments.length === 10 && p.wheel.label === p.wheel.segments[p.wheel.index], "drinking wheel lands on a segment");
r = await admin("spinWheel", { kind: "punish" });
p = await pub();
const lastId = [...p.players].sort((a, b) => a.balance - b.balance)[0].id;
ok(r.ok && p.wheel.kind === "punish" && p.wheel.players[0] === lastId, "punishment wheel targets last place");
await admin("setTv", { mode: "awards" });
await admin("tvStep", { delta: 1 });
p = await pub();
ok(Array.isArray(p.stats) && p.tv.step === 1 && p.stats.find((s) => s.id === "drori").catches === 1, "awards mode publishes stats");
await admin("setTv", { mode: "missions" });
p = await pub();
ok(p.reveal.find((e) => e.playerId === "ayalon").missions.some((m) => m.status === "burned" && m.caughtBy === "drori"), "reveal shows who burned whom");
await admin("setTv", { mode: "lobby" });
ok((await pub()).reveal === null && (await pub()).stats === null, "secrets hidden again");

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
ok(first && first.d.me?.id === "sisu", "socket hello returns sisu's private view");
ws.send("ping");
await admin("setTv", { mode: "board" });
for (let i = 0; i < 50 && !msgs.some((m) => m.t === "s" && m.d.pub.tv.mode === "board"); i++) await sleep(100);
ok(msgs.includes("pong"), "ping/pong heartbeat works");
ok(msgs.some((m) => m.t === "s" && m.d.pub.tv.mode === "board"), "push update arrives after a host action");
ws.close();

console.log("countdown closes betting by itself");
const r3 = v0.admin.rounds.filter((x) => x.kind === "challenge")[2];
await admin("openRound", { roundId: r3.id, seconds: 2 });
await sleep(3200);
ok((await pub()).round.status === "closed", "alarm closed the round");
await admin("cancelRound", { roundId: r3.id });

console.log("reset");
r = await admin("resetGame", { unclaim: true, undeal: true });
p = await pub();
ok(r.ok && p.players.every((x) => x.balance === 1000 && !x.claimed) && p.night.length === 0 && p.feed.length === 0, "reset: clean slate");

console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
