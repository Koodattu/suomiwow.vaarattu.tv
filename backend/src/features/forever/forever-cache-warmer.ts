import { foreverAnalyticsCache } from "./forever-analytics";
import { foreverGuildsCache } from "./forever-guilds";
import { foreverNamegameCache } from "./forever-namegame";

const caches = [foreverAnalyticsCache, foreverGuildsCache, foreverNamegameCache];

export function startForeverPageCaches() {
  for (const cache of caches) cache.start();
}

export async function stopForeverPageCaches() {
  await Promise.all(caches.map(cache => cache.stop()));
}
