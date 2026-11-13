import { createHash, randomUUID } from "node:crypto";
import OpenAI from "openai";
import logger from "../../utils/logger";
import { ForeverCharacter, ForeverGuild } from "./forever.models";
import { ForeverError } from "./forever-errors";
import { GUILD_LANGUAGE_MODEL, GUILD_LANGUAGE_VERSION, scoreGuildLanguage } from "./forever-guild-language";

export async function queueGuildLanguageAssessments() {
  if (!process.env.OPENAI_API_KEY?.trim()) throw new ForeverError("openai_not_configured", 503);
  const result = await ForeverGuild.updateMany({ languageDueAt: null }, { $set: { languageDueAt: new Date() } }, { timestamps: false });
  return { queued: result.modifiedCount };
}

export class GuildLanguageWorker {
  private timer?: NodeJS.Timeout;
  private active?: Promise<void>;

  start() {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (this.timer || !apiKey) return;
    const client = new OpenAI({ apiKey, timeout: 45_000, maxRetries: 0 });
    const poll = () => {
      if (this.active) return;
      this.active = this.tick(client).catch(() => { logger.error("[Forever] Guild language assessment could not be saved"); })
        .finally(() => { this.active = undefined; });
    };
    this.timer = setInterval(poll, 3_000);
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
    const guild = await ForeverGuild.findOneAndUpdate({ languageDueAt: { $lte: new Date() } },
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
    if (previous?.plain != null && previous.structured != null && previous.decision != null && previous.source === source) {
      await ForeverGuild.updateOne(fence, { $unset: finish }, { timestamps: false });
      return;
    }
    const scores = await scoreGuildLanguage(client, evidence, previous);
    await ForeverGuild.updateOne(fence, { $set: { languageAssessment: {
      ...scores, source, fingerprint, assessedAt: new Date(), nameCount: members.length,
    } }, $unset: finish }, { timestamps: false });
  }
}

export default new GuildLanguageWorker();
