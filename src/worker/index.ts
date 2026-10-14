import type { Env } from "./env";

export { GameRoom } from "./room";

export default {
  async fetch(req, env) {
    const { pathname } = new URL(req.url);
    if (pathname === "/ws" || pathname.startsWith("/api/") || pathname.startsWith("/media/")) {
      return env.GAME.get(env.GAME.idFromName("party")).fetch(req);
    }
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;
