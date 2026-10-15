export type ID = string;

export type Audience = "all" | "friends" | "groom";
export type MissionStatus = "open" | "pending" | "done" | "burned";
export type RoundStatus = "draft" | "open" | "closed" | "resolved";
export type RoundKind = "challenge" | "night" | "quiz" | "vote" | "photo";
export type TvMode = "lobby" | "round" | "board" | "night" | "missions" | "awards" | "winner" | "rules";
export type FeedKind = "mission" | "reveal" | "caught" | "miss" | "bailout" | "wheel" | "result" | "shot" | "broke" | "gift" | "spin" | "king" | "streak" | "card" | "rename";
/** the groom's one-time golden cards */
export type GroomCard = "veto" | "double" | "drink";
export type TargetSlot = "G" | "X" | "Y";
export type WheelKind = "drink" | "punish";

export interface Settings {
  currency: string;
  startBalance: number;
  allowJoinNew: boolean;
  /** added by the bank to every pot that has bets */
  bankBonus: number;
  catchReward: number;
  falsePenalty: number;
  bailoutAmount: number;
  /** what 1st, 2nd, 3rd and the last place get in the morning */
  prize1: string;
  prize2: string;
  prize3: string;
  prizeLast: string;
  /** most a player can have riding on night bets at once, so there is money left for challenges */
  nightCap: number;
  /** seconds everybody has to catch a finished mission before it pays */
  catchWindow: number;
}

export interface PlayerRec {
  id: ID;
  name: string;
  ticker: string;
  photo: string | null;
  isGroom: boolean;
  token: string | null;
  joinedAt: number | null;
  /** bought in the shop: an emoji on the head, and one next to the face */
  hat: string | null;
  item: string | null;
}

/** A message, or a photo from someone's gallery, thrown onto the TV. */
export interface Shout {
  id: ID;
  at: number;
  author: ID;
  anon: boolean;
  text: string | null;
  photo: string | null;
  /** a short video from someone's phone */
  video: string | null;
  hidden: boolean;
}

export interface ShoutPub {
  id: ID;
  at: number;
  /** null when sent anonymously */
  by: ID | null;
  text: string | null;
  photo: string | null;
  video: string | null;
}

export interface RoundOption {
  id: ID;
  label: string;
  playerId: ID | null;
  /** photo contest: the picture this player sent */
  photo?: string;
}

export interface RoundRec {
  id: ID;
  kind: RoundKind;
  emoji: string;
  title: string;
  note: string;
  image: string | null;
  options: RoundOption[];
  minBet: number;
  maxBet: number;
  seconds: number;
  /** bets: the bank's bonus on top of the pot. quiz: extra for the fastest right answer */
  bonus: number;
  /** quiz only: almonds for every right answer */
  reward: number;
  /** quiz only: the right answer if known in advance (the host can still pick at reveal) */
  correctId: ID | null;
  noBet: ID[];
  status: RoundStatus;
  openedAt: number | null;
  closesAt: number | null;
  winnerId: ID | null;
  resolvedAt: number | null;
  /** resolved with nobody right: every stake went back */
  refunded: boolean;
  /** quiz: who drinks (wrong answers, or the slowest if everyone was right). vote: whoever got the most votes */
  losers: ID[];
  loserReason: "wrong" | "slow" | "voted" | null;
  /** one-liners for the TV moments (fast, kings, shot, slow, win, lose), written when the round is settled */
  lines: Record<string, string>;
  /** challenge: what the losers have to do */
  task: string | null;
  /** one-on-one game (pingpong, arm, ...): picks the winner's picture and the line */
  game: string | null;
  /** winnings are multiplied by this: 2 after the wheel's "next round is double" */
  mult: number;
  /** the last round of the night: bet everything you have, winners take double */
  final: boolean;
  /** the crown duel: the king's id. If he loses, he pays the challenger */
  crown: ID | null;
  /** photo contest: collecting pictures, then voting on them */
  phase: "collect" | "vote" | null;
}

/** A round picked at random by the host: the TV spins a reel of titles before it opens. */
/** גלגל הבלגן: the host spins, the TV shows a wheel of rounds and surprises, and it lands on one. */
export interface DrawState {
  at: number;
  /** the round it landed on (null when it landed on a surprise) */
  roundId: ID | null;
  /** the wheel's segments, and which one it lands on */
  titles: string[];
  /** per segment: "c" challenge, "q" question, "s" surprise */
  kinds: string[];
  index: number;
  /** the surprise it landed on, e.g. "shots" */
  surprise: string | null;
}

export interface Bet {
  roundId: ID;
  playerId: ID;
  optionId: ID;
  amount: number;
  at: number;
  ticket: number;
  /** the groom played his "double" card on this bet */
  double?: boolean;
}

export interface Mission {
  id: ID;
  /** as written, with {G} = the groom, {X} / {Y} = other players picked when dealt */
  template: string;
  /** the template with names filled in for whoever holds it */
  text: string;
  targets: Partial<Record<TargetSlot, ID>>;
  reward: number;
  audience: Audience;
  assignedTo: ID | null;
  status: MissionStatus;
  claimedAt: number | null;
  doneAt: number | null;
  caughtBy: ID | null;
}

export type LedgerKind = "bet" | "mission" | "adjust" | "catch" | "penalty" | "bailout" | "quiz" | "gift" | "vote" | "streak" | "swap" | "crown" | "contest";

export interface LedgerEntry {
  id: ID;
  playerId: ID;
  delta: number;
  kind: LedgerKind;
  ref: ID | null;
  note: string;
  at: number;
}

export interface Accusation {
  id: ID;
  by: ID;
  suspect: ID;
  text: string;
  at: number;
  status: "pending" | "right" | "wrong";
  missionId: ID | null;
}

export interface BailoutReq {
  id: ID;
  playerId: ID;
  at: number;
  status: "pending" | "granted" | "denied";
  dare: string | null;
}

export interface FeedEvent {
  id: ID;
  at: number;
  kind: FeedKind;
  text: string;
  players: ID[];
  ref: ID | null;
  /** for the big TV moments: the line on its own, the task, the almonds, how long to catch */
  data?: { line?: string; task?: string; amount?: number; until?: number; mission?: ID; surprise?: string; card?: GroomCard; streak?: number };
}

export interface WheelSpin {
  id: ID;
  at: number;
  kind: WheelKind;
  segments: string[];
  index: number;
  label: string;
  players: ID[];
}

export interface TvState {
  mode: TvMode;
  at: number;
  step: number;
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
  accusations: Accusation[];
  bailouts: BailoutReq[];
  feed: FeedEvent[];
  wheel: WheelSpin | null;
  tv: TvState;
  activeRoundId: ID | null;
  lastResolvedId: ID | null;
  draw: DrawState | null;
  shouts: Shout[];
  /** the wheel landed on "next round is double": the next round that opens pays ×2 */
  doubleNext: boolean;
  /** who the TV last crowned, so every new king is announced once */
  king: ID | null;
  kingAt: number;
  /** the groom's golden cards: true once played */
  cards: Record<GroomCard, boolean>;
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
  hat: string | null;
  item: string | null;
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
  kind: RoundKind;
  emoji: string;
  title: string;
  note: string;
  image: string | null;
  options: RoundOption[];
  minBet: number;
  maxBet: number;
  bonus: number;
  reward: number;
  noBet: ID[];
  status: RoundStatus;
  openedAt: number | null;
  closesAt: number | null;
  winnerId: ID | null;
  resolvedAt: number | null;
  refunded: boolean;
  losers: ID[];
  loserReason: "wrong" | "slow" | "voted" | null;
  lines: Record<string, string>;
  task: string | null;
  game: string | null;
  mult: number;
  final: boolean;
  crown: ID | null;
  phase: "collect" | "vote" | null;
  number: number;
  stats: OptionStat[];
  /** sum of all stakes (the bank bonus comes on top) */
  staked: number;
  bettors: ID[];
  /** every bet, revealed only once betting has closed */
  bets: PublicBet[] | null;
  /** per-player result once resolved */
  results: { playerId: ID; delta: number }[] | null;
}

export interface RevealEntry {
  playerId: ID;
  missions: { text: string; reward: number; status: MissionStatus; caughtBy: ID | null }[];
}

export interface PlayerStats {
  id: ID;
  betProfit: number;
  betsWon: number;
  betsLost: number;
  bestWin: number;
  worstLoss: number;
  missionsDone: number;
  missionAlmonds: number;
  catches: number;
  falseAccusations: number;
  timesCaught: number;
  bailouts: number;
  quizRight: number;
  shots: number;
}

export interface PublicView {
  v: number;
  now: number;
  settings: Settings;
  tv: TvState;
  players: PlayerPub[];
  /** the challenge round on the TV */
  round: RoundPub | null;
  night: RoundPub[];
  feed: FeedEvent[];
  wheel: WheelSpin | null;
  roundsTotal: number;
  roundsDone: number;
  /** all missions, only while the TV reveals them */
  reveal: RevealEntry[] | null;
  /** only during the awards ceremony */
  stats: PlayerStats[] | null;
  draw: DrawState | null;
  missionsDone: number;
  shouts: ShoutPub[];
  doubleNext: boolean;
  cards: Record<GroomCard, boolean>;
}

export interface MyBet {
  optionId: ID;
  amount: number;
  ticket: number;
  double?: boolean;
}

export interface MeView {
  id: ID;
  /** what you can still put on the table (balance minus open bets) */
  available: number;
  bets: Record<ID, MyBet>;
  missions: Mission[];
  ledger: LedgerEntry[];
  accusation: Accusation | null;
  bailout: BailoutReq | null;
  /** missions of yours that were burned, with who caught you */
  burned: { text: string; by: ID | null }[];
  /** what you have riding on night bets right now */
  nightStaked: number;
}

export interface AdminView {
  rounds: RoundRec[];
  bets: Bet[];
  missions: Mission[];
  accusations: Accusation[];
  bailouts: BailoutReq[];
  joined: Record<ID, number | null>;
  ledger: LedgerEntry[];
  shouts: Shout[];
}

export interface ClientView {
  pub: PublicView;
  me: MeView | null;
  admin: AdminView | null;
}
