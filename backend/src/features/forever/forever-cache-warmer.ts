import { foreverAnalyticsCache } from "./forever-analytics";
import { foreverGuildsCache } from "./forever-guilds";
import { foreverNamegameCache } from "./forever-namegame";
import { foreverRaidsCache } from "./forever-raids";
import { foreverRecordsCache } from "./forever-records";

const caches = [foreverAnalyticsCache, foreverGuildsCache, foreverNamegameCache, foreverRaidsCache, foreverRecordsCache];

export function startForeverPageCaches() {
  for (const cache of caches) cache.start();
}

export async function stopForeverPageCaches() {
  await Promise.all(caches.map(cache => cache.stop()));
}
