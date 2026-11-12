import assert from "node:assert/strict";
import test from "node:test";
import { compareForeverLevels, level60Estimate, level60Window } from "../src/features/forever/forever-level60";

const lower = Date.parse("2026-11-09T09:30:00Z"), upper = lower + 2 * 3600_000;
const at = lower + 3600_000, slug = "hávi-hávi";
const milestone = (id: number, time = at) => ({ id, achievement: { id }, criteria: { is_completed: true }, completed_timestamp: time });
const estimate = (...achievements: ReturnType<typeof milestone>[]) => level60Estimate({ character: { slug }, achievements }, slug, "Hunter", { lower, upper });

test("only matching completed Master milestones inside the character's window qualify", () => {
  assert.deepEqual(estimate(milestone(61996), milestone(61993)), new Date(at));
  assert.deepEqual(estimate(milestone(63977)), new Date(at));
  assert.equal(estimate(milestone(61996)), undefined);
  assert.equal(estimate({ ...milestone(61993), criteria: { is_completed: false } }), undefined);
  assert.equal(estimate(milestone(61993, Number.NaN)), undefined);
  assert.equal(estimate(milestone(61993, lower)), null);
  assert.equal(estimate(milestone(61993, upper + 1)), null);
  assert.equal(estimate(milestone(61993), milestone(63977, at + 60_000)), null);
  assert.throws(() => level60Estimate({ character: { slug: "other-hunter" }, achievements: [milestone(61993)] }, slug, "Hunter", { lower, upper }));
});

test("the latest lower level and earliest evidence of 60 bound the estimate", () => {
  const previous = { level: 58, observedAt: new Date(lower) };
  const capped = { level: 60, observedAt: new Date(upper + 600_000), sourceUpdatedAt: new Date(upper) };
  assert.deepEqual(level60Window([capped, previous, { level: 57, observedAt: new Date(lower - 60_000) }], capped.observedAt), { lower, upper });
  assert.deepEqual(level60Window([capped, previous], capped.observedAt, { profileLevel: 59, sourceUpdatedAt: new Date(at) }), { lower: at, upper });
  assert.deepEqual(level60Window([capped, previous], capped.observedAt, { profileLevel: 60, sourceUpdatedAt: new Date(at) }), { lower, upper: at });
  assert.equal(level60Window([capped], capped.observedAt), null);
  assert.equal(level60Window([{ ...previous, observedAt: new Date(upper - 86_400_001) }, capped], capped.observedAt), null);
  assert.equal(level60Window([{ ...previous, observedAt: new Date(upper + 1) }, capped], capped.observedAt), null);
});

test("rank across roster polls and preserve observation order within the same minute", () => {
  const row = (name: string, seen: number, estimate?: number) => ({ name, level: 60, lastLevelAt: new Date(seen),
    estimatedLevel60At: estimate === undefined ? undefined : new Date(estimate) });
  const rows = [{ name: "unknown", level: 60 }, row("observed", at + 15_000), row("same-minute", upper, at),
    row("earlier", upper, at - 60_000), { ...row("still-leveling", lower), level: 59 }];
  assert.deepEqual(rows.sort(compareForeverLevels).map(r => r.name), ["earlier", "observed", "same-minute", "unknown", "still-leveling"]);
});
