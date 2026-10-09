import assert from "node:assert/strict";
import test from "node:test";
import { groupMechanicPulls, isSameMechanicPull, PullIdentity } from "../src/utils/avoidable-damage";

const roster = Array.from({ length: 20 }, (_, i) => ({ name: `Player${i}`, server: "Test Realm" }));
const pull = (extra = {}) => ({ reportCode: "A", fightId: 1, encounterID: 3429,
  reportStartTime: 1_000_000, fightStartTime: 10_000, duration: 49_654, isKill: false,
  bossPercentage: 68.76, combatantInfoRosterComplete: true, combatants: roster, ...extra });

test("Slack Axegrinder copies match despite uploader clock skew", () => {
  assert.equal(isSameMechanicPull(pull(), pull({ reportCode: "B", fightStartTime: 15_732, duration: 49_656 })), true);
  assert.equal(isSameMechanicPull(pull({ duration: 18_001 }), pull({ reportCode: "B", fightStartTime: 15_486, duration: 18_010 })), true);
});

test("Slack Ulatek copies tolerate a small proportional difference in fight duration", () => {
  const a = pull({ encounterID: 3492, duration: 411_027 });
  assert.equal(isSameMechanicPull(a, { ...a, reportCode: "B", fightStartTime: 11_488, duration: 414_547 }), true);
});

test("wider clock matching requires complete identical rosters and matching boss health", () => {
  const b = pull({ reportCode: "B", fightStartTime: 15_000 });
  for (const change of [
    { combatants: undefined }, { combatants: roster.slice(1) },
    { combatantInfoRosterComplete: false }, { combatantInfoRosterComplete: undefined },
    { combatants: [...roster.slice(1), { name: "Replacement", server: "Test Realm" }] },
    { combatants: [...roster.slice(1), { ...roster[0], server: "Other Realm" }] },
    { combatants: [...roster.slice(1), roster[1]] },
    { combatants: roster.map(p => ({ ...p, server: "" })) },
    { bossPercentage: undefined }, { bossPercentage: 69 }, { bossPercentage: 0 },
  ]) assert.equal(isSameMechanicPull(pull(), { ...b, ...change }), false, JSON.stringify(change));
});

test("roster comparison ignores order, name case and realm display formatting", () => {
  const b = pull({ reportCode: "B", fightStartTime: 15_000,
    combatants: [...roster].reverse().map(p => ({ name: p.name.toUpperCase(), server: "test-realm" })) });
  assert.equal(isSameMechanicPull(pull(), b), true);
});

test("different pulls are not merged merely because their timestamps are close", () => {
  for (const change of [
    { reportCode: "A", fightId: 2 }, { encounterID: 3492 }, { isKill: true },
    { fightStartTime: 20_001 }, { duration: 50_654 },
  ]) assert.equal(isSameMechanicPull(pull(), pull({ reportCode: "B", fightStartTime: 15_000, ...change })), false);
  // The same raid can wipe and reset quickly: short, non-overlapping pulls stay separate.
  assert.equal(isSameMechanicPull(pull({ duration: 4_000 }), pull({ reportCode: "B", fightStartTime: 15_000, duration: 4_000 })), false);
  assert.equal(isSameMechanicPull(pull({ duration: 1_000 }), pull({ reportCode: "B", fightStartTime: 10_800, duration: 1_000 })), false);
  assert.equal(isSameMechanicPull(pull({ duration: 900_000 }), pull({ reportCode: "B", duration: 905_001 })), false);
});

test("invalid timing cannot be treated as duplicate evidence", () => {
  for (const change of [{ duration: 0 }, { duration: -1 }, { duration: NaN }, { duration: Infinity },
    { reportStartTime: NaN }, { fightStartTime: Infinity }]) {
    const a = pull(change);
    assert.equal(isSameMechanicPull(a, { ...a, reportCode: "B" }), false);
  }
});

test("tight legacy matching remains available without rosters, but contradicting evidence rejects it", () => {
  const a: PullIdentity = { reportCode: "A", fightId: 1, encounterID: 3429, reportStartTime: 1_000_000,
    fightStartTime: 10_000, duration: 90_000, isKill: false };
  assert.equal(isSameMechanicPull(a, { ...a, reportCode: "B", fightStartTime: 10_500 }), true);
  assert.equal(isSameMechanicPull(pull(), pull({ reportCode: "B", bossPercentage: 70 })), false);
  assert.equal(isSameMechanicPull(pull(), pull({ reportCode: "B", combatants: roster.map(p => ({ ...p, server: "Other Realm" })) })), false);
});

test("grouping never hides two distinct fights from the same report", () => {
  const a = pull(), b = pull({ reportCode: "B", fightStartTime: 10_500 }), c = pull({ fightId: 2, fightStartTime: 11_000 });
  assert.deepEqual(groupMechanicPulls([c, b, a]), [[a, b], [c]]);
});

test("every copy must agree with every other copy, not just the first member", () => {
  const a = pull({ duration: 500_000 });
  const b = pull({ reportCode: "B", fightStartTime: 11_000, duration: 504_000 });
  const c = pull({ reportCode: "C", fightStartTime: 12_000, duration: 496_000 });
  assert.equal(isSameMechanicPull(a, b), true);
  assert.equal(isSameMechanicPull(a, c), true);
  assert.equal(isSameMechanicPull(b, c), false);
  assert.deepEqual(groupMechanicPulls([a, b, c]), [[a, b], [c]]);
});

test("matching triple uploads merge without changing the input order", () => {
  const a = pull(), b = pull({ reportCode: "B", fightStartTime: 15_000 }), c = pull({ reportCode: "C", fightStartTime: 16_000 });
  const input = [c, a, b];
  assert.deepEqual(groupMechanicPulls(input), [[a, b, c]]);
  assert.deepEqual(input, [c, a, b]);
});

test("seeding reclassifies fetched duplicates and preserves the retained copy", async (t) => {
  const { default: mongoose } = await import("mongoose");
  const { default: service } = await import("../src/services/avoidable-damage.service");
  const { default: Fight } = await import("../src/models/Fight");
  const { default: Guild } = await import("../src/models/Guild");
  const { default: Raid } = await import("../src/models/Raid");
  const { default: Report } = await import("../src/models/Report");
  const { default: ReportOverride } = await import("../src/models/ReportOverride");
  const { default: AvoidableDamageFight } = await import("../src/models/AvoidableDamageFight");
  const guildId = new mongoose.Types.ObjectId();
  const first = { ...pull(), _id: new mongoose.Types.ObjectId(), guildId, zoneId: 53 };
  const second = { ...first, _id: new mongoose.Types.ObjectId(), reportCode: "B", fightStartTime: 15_732 };
  const separate = { ...first, _id: new mongoose.Types.ObjectId(), fightId: 2, fightStartTime: 200_000 };
  const query = (data: unknown) => ({ select() { return this; }, sort() { return this; }, lean: async () => data });
  t.mock.method(Guild, "findById", () => query({ _id: guildId, region: "EU" }));
  t.mock.method(Fight, "find", () => query([first, second, separate]));
  t.mock.method(Raid, "find", () => query([{ id: 53 }]));
  t.mock.method(Report, "find", () => query([{ code: "A" }, { code: "B" }]));
  t.mock.method(ReportOverride, "find", () => query([]));
  const mechanicKey = "coiled-altar-axegrinder";
  // Keep B's existing collected data even though A's timestamp sorts earlier.
  t.mock.method(AvoidableDamageFight, "find", () => query([
    { sourceFightId: first._id, mechanicKey, status: "pending" },
    { sourceFightId: second._id, mechanicKey, status: "fetched" },
    { sourceFightId: separate._id, mechanicKey, status: "duplicate" },
  ]));
  const writes: any[] = [];
  t.mock.method(AvoidableDamageFight, "bulkWrite", async (operations: any[]) => { writes.push(...operations); });
  const seeder = service as unknown as { seedGuild(queue: unknown): Promise<void> };
  await seeder.seedGuild({ guildId, targetMechanicKeys: [mechanicKey] });
  const updateFor = (id: typeof first._id) => writes.find(x => x.updateOne.filter.sourceFightId.equals(id)).updateOne.update;
  const duplicate = updateFor(first._id);
  assert.equal(duplicate.$set.status, "duplicate");
  assert.deepEqual(duplicate.$set.players, []);
  assert.equal(String(duplicate.$set.duplicateOf), String(second._id));
  assert.equal(updateFor(second._id).$set.status, undefined, "the fetched canonical copy must not be reset");
  assert.equal(updateFor(second._id).$set.players, undefined, "retain collected player totals");
  assert.equal(updateFor(separate._id).$set.status, "pending", "a distinct pull previously marked duplicate must be collected");
  assert.equal(updateFor(separate._id).$unset.duplicateOf, 1);
});
