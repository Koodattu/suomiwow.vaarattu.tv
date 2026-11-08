import assert from "node:assert/strict";
import test from "node:test";
import { buildForeverAnalytics } from "../src/features/forever/forever-analytics";

const now = Date.parse("2026-11-08T12:00:00Z"), hour = 3_600_000;
const point = (level: number, hoursAgo: number) => ({ level, observedAt: new Date(now - hoursAgo * hour) });
test("level histogram includes every level; unknown labels and Skyborne grouping preserve totals", () => {
  const result = buildForeverAnalytics([
    { level: 1, race: "Windshaper Skyborne", className: "Mage" },
    { level: 60, race: "High Order Skyborne", className: "Mage" },
    { level: 20, race: "Orc", className: "Warrior" }, { level: 21 }, { level: 0 }, { level: 61 }, { level: null },
  ], now);
  assert.equal(result.total, 4); assert.equal(result.levels.length, 60);
  assert.equal(result.levels[0].count, 1); assert.equal(result.levels[59].count, 1); assert.equal(result.levels[1].count, 0);
  assert.equal(result.averageLevel, 25.5); assert.equal(result.medianLevel, 20.5); assert.equal(result.atMaxLevel, 1);
  assert.equal(result.races.find(row => row.name === "Skyborne")?.count, 2);
  assert.equal(result.classes.find(row => row.name === null)?.count, 1);
  assert.equal(result.combinations.reduce((sum, row) => sum + row.count, 0), 4);
  assert.equal(result.combinations[0].count, 2);
});
test("race faction segments use actual affiliations and combine both Skyborne variants", () => {
  const result = buildForeverAnalytics([
    { level: 20, race: "Windshaper Skyborne", faction: "Horde" },
    { level: 30, race: "High Order Skyborne", faction: "Alliance" },
    { level: 25, race: "Skyborne", faction: "Horde" },
    { level: 10, race: "Orc", faction: "Horde" },
    { level: 10, race: "Human", faction: "Alliance" },
    { level: 10, race: "Human" },
    { level: 0, race: "Skyborne", faction: "Alliance" },
  ], now);
  assert.deepEqual(result.races.find(race => race.name === "Skyborne"), {
    name: "Skyborne", count: 3, factions: { alliance: 1, horde: 2, unknown: 0 },
  });
  assert.deepEqual(result.races.find(race => race.name === "Orc")?.factions, { alliance: 0, horde: 1, unknown: 0 });
  assert.deepEqual(result.races.find(race => race.name === "Human")?.factions, { alliance: 1, horde: 0, unknown: 1 });
  for (const race of result.races) assert.equal(Object.values(race.factions).reduce((sum, count) => sum + count, 0), race.count);
});
test("race-class faction counts split Skyborne without changing combined popularity totals", () => {
  const result = buildForeverAnalytics([
    { level: 20, race: "Windshaper Skyborne", className: "Mage", faction: "Horde" },
    { level: 30, race: "High Order Skyborne", className: "Mage", faction: "Alliance" },
    { level: 25, race: "Skyborne", className: "Mage", faction: "Horde" },
    { level: 15, race: "Skyborne", className: "Warrior", faction: "Alliance" },
    { level: 10, race: "Skyborne", className: "Warrior" },
    { level: 10, race: "Orc", className: "Mage", faction: "Horde" },
  ], now);
  assert.equal(result.races.find(race => race.name === "Skyborne")?.count, 5);
  assert.deepEqual(result.combinations.find(entry => entry.race === "Skyborne" && entry.className === "Mage"), {
    race: "Skyborne", className: "Mage", count: 3, factions: { alliance: 1, horde: 2, unknown: 0 },
  });
  assert.deepEqual(result.combinations.find(entry => entry.race === "Skyborne" && entry.className === "Warrior")?.factions,
    { alliance: 1, horde: 0, unknown: 1 });
  for (const entry of result.combinations) assert.equal(Object.values(entry.factions).reduce((sum, count) => sum + count, 0), entry.count);
  assert.equal(result.combinations.reduce((sum, entry) => sum + entry.count, 0), result.total);
});
test("activity counts unique new or leveling characters in (now - 24h, now] without inventing gains", () => {
  const result = buildForeverAnalytics([
    { level: 30, history: [point(30, 1)] }, // First sighting is not thirty gains.
    { level: 12, history: [point(10, 48), point(11, 23), point(12, 1)] },
    { level: 60, history: [point(59, 48), point(60, 2)] }, // Recently capped is active.
    { level: 21, history: [point(20, 48), point(21, 24)] }, // Exactly outside half-open window.
    { level: 20, history: [point(20, 48), point(20, 1), point(19, 0.5)] },
    { level: 2, history: [point(1, 48), point(2, -1)] }, // Future data cannot count.
  ], now);
  assert.equal(result.active24h, 3); assert.equal(result.historyCharacters, 6);
  assert.equal(result.new24h, 1); assert.equal(result.levelsGained24h, 3);
  assert.equal(result.activity[result.activity.length - 1].observed, 6);
  assert.equal(result.activity[result.activity.length - 1].active, 3);
  assert.ok(result.activity.every(row => row.active <= row.observed));
  assert.equal(result.activity[0].partial, true); assert.equal(result.activity[result.activity.length - 1].partial, false);
});
test("new arrivals expire after 24h, repeated observations do not extend activity, and genuine gains restart it", () => {
  const fresh = buildForeverAnalytics([{ level: 30, history: [point(30, 2), point(30, 1)] }], now);
  assert.equal(fresh.active24h, 1); assert.equal(fresh.new24h, 1); assert.equal(fresh.levelsGained24h, 0);
  assert.equal(fresh.activity[0].active, 1);
  const expired = buildForeverAnalytics([{ level: 30, history: [point(30, 24), point(30, 1)] }], now);
  assert.equal(expired.active24h, 0); assert.equal(expired.new24h, 0);
  const restarted = buildForeverAnalytics([{ level: 35, history: [point(30, 72), point(35, 1), point(32, 0.5), point(35, 0)] }], now);
  assert.equal(restarted.active24h, 1); assert.equal(restarted.new24h, 0); assert.equal(restarted.levelsGained24h, 5);
  const overlap = buildForeverAnalytics([{ level: 22, history: [point(20, 23), point(21, 22), point(22, 1)] }], now);
  assert.equal(overlap.active24h, 1); assert.equal(overlap.new24h, 1); assert.equal(overlap.levelsGained24h, 2);
  assert.ok(overlap.activity.every(row => row.active === 1));
  const starter = buildForeverAnalytics([{ level: 1, history: [point(1, 2)] }], now);
  assert.equal(starter.new24h, 1); assert.equal(starter.active24h, 0); assert.equal(starter.levelsGained24h, 0);
});

test("faction and ruleset charts share the full analytics population, including unknowns and level one", () => {
  const result = buildForeverAnalytics([
    { level: 1, faction: "Horde", ruleset: "PvP" }, { level: 25, faction: "Horde", ruleset: "Normal" },
    { level: 60, faction: "Alliance", ruleset: "PvP" }, { level: 10, faction: "Alliance" }, { level: 20 }, { level: 0, faction: "Horde" },
  ], now);
  assert.deepEqual(result.statistics.factions, [{ name: "Alliance", count: 2 }, { name: "Horde", count: 2 }, { name: null, count: 1 }]);
  assert.equal(result.statistics.rulesets.find(entry => entry.name === "PvP")?.count, 2);
  assert.equal(result.statistics.rulesets.find(entry => entry.name === null)?.count, 2);
  assert.equal(result.statistics.combinations.reduce((sum, entry) => sum + entry.count, 0), 5);
  assert.equal(result.statistics.combinations.find(entry => entry.faction === "Alliance" && entry.ruleset === null)?.count, 1);
  assert.equal(result.statistics.averageLevel, result.averageLevel); assert.equal(result.statistics.atMaxLevel, result.atMaxLevel);
});
test("activity drop-off is reconstructed between gains, with only thirty days returned", () => {
  const result = buildForeverAnalytics([{ level: 12, history: [point(10, 40 * 24), point(11, 4 * 24), point(12, 2)] }], now);
  assert.equal(result.activity[0].at, new Date(now - 30 * 24 * hour).toISOString());
  assert.equal(result.activity.find(row => row.at === new Date(now - 90 * hour).toISOString())?.active, 1);
  assert.equal(result.activity.find(row => row.at === new Date(now - 48 * hour).toISOString())?.active, 0);
  assert.equal(result.active24h, 1); assert.ok(result.activity.length <= 122);
});
test("current level-one characters are excluded only from activity, while gains from level one still count", () => {
  const starter = { level: 1, race: "Orc", className: "Warrior", faction: "Horde", history: [point(1, 120), point(1, 1)] };
  const leveled = { level: 2, race: "Human", className: "Mage", faction: "Alliance", history: [point(1, 48), point(2, 1)] };
  const result = buildForeverAnalytics([starter, leveled], now);
  const activityOnly = buildForeverAnalytics([leveled], now);
  assert.deepEqual(result.activity, activityOnly.activity);
  assert.equal(result.coverageStart, activityOnly.coverageStart);
  assert.equal(result.historyCharacters, 1);
  assert.equal(result.active24h, 1);
  assert.equal(result.activity[result.activity.length - 1].observed, 1);
  assert.equal(result.total, 2);
  assert.equal(result.levels[0].count, 1);
  assert.equal(result.averageLevel, 1.5);
  assert.equal(result.medianLevel, 1.5);
  assert.equal(result.races.find(row => row.name === "Orc")?.count, 1);
  assert.equal(result.classes.find(row => row.name === "Warrior")?.count, 1);
  assert.equal(result.combinations.find(row => row.race === "Orc")?.count, 1);
  const startersOnly = buildForeverAnalytics([starter], now);
  assert.deepEqual(startersOnly.activity, []);
  assert.equal(startersOnly.coverageStart, null);
  assert.equal(startersOnly.historyCharacters, 0);
  assert.equal(startersOnly.total, 1);
});
test("empty and missing history produce no invented timeline or averages", () => {
  const empty = buildForeverAnalytics([], now);
  assert.equal(empty.total, 0); assert.equal(empty.averageLevel, null); assert.equal(empty.medianLevel, null);
  assert.equal(empty.coverageStart, null); assert.deepEqual(empty.activity, []);
  const unobserved = buildForeverAnalytics([{ level: 40, history: [{ level: 40, observedAt: new Date("invalid") }] }], now);
  assert.equal(unobserved.historyCharacters, 0); assert.deepEqual(unobserved.activity, []);
});
