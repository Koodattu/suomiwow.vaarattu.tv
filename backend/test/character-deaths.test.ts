import assert from "node:assert/strict";
import { test } from "node:test";
import { getCharacterDeaths, summarizeCharacterDeaths } from "../src/services/character-deaths.service";
import characterService from "../src/services/character.service";
import Fight from "../src/models/Fight";

type DeathFight = Parameters<typeof summarizeCharacterDeaths>[0][number];
const appearance = new Map([["report", [{ characterName: "Player", characterRealm: "azjol-nerub", rankingFightIds: [] as number[] }]]]);
const death = (name: string, deathTime: number, server = "Azjol'Nerub") => ({ name, server, timestamp: 1000 + deathTime, deathTime });
const fight = (patch: Partial<DeathFight> = {}): DeathFight => ({
  reportCode: "report", fightId: 1, duration: 100000, fightStartTime: 1000, fightEndTime: 101000,
  timestamp: new Date("2026-09-01T18:00:00Z"), isKill: false, deathEventsFetchStatus: "fetched",
  combatantInfoRosterComplete: true, combatantInfoFetchStatus: "fetched",
  combatants: ["Player", "Other", "Third", "Fourth"].map((name) => ({ name, server: "Azjol'Nerub" })),
  deaths: [], ...patch,
});

test("matches report identity and realm punctuation, preserves resurrection deaths and phases", () => {
  const result = summarizeCharacterDeaths([fight({
    deaths: [death("PLAYER", 80000), death("Other", 10000), death("player", 20000), death("Player", 15000, "Kazzak")],
    phaseTransitions: [{ id: 1, startTime: 1000 }, { id: 2, name: "Final phase", startTime: 71000 }],
  })], appearance);
  assert.equal(result.summary.deaths, 2);
  assert.equal(result.summary.pullsWithDeaths, 1);
  assert.equal(result.summary.averageFirstDeathTime, 20000);
  assert.deepEqual(result.timing, [1, 0, 0, 1]);
  assert.deepEqual(result.events.map((event) => event.order), [2, 2]);
  assert.deepEqual(result.events.map((event) => event.phase), ["1", "Final phase"]);
});

test("does not treat unconfirmed participation or unfetched deaths as survival", () => {
  const result = summarizeCharacterDeaths([
    fight(),
    fight({ fightId: 2, deathEventsFetchStatus: "failed" }),
    fight({ fightId: 3, combatants: [], combatantInfoRosterComplete: false }),
  ], appearance);
  assert.equal(result.summary.pulls, 2);
  assert.equal(result.summary.evaluatedPulls, 1);
  assert.equal(result.summary.survivedPulls, 1);
  assert.equal(result.summary.unconfirmedPulls, 1);
});

test("death or exact ranking fight confirms participation without a roster, but order stays unknown", () => {
  const appearances = new Map([["report", [{ ...appearance.get("report")![0], rankingFightIds: [2] }]]]);
  const result = summarizeCharacterDeaths([
    fight({ combatants: [], combatantInfoRosterComplete: false, deaths: [death("Player", 10000)] }),
    fight({ fightId: 2, combatants: [], combatantInfoRosterComplete: false }),
    fight({ fightId: 3, combatants: [], combatantInfoRosterComplete: false }),
  ], appearances);
  assert.equal(result.summary.pulls, 2);
  assert.equal(result.summary.survivedPulls, 1);
  assert.equal(result.summary.firstThreePulls, 0);
  assert.equal(result.events[0].order, null);
});

test("counts unique players, ignores pets in death order, and gives ties the same order", () => {
  const result = summarizeCharacterDeaths([fight({ deaths: [
    death("Pet", 1000), death("Other", 5000), death("Other", 10000),
    death("Third", 20000), death("Fourth", 20000), death("Player", 20000),
  ] })], appearance);
  assert.equal(result.events[0].order, 2);
  assert.equal(result.summary.firstThreePulls, 1);
});

test("does not assign a death order when the character is absent from the roster", () => {
  const result = summarizeCharacterDeaths([fight({ combatants: [{ name: "Other", server: "Azjol'Nerub" }], deaths: [death("Player", 10000)] })], appearance);
  assert.equal(result.events[0].order, null);
  assert.equal(result.summary.firstThreePulls, 0);
});

test("ignores out-of-fight deaths, includes end-boundary deaths and deduplicates pulls", () => {
  const row = fight({ deaths: [death("Player", -1), death("Player", 100001), death("Player", NaN), death("Player", 100000)] });
  const result = summarizeCharacterDeaths([row, row], appearance);
  assert.equal(result.summary.pulls, 1);
  assert.equal(result.summary.deaths, 1);
  assert.deepEqual(result.timing, [0, 0, 0, 1]);
});

test("pagination keeps full aggregates and returns the latest deaths first", () => {
  const fights = Array.from({ length: 55 }, (_, index) => fight({ fightId: index + 1, deaths: [death("Player", 10000)] }));
  const result = summarizeCharacterDeaths(fights, appearance, 2);
  assert.equal(result.summary.deaths, 55);
  assert.equal(result.events.length, 5);
  assert.equal(result.events[0].fightId, 5);
  assert.equal(result.pagination.totalPages, 2);
  assert.equal(summarizeCharacterDeaths(fights, appearance, 99).pagination.currentPage, 2);
});

test("queries only the selected character's reports, boss, raid, difficulty and outcome", async (context) => {
  const lookup = context.mock.method(characterService, "getDeathAnalysisAppearances", async () => [
    { reportCode: "report", characterName: "Player", characterRealm: "azjol-nerub", rankingFightIds: [] },
  ]);
  let filter: unknown;
  context.mock.method(Fight, "find", (query: unknown) => {
    filter = query;
    return { select: () => ({ lean: async () => [fight()] }) };
  });
  const result = await getCharacterDeaths({ realm: "azjol-nerub", name: "Player", classId: 9, region: "eu", zoneId: 53, encounterId: 123, difficulty: 5, outcome: "wipes", page: 1 });
  assert.deepEqual(lookup.mock.calls[0].arguments, ["azjol-nerub", "Player", 9, "eu"]);
  assert.deepEqual(filter, { reportCode: { $in: ["report"] }, zoneId: 53, encounterID: 123, difficulty: 5, isKill: false });
  assert.equal(result.summary.survivedPulls, 1);
});
