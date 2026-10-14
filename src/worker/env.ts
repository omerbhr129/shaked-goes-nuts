import type { GameRoom } from "./room";

export interface Env {
  GAME: DurableObjectNamespace<GameRoom>;
  ASSETS: Fetcher;
  ADMIN_KEY: string;
}
