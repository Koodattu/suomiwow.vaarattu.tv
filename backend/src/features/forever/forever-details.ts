import { ArmoryError } from "./forever-armory";

// Parsers for the character data Blizzard publishes alongside levels: the Armory
// page's embedded profile (gear, talents, professions) and the official profile
// API's statistics and achievements. Everything here is pure so it can be tested
// against captured payloads without a database.

export const GEAR_SLOTS = ["head", "neck", "shoulder", "back", "chest", "shirt", "tabard", "wrist", "hand", "waist", "leg", "foot",
  "leftFinger", "rightFinger", "leftTrinket", "rightTrinket", "weapon", "offhand", "ranged"] as const;
export type GearSlot = typeof GEAR_SLOTS[number];
// Average item level uses the 17 equipment slots WoW itself averages; shirt and tabard are cosmetic.
export const ITEM_LEVEL_SLOTS = GEAR_SLOTS.filter(slot => slot !== "shirt" && slot !== "tabard");

export interface ForeverGearItem {
  slot: GearSlot; id: number; name: string; quality: string; icon: string | null;
  inventoryType: string | null; subclass: string | null; set: string | null; requiredLevel: number | null; lines: string[];
}
export interface ForeverTalent { id: number; name: string; rank: number; icon: string | null }
export interface ForeverSpec { name: string; points: number; active: boolean; icon: string | null; talents: ForeverTalent[] }
export interface ForeverProfession { name: string; icon: string | null; skill: number; max: number; primary: boolean }
export interface ForeverArmoryDetails {
  gear: ForeverGearItem[]; specs: ForeverSpec[]; professions: ForeverProfession[];
  honorableKills: number | null; pvpRank: number | null; renderUrl: string | null;
}

type Json = Record<string, unknown>;
const object = (value: unknown): Json | null => value && typeof value === "object" && !Array.isArray(value) ? value as Json : null;
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown, max = 200): string | null => typeof value === "string" && value.trim() && value.length <= max ? value.trim() : null;
const integer = (value: unknown): number | null => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;

/** Only Blizzard's own render CDN is accepted for icons and renders shown on our pages. */
export function renderAsset(value: unknown): string | null {
  const url = text(value, 300);
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.origin === "https://render.worldofwarcraft.com" && !parsed.username && !parsed.password && !parsed.search && !parsed.hash
      && /\.(?:jpg|png)$/.test(parsed.pathname) ? parsed.href : null;
  } catch { return null; }
}

function iconOf(value: unknown): string | null {
  const media = object(value);
  const content = object(media?.content);
  const icon = array(content?.assets).map(object).find(asset => asset?.key === "icon");
  return renderAsset(icon?.value);
}

function gearItem(slot: GearSlot, value: unknown): ForeverGearItem | null {
  const item = object(value);
  const id = integer(item?.id), name = text(item?.name);
  if (!item || !id || !name) return null;
  const lines: string[] = [];
  const add = (line: unknown) => { const value = text(line, 300); if (value && lines.length < 16) lines.push(value); };
  add(object(item.binding)?.name);
  add(item.unique_equipped);
  const armor = integer(object(item.armor)?.value);
  if (armor) lines.push(`${armor} Armor`);
  const weapon = object(item.weapon);
  if (weapon) {
    add(object(weapon.damage)?.display_string);
    add(object(weapon.attack_speed)?.display_string);
    add(object(weapon.dps)?.display_string);
  }
  for (const stat of array(item.stats)) add(object(object(stat)?.display)?.display_string);
  for (const spell of array(item.spells)) add(object(spell)?.description);
  const set = object(item.set);
  return {
    slot, id, name, quality: text(object(item.quality)?.type, 40) ?? "COMMON", icon: iconOf(item.media),
    inventoryType: text(object(item.inventory_type)?.type, 40), subclass: text(object(item.item_subclass)?.name, 60),
    set: text(object(set?.item_set)?.name), requiredLevel: integer(object(object(item.requirements)?.level)?.value),
    lines,
  };
}

/** Reads the extra profile sections from the Armory page's `character` object. Unknown shapes are skipped, never guessed. */
export function parseArmoryDetails(character: Json, region: string): ForeverArmoryDetails {
  const gearSource = object(character.gear) ?? {};
  const gear = GEAR_SLOTS.flatMap(slot => { const item = gearItem(slot, gearSource[slot]); return item ? [item] : []; });
  const specs = array(character.specs).flatMap(value => {
    const spec = object(value), name = text(spec?.name, 60), points = integer(spec?.spentPoints);
    if (!spec || !name || points === null) return [];
    const talents = array(spec.talents).flatMap(entry => {
      const talent = object(entry), id = integer(talent?.id), talentName = text(talent?.name, 80), rank = integer(talent?.rank);
      return talent && id && talentName && rank ? [{ id, name: talentName, rank, icon: renderAsset(object(talent.icon)?.url) }] : [];
    }).slice(0, 60);
    return [{ name, points, active: spec.active === true, icon: renderAsset(object(spec.icon)?.url), talents }];
  }).slice(0, 4);
  const professions: ForeverProfession[] = [];
  const professionSource = object(character.professions);
  for (const [key, primary] of [["primaries", true], ["secondaries", false]] as const) {
    for (const value of array(professionSource?.[key])) {
      const profession = object(value), name = text(profession?.name, 60);
      // A profession can list several tiers; the highest trained skill is the one players compare.
      const tiers = array(profession?.tiers).map(object).flatMap(tier => {
        const skill = integer(tier?.skillPoints), max = integer(tier?.maxSkillPoints);
        return skill !== null && max ? [{ skill, max }] : [];
      }).sort((a, b) => b.skill - a.skill);
      if (name && tiers[0]) professions.push({ name, icon: renderAsset(object(profession?.icon)?.url), ...tiers[0], primary });
    }
  }
  const pvp = object(character.pvp);
  const render = renderAsset(object(object(character.media)?.["main-raw"])?.url);
  return {
    gear, specs, professions: professions.slice(0, 8),
    honorableKills: integer(object(pvp?.honorableKills)?.value), pvpRank: integer(object(pvp?.rank)?.value),
    renderUrl: render && render.startsWith(`https://render.worldofwarcraft.com/forever-${region}/character/`) ? render : null,
  };
}

export interface ItemLevelInput { slot: string; id: number; inventoryType?: string | null }
/**
 * Average item level across the 17 equipment slots. Empty slots count as zero, as in game;
 * a two-hander with an empty off hand counts for both hands. Items Blizzard's item data
 * doesn't know are excluded and reported, so callers can decide whether to rank the result.
 */
export function averageItemLevel(gear: readonly ItemLevelInput[], levels: ReadonlyMap<number, number>) {
  const bySlot = new Map(gear.map(item => [item.slot, item]));
  const twoHanded = bySlot.get("weapon")?.inventoryType === "TWOHWEAPON" && !bySlot.has("offhand");
  let sum = 0, counted = 0, unknown = 0;
  for (const slot of ITEM_LEVEL_SLOTS) {
    const item = slot === "offhand" && twoHanded ? bySlot.get("weapon") : bySlot.get(slot);
    if (!item) { counted++; continue; }
    const level = levels.get(item.id);
    if (level === undefined) { unknown++; continue; }
    sum += level; counted++;
  }
  if (!gear.length || !counted) return null;
  return { average: Math.round(sum / counted * 10) / 10, unknown };
}

export interface ForeverRecords {
  epicsEquipped?: number; epicsAcquired?: number; mounts?: number; exalted?: number;
  battlegroundsPlayed?: number; battlegroundsWon?: number; duelsWon?: number; duelsLost?: number;
  totalKills?: number; deathsFromPlayers?: number; dungeonsEntered?: number; raidsEntered?: number;
}
const recordNames: Record<string, keyof ForeverRecords> = {
  "Equipped epic items in item slots": "epicsEquipped", "Epic items acquired": "epicsAcquired", "Mounts owned": "mounts",
  "Most factions at Exalted": "exalted", "Battlegrounds played": "battlegroundsPlayed", "Battlegrounds won": "battlegroundsWon",
  "Duels won": "duelsWon", "Duels lost": "duelsLost", "Total kills": "totalKills",
  "Total deaths from other players": "deathsFromPlayers", "Total 5-player dungeons entered": "dungeonsEntered",
};
export interface ObservedBoss { id: number; boss: string; instance: string; count: number; lastKillAt: Date }

function checkCharacter(document: Json | null, slug: string) {
  const character = object(document?.character);
  if (typeof character?.slug !== "string" || character.slug.normalize("NFC") !== slug) throw new ArmoryError("invalid_data");
}

/** Parses `/achievements/statistics`. Statistics with no progress are omitted by Blizzard, so absence means zero. */
export function parseStatistics(payload: unknown, slug: string): { records: ForeverRecords; bosses: ObservedBoss[] } {
  const document = object(payload);
  checkCharacter(document, slug);
  if (!Array.isArray(document!.categories)) throw new ArmoryError("invalid_data");
  const records: ForeverRecords = {}, bosses = new Map<number, ObservedBoss>();
  const visit = (category: Json | null, depth: number) => {
    if (!category || depth > 4) return;
    for (const entry of array(category.statistics)) {
      const statistic = object(entry), id = integer(statistic?.id), name = text(statistic?.name);
      const quantity = typeof statistic?.quantity === "number" && Number.isFinite(statistic.quantity) && statistic.quantity >= 0 ? Math.round(statistic.quantity) : null;
      if (!id || !name || quantity === null) continue;
      const record = recordNames[name];
      if (record) records[record] = quantity;
      else if (/^Total \d+-player raids entered$/.test(name)) records.raidsEntered = (records.raidsEntered ?? 0) + quantity;
      const kill = name.match(/^(.+?) kills \((.+)\)$/i), at = integer(statistic?.last_updated_timestamp);
      if (kill && quantity >= 1 && at && at <= Date.now() + 300_000) {
        bosses.set(id, { id, boss: kill[1].trim(), instance: kill[2].trim(), count: quantity, lastKillAt: new Date(at) });
      }
    }
    for (const sub of array(category.sub_categories)) visit(object(sub), depth + 1);
  };
  for (const category of document!.categories as unknown[]) visit(object(category), 0);
  return { records, bosses: [...bosses.values()] };
}

export interface ForeverAchievement { id: number; name: string; completedAt: Date }
/** Parses `/achievements`; only completed achievements with a completion time are kept. */
export function parseAchievements(payload: unknown, slug: string): { points: number | null; achievements: ForeverAchievement[] } {
  const document = object(payload);
  checkCharacter(document, slug);
  if (!Array.isArray(document!.achievements)) throw new ArmoryError("invalid_data");
  const achievements = (document!.achievements as unknown[]).flatMap(entry => {
    const achievement = object(entry), id = integer(achievement?.id), name = text(object(achievement?.achievement)?.name);
    const at = integer(achievement?.completed_timestamp);
    if (!id || !name || !at || object(achievement?.criteria)?.is_completed === false || at > Date.now() + 300_000) return [];
    return [{ id, name, completedAt: new Date(at) }];
  }).sort((a, b) => b.completedAt.getTime() - a.completedAt.getTime() || a.id - b.id);
  return { points: integer(document!.total_points), achievements: achievements.slice(0, 400) };
}

export interface StoredBoss {
  id: number; boss: string; instance: string; count: number; lastKillAt: Date;
  /** Known only when we saw the statistic at one kill; earlier kills happened before tracking. */
  firstKillAt: Date | null;
  kills: { at: Date; guildSlug: string | null }[];
}
const KILL_HISTORY = 30;

/**
 * Each statistic records the time of the latest kill. A count of one therefore dates the
 * first kill exactly, and every later change dates another kill. Raid lockouts allow one
 * kill per boss per reset, so polling more often than weekly observes every raid kill.
 */
export function mergeBossKills(previous: readonly StoredBoss[], observed: readonly ObservedBoss[], guildSlug: string | null): StoredBoss[] {
  const merged = new Map(previous.map(boss => [boss.id, { ...boss, kills: [...boss.kills] }]));
  for (const boss of observed) {
    const known = merged.get(boss.id);
    if (!known) {
      merged.set(boss.id, { ...boss, firstKillAt: boss.count === 1 ? boss.lastKillAt : null, kills: [{ at: boss.lastKillAt, guildSlug }] });
      continue;
    }
    const newer = boss.lastKillAt.getTime() > known.lastKillAt.getTime();
    if (newer) known.kills = [...known.kills, { at: boss.lastKillAt, guildSlug }].slice(-KILL_HISTORY);
    merged.set(boss.id, { ...known, boss: boss.boss, instance: boss.instance,
      count: Math.max(known.count, boss.count), lastKillAt: newer ? boss.lastKillAt : known.lastKillAt });
  }
  return [...merged.values()].sort((a, b) => a.instance.localeCompare(b.instance) || a.boss.localeCompare(b.boss));
}

export interface KillEntry { bossId: number; boss: string; instance: string; at: number; characterId: string; guildSlug: string | null }
export interface KillGroup { bossId: number; boss: string; instance: string; at: number; entries: KillEntry[] }
/** Group members' kills of the same boss that Blizzard dated within the same two minutes. */
export function groupKills(entries: readonly KillEntry[], windowMs = 120_000): KillGroup[] {
  const sorted = [...entries].sort((a, b) => a.bossId - b.bossId || a.at - b.at);
  const groups: KillGroup[] = [];
  for (const entry of sorted) {
    const group = groups[groups.length - 1];
    if (group && group.bossId === entry.bossId && entry.at - group.entries[group.entries.length - 1].at <= windowMs) {
      if (!group.entries.some(existing => existing.characterId === entry.characterId)) group.entries.push(entry);
    } else groups.push({ bossId: entry.bossId, boss: entry.boss, instance: entry.instance, at: entry.at, entries: [entry] });
  }
  return groups.sort((a, b) => b.at - a.at || a.bossId - b.bossId);
}

/** A group kill belongs to a guild when at least three tracked members, and half the tracked group, share it. */
export function creditedGuild(entries: readonly Pick<KillEntry, "guildSlug">[]): string | null {
  const counts = new Map<string, number>();
  for (const entry of entries) if (entry.guildSlug) counts.set(entry.guildSlug, (counts.get(entry.guildSlug) ?? 0) + 1);
  const [best] = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return best && best[1] >= 3 && best[1] * 2 >= entries.length ? best[0] : null;
}
