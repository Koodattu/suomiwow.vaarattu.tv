import assert from "node:assert/strict";
import test from "node:test";
import warcraftLogsService from "../src/services/warcraftlogs.service";

test("CombatantInfo parsing preserves each fight's exact player specialization", () => {
  const combatants = warcraftLogsService.parseCombatantInfoByFight(
    {
      combatantInfoEvents: {
        data: [
          { type: "combatantinfo", fight: 10, sourceID: 1, specID: 1473 },
          { type: "combatantinfo", fight: 11, sourceID: 1, specID: 1468 },
          { type: "combatantinfo", fight: 11, sourceID: 2, specID: 263 },
        ],
      },
    },
    [
      { id: 1, name: "Violetcar", server: "Kazzak" },
      { id: 2, name: "Other", server: "Kazzak" },
    ],
  );

  assert.deepEqual(combatants.get(10), [
    { name: "Violetcar", server: "Kazzak", specID: 1473, specName: "augmentation" },
  ]);
  assert.deepEqual(combatants.get(11), [
    { name: "Violetcar", server: "Kazzak", specID: 1468, specName: "preservation" },
    { name: "Other", server: "Kazzak", specID: 263, specName: "enhancement" },
  ]);
});

test("CombatantInfo parsing fails closed for an unknown specialization", () => {
  assert.throws(
    () => warcraftLogsService.parseCombatantInfoByFight(
      { combatantInfoEvents: { data: [{ fight: 1, sourceID: 1, specID: 999_999 }] } },
      [{ id: 1, name: "Futurechar", server: "Kazzak" }],
    ),
    /Unsupported Blizzard specialization ID/,
  );
});

test("fight detail fetching batches long reports and merges deaths and CombatantInfo", async () => {
  const service = warcraftLogsService as any;
  const originalQuery = service.query;
  const requestedFightIds: number[][] = [];

  service.query = async (_query: string, variables: { fightIds: number[] }) => {
    requestedFightIds.push(variables.fightIds);
    return {
      rateLimitData: { pointsSpentThisHour: requestedFightIds.length },
      reportData: {
        report: {
          code: "LONG",
          masterData: { actors: [{ id: 1, name: "Violetcar", server: "Kazzak" }] },
          events: {
            data: variables.fightIds.map((fight) => ({ type: "death", fight, targetID: 1 })),
            nextPageTimestamp: null,
          },
          combatantInfoEvents: {
            data: variables.fightIds.map((fight) => ({ type: "combatantinfo", fight, sourceID: 1, specID: 1473 })),
            nextPageTimestamp: null,
          },
        },
      },
    };
  };

  try {
    const response = await service.getDeathEventsForReport(
      "LONG",
      Array.from({ length: 205 }, (_, index) => index + 1),
      { includeCombatantInfo: true },
    );

    assert.deepEqual(requestedFightIds.map((ids) => ids.length), [100, 100, 5]);
    assert.equal(response.reportData.report.events.data.length, 205);
    assert.equal(response.reportData.report.combatantInfoEvents.data.length, 205);
    assert.equal(response.reportData.report.masterData.actors.length, 1);
    assert.equal(response.rateLimitData.pointsSpentThisHour, 3);
  } finally {
    service.query = originalQuery;
  }
});

test("fight detail fetching splits a truncated WCL response until every batch is complete", async () => {
  const service = warcraftLogsService as any;
  const originalQuery = service.query;
  const requestedBatchSizes: number[] = [];

  service.query = async (_query: string, variables: { fightIds: number[] }) => {
    requestedBatchSizes.push(variables.fightIds.length);
    const truncated = variables.fightIds.length > 2;
    return {
      reportData: {
        report: {
          code: "TRUNCATED",
          masterData: { actors: [] },
          events: {
            data: truncated ? [] : variables.fightIds.map((fight) => ({ type: "death", fight })),
            nextPageTimestamp: truncated ? 12345 : null,
          },
        },
      },
    };
  };

  try {
    const response = await service.getDeathEventsForReport("TRUNCATED", [1, 2, 3, 4, 5]);

    assert.deepEqual(requestedBatchSizes, [5, 3, 2, 1, 2]);
    assert.deepEqual(response.reportData.report.events.data.map((event: any) => event.fight), [1, 2, 3, 4, 5]);
    assert.equal(response.reportData.report.events.nextPageTimestamp, null);
  } finally {
    service.query = originalQuery;
  }
});

test("CombatantInfo can be fetched without requesting death events", async () => {
  const service = warcraftLogsService as any;
  const originalQuery = service.query;
  let capturedQuery = "";

  service.query = async (query: string) => {
    capturedQuery = query;
    return {
      reportData: {
        report: {
          code: "SPECS_ONLY",
          masterData: { actors: [] },
          combatantInfoEvents: { data: [], nextPageTimestamp: null },
        },
      },
    };
  };

  try {
    await service.getDeathEventsForReport("SPECS_ONLY", [1], {
      includeCombatantInfo: true,
      includeDeathEvents: false,
    });

    assert.doesNotMatch(capturedQuery, /dataType:\s*Deaths/);
    assert.match(capturedQuery, /dataType:\s*CombatantInfo/);
  } finally {
    service.query = originalQuery;
  }
});
