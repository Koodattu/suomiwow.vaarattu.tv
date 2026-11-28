import { creditedGuild, groupKills, type KillEntry } from "./forever-details";
import { ForeverCharacterDetail } from "./forever-details.models";
import { ForeverCharacter, ForeverGuild } from "./forever.models";
import { foreverVisibility } from "./forever-visibility";
import { ForeverSnapshotCache } from "./forever-snapshot";

// Statistics name instances, not instance types. Vanilla raids are listed here with their
// boss counts; any other instance is treated as a dungeon. Add new Forever raids here.
export const FOREVER_RAIDS = [
  { instance: "Molten Core", bosses: 10 }, { instance: "Onyxia's Lair", bosses: 1 },
  { instance: "Blackwing Lair", bosses: 8 }, { instance: "Zul'Gurub", bosses: 10 },
  { instance: "Ruins of Ahn'Qiraj", bosses: 6 }, { instance: "Temple of Ahn'Qiraj", bosses: 9 },
  { instance: "Naxxramas", bosses: 15 },
] as const;
const raidNames = new Set<string>(FOREVER_RAIDS.map(raid => raid.instance));
export const isForeverRaid = (instance: string) => raidNames.has(instance);
// Dungeon groups need several tracked players before they count as a shared kill.
const MIN_GROUP = 3;
const RECENT = 30;

type PublicGuild = { id: string | null; name: string; slug: string };
type Participant = { id: string; slug: string; name: string; className: string | null };
export interface ForeverKillEvent {
  boss: string; instance: string; raid: boolean; at: string; guild: PublicGuild | null; participants: Participant[];
}
export interface ForeverGuildProgress {
  guild: PublicGuild; killed: number; reachedAt: string; lastKillAt: string;
  bosses: { boss: string; firstKillAt: string; participants: number }[];
}
export interface ForeverRaidSummary { instance: string; bosses: number; guilds: ForeverGuildProgress[] }
export interface ForeverRaidsSnapshot { raids: ForeverRaidSummary[]; recent: ForeverKillEvent[]; groupKills: number; trackedCharacters: number }

export async function buildForeverRaids(): Promise<ForeverRaidsSnapshot> {
  const visibility = await foreverVisibility();
  const characters = (await ForeverCharacter.find({ region: "eu", status: "tracked", level: { $gte: 40 } })
    .select("slug name className guild source independentlyTracked region").lean()).filter(visibility.includes);
  const byId = new Map(characters.map(character => [String(character._id), character]));
  const details = await ForeverCharacterDetail.find({ _id: { $in: characters.map(character => character._id) }, "blizzard.bosses.0": { $exists: true } })
    .select("blizzard.bosses").lean();
  const entries: KillEntry[] = [];
  for (const detail of details) {
    for (const boss of detail.blizzard?.bosses ?? []) {
      for (const kill of boss.kills ?? []) entries.push({ bossId: boss.id, boss: boss.boss, instance: boss.instance,
        at: kill.at.getTime(), characterId: String(detail._id), guildSlug: kill.guildSlug ?? null });
    }
  }
  const guilds = await ForeverGuild.find({ region: "eu", status: "approved", hidden: { $ne: true } }).select("name slug").lean();
  const guildBySlug = new Map(guilds.map(guild => [guild.slug, { id: String(guild._id), name: guild.name, slug: guild.slug }]));
  const groups = groupKills(entries).filter(group => isForeverRaid(group.instance) || group.entries.length >= MIN_GROUP);
  const events = groups.map(group => {
    const slug = creditedGuild(group.entries);
    return {
      boss: group.boss, instance: group.instance, raid: isForeverRaid(group.instance), at: new Date(group.at).toISOString(),
      guild: slug ? guildBySlug.get(slug) ?? null : null,
      participants: group.entries.flatMap(entry => {
        const character = byId.get(entry.characterId);
        return character ? [{ id: entry.characterId, slug: character.slug, name: character.name || character.slug, className: character.className ?? null }] : [];
      }).sort((a, b) => a.name.localeCompare(b.name, "fi")),
    };
  });

  // Progress counts each boss once per guild, dated by the guild's first credited kill.
  const raids = FOREVER_RAIDS.map(({ instance, bosses }) => {
    const progress = new Map<string, Map<string, { at: string; participants: number }>>();
    for (const event of [...events].reverse()) {
      if (event.instance !== instance || !event.guild) continue;
      const killed = progress.get(event.guild.slug) ?? new Map();
      if (!killed.has(event.boss)) killed.set(event.boss, { at: event.at, participants: event.participants.length });
      progress.set(event.guild.slug, killed);
    }
    const guildProgress = [...progress].map(([slug, killed]) => {
      const list = [...killed].map(([boss, kill]) => ({ boss, firstKillAt: kill.at, participants: kill.participants }))
        .sort((a, b) => a.firstKillAt.localeCompare(b.firstKillAt));
      return { guild: guildBySlug.get(slug)!, killed: list.length, reachedAt: list[list.length - 1].firstKillAt,
        lastKillAt: list.reduce((latest, boss) => boss.firstKillAt > latest ? boss.firstKillAt : latest, list[0].firstKillAt), bosses: list };
    }).filter(row => row.guild).sort((a, b) => b.killed - a.killed || a.reachedAt.localeCompare(b.reachedAt));
    return { instance, bosses, guilds: guildProgress };
  });
  return { raids, recent: events.slice(0, RECENT), groupKills: events.length, trackedCharacters: details.length };
}

export const foreverRaidsCache = new ForeverSnapshotCache("forever:raids:v1", buildForeverRaids);
export function foreverRaids() { return foreverRaidsCache.get(); }

/** A guild's own raid progress and its latest shared kills, for the guild page. */
export async function foreverGuildRaids(slug: string) {
  const snapshot = await foreverRaids();
  return {
    raids: snapshot.raids.flatMap(raid => {
      const row = raid.guilds.find(entry => entry.guild.slug === slug);
      return row ? [{ instance: raid.instance, bosses: raid.bosses, killed: row.killed, reachedAt: row.reachedAt, list: row.bosses }] : [];
    }),
    recent: snapshot.recent.filter(event => event.guild?.slug === slug).slice(0, 8),
  };
}
