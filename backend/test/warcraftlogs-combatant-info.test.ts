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
    { name: "Violetcar", server: "Kazzak", specID: 1473, specName: "augmentation", role: null, source: "combatant_info" },
  ]);
  assert.deepEqual(combatants.get(11), [
    { name: "Violetcar", server: "Kazzak", specID: 1468, specName: "preservation", role: null, source: "combatant_info" },
    { name: "Other", server: "Kazzak", specID: 263, specName: "enhancement", role: null, source: "combatant_info" },
  ]);
});

test("unknown specializations preserve participation without poisoning the fight", () => {
  const rosters = warcraftLogsService.parseFightRostersByFight(
    { combatantInfoEvents: { data: [{ fight: 1, sourceID: 1, specID: 999_999 }] } },
    [{ id: 1, name: "Futurechar", server: "Kazzak" }],
  );

  assert.equal(rosters.get(1)?.status, "partial");
  assert.equal(rosters.get(1)?.rosterComplete, true);
  assert.equal(rosters.get(1)?.participants[0].specName, null);
});

test("playerDetails supplies roles and specs when CombatantInfo is absent", () => {
  const participants = warcraftLogsService.parsePlayerDetailsRoster({
    reportData: { report: { playerDetails: { data: { playerDetails: {
      healers: [{ name: "Healz", server: "Kazzak", specs: [{ spec: "Preservation", count: 1 }] }],
      dps: [{ name: "Violetcar", server: "Kazzak", specs: [{ spec: "Augmentation", count: 1 }] }],
      tanks: [],
    } } } } },
  });

  assert.deepEqual(participants.map(({ name, specName, role }) => ({ name, specName, role })), [
    { name: "Healz", specName: "preservation", role: "healer" },
    { name: "Violetcar", specName: "augmentation", role: "dps" },
  ]);
});

test("fight detail fetching attaches a per-fight playerDetails fallback roster", async () => {
  const service = warcraftLogsService as any;
  const originalQuery = service.query;
  const queries: string[] = [];

  service.query = async (query: string) => {
    queries.push(query);
    if (/playerDetails\s*\(/.test(query)) {
      return {
        reportData: { report: { playerDetails: { data: { playerDetails: {
          healers: [],
          dps: [{ name: "Violetcar", server: "Kazzak", specs: [{ spec: "Augmentation", count: 1 }] }],
          tanks: [],
        } } } } },
      };
    }
    return {
      reportData: { report: {
        code: "FALLBACK",
        masterData: { actors: [] },
        events: { data: [], nextPageTimestamp: null },
        combatantInfoEvents: { data: [], nextPageTimestamp: null },
      } },
    };
  };

  try {
    const response = await service.getDeathEventsForReport("FALLBACK", [7], { includeCombatantInfo: true });
    const roster = service.parseFightRostersByFight(response.reportData.report, []).get(7);

    assert.equal(queries.length, 2);
    assert.equal(roster?.source, "player_details");
    assert.equal(roster?.status, "fetched");
    assert.equal(roster?.participants[0].specName, "augmentation");
  } finally {
    service.query = originalQuery;
  }
});

test("fight detail fetching combines player deaths and CombatantInfo into one filtered event field", async () => {
  const service = warcraftLogsService as any;
  const originalQuery = service.query;
  let capturedQuery = "";

  service.query = async (query: string) => {
    capturedQuery = query;
    return {
      reportData: { report: {
        code: "COMBINED",
        masterData: { actors: [{ id: 1, name: "Violetcar", server: "Kazzak" }] },
        combinedFightEvents: {
          data: [
            { type: "death", fight: 1, targetID: 1 },
            { type: "combatantinfo", fight: 1, sourceID: 1, specID: 1473 },
          ],
          nextPageTimestamp: null,
        },
      } },
    };
  };

  try {
    const response = await service.getDeathEventsForReport("COMBINED", [1], { includeCombatantInfo: true });

    assert.match(capturedQuery, /dataType:\s*All/);
    assert.match(capturedQuery, /target\.type = \\"Player\\"/);
    assert.doesNotMatch(capturedQuery, /dataType:\s*Deaths/);
    assert.doesNotMatch(capturedQuery, /dataType:\s*CombatantInfo/);
    assert.equal(response.reportData.report.events.data.length, 1);
    assert.equal(response.reportData.report.combatantInfoEvents.data.length, 1);
  } finally {
    service.query = originalQuery;
  }
});

test("stable playerDetails chunks use one grouped table for every fight", async () => {
  const service = warcraftLogsService as any;
  const originalQuery = service.query;
  const playerDetailFightIds: number[][] = [];

  service.query = async (query: string, variables: { fightIds: number[] }) => {
    if (/playerDetails\s*\(/.test(query)) {
      playerDetailFightIds.push(variables.fightIds);
      return {
        reportData: { report: { playerDetails: { data: { playerDetails: {
          healers: [],
          dps: [{ name: "Violetcar", server: "Kazzak", specs: [{ spec: "Augmentation", count: variables.fightIds.length }] }],
          tanks: [],
        } } } } },
      };
    }
    return {
      reportData: { report: {
        code: "STABLE",
        masterData: { actors: [] },
        combinedFightEvents: { data: [], nextPageTimestamp: null },
      } },
    };
  };

  try {
    const response = await service.getDeathEventsForReport("STABLE", [1, 2, 3], { includeCombatantInfo: true });
    const rosters = service.parseFightRostersByFight(response.reportData.report, []);

    assert.deepEqual(playerDetailFightIds, [[1, 2, 3]]);
    assert.deepEqual([1, 2, 3].map((fightId) => rosters.get(fightId)?.participants[0]?.specName), [
      "augmentation",
      "augmentation",
      "augmentation",
    ]);
  } finally {
    service.query = originalQuery;
  }
});

test("variable playerDetails chunks derive the omitted fight without an extra table call", async () => {
  const service = warcraftLogsService as any;
  const originalQuery = service.query;
  const playerDetailFightIds: number[][] = [];
  const details = (healers: any[], dps: any[]) => ({
    reportData: { report: { playerDetails: { data: { playerDetails: { healers, dps, tanks: [] } } } } },
  });

  service.query = async (query: string, variables: { fightIds: number[] }) => {
    if (!/playerDetails\s*\(/.test(query)) {
      return {
        reportData: { report: {
          code: "VARIABLE",
          masterData: { actors: [] },
          combinedFightEvents: { data: [], nextPageTimestamp: null },
        } },
      };
    }

    playerDetailFightIds.push(variables.fightIds);
    if (variables.fightIds.length === 3) {
      return details(
        [{ name: "Healz", server: "Kazzak", specs: [{ spec: "Preservation", count: 1 }] }],
        [
          { name: "Violetcar", server: "Kazzak", specs: [{ spec: "Augmentation", count: 3 }] },
          { name: "Other", server: "Kazzak", specs: [{ spec: "Devastation", count: 2 }] },
        ],
      );
    }
    if (variables.fightIds[0] === 1) {
      return details([], [
        { name: "Violetcar", server: "Kazzak", specs: [{ spec: "Augmentation", count: 1 }] },
        { name: "Other", server: "Kazzak", specs: [{ spec: "Devastation", count: 1 }] },
      ]);
    }
    return details(
      [{ name: "Healz", server: "Kazzak", specs: [{ spec: "Preservation", count: 1 }] }],
      [{ name: "Violetcar", server: "Kazzak", specs: [{ spec: "Augmentation", count: 1 }] }],
    );
  };

  try {
    const response = await service.getDeathEventsForReport("VARIABLE", [1, 2, 3], { includeCombatantInfo: true });
    const rosters = service.parseFightRostersByFight(response.reportData.report, []);

    assert.deepEqual(playerDetailFightIds, [[1, 2, 3], [1], [2]]);
    assert.deepEqual(rosters.get(3)?.participants.map((participant: any) => participant.name).sort(), ["Other", "Violetcar"]);
  } finally {
    service.query = originalQuery;
  }
});

test("report rankings parser accepts rankings returned with report metadata", () => {
  const characters = warcraftLogsService.parseReportRankingsCharacters({
    data: [{
      fightID: 7,
      roles: {
        dps: {
          characters: [{
            name: "Violetcar",
            class: "Evoker",
            spec: "Augmentation",
            server: { name: "Kazzak", region: "EU" },
          }],
        },
      },
    }],
  });

  assert.deepEqual(characters, [{
    name: "Violetcar",
    className: "Evoker",
    specName: "Augmentation",
    specNames: ["Augmentation"],
    server: { name: "Kazzak", region: "EU" },
    fightIds: [7],
  }]);
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
          masterData: { actors: [{ id: 1, name: "Violetcar", server: "Kazzak" }] },
          combatantInfoEvents: { data: [{ type: "combatantinfo", fight: 1, sourceID: 1, specID: 1473 }], nextPageTimestamp: null },
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
