import assert from "node:assert/strict";
import test from "node:test";
import { qualifyRaidAffiliations, RaidAffiliationInput } from "../src/utils/character-raid-affiliation";

function row(days: number[], member = false, guild = "guild"): RaidAffiliationInput {
  return {
    reportGuildId: guild, reportGuildName: "Tuju", reportGuildRealm: "Kazzak",
    attendanceEvidence: days.map((day) => ({
      startedAt: new Date(Date.UTC(2026, 8, day, 18)), mythic: true,
      guilds: member ? [{ name: "tuju", realm: "kazzak" }] : [{ name: "Other Guild", realm: "kazzak" }],
    })),
  };
}

test("one-night guests and members never qualify, including duplicate and after-midnight uploads", () => {
  const guest = row([1, 1]);
  guest.attendanceEvidence.push({ ...guest.attendanceEvidence[0], startedAt: new Date("2026-09-02T01:00:00Z") });
  for (const result of qualifyRaidAffiliations([guest, row([1], true)])) {
    assert.equal(result.raidNightCount, 1);
    assert.equal(result.mythicNightCount, 1);
    assert.equal(result.affiliationQualifiedAt, null);
  }
});

test("two independent nights plus matching guild evidence qualify early-season members", () => {
  const [member, guest] = qualifyRaidAffiliations([row([1, 3], true), row([1, 3])]);
  assert.equal(member.affiliationQualifiedAt?.toISOString(), "2026-09-03T06:00:00.000Z");
  assert.equal(guest.affiliationQualifiedAt, null);
});

test("unconfirmed raiders need three nights spanning a week and half of recent opportunities", () => {
  const [regular, sparse, short] = qualifyRaidAffiliations([
    row([1, 3, 7, 8]), row([1, 8, 15]), row([1, 3, 5]),
    row(Array.from({ length: 15 }, (_, i) => i + 1), true),
  ]);
  assert.ok(regular.affiliationQualifiedAt);
  assert.equal(sparse.affiliationQualifiedAt, null);
  assert.equal(short.affiliationQualifiedAt, null);
});

test("late recruits ignore earlier nights and qualification survives later inactivity", () => {
  const [recruit, former] = qualifyRaidAffiliations([
    row([21, 24, 28]), row([1, 3, 8]), row([1, 3, 8, 10, 12, 14, 16, 18, 21, 24, 28], true),
  ]);
  assert.equal(recruit.affiliationQualifiedAt?.toISOString(), "2026-09-28T06:00:00.000Z");
  assert.equal(former.affiliationQualifiedAt?.toISOString(), "2026-09-08T06:00:00.000Z");
});

test("separate guild visits cannot combine into membership and another guild cannot dilute attendance", () => {
  const [first, second, regular] = qualifyRaidAffiliations([
    row([1], true, "a"), row([8], true, "b"), row([1, 3, 8], false, "c"),
    row(Array.from({ length: 8 }, (_, i) => i + 1), true, "d"),
  ]);
  assert.equal(first.affiliationQualifiedAt, null);
  assert.equal(second.affiliationQualifiedAt, null);
  assert.ok(regular.affiliationQualifiedAt);
});

test("Heroic nights provide affiliation evidence without becoming Mythic nights", () => {
  const heroic = row([1, 3], true);
  heroic.attendanceEvidence.forEach((report) => { report.mythic = false; });
  const [result] = qualifyRaidAffiliations([heroic]);
  assert.ok(result.affiliationQualifiedAt);
  assert.equal(result.mythicNightCount, 0);
});
