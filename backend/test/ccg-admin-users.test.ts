import assert from "node:assert/strict";
import test from "node:test";
import { buildCcgAdminUsersPipeline, parseCcgAdminUsersOptions } from "../src/services/ccg-admin-users.service";

test("Admin CCG user options use lightweight defaults and cap page size", () => {
  assert.deepEqual(parseCcgAdminUsersOptions({}), {
    page: 1,
    limit: 25,
    sort: "packOpenings",
    direction: "desc",
  });
  assert.deepEqual(parseCcgAdminUsersOptions({
    page: "3",
    limit: "500",
    sort: "channelPointsUsed",
    direction: "asc",
  }), {
    page: 3,
    limit: 100,
    sort: "channelPointsUsed",
    direction: "asc",
  });
});

test("pack sorting paginates before identity and redemption lookups", () => {
  const pipeline = buildCcgAdminUsersPipeline({
    page: 2,
    limit: 25,
    sort: "packOpenings",
    direction: "desc",
  });

  assert.deepEqual(pipeline.slice(0, 3), [
    { $sort: { packOpenings: -1, ownerKey: 1 } },
    { $skip: 25 },
    { $limit: 25 },
  ]);
  assert.equal(pipeline.findIndex((stage) => "$lookup" in stage), 3);
});

test("channel-point sorting calculates redemption totals before pagination", () => {
  const pipeline = buildCcgAdminUsersPipeline({
    page: 1,
    limit: 25,
    sort: "channelPointsUsed",
    direction: "desc",
  });
  const sortIndex = pipeline.findIndex((stage) => "$sort" in stage);
  const redemptionLookupIndex = pipeline.findIndex((stage) => "$lookup" in stage && stage.$lookup.as === "redemptionStats");
  const leaderboardLookupIndex = pipeline.findIndex((stage) => "$lookup" in stage && stage.$lookup.as === "leaderboardEntry");

  assert.ok(redemptionLookupIndex >= 0);
  assert.ok(sortIndex > redemptionLookupIndex);
  assert.deepEqual(pipeline.slice(sortIndex, sortIndex + 3), [
    { $sort: { channelPointsUsed: -1, ownerKey: 1 } },
    { $skip: 0 },
    { $limit: 25 },
  ]);
  assert.ok(leaderboardLookupIndex > sortIndex + 2);
});

test("leaderboard scores keep guests at zero and missing account calculations empty", () => {
  const pipeline = buildCcgAdminUsersPipeline({
    page: 1,
    limit: 25,
    sort: "packOpenings",
    direction: "desc",
  });
  const scoreStage = pipeline.find((stage) => "$set" in stage && "leaderboardScore" in stage.$set);

  assert.deepEqual(scoreStage, {
    $set: {
      leaderboardScore: {
        $cond: [
          { $eq: ["$ownerType", "guest"] },
          0,
          { $ifNull: [{ $arrayElemAt: ["$leaderboardEntry.score", 0] }, null] },
        ],
      },
    },
  });
});
