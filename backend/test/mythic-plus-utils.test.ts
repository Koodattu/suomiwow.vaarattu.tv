import assert from "node:assert/strict";
import test from "node:test";
import {
  getMissingMythicPlusSeasons,
  hasMythicPlusSeasonStarted,
  mythicPlusCharacterIdentitiesMatch,
  resolveCurrentMythicPlusSeasonSlug,
  resolveMythicPlusSeasonRows,
} from "../src/utils/mythic-plus";
import { RAIDER_IO_MAIN_MYTHIC_PLUS_SEASON_SLUGS } from "../src/config/mythic-plus";

test("Mythic+ identity comparison preserves significant names and normalizes realm display values", () => {
  const current = { name: "Maisié", realm: "stormreaver", region: "eu", classID: 6 };

  assert.equal(
    mythicPlusCharacterIdentitiesMatch(current, { name: "MAISIÉ", realm: "Stormreaver", region: "EU", classID: 6 }),
    true,
  );
  assert.equal(
    mythicPlusCharacterIdentitiesMatch(current, { name: "Maisie", realm: "Tarren Mill", region: "eu", classID: 6 }),
    false,
  );
  assert.equal(
    mythicPlusCharacterIdentitiesMatch(current, { name: "Maisié", realm: "stormreaver", region: "eu", classID: 2 }),
    false,
  );
});

test("historical score repair targets only seasons without a stored result", () => {
  assert.deepEqual(
    getMissingMythicPlusSeasons(
      ["season-tww-3", "season-tww-2", "season-tww-1"],
      ["season-tww-3", "season-tww-1"],
    ),
    ["season-tww-2"],
  );
});

test("profile season rows are matched by explicit season and retain omitted seasons", () => {
  const tww2 = { season: "season-tww-2", scores: { all: 2800 } };
  const resolved = resolveMythicPlusSeasonRows(
    ["season-tww-3", "season-tww-2", "season-tww-1"],
    [tww2],
  );

  assert.deepEqual(resolved, [
    { season: "season-tww-3", row: null },
    { season: "season-tww-2", row: tww2 },
    { season: "season-tww-1", row: null },
  ]);
});

test("unlabelled profile rows use positional mapping only for a complete response", () => {
  const completeRows = [{ scores: { all: 3000 } }, { scores: { all: 2500 } }];
  assert.deepEqual(resolveMythicPlusSeasonRows(["season-a", "season-b"], completeRows), [
    { season: "season-a", row: completeRows[0] },
    { season: "season-b", row: completeRows[1] },
  ]);

  assert.deepEqual(resolveMythicPlusSeasonRows(["season-a", "season-b"], [completeRows[0]]), [
    { season: "season-a", row: null },
    { season: "season-b", row: null },
  ]);
});

test("Midnight Season 2 stays staged until the EU start timestamp", () => {
  const seasons = [
    {
      slug: "season-mn-2",
      starts: { eu: "2026-08-19T04:00:00Z" },
      ends: { eu: "2030-01-01T00:00:00Z" },
    },
    {
      slug: "season-mn-1",
      starts: { eu: "2026-03-25T04:00:00Z" },
      ends: { eu: "2026-08-19T04:00:00Z" },
    },
  ];

  assert.equal(RAIDER_IO_MAIN_MYTHIC_PLUS_SEASON_SLUGS[0], "season-mn-2");
  assert.equal(hasMythicPlusSeasonStarted(seasons[0], "eu", new Date("2026-08-19T03:59:59Z")), false);
  assert.equal(resolveCurrentMythicPlusSeasonSlug(seasons, "eu", new Date("2026-08-19T03:59:59Z")), "season-mn-1");
  assert.equal(resolveCurrentMythicPlusSeasonSlug(seasons, "eu", new Date("2026-08-19T04:00:00Z")), "season-mn-2");
});
