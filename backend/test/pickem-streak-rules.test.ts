/// <reference path="../src/types/express-session.d.ts" />

import assert from "node:assert/strict";
import test from "node:test";
import Pickem, { calculateStreakBonus, IStreakConfig } from "../src/models/Pickem";
import User from "../src/models/User";
import pickemService from "../src/services/pickem.service";
import { getPickemLeaderboard } from "../src/routes/pickems";

const exact: IStreakConfig = { rule: "exact-consecutive-v1", enabled: true, minStreak: 2, bonusPerGuild: 8 };
const legacy: IStreakConfig = { enabled: true, minStreak: 2, bonusPerGuild: 8 };
const predictions = (ranks: (number | null)[]) => ranks.map((actualRank, index) => ({
  guildName: `Guild ${index + 1}`, realm: "Realm", predictedRank: index + 1, actualRank,
}));

test("exact streaks award from the second correct pick without backfilling the first", () => {
  assert.deepEqual(calculateStreakBonus(predictions([1]), exact), { totalBonus: 0, streaks: [] });
  assert.deepEqual(calculateStreakBonus(predictions([1, 2, 3]), exact), {
    totalBonus: 16, streaks: [{ length: 3, guilds: ["Guild 1", "Guild 2", "Guild 3"] }],
  });
});

test("wrong and unranked picks reset the run; the first correct pick after each reset earns nothing", () => {
  assert.equal(calculateStreakBonus(predictions([1, 2, 9, 4, 5, null, 7, 8]), exact).totalBonus, 24);
  assert.equal(calculateStreakBonus(predictions([1, 9, 3]), exact).totalBonus, 0);
  assert.equal(calculateStreakBonus(predictions([2, 3, 4]), exact).totalBonus, 0);
});

test("missing prediction positions break exact streaks and unsorted input is handled", () => {
  const picks = predictions([1, 2, 3, 4]);
  assert.equal(calculateStreakBonus([picks[3], picks[0], picks[2]], exact).totalBonus, 8);
});

test("custom minimum and amount apply prospectively, and the first pick never earns a bonus", () => {
  assert.equal(calculateStreakBonus(predictions([1, 2, 3, 4]), { ...exact, minStreak: 3, bonusPerGuild: 5 }).totalBonus, 10);
  assert.equal(calculateStreakBonus(predictions([1, 2]), { ...exact, minStreak: 1 }).totalBonus, 8);
  assert.equal(calculateStreakBonus(predictions([1, 2]), { ...exact, enabled: false }).totalBonus, 0);
  assert.equal(calculateStreakBonus(predictions([1, 2]), { ...exact, bonusPerGuild: 0 }).totalBonus, 0);
});

test("legacy missing and explicit versions preserve relative order, skipped unranked picks and first-pick bonuses", () => {
  for (const config of [legacy, { ...legacy, rule: "relative-order-v1" as const }]) {
    assert.equal(calculateStreakBonus(predictions([1, 2, 15, 8, 10]), config).totalBonus, 40);
    assert.equal(calculateStreakBonus(predictions([1, null, 2]), config).totalBonus, 16);
    assert.equal(calculateStreakBonus(predictions([1, 2, 3, 4, 5, 6, 7, 8, 10, 12]), config).totalBonus, 80);
  }
});

test("stored historical documents default to the legacy rule even after finalization", () => {
  const closed = Pickem.hydrate({ pickemId: "closed", finalized: true, streakConfig: legacy });
  assert.equal(closed.streakConfig.rule, "relative-order-v1");
  assert.equal(calculateStreakBonus(predictions([1, 2]), closed.streakConfig).totalBonus, 16);
  const newer = Pickem.hydrate({ pickemId: "newer", finalized: true, streakConfig: exact });
  assert.equal(calculateStreakBonus(predictions([1, 2]), newer.streakConfig).totalBonus, 8);
});

test("startup pins only unversioned rules, keeping finalized competitions on the legacy rule", async (t) => {
  const update = t.mock.method(Pickem.collection, "updateMany", async () => ({ modifiedCount: 1 }));
  await pickemService.ensureStreakRules();
  assert.deepEqual(update.mock.calls.map(call => call.arguments), [
    [{ "streakConfig.rule": { $exists: false }, finalized: true }, { $set: { "streakConfig.rule": "relative-order-v1" } }],
    [{ "streakConfig.rule": { $exists: false }, finalized: { $ne: true } }, { $set: { "streakConfig.rule": "exact-consecutive-v1" } }],
  ]);
});

test("new pickems use the exact rule even when an older admin form submits legacy config", async (t) => {
  const create = t.mock.method(Pickem, "create", async (data: Record<string, unknown>) => new Pickem(data));
  const result = await pickemService.createPickem({
    pickemId: "new", name: "New", type: "rwf", votingStart: new Date(), votingEnd: new Date(),
    streakConfig: { ...legacy, rule: "relative-order-v1" },
  });
  assert.equal(create.mock.callCount(), 1);
  assert.equal(result.streakConfig.rule, "exact-consecutive-v1");
  assert.equal(result.streakConfig.bonusPerGuild, 8);
});

test("admin config updates cannot switch an existing competition's persisted rule", async (t) => {
  for (const config of [legacy, exact]) {
    const pickem = new Pickem({ pickemId: "existing", finalized: true, streakConfig: config });
    const before = pickem.streakConfig.rule;
    t.mock.method(Pickem, "findOne", async () => pickem);
    t.mock.method(pickem, "save", async () => pickem);
    const updated = await pickemService.updatePickem("existing", { streakConfig: { ...legacy, rule: before === "exact-consecutive-v1" ? "relative-order-v1" : "exact-consecutive-v1" } });
    assert.equal(updated?.streakConfig.rule, before);
  }
});

test("leaderboard uses each persisted rule and retains it when a competition closes", async (t) => {
  const actualRanks = [1, 2, 3, 4, 5, 6, 7, 8, 10, 12];
  const picks = predictions(actualRanks);
  t.mock.method(User, "find", () => ({ lean: async () => [{
    discord: { id: "example", username: "Example", avatar: null },
    pickems: [{ pickemId: "example", predictions: picks.map(p => ({ ...p, position: p.predictedRank })) }],
  }] }));
  const rankings = picks.map(p => ({ name: p.guildName, realm: p.realm, rank: p.actualRank! }));
  for (const [config, expectedTotal, expectedBonus] of [[legacy, 174, 80], [exact, 150, 56]] as const) {
    const pickem = new Pickem({ pickemId: "example", type: "regular", guildCount: 10, scoreOutOfRangeGuilds: true, streakConfig: config });
    const open = await getPickemLeaderboard("example", rankings, pickem);
    assert.equal(open[0].totalPoints, expectedTotal);
    assert.equal(open[0].streakBonus, expectedBonus);
    pickem.finalized = true;
    assert.deepEqual(await getPickemLeaderboard("example", rankings, pickem), open);
  }
});
