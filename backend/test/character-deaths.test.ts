import assert from "node:assert/strict";
import { test } from "node:test";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import express from "express";
import { getCharacterDeaths, parseDeathEventOptions, summarizeCharacterDeaths } from "../src/services/character-deaths.service";
import characterService from "../src/services/character.service";
import Fight from "../src/models/Fight";
import Character from "../src/models/Character";
import CharacterReportAppearance from "../src/models/CharacterReportAppearance";
import charactersRouter from "../src/routes/characters";

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
  assert.equal(result.timeline.length, 55);
  assert.equal(result.timeline[0].fightId, 1);
  assert.equal(result.timeline[54].fightId, 55);
});

test("timeline retains survival, missing data, repeated deaths, and context independently of record filters", () => {
  const result = summarizeCharacterDeaths([
    fight({ deaths: [death("Player", 20000), death("Other", 30000), death("Pet", 40000), death("Player", 80000)], phaseTransitions: [{ id: 2, name: "Second", startTime: 31000 }] }),
    fight({ fightId: 2 }),
    fight({ fightId: 3, deathEventsFetchStatus: "failed", deaths: [death("Player", 10000), death("Other", 20000)] }),
    fight({ fightId: 4, combatants: [], deaths: [], combatantInfoRosterComplete: false }),
  ], appearance, 1, { phaseFilter: "phase:no matches" });
  assert.equal(result.events.length, 0);
  assert.equal(result.timeline.length, 3);
  assert.deepEqual(result.timeline[0].deaths.map((entry) => entry.deathTime), [20000, 80000]);
  assert.deepEqual(result.timeline[0].otherDeathTimes, [30000]);
  assert.deepEqual(result.timeline[0].phases, [{ time: 30000, name: "Second" }]);
  assert.equal(result.timeline[1].complete, true);
  assert.deepEqual(result.timeline[1].deaths, []);
  assert.equal(result.timeline[2].complete, false);
  assert.deepEqual(result.timeline[2].deaths, []);
  assert.deepEqual(result.timeline[2].otherDeathTimes, []);
});

test("filters and sorts all events before pagination while preserving the summary", () => {
  const fights = Array.from({ length: 80 }, (_, index) => fight({
    fightId: index + 1,
    deaths: [...(index < 60 ? [] : [death("Other", 1), death("Third", 2), death("Fourth", 3)]), death("Player", (index + 1) * 1000)],
  }));
  const result = summarizeCharacterDeaths(fights, appearance, 2, { orderFilter: "firstThree", sortBy: "deathTime", sortDirection: "asc" });
  assert.equal(result.summary.deaths, 80);
  assert.equal(result.timing.reduce((sum, count) => sum + count, 0), 80);
  assert.deepEqual(result.pagination, { currentPage: 2, totalPages: 2, totalItems: 60 });
  assert.deepEqual(result.events.map((event) => event.fightId), Array.from({ length: 10 }, (_, index) => index + 51));
  const later = summarizeCharacterDeaths(fights, appearance, 1, { orderFilter: "later" });
  assert.equal(later.pagination.totalItems, 20);
  assert.ok(later.events.every((event) => event.order === 4));
});

test("timing filters use non-overlapping quarters and include the end of a pull", () => {
  const fights = [24999, 25000, 50000, 75000, 100000].map((time, index) => fight({ fightId: index + 1, deaths: [death("Player", time)] }));
  for (const [timingFilter, expected] of [["0", [24999]], ["1", [25000]], ["2", [50000]], ["3", [75000, 100000]]] as const) {
    const result = summarizeCharacterDeaths(fights, appearance, 1, { timingFilter, sortBy: "deathTime", sortDirection: "asc" });
    assert.deepEqual(result.events.map((event) => event.deathTime), expected);
  }
});

test("combines phase, timing and order filters and keeps phase options available for empty results", () => {
  const fights = [
    fight({ deaths: [death("Player", 25000)], phaseTransitions: [{ id: 1, name: "Phase 2", startTime: 1000 }] }),
    fight({ fightId: 2, deaths: [death("Player", 75000)], phaseTransitions: [{ id: 2, name: "Phase 10", startTime: 1000 }] }),
    fight({ fightId: 3, deaths: [death("Player", 25000)], combatantInfoRosterComplete: false }),
  ];
  const result = summarizeCharacterDeaths(fights, appearance, 1, { phaseFilter: "phase:Phase 2", timingFilter: "1", orderFilter: "first" });
  assert.deepEqual(result.events.map((event) => event.fightId), [1]);
  assert.deepEqual(result.eventOptions, { phases: ["Phase 2", "Phase 10"], hasUnknownPhase: true });
  const empty = summarizeCharacterDeaths(fights, appearance, 9, { phaseFilter: "phase:Phase 2", timingFilter: "3" });
  assert.equal(empty.events.length, 0);
  assert.equal(empty.summary.deaths, 3);
  assert.deepEqual(empty.pagination, { currentPage: 1, totalPages: 1, totalItems: 0 });
  assert.deepEqual(empty.eventOptions, result.eventOptions);
  const unknown = summarizeCharacterDeaths(fights, appearance, 1, { phaseFilter: "unknown", orderFilter: "unknown" });
  assert.deepEqual(unknown.events.map((event) => event.fightId), [3]);
});

test("sorts each column in both directions, with unknowns last and deterministic ties", () => {
  const fights = [
    fight({ reportCode: "report", fightId: 1, deaths: [death("Other", 1), death("Player", 10000)], phaseTransitions: [{ id: 2, name: "Phase 2", startTime: 1000 }] }),
    fight({ fightId: 2, timestamp: new Date("2026-09-02"), isKill: true, fightEndTime: 201000, deaths: [death("Player", 40000)], phaseTransitions: [{ id: 10, name: "Phase 10", startTime: 1000 }] }),
    fight({ fightId: 3, combatantInfoRosterComplete: false, deaths: [death("Player", 50000)] }),
  ];
  for (const sortBy of ["order", "phase"] as const) {
    for (const sortDirection of ["asc", "desc"] as const) {
      const result = summarizeCharacterDeaths(fights, appearance, 1, { sortBy, sortDirection });
      assert.equal(result.events[2].fightId, 3);
      const ascending = sortBy === "order" ? [2, 1] : [1, 2];
      assert.deepEqual(result.events.slice(0, 2).map((event) => event.fightId), sortDirection === "asc" ? ascending : ascending.reverse());
    }
  }
  for (const sortBy of ["date", "isKill", "deathTime", "deathPercent", "duration"] as const) {
    for (const sortDirection of ["asc", "desc"] as const) {
      const result = summarizeCharacterDeaths(fights, appearance, 1, { sortBy, sortDirection });
      const values = result.events.map((event) => sortBy === "date" ? Date.parse(event.date) : Number(event[sortBy]));
      assert.deepEqual(values, [...values].sort((a, b) => sortDirection === "asc" ? a - b : b - a));
    }
  }
  assert.deepEqual(summarizeCharacterDeaths(fights, appearance).events, summarizeCharacterDeaths([...fights].reverse(), appearance).events);
});

test("validates table query values without coercing duplicate or structured filters", () => {
  assert.ok(parseDeathEventOptions({ orderFilter: "first", phaseFilter: "phase:Final phase", sortBy: "order", sortDirection: "asc", timingFilter: "3" }));
  for (const query of [{ sortBy: "invalid" }, { sortDirection: "up" }, { orderFilter: ["first"] }, { phaseFilter: {} }, { timingFilter: "4" }, { phaseFilter: "phase:" }]) {
    assert.equal(parseDeathEventOptions(query), null);
  }
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

test("death endpoint accepts uppercase regions in profile links and still rejects invalid regions", async (context) => {
  const lookup = context.mock.method(characterService, "getDeathAnalysisAppearances", async () => []);
  const app = express();
  app.use("/api/characters", charactersRouter);
  const server = app.listen(0, "127.0.0.1");
  context.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  await once(server, "listening");
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/characters/stormreaver/Ironiwr/deaths?class=11&zoneId=44&encounterId=3134&difficulty=5`;
  for (const region of ["EU", "eu", "Eu"]) {
    const response = await fetch(`${url}&region=${region}`);
    assert.equal(response.status, 200);
    const body = await response.json() as ReturnType<typeof summarizeCharacterDeaths>;
    assert.equal(body.summary.pulls, 0);
    assert.deepEqual(lookup.mock.calls[lookup.mock.callCount() - 1].arguments, ["stormreaver", "Ironiwr", 11, "eu"]);
  }
  for (const regionQuery of ["region=invalid", "region=EU&region=US", "region="]) {
    const response = await fetch(`${url}&${regionQuery}`);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "Invalid death analysis filters" });
  }
  assert.equal(lookup.mock.callCount(), 3);
  for (const tableQuery of ["sortBy=invalid", "sortDirection=up", "orderFilter=first&orderFilter=later", "timingFilter=4", "phaseFilter=phase:"]) {
    const response = await fetch(`${url}&region=EU&${tableQuery}`);
    assert.equal(response.status, 400);
    await response.json();
  }
  assert.equal(lookup.mock.callCount(), 3);
});

test("lowercase region filters retain canonical identity lookup for uppercase stored regions", async (context) => {
  const candidates = [{ wclCanonicalCharacterId: 123, name: "Ironiwr", realm: "stormreaver", region: "EU", classID: 11 }];
  // The first lookup resolves the route; no persisted Character is needed for continuity in this fixture.
  let characterQueries = 0;
  context.mock.method(Character, "find", () => ({ select: () => ({ lean: async () => ++characterQueries === 1 ? candidates : [] }) }));
  let appearanceFilter: unknown;
  context.mock.method(CharacterReportAppearance, "find", (query: unknown) => {
    appearanceFilter = query;
    return { collation: () => ({ select: () => ({ lean: async () => [] }) }) };
  });
  await characterService.getDeathAnalysisAppearances("stormreaver", "Ironiwr", 11, "eu");
  assert.deepEqual(appearanceFilter, {
    wclCanonicalCharacterId: { $in: [123] }, classID: 11, characterRegion: "eu", hidden: { $ne: true },
  });
});
