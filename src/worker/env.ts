import type { GameRoom } from "./room";

export interface Env {
  GAME: DurableObjectNamespace<GameRoom>;
  ASSETS: Fetcher;
  ADMIN_KEY: string;
  /** optional: the TV announcer's voice */
  OPENAI_API_KEY?: string;
}
