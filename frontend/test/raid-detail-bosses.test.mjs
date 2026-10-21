import assert from "node:assert/strict";
import test from "node:test";
import { raidDetailBosses } from "../src/lib/raid-detail-bosses.ts";

const mainIds = [3470, 3445, 3455, 3497, 3420, 3421, 3429, 3492];
const metadata = [...mainIds, 3379, 3513].map(id => ({ id, name: String(id), slug: String(id), isLair: !mainIds.includes(id) }));
const boss = (id, date, killOrder = 1) => ({
  bossId: id, bossName: String(id), kills: date ? 1 : 0, firstKillTime: date,
  killOrder, pullCount: 10, bestPercent: date ? 0 : 50, timeSpent: 300, lastUpdated: "2026-10-21",
});
const progress = (bosses, overrides = {}) => ({
  raidId: 53, raidName: "The Venomous Abyss", difficulty: "mythic", bosses,
  bossesDefeated: 7, totalBosses: 8, totalTimeSpent: 600, lastUpdated: "2026-10-21", ...overrides,
});
const lair = (id, date, overrides = {}) => progress([boss(id, date)], { lairEncounterId: id, ...overrides });
const ids = rows => rows.map(row => row.bossId);

test("lairs share the difficulty table and killed Nymrissa follows first-kill chronology", () => {
  const main = progress([
    boss(3470, "2026-08-30", 1), boss(3445, "2026-08-31", 2),
    boss(3497, "2026-08-31", 3), boss(3455, "2026-09-06", 4),
    boss(3420, "2026-09-13", 5), boss(3421, "2026-09-24", 6),
    boss(3429, "2026-10-12", 7), boss(3492),
  ]);
  const lairs = [lair(3379, "2026-09-01"), lair(3513)];
  const before = structuredClone({ main, lairs, metadata });
  const rows = raidDetailBosses(main, metadata, lairs);
  assert.deepEqual(ids(rows), [3492, 3429, 3421, 3420, 3455, 3379, 3497, 3445, 3470, 3513]);
  assert.equal(rows.length, 10);
  assert.equal(rows.find(row => row.bossId === 3379), lairs[0].bosses[0], "retain the lair's logs and stats");
  assert.deepEqual({ main, lairs, metadata }, before, "display must not modify progress totals or source data");
});

test("heroic lair kills do not leak into mythic, and other raids are ignored", () => {
  const main = progress([boss(3470, "2026-08-30")]);
  const rows = raidDetailBosses(main, metadata, [
    lair(3379, "2026-09-01", { difficulty: "heroic" }),
    lair(3513, "2026-09-02", { raidId: 99 }),
  ]);
  assert.deepEqual(ids(rows).slice(-3), [3470, 3513, 3379]);
  assert.equal(rows.find(row => row.bossId === 3379).kills, 0);
  assert.equal(rows.find(row => row.bossId === 3513).kills, 0);
});

test("a recently killed Kith'ix joins the killed rows even though its local kill order is one", () => {
  const main = progress([boss(3492, "2026-09-01", 8)], { difficulty: "heroic", bossesDefeated: 8 });
  const rows = raidDetailBosses(main, metadata, [lair(3513, "2026-10-14", { difficulty: "heroic" })]);
  assert.deepEqual(ids(rows.filter(row => row.kills > 0)), [3513, 3492]);
  assert.equal(main.bossesDefeated, 8);
  assert.equal(main.totalBosses, 8);
});

test("ordinary raids retain reverse progression ordering and missing boss placeholders", () => {
  const main = progress([boss(1, "2026-08-01", 1), boss(2, "2026-08-01", 2)]);
  const bosses = [1, 2, 3].map(id => ({ id, name: String(id), slug: String(id) }));
  const rows = raidDetailBosses(main, bosses);
  assert.deepEqual(ids(rows), [3, 2, 1]);
  assert.equal(rows[0].kills, 0);
  assert.equal(rows[0].pullCount, 0);
});
