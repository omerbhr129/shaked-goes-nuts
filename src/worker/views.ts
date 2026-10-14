import type { AdminView, ClientView, GameState, ID, MeView, PublicView, RoundPub } from "../shared/types";
import { activeRound, bettingOpen } from "./logic";

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

  let round: RoundPub | null = null;
  const r = activeRound(s);
  if (r && r.status !== "draft") {
    const bets = s.bets.filter((b) => b.roundId === r.id).sort((a, b) => a.at - b.at);
    const open = bettingOpen(r, now);
    round = {
      id: r.id,
      emoji: r.emoji,
      title: r.title,
      note: r.note,
      image: r.image,
      options: r.options,
      minBet: r.minBet,
      maxBet: r.maxBet,
      noBet: r.noBet,
      status: r.status,
      openedAt: r.openedAt,
      closesAt: r.closesAt,
      winnerId: r.winnerId,
      resolvedAt: r.resolvedAt,
      number: s.rounds.indexOf(r) + 1,
      stats: r.options.map((o) => {
        let count = 0;
        let total = 0;
        for (const b of bets)
          if (b.optionId === o.id) {
            count++;
            total += b.amount;
          }
        return { optionId: o.id, count, total };
      }),
      bettors: bets.map((b) => b.playerId),
      bets: open ? null : bets.map((b) => ({ playerId: b.playerId, optionId: b.optionId, amount: b.amount })),
    };
  }

  const revealing = s.tv.mode === "missions";
  return {
    v: s.v,
    now,
    settings: s.settings,
    tv: s.tv,
    players,
    round,
    roundsTotal: s.rounds.length,
    roundsDone: s.rounds.filter((x) => x.status === "resolved").length,
    reveal: revealing
      ? s.players.map((p) => ({
          playerId: p.id,
          missions: s.missions
            .filter((m) => m.assignedTo === p.id)
            .map((m) => ({ text: m.text, reward: m.reward, status: m.status })),
        }))
      : null,
  };
}

function buildMe(s: GameState, pid: ID): MeView {
  const r = activeRound(s);
  const b = r ? s.bets.find((x) => x.roundId === r.id && x.playerId === pid) : undefined;
  return {
    id: pid,
    bet: b ? { optionId: b.optionId, amount: b.amount, ticket: b.ticket } : null,
    missions: s.missions.filter((m) => m.assignedTo === pid),
    ledger: s.ledger.filter((e) => e.playerId === pid).slice(-30),
  };
}

function buildAdmin(s: GameState): AdminView {
  return {
    rounds: s.rounds,
    bets: s.bets.filter((b) => b.roundId === s.activeRoundId),
    missions: s.missions,
    joined: Object.fromEntries(s.players.map((p) => [p.id, p.joinedAt])),
    ledger: s.ledger.slice(-80),
  };
}

export function viewFor(s: GameState, pub: PublicView, pid: ID | null, admin: boolean): ClientView {
  return { pub, me: pid ? buildMe(s, pid) : null, admin: admin ? buildAdmin(s) : null };
}
