import { foreverAnalyticsCache } from "./forever-analytics";
import { ForeverError } from "./forever-errors";
import { publicGuilds } from "./forever-guilds";
import { publicLeaderboardCharacters } from "./forever-leaderboard";
import { foreverNamegameCache } from "./forever-namegame";
import { foreverRaids } from "./forever-raids";
import { foreverRecords } from "./forever-records";

export async function foreverHub() {
  const [{ analytics, milestones }, { guilds }, { names }, records, raids] = await Promise.all([
    foreverAnalyticsCache.get(), publicGuilds(), foreverNamegameCache.get(), foreverRecords({ board: "itemLevel" }), foreverRaids(),
  ]);
  const top = records.rows[0];
  const latestRaid = raids.recent.find(kill => kill.raid);
  return {
    generatedAt: analytics.generatedAt, characters: analytics.total, guilds: guilds.length,
    levelsGained24h: analytics.levelsGained24h, milestones, featuredName: names[0]?.name ?? null,
    topItemLevel: top ? { name: top.name, value: top.values.itemLevel! } : null,
    latestRaidKill: latestRaid ? { boss: latestRaid.boss, guild: latestRaid.guild?.name ?? null, at: latestRaid.at } : null,
  };
}

const normalize = (value: string) => value.trim().normalize("NFC").toLocaleLowerCase("fi");

function nameMatches<T extends { name?: string | null; slug: string }>(rows: T[], term: string) {
  return rows.flatMap(row => {
    const name = normalize(row.name || row.slug);
    const position = name.indexOf(term);
    if (position < 0) return [];
    return [{ row, name, priority: name === term ? 0 : position === 0 ? 1 : 2 }];
  }).sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name, "fi") || a.row.slug.localeCompare(b.row.slug))
    .slice(0, 5).map(match => match.row);
}

export async function searchForeverHub(query: unknown) {
  if (typeof query !== "string" || query.length > 100) throw new ForeverError("invalid_input");
  const term = normalize(query);
  if (!term) return { characters: [], guilds: [] };
  const [characters, { guilds }] = await Promise.all([publicLeaderboardCharacters(), publicGuilds()]);
  return {
    characters: nameMatches(characters, term).map(({ slug, name, level }) => ({ slug, name: name || slug, level })),
    guilds: nameMatches(guilds, term).map(({ _id, name, region }) => ({ _id, name, region })),
  };
}
