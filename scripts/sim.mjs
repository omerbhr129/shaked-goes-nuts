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
  const slots = (m) => new Set([...m.template.matchAll(/\{([GXY])\}/g)].map((x) => x[1]));
  ok(
    mine.every((m) => !Object.values(m.targets).includes(id) && !/\{[GXY]\}/.test(m.text) && Object.keys(m.targets).length === slots(m).size && !(m.targets.X && m.targets.X === m.targets.Y)),
    `${id}: every mission names other people, never himself (${mine.map((m) => m.text).join(" | ")})`,
  );
  if (id === "itay") ok(mine.every((m) => m.audience !== "friends" && !m.template.includes("{G}")), "groom never gets a mission about himself");
  else ok(mine.filter((m) => m.template.includes("{G}")).length === 1, `${id}: exactly one mission about the groom, the rest about the guys`);
}

console.log("host writes a mission with a name slot");
r = await admin("saveMission", { mission: { template: "תגרום ל{X} לקרוא לך ״אבא״ בקול", reward: 150, audience: "all", assignedTo: "drori" } });
const dm = (await view({ token: tokens.drori })).me.missions.find((m) => m.id === r.r?.id);
ok(r.ok && dm && !dm.text.includes("{X}") && dm.targets.X && dm.targets.X !== "drori", `slot filled in: ${dm?.text}`);
await admin("deleteMission", { missionId: r.r.id });
const gm = (await admin("saveMission", { mission: { template: "תגרום ל{G} להגיד ״בדיקה״", reward: 100, audience: "friends" } })).r.id;
r = await admin("assignMission", { missionId: gm, playerId: "itay" });
ok(!r.ok, `a mission about the groom can't go to the groom (${r.err})`);
await admin("deleteMission", { missionId: gm });

console.log("challenge round with a shared pot");
const v0 = await view({ key: KEY });
const r1 = v0.admin.rounds.find((x) => x.kind === "challenge");
await admin("openRound", { roundId: r1.id, seconds: 0 });
ok(!(await act("bet", { roundId: r1.id, optionId: "yes", amount: 100 }, { token: tokens.itay })).ok, "contestant cannot bet");
const plan = { benharoosh: ["yes", 200], ayalon: ["no", 500], drori: ["yes", 50], birman: ["no", 100], yali: ["yes", 300], sisu: ["no", 250], shmay: ["yes", 150] };
for (const [id, [opt, amt]] of Object.entries(plan)) ok((await act("bet", { roundId: r1.id, optionId: opt, amount: amt }, { token: tokens[id] })).ok, `${id} bet ${amt} on ${opt}`);
let p = await pub();
ok(p.round.bets === null && p.round.staked === 1550 && p.round.stats.every((x) => x.count === 0 && x.total === 0), "while open nobody sees the split, only the pot (1550)");
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
p = await pub();
ok(p.round.lines.win && p.round.lines.lose && p.round.task, `funny lines and a task for the losers: ${p.round.lines.lose} → ${p.round.task}`);
ok(JSON.stringify([...p.round.losers].sort()) === JSON.stringify(["ayalon", "birman", "sisu"]), "the losers of the challenge are on the hook");

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
r = await act("bet", { roundId: n2.id, optionId: "drori", amount: 250 }, { token: tokens.drori });
ok(!r.ok && /עד 300/.test(r.err), `night bets have a total cap: ${r.err}`);
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

console.log("missions: anonymous alert, catch window, the one who got played pays");
await admin("saveSettings", { settings: { catchWindow: 3 } });
const ayalonM = (await view({ token: tokens.ayalon })).me.missions.find((m) => Object.keys(m.targets).length === 1);
const victim = Object.values(ayalonM.targets)[0];
const before = bal(await pub(), "ayalon");
const victimBefore = bal(await pub(), victim);
r = await act("claimMission", { missionId: ayalonM.id }, { token: tokens.ayalon });
p = await pub();
const alert = p.feed.find((e) => e.kind === "mission" && e.ref === ayalonM.id);
ok(r.ok && bal(p, "ayalon") === before && alert && alert.players.length === 0 && alert.data?.until > Date.now() - 5000, `claim: an anonymous alert, no money yet: ${alert?.text}`);
ok(!JSON.stringify(p).includes(ayalonM.text), "the mission itself stays secret");
ok(!(await act("claimMission", { missionId: ayalonM.id }, { token: tokens.drori })).ok, "cannot claim someone else's mission");
for (let i = 0; i < 60 && !(await pub()).feed.some((e) => e.kind === "reveal" && e.ref === ayalonM.id); i++) await sleep(200);
p = await pub();
const reveal = p.feed.find((e) => e.kind === "reveal" && e.ref === ayalonM.id);
ok(reveal && reveal.players[0] === "ayalon" && reveal.players.includes(victim), `window over, nobody caught him: ${reveal?.text}`);
ok(bal(p, "ayalon") === before + ayalonM.reward && bal(p, victim) === victimBefore - ayalonM.reward, `${victim} pays ayalon ${ayalonM.reward}`);
r = await act("accuse", { suspectId: "ayalon", text: "הוא ניסה לגרום למישהו להגיד משהו" }, { token: tokens.drori });
ok(r.ok, "drori accuses ayalon");
ok(!(await act("accuse", { suspectId: "birman", text: "עוד אחד" }, { token: tokens.drori })).ok, "one open accusation at a time");
const acc = (await view({ key: KEY })).admin.accusations.find((a) => a.by === "drori" && a.status === "pending");
const droriBefore = bal(await pub(), "drori");
r = await admin("judgeAccusation", { accusationId: acc.id, missionId: ayalonM.id });
p = await pub();
ok(r.ok && bal(p, "drori") === droriBefore + ayalonM.reward && bal(p, "ayalon") === before - ayalonM.reward && bal(p, victim) === victimBefore, "right catch: the catcher steals its worth, the victim gets his money back");
const ayalonNow = (await view({ token: tokens.ayalon })).me;
ok(ayalonNow.missions.length === 3 && ayalonNow.burned.length === 1 && ayalonNow.burned[0].by === "drori", "burned mission replaced with a new one");
ok(p.feed.some((e) => e.kind === "caught" && e.players[0] === "drori" && e.data?.mission === ayalonM.id), "the catch is announced");
await act("accuse", { suspectId: "birman", text: "הוא בטוח במשימה" }, { token: tokens.yali });
const acc2 = (await view({ key: KEY })).admin.accusations.find((a) => a.by === "yali" && a.status === "pending");
const yaliBefore = bal(await pub(), "yali");
const birmanBefore = bal(await pub(), "birman");
await admin("judgeAccusation", { accusationId: acc2.id });
p = await pub();
ok(bal(p, "yali") === yaliBefore - 50 && bal(p, "birman") === birmanBefore + 50, "false accusation: 50 go to the suspect");
const shmayM = (await view({ token: tokens.shmay })).me.missions[0];
await act("claimMission", { missionId: shmayM.id }, { token: tokens.shmay });
r = await admin("reviewMission", { missionId: shmayM.id, approve: true });
ok(r.ok && (await pub()).feed.some((e) => e.kind === "reveal" && e.ref === shmayM.id), "the host can approve right away");
await admin("saveSettings", { settings: { catchWindow: 90 } });

console.log("gifts, the screen, emojis");
const bhBefore = bal(await pub(), "benharoosh");
r = await act("gift", { to: "itay", item: "tophat" }, { token: tokens.benharoosh });
p = await pub();
ok(r.ok && p.players.find((x) => x.id === "itay").hat === "🎩" && bal(p, "benharoosh") === bhBefore - 40, "ben harush buys itay a top hat for 40");
ok(p.feed.some((e) => e.kind === "gift" && e.players[1] === "itay"), `the gift is announced: ${p.feed.findLast((e) => e.kind === "gift")?.text}`);
ok((await act("gift", { to: "sisu", item: "poop" }, { token: tokens.sisu })).ok && (await pub()).players.find((x) => x.id === "sisu").hat === "💩", "you can buy yourself one too");
r = await act("shout", { text: "איתי, עוד לא מאוחר לברוח", anon: true }, { token: tokens.yali });
p = await pub();
const sh = p.shouts.at(-1);
ok(r.ok && sh.by === null && sh.text.includes("לברוח"), "anonymous message on the TV");
ok((await view({ key: KEY })).admin.shouts[0].author === "yali", "the host still sees who sent it");
ok(!(await act("shout", { text: "שוב" }, { token: tokens.yali })).ok, "slow down between messages");
await admin("hideShout", { shoutId: sh.id });
ok(!(await pub()).shouts.some((x) => x.id === sh.id), "the host can pull a message off the screen");
ok((await act("react", { emoji: "🔥" }, { token: tokens.drori })).ok, "emoji to the TV");
ok(!(await act("react", { emoji: "🦖" }, { token: tokens.drori })).ok, "only emojis from the list");

console.log("quiz: right answers pay, wrong or silent ones drink");
const vq = (await view({ key: KEY })).admin.rounds;
const order = vq.filter((x) => x.kind !== "night").map((x) => x.kind);
ok(order[2] === "quiz" && order[5] === "vote" && order[8] === "quiz", "after every two challenges: a quiz or a vote, taking turns");
const q2 = vq.find((x) => x.id === "q2");
ok(q2.correctId === "o2", "almond quiz has its answer set in advance");
await admin("openRound", { roundId: q2.id, seconds: 0 });
const qb = Object.fromEntries((await pub()).players.map((x) => [x.id, x.balance]));
const answer = (id, optionId) => act("bet", { roundId: q2.id, optionId, amount: 999 }, { token: tokens[id] });
for (const [id, o] of [["shmay", "o2"], ["ayalon", "o1"], ["drori", "o2"], ["yali", "o3"], ["birman", "o4"], ["itay", "o2"], ["benharoosh", "o2"]]) await answer(id, o);
await answer("yali", "o2");
p = await pub();
ok(p.round.kind === "quiz" && p.round.bets === null && p.round.stats.every((x) => x.count === 0), "while open nobody sees how others answered");
ok(p.round.bettors.length === 7 && p.round.staked === 0, "answers cost nothing");
ok((await view({ token: tokens.yali })).me.bets[q2.id].optionId === "o2", "an answer can be changed while open");
await admin("closeRound", { roundId: q2.id });
p = await pub();
ok(p.round.status === "resolved" && p.round.winnerId === "o2", "closing a quiz with a known answer reveals it right away");
const qd = (id) => bal(p, id) - qb[id];
ok(qd("shmay") === 150 && qd("drori") === 100 && qd("yali") === 100 && qd("itay") === 100 && qd("benharoosh") === 100, "right: +100, fastest +50 more");
ok(qd("ayalon") === 0 && qd("birman") === 0 && qd("sisu") === 0, "wrong answers cost no almonds");
ok(JSON.stringify(p.round.losers) === JSON.stringify(["ayalon", "birman", "sisu"]) && p.round.loserReason === "wrong", `wrong and silent drink: ${p.round.losers}`);
const shot = p.feed.find((e) => e.kind === "shot" && e.ref === q2.id);
ok(shot && shot.players.length === 3 && shot.text.includes("שוט"), `shot announced: ${shot?.text}`);
ok(p.round.lines.fast?.includes("שמאי") && p.round.lines.shot?.includes("סיסו") && p.round.lines.shot?.includes("איילון"), `fastest praised, the rest roasted: ${p.round.lines.fast} | ${p.round.lines.shot}`);
ok(p.round.bets.length === 7 && p.round.results.find((x) => x.playerId === "shmay").delta === 150, "after the reveal everyone sees who answered what");

console.log("quiz: everyone right → the slowest drinks, and it closes itself");
const q5 = vq.find((x) => x.kind === "quiz" && x.correctId && x.id !== "q2");
await admin("openRound", { roundId: q5.id, seconds: 0 });
for (const id of ids) await act("bet", { roundId: q5.id, optionId: "o1", amount: 0 }, { token: tokens[id] });
p = await pub();
ok(p.round.status === "resolved", "last answer closed the quiz and revealed it");
ok(p.round.losers.length === 1 && p.round.losers[0] === ids[ids.length - 1] && p.round.loserReason === "slow", `slowest drinks: ${p.round.losers}`);
ok(p.round.lines.slow?.includes("שמאי"), `the slow one gets roasted: ${p.round.lines.slow}`);

console.log("quiz: Itay answers live, the host picks the answer");
const q1 = vq.find((x) => x.id === "q1");
await admin("openRound", { roundId: q1.id, seconds: 0 });
ok(!(await act("bet", { roundId: q1.id, optionId: "o1", amount: 0 }, { token: tokens.itay })).ok, "the groom doesn't answer a question about himself");
for (const id of ids.filter((x) => x !== "itay")) await act("bet", { roundId: q1.id, optionId: id === "sisu" ? "o2" : "o1", amount: 0 }, { token: tokens[id] });
p = await pub();
ok(p.round.status === "closed", "everyone answered → closed, waiting for Itay");
const sisuQ = bal(p, "sisu");
await admin("resolveRound", { roundId: q1.id, optionId: "o2" });
p = await pub();
ok(p.round.losers.length === 6 && !p.round.losers.includes("itay") && !p.round.losers.includes("sisu"), "host's pick decides who drinks");
await admin("undoResolve", { roundId: q1.id });
p = await pub();
ok(p.round.status === "closed" && p.round.losers.length === 0 && bal(p, "sisu") === sisuQ, "a quiz result can be undone");
await admin("cancelRound", { roundId: q1.id });

console.log("quiz: the host writes one, the timer reveals it");
r = await admin("saveRound", { round: { kind: "quiz", emoji: "❓", title: "בדיקה: כמה זה 2+2?", options: [{ label: "4" }, { label: "5" }], correctIndex: null } });
ok(r.ok && (await view({ key: KEY })).admin.rounds.find((x) => x.id === r.r.id).correctId === null, "no answer picked → the host decides at the reveal");
r = await admin("saveRound", { round: { kind: "quiz", emoji: "❓", title: "בדיקה: כמה זה 2+2?", options: [{ label: "5" }, { label: "4" }], correctIndex: 1 } });
const tq = (await view({ key: KEY })).admin.rounds.find((x) => x.id === r.r.id);
ok(tq.correctId === tq.options[1].id && tq.reward === 100 && tq.seconds === 25, "answer, reward and timer saved");
await admin("openRound", { roundId: tq.id, seconds: 2 });
await act("bet", { roundId: tq.id, optionId: tq.options[1].id, amount: 0 }, { token: tokens.birman });
await sleep(3300);
p = await pub();
ok(p.round.status === "resolved" && p.round.losers.length === 7 && !p.round.losers.includes("birman"), "time up → revealed by itself, the silent drink");
await admin("cancelRound", { roundId: tq.id });
await admin("deleteRound", { roundId: tq.id });
for (const r0 of (await view({ key: KEY })).admin.rounds.filter((x) => x.title.startsWith("בדיקה"))) await admin("deleteRound", { roundId: r0.id });

console.log("quick one-on-one");
r = await admin("quickDuel", { game: "pingpong", a: "drori", b: "yali" });
p = await pub();
ok(r.ok && p.round.game === "pingpong" && p.round.noBet.includes("drori") && p.round.title.includes("פינג פונג"), `duel open: ${p.round.title}`);
await act("bet", { roundId: r.r.id, optionId: "yali", amount: 100 }, { token: tokens.shmay });
await admin("closeRound", { roundId: r.r.id });
await admin("resolveRound", { roundId: r.r.id, optionId: "drori" });
p = await pub();
ok(p.round.lines.duel?.includes("דרורי") && p.round.lines.duel.includes("יהלי") && p.round.lines.duelLoser === "יהלי", `the winner gets a line about the game: ${p.round.lines.duel}`);

console.log("review fixes");
const doneM = (await view({ key: KEY })).admin.missions.find((m) => m.status === "done" && Object.keys(m.targets).length);
if (doneM) {
  const sumBefore = (await pub()).players.reduce((a, x) => a + x.balance, 0);
  r = await admin("saveMission", { mission: { id: doneM.id, template: doneM.template, reward: doneM.reward, audience: doneM.audience, assignedTo: doneM.assignedTo } });
  ok(r.ok && (await pub()).players.reduce((a, x) => a + x.balance, 0) === sumBefore, "editing a paid mission doesn't create almonds");
  ok(!(await admin("saveMission", { mission: { id: doneM.id, template: doneM.template, reward: doneM.reward + 50, audience: doneM.audience, assignedTo: doneM.assignedTo } })).ok, "a paid mission's reward can't change");
}
const spamM = (await view({ token: tokens.yali })).me.missions.find((m) => m.status === "open");
await act("claimMission", { missionId: spamM.id }, { token: tokens.yali });
await act("unclaimMission", { missionId: spamM.id }, { token: tokens.yali });
ok(!(await act("claimMission", { missionId: spamM.id }, { token: tokens.yali })).ok, "no claim/cancel spam on the TV");
ok((await pub()).feed.filter((e) => e.kind === "mission" && e.ref === spamM.id).every((e) => e.data.until <= Date.now() + 1000), "a cancelled claim ends its countdown");
await act("gift", { to: "drori", item: "beer" }, { token: tokens.birman });
ok(!(await act("gift", { to: "drori", item: "beer" }, { token: tokens.birman })).ok, "gifts have a short cooldown");
const joinNew = await act("join", { name: "בדיקה" });
ok(!joinNew.ok, "only the 8 names can join");

console.log("random draw from the pool");
const drawn = await admin("drawRound", { kind: "challenge" });
p = await pub();
ok(drawn.ok && p.round.id === drawn.r.id && p.draw?.roundId === drawn.r.id && p.draw.titles[p.draw.index].includes(p.round.title), `the wheel lands on it: ${drawn.r?.title}`);
const bettor = ids.find((id) => !p.round.noBet.includes(id));
const early = await act("bet", { roundId: drawn.r.id, optionId: p.round.options[0].id, amount: 50 }, { token: tokens[bettor] });
ok(!early.ok && /מגרילים/.test(early.err), "no bets while the reel spins");
const again = await admin("drawRound", { kind: "challenge", redraw: true });
ok(again.ok && again.r.id !== drawn.r.id, "draw again while nobody has bet");
p = await pub();
const bettor2 = ids.find((id) => !p.round.noBet.includes(id));
await sleep(8300);
ok((await act("bet", { roundId: again.r.id, optionId: p.round.options[0].id, amount: 50 }, { token: tokens[bettor2] })).ok, "after the reel, bets are open");
ok(!(await admin("drawRound", { kind: "challenge", redraw: true })).ok, "no redraw once someone has bet");
await admin("cancelRound", { roundId: again.r.id });
ok((await admin("drawRound", { kind: "quiz" })).ok && (await pub()).round.kind === "quiz", "a random quiz too");
await admin("cancelRound", { roundId: (await pub()).round.id });
const before50 = Object.fromEntries((await pub()).players.map((x) => [x.id, x.balance]));
r = await admin("drawRound", { kind: "any", pick: "rain" });
p = await pub();
ok(r.ok && r.r.surprise === "rain" && p.draw.surprise === "rain" && p.draw.kinds[p.draw.index] === "s" && !p.draw.roundId, `the mixed wheel can land on a surprise: ${r.r?.title}`);
ok(p.players.every((x) => !x.claimed || x.balance === before50[x.id] + 50) && p.feed.some((e) => e.kind === "spin" && e.data?.surprise === "rain"), "rain: 50 for everyone who plays");
r = await admin("drawRound", { kind: "any", pick: "shots" });
ok(r.ok && (await pub()).feed.findLast((e) => e.kind === "spin").players.length === 8, "shots for everybody");
r = await admin("drawRound", { kind: "any" });
p = await pub();
ok(r.ok && p.draw.titles.length >= 8 && p.draw.kinds.includes("s"), `a mixed wheel of ${p.draw.titles.length}: ${p.draw.titles[p.draw.index]}`);
if (p.round && p.round.status === "open") await admin("cancelRound", { roundId: p.round.id });

console.log("announcer");
const said = (await pub()).feed.at(-1);
const tts = await fetch(`${BASE}/api/tts`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ref: `feed:${said.id}` }) });
ok(tts.ok && tts.headers.get("content-type") === "audio/mpeg" && (await tts.arrayBuffer()).byteLength > 2000, "a line from the game comes back as speech");
const nope = await fetch(`${BASE}/api/tts`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ref: "feed:nonsense" }) });
ok(nope.status === 404, "anything else is refused");

console.log("bailout, wheel, awards");
await admin("adjust", { playerId: "sisu", delta: -2000, note: "בדיקה" });
p = await pub();
const brokeEv = p.feed.find((e) => e.kind === "broke" && e.players[0] === "sisu");
ok(brokeEv && brokeEv.data?.task, `going broke puts him on the TV with a task: ${brokeEv?.text}`);
const bail = (await view({ key: KEY })).admin.bailouts.find((b) => b.status === "pending" && b.playerId === "sisu");
ok(bail && bail.dare === brokeEv.data.task, "and opens a bailout for the host with that task");
ok(!(await act("requestBailout", {}, { token: tokens.sisu })).ok, "no double bailout requests");
ok(!(await act("requestBailout", {}, { token: tokens.shmay })).ok, "rich players cannot ask for a bailout");
const sisuBefore = bal(await pub(), "sisu");
await admin("judgeBailout", { bailoutId: bail.id, approve: true });
p = await pub();
ok(bal(p, "sisu") === sisuBefore + 300 && p.feed.some((e) => e.kind === "bailout" && e.text.includes(bail.dare)), "bailout paid, with the same task");
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
ok(p.stats.find((s) => s.id === "shmay").quizRight === 2 && p.stats.find((s) => s.id === "ayalon").shots === 1, "quiz stats for the 🧠 and 🥃 awards");
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

console.log("no reopening after the bets came out, no double moments");
const rx = v0.admin.rounds.filter((x) => x.kind === "challenge")[3];
await admin("openRound", { roundId: rx.id, seconds: 0 });
await admin("closeRound", { roundId: rx.id });
ok(!(await admin("extendRound", { roundId: rx.id, seconds: 30 })).ok, "a closed round can't be reopened");
await admin("resolveRound", { roundId: rx.id, optionId: rx.options[0].id });
const feedLen = (await pub()).feed.length;
await admin("resolveRound", { roundId: rx.id, optionId: rx.options[0].id });
ok((await pub()).feed.length === feedLen, "deciding the same result twice changes nothing");
await admin("cancelRound", { roundId: rx.id });

console.log("countdown closes betting by itself");
const r3 = v0.admin.rounds.filter((x) => x.kind === "challenge")[2];
await admin("openRound", { roundId: r3.id, seconds: 2 });
await sleep(3200);
ok((await pub()).round.status === "closed", "alarm closed the round");
await admin("cancelRound", { roundId: r3.id });

/* ---------- the night's extras: votes, kings, streaks, the double, the final, the groom's cards ---------- */

const rounds = async () => (await view({ key: KEY })).admin.rounds;
const draft = async (pred) => (await rounds()).find((x) => x.status === "draft" && pred(x));
// throwaway yes/no challenges nobody sits out (a reseed at the end clears them)
let mkN = 0;
async function mk() {
  const yn = [
    { id: "yes", label: "כן" },
    { id: "no", label: "לא" },
  ];
  const made = await admin("saveRound", { round: { kind: "challenge", emoji: "🧪", title: `בדיקה ${++mkN}`, note: "", options: yn, minBet: 50, maxBet: 500, seconds: 0, bonus: 200, noBet: [] } });
  return (await rounds()).find((x) => x.id === made.r.id);
}
for (const id of ids) await admin("adjust", { playerId: id, delta: 2000, note: "test" });

console.log("vote: the most votes drinks, the majority earns");
let vr = await draft((x) => x.kind === "vote");
ok(vr.options.length === 8 && vr.seconds === 40 && vr.reward === 100, "a vote has every player as an option");
ok((await admin("openRound", { roundId: vr.id, seconds: 0 })).ok, "a vote opens");
r = await act("bet", { roundId: vr.id, optionId: "itay", amount: 0 }, { token: tokens.itay });
ok(!r.ok, `nobody votes for himself (${r.err})`);
let vBefore = await pub();
for (const id of ["itay", "benharoosh", "ayalon", "birman", "sisu"]) await act("bet", { roundId: vr.id, optionId: "drori", amount: 0 }, { token: tokens[id] });
await act("bet", { roundId: vr.id, optionId: "yali", amount: 0 }, { token: tokens.shmay });
await act("bet", { roundId: vr.id, optionId: "yali", amount: 0 }, { token: tokens.drori });
let vp = await pub();
ok(vp.round.status === "open" && vp.round.bets === null && vp.round.stats.every((x) => x.count === 0), "votes stay secret while it's open");
await act("bet", { roundId: vr.id, optionId: "drori", amount: 0 }, { token: tokens.yali });
vp = await pub();
ok(vp.round.status === "resolved" && vp.round.losers.join() === "drori" && vp.round.loserReason === "voted", "everyone voted → it counts itself, drori drinks");
ok(bal(vp, "itay") - bal(vBefore, "itay") === 100 && bal(vp, "yali") - bal(vBefore, "yali") === 100 && bal(vp, "shmay") === bal(vBefore, "shmay"), "the majority gets +100, the rest nothing");
ok(vp.feed.some((e) => e.kind === "shot" && e.ref === vr.id && e.players.join() === "drori") && !!vp.round.lines.voted && !!vp.round.lines.majority, "the chosen one drinks, with a line for the TV");
ok(vp.round.bets.length === 8, "after the count everybody sees who voted for whom");

console.log("vote: a tie means both drink, the host can count early, nobody voting means everybody drinks");
vr = await draft((x) => x.kind === "vote");
await admin("openRound", { roundId: vr.id, seconds: 0 });
for (const [id, to] of [["ayalon", "sisu"], ["birman", "sisu"], ["drori", "yali"], ["shmay", "yali"]]) await act("bet", { roundId: vr.id, optionId: to, amount: 0 }, { token: tokens[id] });
await admin("closeRound", { roundId: vr.id });
vp = await pub();
ok(vp.round.status === "resolved" && [...vp.round.losers].sort().join() === "sisu,yali", "a tie: both drink");
vr = await draft((x) => x.kind === "vote");
await admin("openRound", { roundId: vr.id, seconds: 2 });
await sleep(3300);
vp = await pub();
ok(vp.round.status === "resolved" && vp.round.refunded && vp.round.losers.length === 8, "nobody voted before the timer: everybody drinks");
r = await admin("drawRound", { kind: "vote" });
ok(r.ok && (await rounds()).find((x) => x.id === r.r.id)?.kind === "vote", "the wheel can land on a vote");
await admin("cancelRound", { roundId: r.r.id });

console.log("the wheel's double: the next round pays ×2");
r = await admin("drawRound", { kind: "any", pick: "double" });
ok(r.ok && r.r.surprise === "double" && (await pub()).doubleNext === true, "the wheel landed on 'next round is double'");
let ch = await mk();
await admin("openRound", { roundId: ch.id, seconds: 0 });
vp = await pub();
ok(vp.round.mult === 2 && vp.doubleNext === false, "the next round picked up the double");
await act("bet", { roundId: ch.id, optionId: "yes", amount: 100 }, { token: tokens.ayalon });
await act("bet", { roundId: ch.id, optionId: "yes", amount: 100 }, { token: tokens.birman });
await act("bet", { roundId: ch.id, optionId: "no", amount: 100 }, { token: tokens.sisu });
await admin("closeRound", { roundId: ch.id });
await admin("resolveRound", { roundId: ch.id, optionId: "yes" });
let res = (await pub()).round.results;
const dOf = (id) => res.find((x) => x.playerId === id)?.delta;
// pot 300 + 200 bonus = 500, yes holds 200 → 150 profit each, doubled
ok(dOf("ayalon") === 300 && dOf("birman") === 300 && dOf("sisu") === -100, `double pays twice the profit, losers lose only their stake (${dOf("ayalon")}, ${dOf("sisu")})`);
r = await admin("drawRound", { kind: "any", pick: "double" });
ch = await mk();
await admin("openRound", { roundId: ch.id, seconds: 0 });
await admin("cancelRound", { roundId: ch.id });
ok((await pub()).doubleNext === true, "a cancelled double round hands the double on");
ch = await mk();
await admin("openRound", { roundId: ch.id, seconds: 0 });
await admin("cancelRound", { roundId: ch.id });
await admin("resetGame", {});
ok((await pub()).doubleNext === false, "a reset clears the double");
for (const id of ids) await admin("adjust", { playerId: id, delta: 2000, note: "test" });

console.log("the final: bet everything, winners take double");
r = await admin("drawRound", { kind: "challenge", final: true });
ok(r.ok && r.r.final === true, "the final is drawn from the challenges");
await sleep(8300);
let fr = (await pub()).round;
ok(fr.final && fr.id === r.r.id, "the final is on");
const allIn = ids.find((id) => id !== "itay" && !fr.noBet.includes(id));
const rival = ids.find((id) => id !== "itay" && id !== allIn && !fr.noBet.includes(id));
const fav = (await view({ token: tokens[allIn] })).me.available;
r = await act("bet", { roundId: fr.id, optionId: fr.options[0].id, amount: fav }, { token: tokens[allIn] });
ok(r.ok && fav > fr.maxBet, `all in: ${fav} on the table (more than the usual ${fr.maxBet})`);
await act("bet", { roundId: fr.id, optionId: fr.options[1].id, amount: 100 }, { token: tokens[rival] });
await admin("closeRound", { roundId: fr.id });
await admin("resolveRound", { roundId: fr.id, optionId: fr.options[0].id });
res = (await pub()).round.results;
// pot fav + 100 + bonus; he alone on the winning side: profit 100 + bonus, doubled
ok(dOf(allIn) === (100 + fr.bonus) * 2, `the final pays double (${dOf(allIn)})`);

console.log("the groom's golden cards");
r = await act("groomCard", { card: "drink", target: "sisu" }, { token: tokens.ayalon });
ok(!r.ok, `only the groom has golden cards (${r.err})`);
r = await act("groomCard", { card: "drink", target: "sisu" }, { token: tokens.itay });
vp = await pub();
ok(r.ok && vp.feed.some((e) => e.kind === "card" && e.data?.card === "drink" && e.players.join() === "sisu") && vp.cards.drink, "drink card: the TV tells sisu to drink");
r = await act("groomCard", { card: "drink", target: "yali" }, { token: tokens.itay });
ok(!r.ok, "each card works once a night");
r = await act("groomCard", { card: "veto" }, { token: tokens.itay });
ok(!r.ok, `veto needs a live challenge (${r.err})`);
ch = await mk();
await admin("openRound", { roundId: ch.id, seconds: 0 });
await act("bet", { roundId: ch.id, optionId: "yes", amount: 100 }, { token: tokens.ayalon });
const ayBefore = (await view({ token: tokens.ayalon })).me.available;
r = await act("groomCard", { card: "veto" }, { token: tokens.itay });
vp = await pub();
ok(r.ok && !vp.round && (await view({ token: tokens.ayalon })).me.available === ayBefore + 100 && vp.feed.some((e) => e.kind === "card" && e.data?.card === "veto"), "veto: the challenge is off and the bets are back");
ch = await mk();
await admin("openRound", { roundId: ch.id, seconds: 0 });
r = await act("groomCard", { card: "double" }, { token: tokens.itay });
ok(!r.ok, `double needs a bet first (${r.err})`);
await act("bet", { roundId: ch.id, optionId: "yes", amount: 100 }, { token: tokens.itay });
await act("bet", { roundId: ch.id, optionId: "no", amount: 100 }, { token: tokens.drori });
r = await act("groomCard", { card: "double" }, { token: tokens.itay });
ok(r.ok && (await view({ token: tokens.itay })).me.bets[ch.id]?.double === true, "double card on the groom's bet");
await admin("closeRound", { roundId: ch.id });
await admin("resolveRound", { roundId: ch.id, optionId: "yes" });
res = (await pub()).round.results;
// pot 200 + 200 bonus = 400, he alone on yes: 300 profit, doubled
ok(dOf("itay") === 600 && dOf("drori") === -100, `the groom's double (${dOf("itay")})`);
vp = await pub();
ok(vp.cards.veto && vp.cards.double && vp.cards.drink, "all three cards are spent");

console.log("swap a mission for 50");
const mv = await view({ token: tokens.birman });
const openM = mv.me.missions.find((m) => m.status === "open");
r = await act("swapMyMission", { missionId: openM.id }, { token: tokens.birman });
const mv2 = await view({ token: tokens.birman });
ok(r.ok && !mv2.me.missions.some((m) => m.id === openM.id) && mv2.me.missions.length === mv.me.missions.length && mv2.me.available === mv.me.available - 50, "swapped: a different mission, 50 almonds less");
ok(mv2.me.missions.every((m) => !Object.values(m.targets).includes("birman")), "the new mission is about someone else");
r = await act("swapMyMission", { missionId: openM.id }, { token: tokens.birman });
ok(!r.ok, "can't swap a mission that isn't yours anymore");

console.log("three in a row: a streak, and a bonus");
async function settleOne(winner, loser, win) {
  const x = await mk();
  await admin("openRound", { roundId: x.id, seconds: 0 });
  await act("bet", { roundId: x.id, optionId: win ? "yes" : "no", amount: 50 }, { token: tokens[winner] });
  await act("bet", { roundId: x.id, optionId: win ? "no" : "yes", amount: 50 }, { token: tokens[loser] });
  await admin("closeRound", { roundId: x.id });
  await admin("resolveRound", { roundId: x.id, optionId: "yes" });
  return x.id;
}
await settleOne("yali", "shmay", false);
await settleOne("yali", "shmay", true);
await settleOne("yali", "shmay", true);
ok(!(await pub()).feed.some((e) => e.kind === "streak" && e.players[0] === "yali"), "two in a row: nothing yet");
const third = await settleOne("yali", "shmay", true);
vp = await pub();
const st = vp.feed.find((e) => e.kind === "streak" && e.ref === third);
ok(st && st.players[0] === "yali" && st.data?.streak === 3 && st.data?.amount === 100, `three in a row: on the TV with +100 (${st?.text})`);
r = await admin("undoResolve", { roundId: third });
ok(!(await pub()).feed.some((e) => e.kind === "streak" && e.ref === third), "undoing the result takes the streak back");
await admin("cancelRound", { roundId: third });

console.log("a new king is crowned");
await admin("adjust", { playerId: "shmay", delta: 20000, note: "test" });
let king = (await pub()).feed.find((e) => e.kind === "king" && e.players[0] === "shmay");
if (!king) {
  // at most one crowning every 20 seconds
  await sleep(20500);
  await admin("adjust", { playerId: "shmay", delta: 1, note: "test" });
  king = (await pub()).feed.find((e) => e.kind === "king" && e.players[0] === "shmay");
}
ok(!!king && !!king.data?.line, `the TV crowns the new king (${king?.text})`);
await admin("adjust", { playerId: "shmay", delta: 5, note: "test" });
ok((await pub()).feed.filter((e) => e.kind === "king" && e.players[0] === "shmay").length === 1, "the same king isn't crowned twice");

console.log("the host's soundboard");
ok((await admin("sound", { id: "cheers" })).ok, "the host plays a sound on the TV");
ok(!(await act("sound", { id: "cheers" }, { token: tokens.ayalon })).ok, "players can't");
ok(!(await admin("sound", { id: "nope" })).ok, "unknown sounds are refused");

console.log("a player picks his own name");
ok(!(await act("rename", { name: "ש" }, { token: tokens.birman })).ok, "too short is refused");
ok(!(await act("rename", { name: "סיסו" }, { token: tokens.birman })).ok, "someone else's name is refused");
r = await act("rename", { name: "בירמן הענק" }, { token: tokens.birman });
vp = await pub();
ok(r.ok && vp.players.find((x) => x.id === "birman").name === "בירמן הענק" && vp.feed.some((e) => e.kind === "rename" && e.players[0] === "birman"), "renamed, and the TV hears about it");
const aboutHim = (await view({ key: KEY })).admin.missions.filter((m) => m.assignedTo && Object.values(m.targets).includes("birman"));
ok(aboutHim.every((m) => m.text.includes("בירמן הענק")), `missions about him say the new name (${aboutHim.length})`);
ok((await rounds()).filter((x) => x.options.some((o) => o.playerId === "birman")).every((x) => x.options.find((o) => o.playerId === "birman").label === "בירמן הענק"), "options with him say the new name");
await act("rename", { name: "בירמן הגדול" }, { token: tokens.birman });
ok((await pub()).feed.filter((e) => e.kind === "rename" && e.players[0] === "birman").length === 1, "renaming again right away doesn't spam the TV");

console.log("reset");
r = await admin("resetGame", { unclaim: true, undeal: true });
p = await pub();
ok(r.ok && p.players.every((x) => x.balance === 1000 && !x.claimed) && p.night.length === 0 && p.feed.length === 0, "reset: clean slate");
ok(!p.cards.veto && !p.cards.double && !p.cards.drink && !p.doubleNext, "reset: the groom gets his cards back");
// back to the seeded game: no test rounds, no quick duels, fresh missions
await admin("reseed");
await admin("resetGame", { unclaim: true, undeal: true });
ok(!(await rounds()).some((x) => x.title.startsWith("בדיקה ")), "the test rounds are gone");
ok(!(await view({ key: KEY })).admin.rounds.some((x) => x.id.startsWith("duel-")), "quick duels don't survive a reset");

console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
