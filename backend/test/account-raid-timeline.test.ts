import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import { summarizeAccountRaidActivity } from "../src/services/account-raid-timeline.service";

const main = new mongoose.Types.ObjectId();
const alt = new mongoose.Types.ObjectId();
const guildId = new mongoose.Types.ObjectId();
const row = (characterId = main, zoneId = 38) => ({ characterId, zoneId, reportGuildId: guildId, reportGuildName: "First Guild", reportGuildRealm: "stormreaver", firstSeenAt: new Date("2025-01-01"), lastSeenAt: new Date("2025-02-01"), reportCount: 2 });

test("combines guild activity while keeping characters and tiers separate", () => {
  const result = summarizeAccountRaidActivity([
    row(), { ...row(), firstSeenAt: new Date("2024-12-01"), lastSeenAt: new Date("2025-03-01"), reportCount: 3 }, row(alt), row(main, 42),
  ], []);
  const activity = result.get(38)!.get(String(main))!;
  assert.equal(activity.reportCount, 5);
  assert.equal(activity.firstSeenAt.toISOString(), "2024-12-01T00:00:00.000Z");
  assert.equal(activity.lastSeenAt.toISOString(), "2025-03-01T00:00:00.000Z");
  assert.equal(result.get(38)!.get(String(alt))!.reportCount, 2);
  assert.equal(result.get(42)!.get(String(main))!.reportCount, 2);
});

test("normalizes and deduplicates spec evidence without copying it to other characters or tiers", () => {
  const result = summarizeAccountRaidActivity([row(), row(alt), row(main, 42)], [
    { characterId: main, zoneId: 38, specs: ["BeastMastery", "beast-mastery", "", "Marksmanship"] },
    { characterId: main, zoneId: 38, specs: ["Survival"] },
    { characterId: alt, zoneId: 42, specs: ["Holy"] },
  ]);
  assert.deepEqual(result.get(38)!.get(String(main))!.specs, ["beast-mastery", "marksmanship", "survival"]);
  assert.deepEqual(result.get(38)!.get(String(alt))!.specs, []);
  assert.deepEqual(result.get(42)!.get(String(main))!.specs, []);
  assert.equal(result.get(42)!.has(String(alt)), false);
});

test("keeps historical guild dates and report counts per character and tier", () => {
  const otherGuildId = new mongoose.Types.ObjectId();
  const result = summarizeAccountRaidActivity([
    { ...row(), reportGuildId: otherGuildId, reportGuildName: "Second Guild", reportGuildRealm: "ravencrest", firstSeenAt: new Date("2025-01-15"), lastSeenAt: new Date("2025-03-01"), reportCount: 3 },
    row(),
    { ...row(), firstSeenAt: new Date("2024-12-01"), lastSeenAt: new Date("2025-02-15"), reportCount: 1 },
    row(alt),
    row(main, 42),
  ], []);
  assert.deepEqual(result.get(38)!.get(String(main))!.guilds, [
    { id: String(guildId), name: "First Guild", realm: "stormreaver", firstSeenAt: new Date("2024-12-01"), lastSeenAt: new Date("2025-02-15"), reportCount: 3 },
    { id: String(otherGuildId), name: "Second Guild", realm: "ravencrest", firstSeenAt: new Date("2025-01-15"), lastSeenAt: new Date("2025-03-01"), reportCount: 3 },
  ]);
  assert.equal(result.get(38)!.get(String(main))!.reportCount, 6);
  const expectedOtherGuilds = [{ id: String(guildId), name: "First Guild", realm: "stormreaver", firstSeenAt: row().firstSeenAt, lastSeenAt: row().lastSeenAt, reportCount: 2 }];
  assert.deepEqual(result.get(38)!.get(String(alt))!.guilds, expectedOtherGuilds);
  assert.deepEqual(result.get(42)!.get(String(main))!.guilds, expectedOtherGuilds);
});

test("does not merge different guilds with the same name", () => {
  const otherGuildId = new mongoose.Types.ObjectId();
  const result = summarizeAccountRaidActivity([row(), { ...row(), reportGuildId: otherGuildId, reportGuildRealm: "ravencrest" }], []);
  const guilds = result.get(38)!.get(String(main))!.guilds;
  assert.equal(guilds.length, 2);
  assert.deepEqual(new Set(guilds.map((guild) => guild.id)), new Set([String(guildId), String(otherGuildId)]));
  assert.deepEqual(new Set(guilds.map((guild) => guild.realm)), new Set(["stormreaver", "ravencrest"]));
});

test("empty participation and unlinked or zero-report rows do not imply activity", () => {
  assert.equal(summarizeAccountRaidActivity([], []).size, 0);
  assert.equal(summarizeAccountRaidActivity([{ ...row(), characterId: null }, { ...row(), reportCount: 0 }], []).size, 0);
});
