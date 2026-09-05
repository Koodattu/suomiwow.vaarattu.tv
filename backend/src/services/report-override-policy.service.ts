import mongoose from "mongoose";
import ReportOverride from "../models/ReportOverride";
import Report from "../models/Report";

export class ReportOverrideError extends Error {
  constructor(public statusCode: number, public code: string, message: string) {
    super(message);
  }
}

export function normalizeReportCode(input: unknown): string {
  const value = typeof input === "string" ? input.trim() : "";
  if (/^[a-zA-Z0-9]+$/.test(value)) return value;
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && /^(?:www\.|[a-z]{2}\.)?warcraftlogs\.com$/.test(url.hostname)) {
      const match = url.pathname.match(/^\/reports\/([a-zA-Z0-9]+)\/?$/);
      if (match) return match[1];
    }
  } catch { /* Invalid input is reported below. */ }
  throw new ReportOverrideError(400, "invalid_report_code", "Enter a Warcraft Logs report code or report link");
}

export function reportAllowedForGuild(policy: {
  assignment?: { guildId?: unknown } | null;
  exclusions?: Array<{ guildId: unknown }>;
} | null, guildId: unknown): boolean {
  const id = String(guildId);
  return (!policy?.assignment?.guildId || String(policy.assignment.guildId) === id)
    && !policy?.exclusions?.some((entry) => String(entry.guildId) === id);
}

class ReportOverridePolicyService {
  async allowed(code: string, guildId: unknown): Promise<boolean> {
    return reportAllowedForGuild(await ReportOverride.findOne({ code }).lean(), guildId);
  }

  async acquire(code: string): Promise<string> {
    await ReportOverride.init();
    const token = new mongoose.Types.ObjectId().toHexString();
    try {
      await ReportOverride.findOneAndUpdate(
        { code, $or: [{ lockToken: { $exists: false } }, { lockedAt: { $lt: new Date(Date.now() - 2 * 60 * 60 * 1000) } }] },
        { $set: { lockToken: token, lockedAt: new Date() }, $setOnInsert: { code } },
        { upsert: true },
      );
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        throw new ReportOverrideError(409, "report_busy", "This report is being updated. Try again when the update finishes.");
      }
      throw error;
    }
    return token;
  }

  async release(code: string, token: string): Promise<void> {
    await ReportOverride.updateOne({ code, lockToken: token }, { $unset: { lockToken: 1, lockedAt: 1 } });
  }

  async acquireForIngestion(code: string, guildId: unknown): Promise<string | null> {
    if (!(await this.allowed(code, guildId))) return null;
    const token = await this.acquire(code);
    try {
      if (await this.allowed(code, guildId)) return token;
      await this.release(code, token);
      return null;
    } catch (error) {
      await this.release(code, token);
      throw error;
    }
  }

  async assignedCodes(guildId: mongoose.Types.ObjectId | string, recentOnly = false): Promise<string[]> {
    const policies = await ReportOverride.find({ "assignment.guildId": guildId, "exclusions.guildId": { $ne: guildId } }).select("code").lean();
    const codes = policies.map((policy) => policy.code);
    if (!recentOnly || !codes.length) return codes;
    // Live reports keep updating; finished manual reports are checked daily for later additions.
    const fresh = await Report.find({ code: { $in: codes }, guildId, isOngoing: false, lastProcessed: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } }).select("code").lean();
    const freshCodes = new Set(fresh.map((report) => report.code));
    return codes.filter((code) => !freshCodes.has(code));
  }

  async sourceFields(code: string, fields: Record<string, unknown>): Promise<Record<string, unknown>> {
    const policy = await ReportOverride.findOne({ code }).select("assignment.guildId").lean();
    if (policy?.assignment?.guildId && await Report.exists({ code })) return {};
    return fields;
  }
}

export default new ReportOverridePolicyService();
