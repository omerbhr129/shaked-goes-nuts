export type ID = string;

export type Audience = "all" | "friends" | "groom";
export type MissionStatus = "open" | "pending" | "done";
export type RoundStatus = "draft" | "open" | "closed" | "resolved";
export type TvMode = "lobby" | "round" | "board" | "missions" | "winner";

export interface Settings {
  currency: string;
  startBalance: number;
  allowJoinNew: boolean;
}

export interface PlayerRec {
  id: ID;
  name: string;
  ticker: string;
  photo: string | null;
  isGroom: boolean;
  token: string | null;
  joinedAt: number | null;
}

export interface RoundOption {
  id: ID;
  label: string;
  playerId: ID | null;
}

export interface RoundRec {
  id: ID;
  emoji: string;
  title: string;
  note: string;
  image: string | null;
  options: RoundOption[];
  minBet: number;
  maxBet: number;
  seconds: number;
  noBet: ID[];
  status: RoundStatus;
  openedAt: number | null;
  closesAt: number | null;
  winnerId: ID | null;
  resolvedAt: number | null;
}

export interface Bet {
  roundId: ID;
  playerId: ID;
  optionId: ID;
  amount: number;
  at: number;
  ticket: number;
}

export interface Mission {
  id: ID;
  text: string;
  reward: number;
  audience: Audience;
  assignedTo: ID | null;
  status: MissionStatus;
  claimedAt: number | null;
  doneAt: number | null;
}

export interface LedgerEntry {
  id: ID;
  playerId: ID;
  delta: number;
  kind: "bet" | "mission" | "adjust";
  ref: ID | null;
  note: string;
  at: number;
}

export interface TvState {
  mode: TvMode;
  at: number;
}

export interface GameState {
  v: number;
  seq: number;
  settings: Settings;
  players: PlayerRec[];
  rounds: RoundRec[];
  bets: Bet[];
  missions: Mission[];
  ledger: LedgerEntry[];
  tv: TvState;
  activeRoundId: ID | null;
}

/* ---------- views sent to clients ---------- */

export interface PlayerPub {
  id: ID;
  name: string;
  ticker: string;
  photo: string | null;
  isGroom: boolean;
  balance: number;
  claimed: boolean;
  online: boolean;
  spark: number[];
  last: number;
}

export interface OptionStat {
  optionId: ID;
  count: number;
  total: number;
}

export interface PublicBet {
  playerId: ID;
  optionId: ID;
  amount: number;
}

export interface RoundPub {
  id: ID;
  emoji: string;
  title: string;
  note: string;
  image: string | null;
  options: RoundOption[];
  minBet: number;
  maxBet: number;
  noBet: ID[];
  status: RoundStatus;
  openedAt: number | null;
  closesAt: number | null;
  winnerId: ID | null;
  resolvedAt: number | null;
  number: number;
  stats: OptionStat[];
  bettors: ID[];
  /** every bet, revealed only once betting has closed */
  bets: PublicBet[] | null;
}

export interface RevealEntry {
  playerId: ID;
  missions: { text: string; reward: number; status: MissionStatus }[];
}

export interface PublicView {
  v: number;
  now: number;
  settings: Settings;
  tv: TvState;
  players: PlayerPub[];
  round: RoundPub | null;
  roundsTotal: number;
  roundsDone: number;
  /** all missions, only while the TV is in reveal / winner mode */
  reveal: RevealEntry[] | null;
}

export interface MeView {
  id: ID;
  bet: { optionId: ID; amount: number; ticket: number } | null;
  missions: Mission[];
  ledger: LedgerEntry[];
}

export interface AdminView {
  rounds: RoundRec[];
  bets: Bet[];
  missions: Mission[];
  joined: Record<ID, number | null>;
  ledger: LedgerEntry[];
}

export interface ClientView {
  pub: PublicView;
  me: MeView | null;
  admin: AdminView | null;
}
