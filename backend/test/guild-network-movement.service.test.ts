import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGuildNetworkMovementPayload,
  MovementAccountGroupRow,
  MovementAppearanceRow,
  MovementReportRow,
} from "../src/services/guild-network-movement.service";

const RAID = { id: 46, name: "Test Raid", expansion: "Midnight" };
const GENERATED_AT = new Date("2026-07-19T12:00:00.000Z");

function report(code: string, startTime: string, guildId: string): MovementReportRow {
  const start = new Date(startTime).getTime();
  return { code, startTime: start, endTime: start + 3_600_000, guildId };
}

function appearance(
  reportCode: string,
  startTime: string,
  guildId: string,
  overrides: Partial<MovementAppearanceRow> = {},
): MovementAppearanceRow {
  return {
    characterId: "507f1f77bcf86cd799439011",
    wclCanonicalCharacterId: 101,
    sourceIdentityKey: `source:${reportCode}`,
    appearanceSource: "rankedCharacters",
    reportCode,
    reportStartTime: new Date(startTime),
    reportZoneId: RAID.id,
    reportGuildId: guildId,
    reportGuildName: guildId === "guild-a" ? "Guild A" : "Guild B",
    reportGuildRealm: "Realm",
    characterName: "Main",
    characterRealm: "Realm",
    characterRegion: "EU",
    classID: 4,
    hidden: false,
    ...overrides,
  };
}

function guildSequence(
  payload: ReturnType<typeof buildGuildNetworkMovementPayload>,
  characterIndex = 0,
): string[] {
  return payload.reports
    .filter((entry) => entry[4].includes(characterIndex))
    .map((entry) => payload.guilds[entry[3]][1]);
}

test("preserves chronological A to B to A report observations", () => {
  const reports = [
    report("A1", "2026-06-03T18:00:00.000Z", "guild-a"),
    report("A2", "2026-06-05T18:00:00.000Z", "guild-a"),
    report("B1", "2026-06-11T18:00:00.000Z", "guild-b"),
    report("A3", "2026-06-19T18:00:00.000Z", "guild-a"),
  ];
  const appearances = reports.map((entry) => appearance(entry.code, new Date(entry.startTime).toISOString(), String(entry.guildId)));

  const payload = buildGuildNetworkMovementPayload(RAID, reports, appearances, [], GENERATED_AT);

  assert.deepEqual(guildSequence(payload), ["Guild A", "Guild A", "Guild B", "Guild A"]);
  assert.equal(payload.rowCount, 4);
  assert.equal(payload.reports.length, 4);
  assert.equal(payload.raid.start, "2026-06-03T18:00:00.000Z");
  assert.equal(payload.raid.end, "2026-06-19T19:00:00.000Z");
});

test("orders same-time reports deterministically without discarding parallel guild observations", () => {
  const reports = [
    report("Z-report", "2026-06-11T18:00:00.000Z", "guild-b"),
    report("A-report", "2026-06-11T18:00:00.000Z", "guild-a"),
  ];
  const appearances = reports.map((entry) => appearance(entry.code, new Date(entry.startTime).toISOString(), String(entry.guildId)));

  const payload = buildGuildNetworkMovementPayload(RAID, reports, appearances, [], GENERATED_AT);

  assert.deepEqual(payload.reports.map((entry) => entry[0]), ["A-report", "Z-report"]);
  assert.deepEqual(guildSequence(payload), ["Guild A", "Guild B"]);
  assert.equal(payload.reports[0][1], payload.reports[1][1]);
});

test("reconciles canonical fallback rows to the linked character and keeps classes distinct", () => {
  const reports = [
    report("linked", "2026-06-03T18:00:00.000Z", "guild-a"),
    report("fallback", "2026-06-05T18:00:00.000Z", "guild-a"),
    report("other-class", "2026-06-07T18:00:00.000Z", "guild-a"),
  ];
  const appearances = [
    appearance("linked", "2026-06-03T18:00:00.000Z", "guild-a"),
    appearance("fallback", "2026-06-05T18:00:00.000Z", "guild-a", { characterId: null }),
    appearance("other-class", "2026-06-07T18:00:00.000Z", "guild-a", {
      characterId: null,
      wclCanonicalCharacterId: 101,
      classID: 5,
    }),
  ];

  const payload = buildGuildNetworkMovementPayload(RAID, reports, appearances, [], GENERATED_AT);

  assert.equal(payload.characters.length, 2);
  const mageIndex = payload.characters.findIndex((entry) => entry[3] === 4);
  assert.deepEqual(payload.reports.filter((entry) => entry[4].includes(mageIndex)).map((entry) => entry[0]), ["linked", "fallback"]);
});

test("keeps canonical-only rows separate when linked character IDs conflict", () => {
  const reports = [
    report("larger-link", "2026-06-03T18:00:00.000Z", "guild-a"),
    report("smaller-link", "2026-06-05T18:00:00.000Z", "guild-a"),
    report("fallback", "2026-06-07T18:00:00.000Z", "guild-a"),
  ];
  const appearances = [
    appearance("larger-link", "2026-06-03T18:00:00.000Z", "guild-a", { characterId: "507f1f77bcf86cd799439019" }),
    appearance("smaller-link", "2026-06-05T18:00:00.000Z", "guild-a", { characterId: "507f1f77bcf86cd799439011" }),
    appearance("fallback", "2026-06-07T18:00:00.000Z", "guild-a", { characterId: null }),
  ];

  const payload = buildGuildNetworkMovementPayload(RAID, reports, appearances, [], GENERATED_AT);
  const reversedPayload = buildGuildNetworkMovementPayload(RAID, reports, appearances.slice().reverse(), [], GENERATED_AT);
  const fallbackCharacter = payload.characters[payload.reports.find((entry) => entry[0] === "fallback")![4][0]];
  const reversedFallbackCharacter = reversedPayload.characters[reversedPayload.reports.find((entry) => entry[0] === "fallback")![4][0]];

  assert.equal(fallbackCharacter[0], "c:101:4");
  assert.equal(reversedFallbackCharacter[0], fallbackCharacter[0]);
});

test("deduplicates duplicate report evidence and maps inferred accounts to observed alts", () => {
  const reports = [
    report("main-report", "2026-06-03T18:00:00.000Z", "guild-a"),
    report("alt-report", "2026-06-11T18:00:00.000Z", "guild-b"),
  ];
  const altId = "507f1f77bcf86cd799439012";
  const appearances = [
    appearance("main-report", "2026-06-03T18:00:00.000Z", "guild-a"),
    appearance("main-report", "2026-06-03T18:00:00.000Z", "guild-a", {
      characterId: null,
      appearanceSource: "reportRankings",
      sourceIdentityKey: "duplicate-fallback",
    }),
    appearance("alt-report", "2026-06-11T18:00:00.000Z", "guild-b", {
      characterId: altId,
      wclCanonicalCharacterId: 202,
      characterName: "Alt",
    }),
  ];
  const accountGroups: MovementAccountGroupRow[] = [
    {
      displayName: "Main account",
      slug: "main-account",
      characterIds: ["507f1f77bcf86cd799439011", altId],
    },
  ];

  const payload = buildGuildNetworkMovementPayload(RAID, reports, appearances, accountGroups, GENERATED_AT);

  assert.equal(payload.rowCount, 2);
  assert.equal(payload.characters.length, 2);
  assert.deepEqual(payload.accounts, [["Main account", "main-account", [0, 1]]]);
});

test("ignores hidden, mismatched-raid, and non-eligible-report appearances", () => {
  const reports = [report("eligible", "2026-06-03T18:00:00.000Z", "guild-a")];
  const appearances = [
    appearance("eligible", "2026-06-03T18:00:00.000Z", "guild-a", { hidden: true }),
    appearance("eligible", "2026-06-03T18:00:00.000Z", "guild-a", { reportZoneId: 44 }),
    appearance("not-in-report-set", "2026-06-03T18:00:00.000Z", "guild-a"),
  ];

  const payload = buildGuildNetworkMovementPayload(RAID, reports, appearances, [], GENERATED_AT);

  assert.equal(payload.rowCount, 0);
  assert.deepEqual(payload.reports, []);
  assert.deepEqual(payload.characters, []);
});
