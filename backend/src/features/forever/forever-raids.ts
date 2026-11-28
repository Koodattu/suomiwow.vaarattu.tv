import { creditedGuild, groupKills, type KillEntry, type RaidCriterionSeen, type StoredBoss } from "./forever-details";
import { ForeverCharacterDetail } from "./forever-details.models";
import { ForeverCharacter, ForeverGuild } from "./forever.models";
import { foreverVisibility } from "./forever-visibility";
import { ForeverSnapshotCache } from "./forever-snapshot";
import { bossNames, FOREVER_RAIDS, raidClearAchievement, raidCriterion, raidFor } from "./forever-raid-catalog";

// Dungeon groups need several tracked players before they count as a shared kill. An instance
// outside the catalog is treated as a raid once a tracked group larger than a party kills there.
const MIN_GROUP = 3;
const PARTY_SIZE = 5;
const RECENT = 30;
// Achievement criteria carry no time. A guild is credited once this many of its tracked members
// show the boss, dated to the check that saw the last of them.
const MIN_CRITERIA_MEMBERS = 3;

type PublicGuild = { id: string | null; name: string; slug: string };
type Participant = { id: string; slug: string; name: string; className: string | null };
export interface ForeverKillEvent {
  boss: string; instance: string; raid: boolean; clear: boolean; at: string; guild: PublicGuild | null; participants: Participant[];
}
export interface ForeverBossCredit { guild: PublicGuild; at: string; approximate: boolean; participants: number }
export interface ForeverGuildProgress {
  guild: PublicGuild; killed: number; reachedAt: string; approximate: boolean; clearedAt: string | null;
  bosses: { name: string; at: string; approximate: boolean }[];
}
export interface ForeverRaidSummary {
  key: string; instance: string; size: number | null; opensAt: string | null; legacy: boolean; discovered: boolean;
  bossCount: number; bosses: { name: string; first: ForeverBossCredit | null }[];
  firstClear: ForeverBossCredit | null; guilds: ForeverGuildProgress[];
}
export interface ForeverRaidsSnapshot { raids: ForeverRaidSummary[]; recent: ForeverKillEvent[]; groupKills: number; trackedCharacters: number }

const key = (raid: { key: string }, boss: string) => `${raid.key}:${boss.normalize("NFC").toLocaleLowerCase("en")}`;
// Instances outside the catalog (dungeons, or raids Forever adds later) are keyed by name.
const instanceKey = (instance: string) => ({ key: `instance-${instance.normalize("NFC").toLocaleLowerCase("en")}` });
type Credit = { at: number; approximate: boolean; participants: number };
type DetailRow = { _id: unknown; blizzard?: { bosses?: StoredBoss[]; raidCriteria?: RaidCriterionSeen[];
  raidClears?: { id: number; completedAt: Date }[] } | null };

/** Kill entries with exact times: boss statistics, and raid achievements that date the clearing kill. */
function exactEntries(detail: DetailRow): KillEntry[] {
  const characterId = String(detail._id), entries: KillEntry[] = [];
  for (const stored of detail.blizzard?.bosses ?? []) {
    const raid = raidFor(stored.instance, stored.boss);
    // A boss Blizzard names differently from the catalog still counts under its own name.
    const named = raid && bossNames(raid).find(name => key(raid, name) === key(raid, stored.boss));
    const bossKey = key(raid ?? instanceKey(stored.instance), named || stored.boss);
    for (const kill of stored.kills ?? []) entries.push({ bossKey, boss: named || stored.boss, instance: raid?.instance ?? stored.instance,
      at: kill.at.getTime(), characterId, guildSlug: kill.guildSlug ?? null });
  }
  for (const clear of detail.blizzard?.raidClears ?? []) {
    const raid = raidClearAchievement(clear.id);
    if (!raid || !clear.completedAt) continue;
    // A one-boss raid's achievement is that boss's kill; otherwise it marks the full clear.
    const single = raid.bosses.length === 1 ? raid.bosses[0].name : null;
    entries.push({ bossKey: single ? key(raid, single) : `${raid.key}:clear`, boss: single ?? "", instance: raid.instance,
      at: clear.completedAt.getTime(), characterId, guildSlug: null });
  }
  return entries;
}

export async function buildForeverRaids(): Promise<ForeverRaidsSnapshot> {
  const visibility = await foreverVisibility();
  const characters = (await ForeverCharacter.find({ region: "eu", status: "tracked", level: { $gte: 40 } })
    .select("slug name className guild source independentlyTracked region").lean()).filter(visibility.includes);
  const byId = new Map(characters.map(character => [String(character._id), character]));
  const details = await ForeverCharacterDetail.find({ _id: { $in: characters.map(character => character._id) },
    $or: [{ "blizzard.bosses.0": { $exists: true } }, { "blizzard.raidCriteria.0": { $exists: true } }, { "blizzard.raidClears.0": { $exists: true } }] })
    .select("blizzard.bosses blizzard.raidCriteria blizzard.raidClears").lean<DetailRow[]>();
  const guilds = await ForeverGuild.find({ region: "eu", status: "approved", hidden: { $ne: true } }).select("name slug").lean();
  const guildBySlug = new Map(guilds.map(guild => [guild.slug, { id: String(guild._id), name: guild.name, slug: guild.slug }]));
  // Achievements don't say which guild a player was in; use the guild they're in now.
  const currentGuild = (characterId: string) => byId.get(characterId)?.guild?.slug ?? null;

  const entries = details.flatMap(exactEntries).map(entry => ({ ...entry, guildSlug: entry.guildSlug ?? currentGuild(entry.characterId) }));
  const discovered = new Map<string, number>();
  const groups = groupKills(entries).filter(group => {
    const catalog = raidFor(group.instance, group.boss);
    if (!catalog && group.entries.length > PARTY_SIZE) discovered.set(group.instance, Math.max(discovered.get(group.instance) ?? 0, group.entries.length));
    return catalog || group.entries.length >= MIN_GROUP;
  });
  const isRaid = (instance: string, boss: string) => !!raidFor(instance, boss) || discovered.has(instance);
  const events = groups.map(group => {
    const slug = creditedGuild(group.entries);
    return { group, event: {
      boss: group.boss, instance: group.instance, raid: isRaid(group.instance, group.boss), clear: group.bossKey.endsWith(":clear"),
      at: new Date(group.at).toISOString(), guild: slug ? guildBySlug.get(slug) ?? null : null,
      participants: group.entries.flatMap(entry => {
        const character = byId.get(entry.characterId);
        return character ? [{ id: entry.characterId, slug: character.slug, name: character.name || character.slug, className: character.className ?? null }] : [];
      }).sort((a, b) => a.name.localeCompare(b.name, "fi")),
    } satisfies ForeverKillEvent };
  });

  // Credits per encounter key, per guild: the earliest exact group kill, else criteria evidence.
  const credits = new Map<string, Map<string, Credit>>();
  const credit = (bossKey: string, slug: string, value: Credit) => {
    const byGuild = credits.get(bossKey) ?? new Map<string, Credit>();
    const known = byGuild.get(slug);
    if (!known || (known.approximate && !value.approximate) || (known.approximate === value.approximate && value.at < known.at)) byGuild.set(slug, value);
    credits.set(bossKey, byGuild);
  };
  for (const { group, event } of events) if (event.guild) credit(group.bossKey, event.guild.slug, { at: group.at, approximate: false, participants: event.participants.length });
  const seen = new Map<string, number[]>();
  for (const detail of details) {
    const slug = currentGuild(String(detail._id));
    if (!slug || !guildBySlug.has(slug)) continue;
    for (const criterion of detail.blizzard?.raidCriteria ?? []) {
      const match = raidCriterion(criterion.id);
      if (!match) continue;
      const id = `${key(match.raid, match.boss)}|${slug}`;
      seen.set(id, [...(seen.get(id) ?? []), criterion.seenAt.getTime()]);
    }
  }
  for (const [id, times] of seen) {
    if (times.length < MIN_CRITERIA_MEMBERS) continue;
    const [bossKey, slug] = id.split("|");
    credit(bossKey, slug, { at: times.sort((a, b) => a - b)[MIN_CRITERIA_MEMBERS - 1], approximate: true, participants: times.length });
  }

  const toCredit = (slug: string, value: Credit): ForeverBossCredit => ({ guild: guildBySlug.get(slug)!, at: new Date(value.at).toISOString(),
    approximate: value.approximate, participants: value.participants });
  const first = (bossKey: string) => {
    const [best] = [...credits.get(bossKey) ?? []].sort((a, b) => a[1].at - b[1].at);
    return best ? toCredit(...best) : null;
  };
  const summarize = (raid: { key: string; instance: string; size: number | null; opensAt: string | null; legacy?: boolean }, names: string[], bossCount: number, isDiscovered: boolean): ForeverRaidSummary => {
    const bosses = names.map(name => ({ name, first: first(key(raid, name)) }));
    const progress = new Map<string, ForeverGuildProgress>();
    for (const name of names) for (const [slug, value] of credits.get(key(raid, name)) ?? []) {
      const row = progress.get(slug) ?? { guild: guildBySlug.get(slug)!, killed: 0, reachedAt: "", approximate: false, clearedAt: null, bosses: [] };
      const at = new Date(value.at).toISOString();
      row.bosses.push({ name, at, approximate: value.approximate });
      row.killed++; row.approximate ||= value.approximate;
      if (at > row.reachedAt) row.reachedAt = at;
      progress.set(slug, row);
    }
    for (const [slug, value] of credits.get(`${raid.key}:clear`) ?? []) {
      const row = progress.get(slug);
      if (row) row.clearedAt = new Date(value.at).toISOString();
    }
    const clear = first(`${raid.key}:clear`) ?? (names.length === 1 ? bosses[0].first : null);
    return { key: raid.key, instance: raid.instance, size: raid.size, opensAt: raid.opensAt, legacy: !!raid.legacy, discovered: isDiscovered,
      bossCount, bosses, firstClear: clear,
      guilds: [...progress.values()].filter(row => row.guild)
        .sort((a, b) => b.killed - a.killed || (a.clearedAt ?? "~").localeCompare(b.clearedAt ?? "~") || a.reachedAt.localeCompare(b.reachedAt)) };
  };

  // Legacy and discovered raids learn their bosses from the kills themselves, in first-kill order.
  const killedNames = (instance: string) => [...new Map(events.filter(({ event }) => event.instance === instance && !event.clear)
    .sort((a, b) => a.group.at - b.group.at).map(({ event }) => [event.boss, event.boss])).values()];
  const raids = [
    ...FOREVER_RAIDS.filter(raid => !raid.legacy).map(raid => summarize(raid, bossNames(raid), raid.bosses.length, false)),
    ...FOREVER_RAIDS.filter(raid => raid.legacy && killedNames(raid.instance).length)
      .map(raid => summarize(raid, killedNames(raid.instance), raid.bosses.length, false)),
    ...[...discovered.keys()].map(instance => {
      const names = killedNames(instance);
      return summarize({ ...instanceKey(instance), instance, size: null, opensAt: null }, names, names.length, true);
    }),
  ];
  return { raids, recent: events.slice(0, RECENT).map(({ event }) => event), groupKills: events.length, trackedCharacters: details.length };
}

export const foreverRaidsCache = new ForeverSnapshotCache("forever:raids:v2", buildForeverRaids);
export function foreverRaids() { return foreverRaidsCache.get(); }

/** A guild's own progress in every raid it has credit in, and its latest shared kills. */
export async function foreverGuildRaids(slug: string) {
  const snapshot = await foreverRaids();
  return {
    raids: snapshot.raids.flatMap(raid => {
      const row = raid.guilds.find(entry => entry.guild.slug === slug);
      if (!row && (raid.legacy || raid.discovered)) return [];
      const killed = new Map(row?.bosses.map(entry => [entry.name, entry]) ?? []);
      return [{ key: raid.key, instance: raid.instance, size: raid.size, bossCount: raid.bossCount, killed: row?.killed ?? 0,
        clearedAt: row?.clearedAt ?? null, bosses: raid.bosses.map(entry => ({ name: entry.name, kill: killed.get(entry.name) ?? null })) }];
    }),
    recent: snapshot.recent.filter(event => event.guild?.slug === slug).slice(0, 8),
  };
}

/** One character's raid progress: exact kill times from statistics, or the check that first saw the boss. */
export function characterRaidProgress(detail: DetailRow | null) {
  const bosses = detail?.blizzard?.bosses ?? [], criteria = detail?.blizzard?.raidCriteria ?? [], clears = detail?.blizzard?.raidClears ?? [];
  return FOREVER_RAIDS.filter(raid => !raid.legacy).map(raid => ({
    key: raid.key, instance: raid.instance, size: raid.size, opensAt: raid.opensAt,
    clearedAt: clears.filter(clear => raidClearAchievement(clear.id) === raid).map(clear => clear.completedAt)
      .sort((a, b) => a.getTime() - b.getTime())[0] ?? null,
    bosses: bossNames(raid).map(name => {
      const stat = bosses.find(entry => raidFor(entry.instance, entry.boss) === raid && key(raid, entry.boss) === key(raid, name));
      const exact = stat ? stat.firstKillAt ?? null : raid.bosses.length === 1
        ? clears.filter(clear => raidClearAchievement(clear.id) === raid).map(clear => clear.completedAt)[0] ?? null : null;
      const seen = criteria.filter(entry => raidCriterion(entry.id)?.raid === raid && raidCriterion(entry.id)?.boss === name)
        .sort((a, b) => a.seenAt.getTime() - b.seenAt.getTime())[0];
      const killed = !!stat || !!exact || !!seen;
      return { name, killed, count: stat?.count ?? (killed ? 1 : 0),
        firstKillAt: exact, seenAt: !exact && seen ? seen.seenAt : null, seenAfter: !exact && seen ? seen.after : null,
        beforeTracking: !!stat && !stat.firstKillAt };
    }),
  }));
}
