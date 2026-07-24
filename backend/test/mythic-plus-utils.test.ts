import assert from "node:assert/strict";
import test from "node:test";
import { getMissingMythicPlusSeasons, resolveMythicPlusSeasonRows } from "../src/utils/mythic-plus";

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
