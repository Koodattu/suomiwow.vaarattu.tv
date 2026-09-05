/// <reference path="../src/types/express-session.d.ts" />

import assert from "node:assert/strict";
import test, { TestContext } from "node:test";
import mongoose from "mongoose";
import Report from "../src/models/Report";
import ReportOverride from "../src/models/ReportOverride";
import policyService, { normalizeReportCode, reportAllowedForGuild, ReportOverrideError } from "../src/services/report-override-policy.service";

const sourceId = new mongoose.Types.ObjectId("507f1f77bcf86cd799439012");
const targetId = new mongoose.Types.ObjectId("507f1f77bcf86cd799439013");
const code = "AbCdEf1234567890";

test("report codes and WCL links normalize without accepting unrelated hosts or paths", () => {
  for (const input of [code, ` ${code} `, `https://www.warcraftlogs.com/reports/${code}#fight=3`, `https://warcraftlogs.com/reports/${code}?fight=last`, `https://fi.warcraftlogs.com/reports/${code}/`]) {
    assert.equal(normalizeReportCode(input), code);
  }
  for (const input of ["", null, "bad/code", `https://warcraftlogs.com.evil.test/reports/${code}`, `https://evil.test/reports/${code}`, `https://warcraftlogs.com/reports/${code}/extra`, `http://warcraftlogs.com/reports/${code}`]) {
    assert.throws(() => normalizeReportCode(input), ReportOverrideError);
  }
});

test("a guild exclusion is permanent for that guild but does not exclude other guilds", () => {
  const policy = { exclusions: [{ guildId: sourceId }] };
  assert.equal(reportAllowedForGuild(policy, sourceId.toString()), false);
  assert.equal(reportAllowedForGuild(policy, targetId), true);
  assert.equal(reportAllowedForGuild(null, sourceId), true);
});

test("assignments override WCL discovery and exclusions take precedence at the destination", () => {
  const policy = { assignment: { guildId: targetId }, exclusions: [{ guildId: sourceId }] };
  assert.equal(reportAllowedForGuild(policy, sourceId), false);
  assert.equal(reportAllowedForGuild(policy, targetId.toString()), true);
  assert.equal(reportAllowedForGuild({ ...policy, exclusions: [{ guildId: targetId }] }, targetId), false);
});

test("a second writer cannot acquire a report already being fetched", async (t) => {
  let locked = false;
  t.mock.method(ReportOverride as any, "init", async () => undefined);
  t.mock.method(ReportOverride as any, "findOneAndUpdate", async () => {
    if (locked) throw Object.assign(new Error("duplicate key"), { code: 11000 });
    locked = true;
  });
  t.mock.method(ReportOverride as any, "updateOne", async () => { locked = false; });
  const firstToken = await policyService.acquire(code);
  await assert.rejects(policyService.acquire(code), (error: unknown) => error instanceof ReportOverrideError && error.code === "report_busy");
  await policyService.release(code, firstToken);
  assert.notEqual(await policyService.acquire(code), firstToken);
});

test("ingestion releases its lock when a rule rejects a report or the rule lookup fails", async (t) => {
  const released: string[] = [];
  t.mock.method(policyService, "acquire", async () => "token");
  t.mock.method(policyService, "release", async (reportCode: string) => { released.push(reportCode); });
  let lookups = 0;
  t.mock.method(policyService, "allowed", async () => ++lookups === 1);
  assert.equal(await policyService.acquireForIngestion(code, sourceId), null);
  assert.deepEqual(released, [code]);
  lookups = 0;
  t.mock.method(policyService, "allowed", async () => {
    if (++lookups === 1) return true;
    throw new Error("database unavailable");
  });
  await assert.rejects(policyService.acquireForIngestion(code, sourceId), /database unavailable/);
  assert.deepEqual(released, [code, code]);
});

test("a foreign guild skips assigned reports without interrupting the destination's active fetch", async (t) => {
  t.mock.method(policyService, "allowed", async () => false);
  t.mock.method(policyService, "acquire", () => { assert.fail("A foreign guild must not compete for the report lock"); });
  assert.equal(await policyService.acquireForIngestion(code, sourceId), null);
});

test("destination polling includes missing and unfinished assignments but avoids repeatedly fetching finished logs", async (t) => {
  t.mock.method(ReportOverride as any, "find", (filter: any) => {
    assert.equal(filter["assignment.guildId"], targetId);
    assert.equal(filter["exclusions.guildId"].$ne, targetId);
    return { select: () => ({ lean: async () => [{ code: "missing" }, { code: "live" }, { code: "finished" }] }) };
  });
  t.mock.method(Report as any, "find", () => ({ select: () => ({ lean: async () => [{ code: "finished" }] }) }));
  assert.deepEqual(await policyService.assignedCodes(targetId, true), ["missing", "live"]);
  assert.deepEqual(await policyService.assignedCodes(targetId), ["missing", "live", "finished"]);
});

test("a moved report retains its WCL source snapshot on automatic refresh", async (t) => {
  t.mock.method(ReportOverride as any, "findOne", () => ({ select: () => ({ lean: async () => ({ assignment: { guildId: targetId } }) }) }));
  t.mock.method(Report as any, "exists", async () => ({ _id: sourceId }));
  assert.deepEqual(await policyService.sourceFields(code, { sourceGuildSnapshot: { name: "KC" } }), {});
});

async function services() {
  process.env.BLIZZARD_CLIENT_ID ||= "test-client";
  process.env.BLIZZARD_CLIENT_SECRET ||= "test-secret";
  process.env.RAIDER_IO_API_KEY ||= "test-key";
  const [{ default: guild }, { default: processor }] = await Promise.all([
    import("../src/services/guild.service"),
    import("../src/services/background-guild-processor.service"),
  ]);
  return { guild: guild as any, processor: processor as any };
}

test("full rescan refuses excluded or foreign-assigned reports before storing reports or fights", async (t) => {
  const { processor } = await services();
  t.mock.method(policyService, "acquireForIngestion", async () => null);
  t.mock.method(Report as any, "findOneAndUpdate", () => { assert.fail("Excluded report must not be written"); });
  assert.equal(await processor.processReport({ code, fights: [{ id: 1 }] }, { _id: sourceId }, {}, new Set([1])), 0);
});

test("manual import cannot bypass an exclusion or a destination assignment", async (t) => {
  const { guild } = await services();
  t.mock.method(policyService, "acquireForIngestion", async () => null);
  t.mock.method(guild, "importSpecificReportForGuildUnlocked", () => { assert.fail("Blocked import must not fetch or persist data"); });
  await assert.rejects(guild.importSpecificReportForGuild(sourceId.toString(), code), (error: unknown) => error instanceof ReportOverrideError && error.code === "report_excluded");
});

test("manual import releases the shared report lock even when its persistence fails", async (t) => {
  const { guild } = await services();
  const { default: Guild } = await import("../src/models/Guild");
  t.mock.method(Guild as any, "updateOne", async () => ({ modifiedCount: 1 }));
  const release = t.mock.method(policyService, "release", async () => undefined);
  t.mock.method(policyService, "acquireForIngestion", async () => "manual-token");
  t.mock.method(guild, "importSpecificReportForGuildUnlocked", async () => { throw new Error("persistence failed"); });
  await assert.rejects(guild.importSpecificReportForGuild(sourceId.toString(), `https://www.warcraftlogs.com/reports/${code}`), /persistence failed/);
  assert.deepEqual(release.mock.calls[0].arguments, [code, "manual-token"]);
});

test("normal polling does not treat excluded reports as live raids or fetch them again", async (t) => {
  const { guild } = await services();
  const { default: wcl } = await import("../src/services/warcraftlogs.service");
  t.mock.method(guild, "getCurrentRaidIdByEncounterId", async () => new Map());
  t.mock.method(policyService, "assignedCodes", async () => []);
  t.mock.method(policyService, "allowed", async () => false);
  t.mock.method(wcl, "getRecentReports", async () => ({ reportData: { reports: { data: [{ code, endTime: Date.now() }] } } }) as any);
  t.mock.method(wcl, "getReportByCodeAllDifficulties", () => { assert.fail("Excluded report must not be fetched"); });
  const source = { name: "THPS", realm: "Realm", region: "EU" };
  const storedGuild = { ...source, _id: sourceId, isCurrentlyRaiding: false };
  assert.equal(await guild.performUpdate(storedGuild, source), false);
  assert.equal(storedGuild.isCurrentlyRaiding, false);
});

test("destination polling refreshes an assigned historical report absent from its WCL guild listing", async (t) => {
  const { guild } = await services();
  const { default: wcl } = await import("../src/services/warcraftlogs.service");
  const { default: Fight } = await import("../src/models/Fight");
  const historicalRaidId = 9999;
  const endTime = Date.now() - 60 * 60 * 1000;
  t.mock.method(guild, "getCurrentRaidIdByEncounterId", async () => new Map());
  t.mock.method(guild, "getTrackedRaidIdByEncounterId", async () => new Map([[42, historicalRaidId]]));
  t.mock.method(policyService, "assignedCodes", async () => [code]);
  t.mock.method(policyService, "acquireForIngestion", async () => "assigned-token");
  t.mock.method(policyService, "release", async () => undefined);
  t.mock.method(policyService, "sourceFields", async () => ({}));
  t.mock.method(wcl, "getRecentReports", async () => ({ reportData: { reports: { data: [] } } }) as any);
  t.mock.method(wcl, "getReportByCodeAllDifficulties", async () => ({ reportData: { report: {
    code, startTime: endTime - 1000, endTime,
    fights: [{ id: 1, encounterID: 42, startTime: 0, endTime: 1000, difficulty: 4, kill: true }],
  } } }) as any);
  t.mock.method(wcl, "getDeathEventsForReport", async () => ({}) as any);
  t.mock.method(wcl, "determinePhaseInfo", () => ({}) as any);
  t.mock.method(Fight as any, "find", () => ({ select: () => ({ lean: async () => [] }) }));
  const fightWrites = t.mock.method(Fight as any, "bulkWrite", async () => undefined);
  const reportWrite = t.mock.method(Report as any, "findOneAndUpdate", async () => undefined);
  t.mock.method(Report as any, "findOne", () => ({ sort: () => ({ limit: () => ({ lean: async () => ({ endTime }) }) }) }));
  const statistics = t.mock.method(guild, "calculateGuildStatistics", async () => undefined);
  t.mock.method(guild, "calculateGuildRankingsForRaid", async () => undefined);
  const source = { name: "KC", realm: "Realm", region: "EU" };
  const storedGuild = { ...source, _id: targetId, isCurrentlyRaiding: false, save: async () => undefined };
  assert.equal(await guild.performUpdate(storedGuild, source), true);
  assert.equal((reportWrite.mock.calls[0].arguments as any[])[1].zoneId, historicalRaidId);
  assert.equal((fightWrites.mock.calls[0].arguments as any[])[0][0].updateOne.update.$set.guildId, targetId);
  assert.equal((statistics.mock.calls[0].arguments as any[])[1], historicalRaidId);
});

async function correctionFixture(t: TestContext) {
  const { guild: guildService } = await services();
  const { default: correctionService } = await import("../src/services/report-override.service");
  const { default: Guild } = await import("../src/models/Guild");
  const { default: Fight } = await import("../src/models/Fight");
  const { default: Queue } = await import("../src/models/GuildProcessingQueue");
  const { default: Appearance } = await import("../src/models/CharacterReportAppearance");
  const { default: Vod } = await import("../src/models/FightVodLink");
  const { default: Participation } = await import("../src/models/CharacterRaidParticipation");
  const { default: Highlight } = await import("../src/models/GuildProfileHighlight");
  const { default: TierEntry } = await import("../src/models/CharacterTierListEntry");
  const { default: cache } = await import("../src/services/cache.service");
  const { default: scheduler } = await import("../src/services/scheduler.service");
  const calls: Array<{ model: string; method: string; filter: any; update?: any }> = [];
  const policy: any = { exclusions: [] };
  let report: any = { _id: new mongoose.Types.ObjectId(), code, guildId: sourceId, sourceGuildSnapshot: { name: "THPS" } };
  const guilds = [
    { _id: sourceId, name: "THPS", realm: "Realm", save: async () => undefined },
    { _id: targetId, name: "KC", realm: "Realm", save: async () => undefined },
  ];
  let transactions = 0;
  const session: any = { withTransaction: async (fn: () => Promise<void>) => { transactions++; await fn(); }, endSession: async () => undefined };
  t.mock.method(mongoose, "startSession", async () => session);
  t.mock.method(policyService, "acquire", async () => "correction-token");
  const release = t.mock.method(policyService, "release", async () => undefined);
  t.mock.method(Guild as any, "find", async (filter: any) => guilds.filter((guild) => filter._id.$in.includes(String(guild._id))));
  t.mock.method(Guild as any, "updateMany", async (filter: any) => ({ modifiedCount: filter._id.$in.length }));
  t.mock.method(Queue as any, "exists", async () => null);
  t.mock.method(ReportOverride as any, "findOne", () => ({ session: async () => policy }));
  t.mock.method(Report as any, "findOne", () => ({ session: async () => report, sort: () => ({ select: () => ({ lean: async () => null }) }) }));
  t.mock.method(ReportOverride as any, "updateOne", async (filter: any, update: any, options: any) => {
    assert.equal(options.session, session);
    calls.push({ model: "policy", method: "update", filter, update });
    if (update.$set?.assignment) policy.assignment = update.$set.assignment;
    if (update.$unset?.assignment) delete policy.assignment;
    if (update.$pull?.exclusions) policy.exclusions = policy.exclusions.filter((entry: any) => String(entry.guildId) !== String(update.$pull.exclusions.guildId));
    if (update.$push?.exclusions) policy.exclusions.push(update.$push.exclusions);
  });
  for (const [modelName, model] of [["report", Report], ["fight", Fight], ["appearance", Appearance], ["vod", Vod], ["participation", Participation], ["highlight", Highlight], ["tier", TierEntry]] as const) {
    const updateMethod = modelName === "report" ? "updateOne" : "updateMany";
    t.mock.method(model as any, updateMethod, async (filter: any, update: any, options: any) => {
      assert.equal(options.session, session);
      calls.push({ model: modelName, method: "update", filter, update });
      if (modelName === "report") Object.assign(report, update.$set);
      return { modifiedCount: 1 };
    });
    const deleteMethod = modelName === "report" ? "deleteOne" : "deleteMany";
    t.mock.method(model as any, deleteMethod, async (filter: any, options: any) => {
      assert.equal(options.session, session);
      calls.push({ model: modelName, method: "delete", filter });
      if (modelName === "report") report = null;
      return { deletedCount: 2 };
    });
  }
  const statistics = t.mock.method(guildService, "calculateGuildStatistics", async () => undefined);
  const rankings = t.mock.method(guildService, "calculateGuildRankingsForAllRaids", async () => undefined);
  const derived = t.mock.method(scheduler, "triggerReportCorrectionRefresh", () => undefined);
  t.mock.method(cache, "invalidateAllGuildCaches", async () => undefined);
  t.mock.method(cache, "invalidateGuildSpecificCaches", async () => undefined);
  t.mock.method(cache, "invalidateCharacterTierListCaches", async () => undefined);
  t.mock.method(cache, "invalidatePattern", async () => undefined);
  return { correctionService, policy, getReport: () => report, calls, statistics, rankings, derived, release, Queue, transactions: () => transactions };
}

test("moving a report updates its fights, appearances and VODs atomically and refreshes both guilds", async (t) => {
  const fixture = await correctionFixture(t);
  const result = await fixture.correctionService.change({ guildId: String(sourceId), reportCode: code, action: "assign", targetGuildId: String(targetId), reason: "Kelacity raid" });
  assert.equal(fixture.transactions(), 1);
  assert.equal(String(fixture.policy.assignment.guildId), String(targetId));
  assert.equal(String(fixture.policy.assignment.previousGuildId), String(sourceId));
  assert.equal(String(fixture.getReport().guildId), String(targetId));
  assert.deepEqual(fixture.getReport().sourceGuildSnapshot, { name: "THPS" });
  assert.deepEqual(fixture.calls.filter((call) => call.method === "update" && call.model !== "policy").map((call) => call.model), ["report", "fight", "appearance", "vod"]);
  const appearanceWrite = fixture.calls.find((call) => call.model === "appearance")!;
  assert.equal(appearanceWrite.update.$set.reportGuildName, "KC");
  assert.deepEqual(fixture.statistics.mock.calls.map((call: any) => String(call.arguments[0]._id)), [String(sourceId), String(targetId)]);
  assert.equal(fixture.rankings.mock.callCount(), 1);
  assert.equal(fixture.derived.mock.callCount(), 1);
  assert.equal(fixture.release.mock.callCount(), 1);
  assert.deepEqual(result.warnings, []);
});

test("removal leaves a persistent exclusion; restoring allows fetching without silently importing", async (t) => {
  const fixture = await correctionFixture(t);
  await fixture.correctionService.change({ guildId: String(sourceId), reportCode: code, action: "exclude", reason: "PUG" });
  assert.equal(fixture.getReport(), null);
  assert.equal(reportAllowedForGuild(fixture.policy, sourceId), false);
  assert.equal(reportAllowedForGuild(fixture.policy, targetId), true);
  assert.deepEqual(fixture.calls.filter((call) => call.method === "delete").map((call) => call.model), ["fight", "appearance", "vod", "report", "participation", "highlight", "tier"]);
  await fixture.correctionService.change({ guildId: String(sourceId), reportCode: code, action: "restore" });
  assert.equal(reportAllowedForGuild(fixture.policy, sourceId), true);
  assert.equal(fixture.getReport(), null);
});

test("excluding a code owned by another guild only changes the requesting guild's rule", async (t) => {
  const fixture = await correctionFixture(t);
  await fixture.correctionService.change({ guildId: String(targetId), reportCode: code, action: "exclude" });
  assert.equal(String(fixture.getReport().guildId), String(sourceId));
  assert.equal(reportAllowedForGuild(fixture.policy, targetId), false);
  assert.equal(fixture.calls.some((call) => call.method === "delete"), false);
  assert.equal(fixture.statistics.mock.callCount(), 0);
});

test("queued guild work blocks corrections before any ownership or rule write", async (t) => {
  const fixture = await correctionFixture(t);
  t.mock.method(fixture.Queue as any, "exists", async () => ({ _id: sourceId }));
  await assert.rejects(fixture.correctionService.change({ guildId: String(sourceId), reportCode: code, action: "exclude" }), (error: unknown) => error instanceof ReportOverrideError && error.code === "guild_busy");
  assert.equal(fixture.calls.length, 0);
  assert.equal(fixture.release.mock.callCount(), 1);
});

test("a saved correction reports statistics failure without pretending the move failed", async (t) => {
  const fixture = await correctionFixture(t);
  fixture.statistics.mock.mockImplementation(async () => { throw new Error("statistics unavailable"); });
  const result = await fixture.correctionService.change({ guildId: String(sourceId), reportCode: code, action: "assign", targetGuildId: String(targetId) });
  assert.equal(result.success, true);
  assert.deepEqual(result.warnings, ["statistics_refresh_failed"]);
  assert.equal(String(fixture.getReport().guildId), String(targetId));
  assert.equal(fixture.derived.mock.callCount(), 1);
});
