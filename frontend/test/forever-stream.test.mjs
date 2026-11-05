import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../src/lib/forever-api.ts", import.meta.url), "utf8");
const exports = {};
runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, { exports });
const { isForeverStreamLive, formatForeverDate, foreverUpdateAge } = exports;

test("update ages advance through minutes, hours and days without rounding up", () => {
  const now = Date.parse("2026-11-05T15:04:00Z");
  for (const [seconds, unit, count] of [[-60, "now", 0], [0, "now", 0], [59, "now", 0], [60, "minutes", 1], [3599, "minutes", 59], [3600, "hours", 1], [86399, "hours", 23], [86400, "days", 1], [172800, "days", 2]]) {
    const age = foreverUpdateAge(new Date(now - seconds * 1000).toISOString(), now);
    assert.equal(age.unit, unit); assert.equal(age.count, count);
  }
  assert.equal(foreverUpdateAge(undefined, now), null);
  assert.equal(foreverUpdateAge("invalid", now), null);
});

test("Forever dates always use Finnish numbers and Helsinki time including daylight saving", () => {
  assert.equal(formatForeverDate("2026-11-05T15:04:00Z"), "5.11.2026 17.04");
  assert.equal(formatForeverDate("2026-11-05T15:04:00Z", true), "5.11. 17.04");
  assert.equal(formatForeverDate("2026-07-05T21:04:00Z"), "6.7.2026 00.04");
  assert.equal(formatForeverDate("invalid"), "—");
});

test("live badges require a recent positive Twitch observation", () => {
  const now = Date.parse("2026-11-05T15:00:00Z");
  const character = { twitchIsLive: true, twitchCheckedAt: new Date(now - 120_000).toISOString() };
  assert.equal(isForeverStreamLive(character, now), true);
  assert.equal(isForeverStreamLive({ ...character, twitchIsLive: false }, now), false);
  assert.equal(isForeverStreamLive(character, now + 180_000), false);
  assert.equal(isForeverStreamLive({ twitchIsLive: true }, now), false);
  assert.equal(isForeverStreamLive({ ...character, twitchCheckedAt: "invalid" }, now), false);
  assert.equal(isForeverStreamLive({ ...character, twitchCheckedAt: new Date(now + 60_000).toISOString() }, now), false);
});
