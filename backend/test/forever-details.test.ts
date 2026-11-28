import assert from "node:assert/strict";
import test from "node:test";
import { parseCharacterHtml } from "../src/features/forever/forever-armory";
import { averageItemLevel, creditedGuild, groupKills, mergeBossKills, parseAchievements, parseArmoryDetails, parseStatistics,
  type KillEntry, type StoredBoss } from "../src/features/forever/forever-details";
import { nextStatsCheckAt, statsInterval } from "../src/features/forever/forever-blizzard.worker";

const icon = (id: number) => ({ content: { assets: [{ key: "icon", value: `https://render.worldofwarcraft.com/forever-eu/icons/56/${id}.jpg` }] } });
const item = (id: number, name: string, extra: Record<string, unknown> = {}) => ({
  id, name, quality: { type: "RARE" }, media: icon(id), inventory_type: { type: "HAND" }, item_subclass: { name: "Plate" }, ...extra,
});
const character = {
  gear: {
    hand: item(16737, "Gauntlets of Valor", {
      binding: { name: "Binds when equipped" }, armor: { value: 386 },
      stats: [{ display: { display_string: "+17 Strength" } }, { display: { display_string: "+10 Stamina" } }],
      set: { item_set: { name: "Battlegear of Valor" } }, requirements: { level: { value: 54 } },
    }),
    weapon: item(281587, "Greatflank Flayer", { inventory_type: { type: "TWOHWEAPON" },
      weapon: { damage: { display_string: "63 - 118 Damage" }, attack_speed: { display_string: "Speed 2.30" } } }),
    neck: item(1, "Untrusted Icon", { media: { content: { assets: [{ key: "icon", value: "https://example.com/x.jpg" }] } } }),
    mystery: item(2, "Unknown slot"),
    head: { name: "Missing id" },
  },
  specs: [{ name: "Arms", spentPoints: 31, active: true, icon: { url: "https://render.worldofwarcraft.com/forever-eu/icons/56/1.jpg" },
    talents: [{ id: 5, name: "Deflection", rank: 5 }, { id: 6, name: "No rank" }] }, { name: "Broken" }],
  professions: {
    primaries: [{ name: "Mining", tiers: [{ skillPoints: 150, maxSkillPoints: 300 }, { skillPoints: 285, maxSkillPoints: 300 }] }],
    secondaries: [{ name: "Cooking", tiers: [{ skillPoints: 300, maxSkillPoints: 300 }] }, { name: "No tiers" }],
  },
  pvp: { honorableKills: { value: 120 }, rank: { value: 3 } },
  media: { "main-raw": { url: "https://render.worldofwarcraft.com/forever-eu/character/1/2-main-raw.png" } },
};

test("Armory details keep gear, talents and professions and accept only Blizzard render assets", () => {
  const details = parseArmoryDetails(character, "eu");
  assert.deepEqual(details.gear.map(entry => entry.slot), ["neck", "hand", "weapon"]);
  const hands = details.gear.find(entry => entry.slot === "hand")!;
  assert.deepEqual(hands, { slot: "hand", id: 16737, name: "Gauntlets of Valor", quality: "RARE",
    icon: "https://render.worldofwarcraft.com/forever-eu/icons/56/16737.jpg", inventoryType: "HAND", subclass: "Plate",
    set: "Battlegear of Valor", requiredLevel: 54, lines: ["Binds when equipped", "386 Armor", "+17 Strength", "+10 Stamina"] });
  assert.equal(details.gear.find(entry => entry.slot === "neck")!.icon, null);
  assert.deepEqual(details.gear.find(entry => entry.slot === "weapon")!.lines, ["63 - 118 Damage", "Speed 2.30"]);
  assert.deepEqual(details.specs.map(spec => [spec.name, spec.points, spec.active, spec.talents.length]), [["Arms", 31, true, 1]]);
  assert.deepEqual(details.professions.map(row => [row.name, row.skill, row.max, row.primary]), [["Mining", 285, 300, true], ["Cooking", 300, 300, false]]);
  assert.deepEqual([details.honorableKills, details.pvpRank], [120, 3]);
  assert.equal(details.renderUrl, "https://render.worldofwarcraft.com/forever-eu/character/1/2-main-raw.png");
  assert.equal(parseArmoryDetails(character, "us").renderUrl, null);
});

test("the Armory page parser attaches details only when the page has them", () => {
  const base = { region: "eu", slug: "testi-hahmo", url: "/forever/eu/armory/character/testi-hahmo/", name: "Testi", surname: "Hahmo",
    level: 60, class: { name: "Warrior" }, race: { name: "Orc" }, faction: { name: "Horde" }, ruleset: { name: "Normal" },
    lastUpdatedTimestamp: { epoch: Date.now() - 60_000 } };
  const html = (value: unknown) => `<script>var characterProfileInitialState = ${JSON.stringify({ character: value })};</script>`;
  const identity = { region: "eu" as const, slug: "testi-hahmo" };
  assert.equal("details" in parseCharacterHtml(html(base), identity), false);
  assert.equal(parseCharacterHtml(html({ ...base, gear: character.gear }), identity).details?.gear.length, 3);
});

test("average item level counts empty slots as zero, two-handers twice, and reports unknown items", () => {
  const levels = new Map([[1, 60], [2, 66], [3, 70]]);
  const full = ["head", "neck", "shoulder", "back", "chest", "wrist", "hand", "waist", "leg", "foot", "leftFinger", "rightFinger",
    "leftTrinket", "rightTrinket", "weapon", "offhand", "ranged"].map(slot => ({ slot, id: 1 }));
  assert.deepEqual(averageItemLevel(full, levels), { average: 60, unknown: 0 });
  const twoHander = [...full.filter(entry => entry.slot !== "weapon" && entry.slot !== "offhand"), { slot: "weapon", id: 3, inventoryType: "TWOHWEAPON" }];
  assert.deepEqual(averageItemLevel(twoHander, levels), { average: Math.round((60 * 15 + 140) / 17 * 10) / 10, unknown: 0 });
  assert.deepEqual(averageItemLevel([{ slot: "head", id: 2 }, { slot: "shirt", id: 3 }], levels), { average: Math.round(66 / 17 * 10) / 10, unknown: 0 });
  assert.deepEqual(averageItemLevel([...full.slice(1), { slot: "head", id: 99 }], levels), { average: 60, unknown: 1 });
  assert.equal(averageItemLevel([], levels), null);
});

const statistics = (slug: string, statisticsRows: unknown[]) => ({ character: { slug }, categories: [
  { name: "Character", statistics: [], sub_categories: [{ name: "Gear", statistics: statisticsRows }] },
] });

test("statistics map to records and dated boss kills; zero or malformed rows are ignored", () => {
  const at = Date.parse("2026-11-20T18:30:00Z");
  const parsed = parseStatistics(statistics("hahmo", [
    { id: 1, name: "Equipped epic items in item slots", quantity: 7 }, { id: 2, name: "Mounts owned", quantity: 3 },
    { id: 3, name: "Total 10-player raids entered", quantity: 4 }, { id: 4, name: "Total 40-player raids entered", quantity: 2 },
    { id: 1093, name: "Ragnaros kills (Molten Core)", quantity: 1, last_updated_timestamp: at },
    { id: 1094, name: "Onyxia kills (Onyxia's Lair)", quantity: 0, last_updated_timestamp: at },
    { id: 1095, name: "Future kills (Somewhere)", quantity: 1, last_updated_timestamp: Date.now() + 3_600_000 },
    { id: 1096, name: "Broken", quantity: "x" },
  ]), "hahmo");
  assert.deepEqual(parsed.records, { epicsEquipped: 7, mounts: 3, raidsEntered: 6 });
  assert.deepEqual(parsed.bosses, [{ id: 1093, boss: "Ragnaros", instance: "Molten Core", count: 1, lastKillAt: new Date(at) }]);
  assert.throws(() => parseStatistics(statistics("someone-else", []), "hahmo"));
  assert.throws(() => parseStatistics({ character: { slug: "hahmo" } }, "hahmo"));
});

test("achievements keep completed entries newest first with total points", () => {
  const parsed = parseAchievements({ character: { slug: "hahmo" }, total_points: 150, achievements: [
    { id: 1, achievement: { name: "Journeyman Tailor" }, completed_timestamp: 1000 },
    { id: 2, achievement: { name: "Artisan Tailor" }, completed_timestamp: 5000 },
    { id: 3, achievement: { name: "In progress" }, criteria: { is_completed: false }, completed_timestamp: 6000 },
    { id: 4, achievement: { name: "Never" } },
  ] }, "hahmo");
  assert.equal(parsed.points, 150);
  assert.deepEqual(parsed.achievements.map(row => row.name), ["Artisan Tailor", "Journeyman Tailor"]);
});

test("boss kill history dates first kills only when tracking saw the first one", () => {
  const t0 = new Date("2026-12-01T19:00:00Z"), t1 = new Date("2026-12-08T19:05:00Z");
  const observed = (count: number, at: Date, id = 1) => ({ id, boss: "Lucifron", instance: "Molten Core", count, lastKillAt: at });
  const first = mergeBossKills([], [observed(1, t0), observed(4, t0, 2)], "kilta");
  assert.deepEqual(first.find(boss => boss.id === 1)!.firstKillAt, t0);
  assert.equal(first.find(boss => boss.id === 2)!.firstKillAt, null, "earlier kills predate tracking");
  const unchanged = mergeBossKills(first, [observed(1, t0)], "kilta");
  assert.equal(unchanged.find(boss => boss.id === 1)!.kills.length, 1, "a repeated reading is not another kill");
  const second = mergeBossKills(unchanged, [observed(2, t1)], "toinen");
  const lucifron = second.find(boss => boss.id === 1)!;
  assert.deepEqual([lucifron.count, lucifron.firstKillAt, lucifron.lastKillAt], [2, t0, t1]);
  assert.deepEqual(lucifron.kills.map(kill => [kill.at, kill.guildSlug]), [[t0, "kilta"], [t1, "toinen"]]);
  let many: StoredBoss[] = second;
  for (let index = 1; index <= 40; index++) many = mergeBossKills(many, [observed(2 + index, new Date(t1.getTime() + index * 604_800_000))], null);
  assert.equal(many.find(boss => boss.id === 1)!.kills.length, 30);
});

test("tracked members' kills dated together form one group kill credited to their guild", () => {
  const at = Date.parse("2026-12-01T20:00:00Z");
  const entry = (characterId: string, guildSlug: string | null, offset = 0, bossId = 1): KillEntry =>
    ({ bossId, boss: "Ragnaros", instance: "Molten Core", at: at + offset, characterId, guildSlug });
  const groups = groupKills([entry("a", "kilta"), entry("b", "kilta", 1000), entry("c", "kilta", 90_000), entry("c", "kilta", 90_000),
    entry("d", "muu", 400_000), entry("e", "kilta", 0, 2)]);
  assert.deepEqual(groups.map(group => [group.bossId, group.entries.map(row => row.characterId)]), [[1, ["d"]], [1, ["a", "b", "c"]], [2, ["e"]]]);
  assert.equal(creditedGuild(groups[1].entries), "kilta");
  assert.equal(creditedGuild([entry("a", "kilta"), entry("b", "kilta")]), null, "two players are not a guild group");
  assert.equal(creditedGuild([entry("a", "x"), entry("b", "x"), entry("c", "x"), entry("d", "y"), entry("e", "y"), entry("f", null), entry("g", null)]), null,
    "a guild needs half the tracked group");
});

test("statistics are checked twice a day at 60 and every three days while leveling, with a stable phase", () => {
  assert.equal(statsInterval(60), 12 * 3600_000);
  assert.equal(statsInterval(45), 72 * 3600_000);
  const now = Date.parse("2026-12-01T00:00:00Z");
  const next = nextStatsCheckAt("hahmo", 60, now).getTime() - now;
  assert.ok(next >= 12 * 3600_000 && next < 13 * 3600_000);
  assert.equal(nextStatsCheckAt("hahmo", 60, now).getTime(), nextStatsCheckAt("hahmo", 60, now).getTime());
});
