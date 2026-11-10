import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../src/lib/forever-api.ts", import.meta.url), "utf8");
const exports = {};
runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, { exports });
const { isForeverStreamLive, formatForeverDate, foreverUpdateAge, foreverRace, foreverCharacterPath, foreverRouteIdentity, foreverHistory } = exports;

test("Skyborne display labels and name links preserve accents and existing non-EU identities", () => {
  assert.equal(foreverRace("High Order Skyborne"), "Skyborne");
  assert.equal(foreverRace("Windshaper Skyborne"), "Skyborne");
  assert.equal(foreverRace("Dwarf"), "Dwarf"); assert.equal(foreverRace(undefined), "—");
  const character = { _id: "507f1f77bcf86cd799439011", region: "eu", slug: "väinö-korpi" };
  assert.equal(foreverCharacterPath(character), "/forever/characters/v%C3%A4in%C3%B6-korpi");
  assert.equal(foreverCharacterPath({ ...character, region: "us" }), `/forever/characters/${character._id}`);
  assert.equal(foreverRouteIdentity("v%C3%A4in%C3%B6-korpi"), "väinö-korpi");
  assert.equal(foreverRouteIdentity("väinö-korpi"), "väinö-korpi");
  assert.equal(foreverRouteIdentity("bad%escape"), "bad%escape");
});

test("progress points use observed times, retain level jumps and never invent missing levels", () => {
  const points = foreverHistory([
    { level: 27, observedAt: "2026-11-05T15:00:00Z", sourceUpdatedAt: "2026-11-05T14:00:00Z" },
    { level: 18, observedAt: "2026-11-05T10:00:00Z" },
    { level: 22, observedAt: "2026-11-05T12:00:00Z" },
    { level: 61, observedAt: "2026-11-05T16:00:00Z" }, { level: 0, observedAt: "2026-11-05T16:00:00Z" },
    { level: 28, observedAt: "invalid" },
  ]);
  assert.deepEqual(Array.from(points, p => p.level), [18, 22, 27]);
  assert.equal(points[2].timestamp, Date.parse("2026-11-05T15:00:00Z"));
  assert.equal(foreverHistory(undefined).length, 0);
  assert.equal(foreverHistory([{ level: 60, observedAt: "2026-11-05T16:00:00Z" }]).length, 1);
});

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
