import { createHash, randomUUID } from "node:crypto";
import OpenAI from "openai";
import mongoose from "mongoose";
import { meteredFetch } from "../ai-usage/ai-usage";
import logger from "../../utils/logger";
import { ForeverCharacter, ForeverGuild, ForeverWorker } from "./forever.models";
import { releaseRosterCoverage } from "./forever-roster-sync";
import { ForeverError } from "./forever-errors";
import { GUILD_LANGUAGE_MODEL, GUILD_LANGUAGE_VERSION, guildLanguageAutoAction, guildsAwaitingLanguageReview, guildsReadyForLanguageAssessment, scoreGuildLanguage } from "./forever-guild-language";

const RETRY_DELAY_MS = 60 * 60_000;

export async function queueGuildLanguageAssessments() {
  if (!process.env.OPENAI_API_KEY?.trim()) throw new ForeverError("openai_not_configured", 503);
  const now = new Date();
  const result = await ForeverGuild.updateMany({ languageLease: null, $or: [
    { languageDueAt: null }, { languageDueAt: { $gt: now } },
  ] }, { $set: { languageDueAt: now } }, { timestamps: false });
  return { queued: result.modifiedCount };
}

export class GuildLanguageWorker {
  private timer?: NodeJS.Timeout;
  private active?: Promise<void>;

  start() {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (this.timer) return;
    if (!apiKey) {
      logger.warn("[Forever] Guild language worker is disabled because OPENAI_API_KEY is missing");
      return;
    }
    const client = new OpenAI({ apiKey, timeout: 45_000, maxRetries: 0, fetch: meteredFetch("guildLanguage", GUILD_LANGUAGE_MODEL) });
    const poll = () => {
      if (this.active) return;
      this.active = this.tick(client).catch(() => { logger.error("[Forever] Guild language assessment could not be saved"); })
        .finally(() => { this.active = undefined; });
    };
    this.timer = setInterval(poll, 3_000);
    logger.info("[Forever] Guild language worker started");
    poll();
  }

  async stop() {
    clearInterval(this.timer);
    this.timer = undefined;
    await this.active;
  }

  async tick(client: OpenAI) {
    const lease = randomUUID();
    // Moving the due date lets another worker resume after a crash. Only this claim can publish its result.
    const guild = await ForeverGuild.findOneAndUpdate(guildsReadyForLanguageAssessment(new Date()),
      { $set: { languageLease: lease, languageDueAt: new Date(Date.now() + 120_000) } },
      { sort: { languageDueAt: 1, _id: 1 }, returnDocument: "after", timestamps: false })
      .select("name region slug lastFetchedAt roster.name roster.slug languageAssessment").lean();
    if (!guild) return;
    const hasRoster = !!guild.lastFetchedAt || !!guild.roster?.length;
    const members = hasRoster ? guild.roster : await ForeverCharacter.find({ region: guild.region, "guild.slug": guild.slug }).select("name slug").lean();
    const evidence = { guildName: guild.name, characterNames: members.map(member => member.name || member.slug.replace(/-/g, " ")).sort() };
    const fingerprint = createHash("sha256").update(JSON.stringify([GUILD_LANGUAGE_VERSION, GUILD_LANGUAGE_MODEL, evidence])).digest("hex");
    const previous = guild.languageAssessment?.fingerprint === fingerprint ? guild.languageAssessment : undefined;
    const source = hasRoster ? "roster" : "profiles";
    const fence = { _id: guild._id, languageLease: lease };
    const finish = { languageDueAt: 1, languageLease: 1 } as const;
    const scores = await scoreGuildLanguage(client, evidence, previous);
    const missing = (["structured", "decision"] as const).filter(method => scores[method] == null);
    const assessedAt = new Date();
    const retry = missing.length > 0;
    const action = guildLanguageAutoAction(scores);
    await mongoose.connection.transaction(async session => {
      // Commit the action, audit record and assessment together. A reclaimed lease or
      // concurrent manual review must never publish an automatic moderation action.
      if (action) {
        const reviewed = await ForeverGuild.findOneAndUpdate({ ...fence, ...guildsAwaitingLanguageReview }, {
          $set: { status: action, ...(action === "rejected" && { hidden: true }),
            autoReview: { action, reviewedAt: assessedAt, structured: scores.structured, decision: scores.decision!.percent } },
        }, { session, returnDocument: "after" }).select("region slug failures").lean();
        if (reviewed) {
          if (action === "approved") {
            // Match manual approval: queue a fresh roster without bypassing an upstream backoff.
            if (!reviewed.failures) await ForeverGuild.updateOne(fence, { $set: { nextFetchAt: assessedAt } }, { session });
          } else {
            await releaseRosterCoverage({ region: reviewed.region, rosterGuildSlug: reviewed.slug }, assessedAt, session);
            await ForeverWorker.updateOne({ _id: "armory" }, { $inc: { leaderboardRevision: 1 } }, { session, upsert: true });
          }
        }
      }
      await ForeverGuild.updateOne(fence, { $set: { languageAssessment: {
        ...scores, source, fingerprint, automationChecked: true, nameCount: members.length,
        assessedAt: previous?.structured != null && previous.decision != null && previous.source === source ? previous.assessedAt : assessedAt,
      }, ...(retry && { languageDueAt: new Date(assessedAt.getTime() + RETRY_DELAY_MS) }) },
      $unset: retry ? { languageLease: 1 } : finish }, { session, timestamps: false });
    });
    if (retry) logger.warn(`[Forever] Guild ${guild._id} missing ${missing.join(", ")} language results. Retry scheduled in one hour.`);
  }
}

export default new GuildLanguageWorker();
