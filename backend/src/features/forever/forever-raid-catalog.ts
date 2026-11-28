// Forever raids, from Blizzard's own static data (namespace static-forever-eu, read 28 November
// 2026). Each raid's "Conqueror" achievement lists one criterion per encounter, in this order.
// The order is Blizzard's listing, not a guaranteed kill order: Hyjal Summit has branching routes.
// Two achievement versions exist for each raid; both sets of criterion IDs map to the same boss.
// Opening dates come from community guides, which agree on 9 December 2026.

export interface ForeverRaidBoss { name: string; criteria: readonly number[] }
export interface ForeverRaidDefinition {
  key: string; instance: string; aliases: readonly string[]; size: number; opensAt: string | null;
  /** Full-clear achievements. Their completion time is the time of the clearing kill. */
  clearAchievements: readonly number[];
  bosses: readonly ForeverRaidBoss[];
  /** Vanilla raids Forever may bring back; shown only once someone has a kill. */
  legacy?: boolean;
}

const boss = (name: string, ...criteria: number[]): ForeverRaidBoss => ({ name, criteria });

export const FOREVER_RAIDS: readonly ForeverRaidDefinition[] = [
  { key: "barrow-deeps", instance: "Barrow Deeps", aliases: ["The Barrow Deeps"], size: 10, opensAt: "2026-12-09",
    clearAchievements: [62035, 64020], bosses: [
      boss("Chillhowl", 230806, 234187), boss("Elder Tangleclaw", 230801, 234182), boss("Khalith the Dreadspinner", 230802, 234183),
      boss("Well of Sorrow", 230804, 234185), boss("Amethrax", 230803, 234184), boss("Del'lynar Songwood", 230805, 234186),
      boss("Ravus and Darlissa", 230807, 234188), boss("Sonya Darkhallow", 230800, 234181),
    ] },
  { key: "hyjal-summit", instance: "Hyjal Summit", aliases: [], size: 20, opensAt: "2026-12-09",
    clearAchievements: [62034, 64019], bosses: [
      boss("Bandalar", 230812, 234167), boss("Ancient of Decay", 230813, 234168), boss("Time-Lost Battalion", 230814, 234169),
      boss("Sylvestris Dusksong", 230815, 234170), boss("Old Gloomlurker", 230816, 234171), boss("Gharalis the Abyssal", 230817, 234172),
      boss("Kathris the Haunted", 230818, 234173), boss("Anara Chillwind", 230819, 234174), boss("Elder Minderel", 230820, 234175),
      boss("Tracker Stillwind", 230821, 234176), boss("Council of Thorns", 230822, 234177), boss("Nythus the Dreambound", 230823, 234178),
      boss("The Wild King", 230824, 234179),
    ] },
  // A single-boss raid: completing its achievement is the Onyxia kill itself.
  { key: "onyxias-lair", instance: "Onyxia's Lair", aliases: [], size: 40, opensAt: "2026-12-09",
    clearAchievements: [684, 64030], bosses: [boss("Onyxia")] },
  ...[["molten-core", "Molten Core", 10], ["blackwing-lair", "Blackwing Lair", 8], ["zul-gurub", "Zul'Gurub", 10],
    ["ruins-of-ahn-qiraj", "Ruins of Ahn'Qiraj", 6], ["temple-of-ahn-qiraj", "Temple of Ahn'Qiraj", 9], ["naxxramas", "Naxxramas", 15]]
    .map(([key, instance, count]) => ({ key: key as string, instance: instance as string, aliases: [], size: 40, opensAt: null,
      clearAchievements: [], bosses: Array.from({ length: count as number }, () => boss("")), legacy: true })),
];

const normalize = (value: string) => value.normalize("NFC").toLocaleLowerCase("en").replace(/^the\s+/, "").trim();
const byInstance = new Map(FOREVER_RAIDS.flatMap(raid => [raid.instance, ...raid.aliases].map(name => [normalize(name), raid] as const)));
const byBoss = new Map(FOREVER_RAIDS.flatMap(raid => raid.bosses.filter(entry => entry.name).map(entry => [normalize(entry.name), raid] as const)));
const byCriterion = new Map(FOREVER_RAIDS.flatMap(raid => raid.bosses.flatMap(entry => entry.criteria.map(id => [id, { raid, boss: entry.name }] as const))));
const byClear = new Map(FOREVER_RAIDS.flatMap(raid => raid.clearAchievements.map(id => [id, raid] as const)));

/** Statistics name instances, which may differ slightly ("the Barrow Deeps"); boss names settle it. */
export function raidFor(instance: string, boss?: string): ForeverRaidDefinition | null {
  return byInstance.get(normalize(instance)) ?? (boss ? byBoss.get(normalize(boss)) : undefined) ?? null;
}
export const raidCriterion = (id: number) => byCriterion.get(id) ?? null;
export const raidClearAchievement = (id: number) => byClear.get(id) ?? null;
export const RAID_ACHIEVEMENTS = new Set(FOREVER_RAIDS.flatMap(raid => raid.clearAchievements));
/** Bosses named in the catalog; legacy raids only know their boss count. */
export const bossNames = (raid: ForeverRaidDefinition) => raid.bosses.map(entry => entry.name).filter(Boolean);
