import type { AdminView, ClientView, GameState, ID, MeView, MyBet, PlayerStats, PublicView, RoundPub, RoundRec } from "../shared/types";
import { activeRound, available, bettingOpen } from "./logic";

function roundPub(s: GameState, r: RoundRec, now: number): RoundPub {
  const bets = s.bets.filter((b) => b.roundId === r.id).sort((a, b) => a.at - b.at);
  const open = bettingOpen(r, now);
  let staked = 0;
  const stats = r.options.map((o) => {
    let count = 0;
    let total = 0;
    for (const b of bets)
      if (b.optionId === o.id) {
        count++;
        total += b.amount;
      }
    staked += total;
    return { optionId: o.id, count, total };
  });
  return {
    id: r.id,
    kind: r.kind,
    emoji: r.emoji,
    title: r.title,
    note: r.note,
    image: r.image,
    options: r.options,
    minBet: r.minBet,
    maxBet: r.maxBet,
    bonus: r.bonus,
    noBet: r.noBet,
    status: r.status,
    openedAt: r.openedAt,
    closesAt: r.closesAt,
    winnerId: r.winnerId,
    resolvedAt: r.resolvedAt,
    refunded: r.refunded,
    number: s.rounds.filter((x) => x.kind === r.kind).indexOf(r) + 1,
    stats,
    staked,
    bettors: bets.map((b) => b.playerId),
    bets: open ? null : bets.map((b) => ({ playerId: b.playerId, optionId: b.optionId, amount: b.amount })),
    results:
      r.status === "resolved"
        ? s.ledger.filter((e) => e.kind === "bet" && e.ref === r.id).map((e) => ({ playerId: e.playerId, delta: e.delta }))
        : null,
  };
}

function playerStats(s: GameState): PlayerStats[] {
  return s.players.map((p) => {
    const st: PlayerStats = {
      id: p.id,
      betProfit: 0,
      betsWon: 0,
      betsLost: 0,
      bestWin: 0,
      worstLoss: 0,
      missionsDone: 0,
      missionAlmonds: 0,
      catches: 0,
      falseAccusations: 0,
      timesCaught: 0,
      bailouts: 0,
    };
    for (const e of s.ledger) {
      if (e.playerId !== p.id) continue;
      if (e.kind === "bet") {
        st.betProfit += e.delta;
        if (e.delta > 0) {
          st.betsWon++;
          st.bestWin = Math.max(st.bestWin, e.delta);
        } else if (e.delta < 0) {
          st.betsLost++;
          st.worstLoss = Math.min(st.worstLoss, e.delta);
        }
      } else if (e.kind === "bailout") st.bailouts++;
    }
    for (const m of s.missions) {
      if (m.assignedTo !== p.id) continue;
      if (m.status === "done") {
        st.missionsDone++;
        st.missionAlmonds += m.reward;
      } else if (m.status === "burned") st.timesCaught++;
    }
    for (const a of s.accusations) {
      if (a.by !== p.id) continue;
      if (a.status === "right") st.catches++;
      else if (a.status === "wrong") st.falseAccusations++;
    }
    return st;
  });
}

/** What everyone may see: the TV, every phone and the host. Never includes secret missions or open bets. */
export function buildPublic(s: GameState, now: number, online: Set<ID>): PublicView {
  const start = s.settings.startBalance;
  const series = new Map<ID, number[]>();
  const last = new Map<ID, number>();
  for (const p of s.players) series.set(p.id, [start]);
  for (const e of s.ledger) {
    const arr = series.get(e.playerId);
    if (!arr) continue;
    arr.push(arr[arr.length - 1] + e.delta);
    last.set(e.playerId, e.delta);
  }

  const players = s.players.map((p) => {
    const arr = series.get(p.id)!;
    return {
      id: p.id,
      name: p.name,
      ticker: p.ticker,
      photo: p.photo,
      isGroom: p.isGroom,
      balance: arr[arr.length - 1],
      claimed: !!p.token,
      online: online.has(p.id),
      spark: arr.slice(-24),
      last: last.get(p.id) ?? 0,
    };
  });

  const featured = activeRound(s);
  const challenges = s.rounds.filter((r) => r.kind === "challenge");
  return {
    v: s.v,
    now,
    settings: s.settings,
    tv: s.tv,
    players,
    round: featured && featured.status !== "draft" ? roundPub(s, featured, now) : null,
    night: s.rounds.filter((r) => r.kind === "night" && r.status !== "draft").map((r) => roundPub(s, r, now)),
    feed: s.feed.slice(-12),
    wheel: s.wheel,
    roundsTotal: challenges.length,
    roundsDone: challenges.filter((r) => r.status === "resolved").length,
    reveal:
      s.tv.mode === "missions"
        ? s.players.map((p) => ({
            playerId: p.id,
            missions: s.missions
              .filter((m) => m.assignedTo === p.id)
              .map((m) => ({ text: m.text, reward: m.reward, status: m.status, caughtBy: m.caughtBy })),
          }))
        : null,
    stats: s.tv.mode === "awards" || s.tv.mode === "winner" ? playerStats(s) : null,
  };
}

function buildMe(s: GameState, pid: ID): MeView {
  const bets: Record<ID, MyBet> = {};
  for (const b of s.bets) if (b.playerId === pid) bets[b.roundId] = { optionId: b.optionId, amount: b.amount, ticket: b.ticket };
  const mine = s.missions.filter((m) => m.assignedTo === pid);
  const latest = <T extends { at: number }>(list: T[]) => list.reduce<T | null>((a, x) => (!a || x.at > a.at ? x : a), null);
  return {
    id: pid,
    available: available(s, pid),
    bets,
    missions: mine.filter((m) => m.status !== "burned"),
    burned: mine.filter((m) => m.status === "burned").map((m) => ({ text: m.text, by: m.caughtBy })),
    ledger: s.ledger.filter((e) => e.playerId === pid).slice(-30),
    accusation: latest(s.accusations.filter((a) => a.by === pid)),
    bailout: latest(s.bailouts.filter((b) => b.playerId === pid)),
  };
}

function buildAdmin(s: GameState): AdminView {
  return {
    rounds: s.rounds,
    bets: s.bets,
    missions: s.missions,
    accusations: [...s.accusations].reverse(),
    bailouts: [...s.bailouts].reverse(),
    joined: Object.fromEntries(s.players.map((p) => [p.id, p.joinedAt])),
    ledger: s.ledger.slice(-120),
  };
}

export function viewFor(s: GameState, pub: PublicView, pid: ID | null, admin: boolean): ClientView {
  return { pub, me: pid ? buildMe(s, pid) : null, admin: admin ? buildAdmin(s) : null };
}
