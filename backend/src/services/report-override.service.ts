import mongoose from "mongoose";
import Guild from "../models/Guild";
import Report from "../models/Report";
import ReportOverride from "../models/ReportOverride";
import Fight from "../models/Fight";
import FightVodLink from "../models/FightVodLink";
import CharacterReportAppearance from "../models/CharacterReportAppearance";
import CharacterRaidParticipation from "../models/CharacterRaidParticipation";
import GuildProcessingQueue from "../models/GuildProcessingQueue";
import GuildProfileHighlight from "../models/GuildProfileHighlight";
import CharacterTierListEntry from "../models/CharacterTierListEntry";
import guildService from "./guild.service";
import cacheService from "./cache.service";
import policyService, { normalizeReportCode, ReportOverrideError } from "./report-override-policy.service";

export type ReportOverrideAction = "assign" | "exclude" | "restore" | "clear_assignment";

class ReportOverrideService {
  async list(guildId: string) {
    return ReportOverride.find({ $or: [
      { "assignment.guildId": guildId },
      { "assignment.previousGuildId": guildId },
      { "exclusions.guildId": guildId },
    ] }).select("code assignment exclusions updatedAt")
      .populate("assignment.guildId", "name realm")
      .sort({ updatedAt: -1 }).lean();
  }

  async change(input: {
    guildId: string;
    reportCode: unknown;
    action: ReportOverrideAction;
    targetGuildId?: string;
    reason?: string;
    updatedBy?: mongoose.Types.ObjectId;
  }) {
    const { guildId, action, targetGuildId, updatedBy } = input;
    const code = normalizeReportCode(input.reportCode);
    if (!mongoose.isValidObjectId(guildId) || (action === "assign" && !mongoose.isValidObjectId(targetGuildId))) {
      throw new ReportOverrideError(400, "invalid_guild", "Choose a valid guild");
    }
    if (action === "assign" && guildId === targetGuildId) {
      throw new ReportOverrideError(400, "same_guild", "Choose a different destination guild");
    }
    const reason = input.reason?.trim() || "";
    if (reason.length > 500) throw new ReportOverrideError(400, "invalid_reason", "Keep the reason under 500 characters");
    const token = await policyService.acquire(code);
    const involvedIds = [...new Set([guildId, ...(action === "assign" ? [targetGuildId!] : [])])];
    const now = new Date();
    let deletedFights = 0;
    let changedData = false;
    try {
      const guilds = await Guild.find({ _id: { $in: involvedIds } });
      if (guilds.length !== involvedIds.length) throw new ReportOverrideError(404, "guild_not_found", "Guild not found");
      const source = guilds.find((guild) => String(guild._id) === guildId)!;
      const target = guilds.find((guild) => String(guild._id) === targetGuildId);
      const locked = await Guild.updateMany({
        _id: { $in: involvedIds },
        $and: [
          { $or: [{ wclUpdateLockToken: { $exists: false } }, { wclUpdateStartedAt: { $lt: new Date(Date.now() - 60 * 60 * 1000) } }] },
          { $or: [{ logSourceMigrationLockToken: { $exists: false } }, { logSourceMigrationLockedAt: { $lt: new Date(Date.now() - 2 * 60 * 60 * 1000) } }] },
        ],
      }, { $set: { logSourceMigrationLockToken: token, logSourceMigrationLockedAt: now } });
      if (locked.modifiedCount !== involvedIds.length || await GuildProcessingQueue.exists({ guildId: { $in: involvedIds }, status: { $in: ["pending", "in_progress", "paused"] } })) {
        throw new ReportOverrideError(409, "guild_busy", "A guild update is queued or running. Try again after it finishes.");
      }
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          const policy = await ReportOverride.findOne({ code, lockToken: token }).session(session);
          if (!policy) throw new ReportOverrideError(409, "report_busy", "The report changed. Refresh and try again.");
          const report = await Report.findOne({ code }).session(session);
          if (action === "assign") {
            if (!report || String(report.guildId) !== guildId) throw new ReportOverrideError(409, "report_conflict", "Choose a report currently stored for this guild");
            if (policy.exclusions.some((entry) => String(entry.guildId) === targetGuildId)) throw new ReportOverrideError(409, "report_excluded", "Allow fetching this report for the destination guild before moving it");
            await ReportOverride.updateOne({ code, lockToken: token }, { $set: { assignment: { guildId: target!._id, previousGuildId: source._id, reason, updatedBy, updatedAt: now } } }, { session });
            // Preserve the original WCL source snapshot as provenance.
            await Report.updateOne({ _id: report._id }, { $set: { guildId: target!._id } }, { session });
            await Fight.updateMany({ reportCode: code }, { $set: { guildId: target!._id } }, { session });
            await CharacterReportAppearance.updateMany({ reportCode: code }, { $set: { reportGuildId: target!._id, reportGuildName: target!.name, reportGuildRealm: target!.realm } }, { session });
            await FightVodLink.updateMany({ reportCode: code }, { $set: { guildId: target!._id } }, { session });
            changedData = true;
          } else if (action === "exclude") {
            await ReportOverride.updateOne({ code, lockToken: token }, { $pull: { exclusions: { guildId: source._id } } }, { session });
            await ReportOverride.updateOne({ code, lockToken: token }, { $push: { exclusions: { guildId: source._id, reason, updatedBy, updatedAt: now } } }, { session });
            if (report && String(report.guildId) === guildId) {
              const result = await Fight.deleteMany({ reportCode: code, guildId: source._id }, { session });
              deletedFights = result.deletedCount;
              await CharacterReportAppearance.deleteMany({ reportCode: code, reportGuildId: source._id }, { session });
              await FightVodLink.deleteMany({ reportCode: code, guildId: source._id }, { session });
              await Report.deleteOne({ _id: report._id }, { session });
              changedData = true;
            }
          } else if (action === "restore") {
            await ReportOverride.updateOne({ code, lockToken: token }, { $pull: { exclusions: { guildId: source._id } } }, { session });
          } else {
            if (String(policy.assignment?.guildId) !== guildId) throw new ReportOverrideError(409, "report_conflict", "Release the assignment from its destination guild");
            await ReportOverride.updateOne({ code, lockToken: token }, { $unset: { assignment: 1 } }, { session });
          }
          if (changedData) {
            await CharacterRaidParticipation.deleteMany({ reportGuildId: { $in: guilds.map((guild) => guild._id) } }, { session });
            await GuildProfileHighlight.deleteMany({ guildId: { $in: guilds.map((guild) => guild._id) } }, { session });
            await CharacterTierListEntry.deleteMany({ guildId: { $in: guilds.map((guild) => guild._id) } }, { session });
          }
        });
      } finally {
        await session.endSession();
      }
      const warnings: string[] = [];
      if (changedData) {
        try {
          for (const guild of guilds) {
            await guildService.calculateGuildStatistics(guild, null, { createEvents: false });
            const latest = await Report.findOne({ guildId: guild._id }).sort({ endTime: -1 }).select("endTime").lean();
            guild.lastLogEndTime = latest?.endTime ? new Date(latest.endTime) : undefined;
            guild.isCurrentlyRaiding = Boolean(latest?.endTime && Date.now() - latest.endTime < 30 * 60 * 1000);
            await guild.save();
          }
          await guildService.calculateGuildRankingsForAllRaids();
        } catch (error) {
          const { default: logger } = await import("../utils/logger");
          logger.error("Report correction saved, but statistics refresh failed:", error);
          warnings.push("statistics_refresh_failed");
        }
        try {
          const { default: scheduler } = await import("./scheduler.service");
          scheduler.triggerReportCorrectionRefresh();
          await cacheService.invalidateAllGuildCaches();
          for (const guild of guilds) await cacheService.invalidateGuildSpecificCaches(guild.realm, guild.name);
          await cacheService.invalidateCharacterTierListCaches();
          await cacheService.invalidatePattern(/^characters:profile:/);
        } catch (error) {
          const { default: logger } = await import("../utils/logger");
          logger.error("Report correction saved, but derived data refresh failed:", error);
          warnings.push("derived_refresh_failed");
        }
      }
      return { success: true, reportCode: code, deletedFights, warnings };
    } finally {
      try {
        await Guild.updateMany({ _id: { $in: involvedIds }, logSourceMigrationLockToken: token }, { $unset: { logSourceMigrationLockToken: 1, logSourceMigrationLockedAt: 1 } });
      } finally {
        await policyService.release(code, token);
      }
    }
  }
}

export default new ReportOverrideService();
