import Guild, { IBossProgress, IGuild, IRaidProgress } from "../models/Guild";
import { CURRENT_RAID_IDS } from "../config/guilds";
import { compareRaidIdsByPriority } from "../utils/raidPriority";
import searchService, { SearchResult } from "./search.service";

export type TwitchChatCommandName = "best" | "search";

export interface ParsedTwitchChatCommand {
  name: TwitchChatCommandName;
  args: string;
}

export interface TwitchChatCommandOptions {
  includeUrl: boolean;
}

type GuildLookupResult = Pick<IGuild, "name" | "realm" | "region" | "isCurrentlyRaiding" | "progress" | "officialProgress"> & {
  _id: unknown;
};

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

class TwitchChatCommandService {
  parse(text: string): ParsedTwitchChatCommand | null {
    const trimmed = text.trim();
    const match = /^!(best|paras|search)(?:\s+(.*))?$/i.exec(trimmed);
    if (!match) {
      return null;
    }

    return {
      name: match[1].toLowerCase() === "search" ? "search" : "best",
      args: (match[2] || "").trim(),
    };
  }

  async handle(command: ParsedTwitchChatCommand, channelName: string, options: TwitchChatCommandOptions): Promise<string | null> {
    if (command.name === "search") {
      return this.handleSearch(command.args, options);
    }

    return this.handleBest(command.args, channelName, options);
  }

  private async handleSearch(query: string, options: TwitchChatCommandOptions): Promise<string> {
    if (query.trim().length < 2) {
      return "Usage: !search <guild or character>";
    }

    const results = await searchService.searchForBotCommand(query, 5);
    if (results.length === 0) {
      return `No guilds or characters found for "${query}".`;
    }

    const formatted = results.map((result) => this.formatSearchResult(result, options)).join(" | ");
    return this.limitMessage(`Found: ${formatted}`);
  }

  private async handleBest(query: string, channelName: string, options: TwitchChatCommandOptions): Promise<string> {
    const guild = query.trim().length > 0 ? await this.findGuildFromQuery(query) : await this.findGuildForChannel(channelName);

    if (!guild) {
      return query.trim().length > 0
        ? `No tracked guild found for "${query}". Try !search ${query}`
        : "I could not tell which guild this stream belongs to. Try !best <guild>";
    }

    return this.limitMessage(this.formatBestPull(guild, options));
  }

  private async findGuildForChannel(channelName: string): Promise<GuildLookupResult | null> {
    const channelRegex = new RegExp(`^${escapeRegex(channelName)}$`, "i");
    const guilds = (await Guild.find({ "streamers.channelName": channelRegex })
      .select("name realm region isCurrentlyRaiding progress officialProgress streamers")
      .lean()) as Array<GuildLookupResult & { streamers?: Array<{ channelName: string; isLive: boolean; isPlayingWoW: boolean }> }>;

    if (guilds.length === 0) {
      return null;
    }

    const activelyRaiding = guilds.filter((guild) => guild.isCurrentlyRaiding);
    const liveForThisChannel = activelyRaiding.filter((guild) =>
      (guild.streamers || []).some((streamer) => streamer.isLive && streamer.isPlayingWoW && streamer.channelName.toLowerCase() === channelName.toLowerCase()),
    );

    if (liveForThisChannel.length === 1) {
      return liveForThisChannel[0];
    }

    if (activelyRaiding.length === 1) {
      return activelyRaiding[0];
    }

    if (guilds.length === 1) {
      return guilds[0];
    }

    return null;
  }

  private async findGuildFromQuery(query: string): Promise<GuildLookupResult | null> {
    const results = await searchService.searchForBotCommand(query, 5);
    if (results.length === 0) {
      return null;
    }

    const guildResult = results[0].type === "guild" ? results[0] : results[0].guild ? { ...results[0].guild, type: "guild" as const } : null;
    if (!guildResult) {
      return null;
    }

    return (await Guild.findOne({
      name: new RegExp(`^${escapeRegex(guildResult.name)}$`, "i"),
      realm: new RegExp(`^${escapeRegex(guildResult.realm)}$`, "i"),
    })
      .select("name realm region isCurrentlyRaiding progress officialProgress")
      .lean()) as GuildLookupResult | null;
  }

  private formatBestPull(guild: GuildLookupResult, options: TwitchChatCommandOptions): string {
    const progress = this.selectBestProgress(guild.progress || []);
    const guildUrl = `${this.getFrontendBaseUrl()}/guilds/${encodeURIComponent(guild.realm)}/${encodeURIComponent(guild.name)}`;
    const urlSuffix = options.includeUrl ? ` ${guildUrl}` : "";

    if (!progress) {
      const official = this.selectOfficialProgress(guild);
      if (official) {
        return `${guild.name}: official progress ${official.summary}.${urlSuffix}`;
      }

      return `${guild.name}: no current raid progress found yet.${urlSuffix}`;
    }

    const difficulty = progress.difficulty === "mythic" ? "M" : "HC";
    const summary = `${progress.bossesDefeated}/${progress.totalBosses} ${difficulty}`;
    const nextBoss = (progress.bosses || []).find((boss) => boss.kills === 0);

    if (!nextBoss) {
      const lastKill = this.findLastKilledBoss(progress);
      if (lastKill) {
        return `${guild.name} ${summary}, raid cleared. Last kill: ${lastKill.bossName} after ${lastKill.pullCount} pulls.${urlSuffix}`;
      }

      return `${guild.name} ${summary}, raid cleared.${urlSuffix}`;
    }

    if (nextBoss.pullCount <= 0 && nextBoss.bestPercent >= 100) {
      return `${guild.name} ${summary}, next: ${nextBoss.bossName}. No logged pulls yet.${urlSuffix}`;
    }

    const progressDisplay = this.formatBossProgress(nextBoss);
    return `${guild.name} ${summary}, ${nextBoss.bossName}: ${progressDisplay} after ${nextBoss.pullCount} pulls.${urlSuffix}`;
  }

  private selectBestProgress(progress: IRaidProgress[]): IRaidProgress | null {
    const sorted = [...progress]
      .filter((raidProgress) => raidProgress.totalBosses > 0)
      .sort((a, b) => {
        const currentDiff = Number(CURRENT_RAID_IDS.includes(b.raidId)) - Number(CURRENT_RAID_IDS.includes(a.raidId));
        if (currentDiff !== 0) return currentDiff;

        const difficultyDiff = this.getDifficultyRank(b.difficulty) - this.getDifficultyRank(a.difficulty);
        if (difficultyDiff !== 0) return difficultyDiff;

        const raidDiff = compareRaidIdsByPriority(a.raidId, b.raidId);
        if (raidDiff !== 0) return raidDiff;

        return b.bossesDefeated - a.bossesDefeated;
      });

    return sorted[0] || null;
  }

  private selectOfficialProgress(guild: GuildLookupResult): { summary: string } | null {
    const progress = guild.officialProgress || [];
    if (progress.length === 0) {
      return null;
    }

    return [...progress].sort((a, b) => b.mythicBossesKilled - a.mythicBossesKilled || b.heroicBossesKilled - a.heroicBossesKilled)[0];
  }

  private findLastKilledBoss(progress: IRaidProgress): IBossProgress | null {
    const killedBosses = (progress.bosses || []).filter((boss) => boss.kills > 0);
    if (killedBosses.length === 0) {
      return null;
    }

    return killedBosses.sort((a, b) => {
      const orderDiff = (b.killOrder || 0) - (a.killOrder || 0);
      if (orderDiff !== 0) return orderDiff;

      return (b.firstKillTime?.getTime() || 0) - (a.firstKillTime?.getTime() || 0);
    })[0];
  }

  private formatBossProgress(boss: IBossProgress): string {
    if (boss.bestPullPhase?.displayString) {
      return boss.bestPullPhase.displayString;
    }

    if (Number.isFinite(boss.bestPercent)) {
      return `${boss.bestPercent.toFixed(1)}%`;
    }

    return "no best pull recorded";
  }

  private getDifficultyRank(difficulty: IRaidProgress["difficulty"]): number {
    return difficulty === "mythic" ? 2 : 1;
  }

  private formatSearchResult(result: SearchResult, options: TwitchChatCommandOptions): string {
    const title = `${result.name}-${this.formatRealmName(result.realm)}`;
    const url = `${this.getFrontendBaseUrl()}${result.href}`;
    const urlSuffix = options.includeUrl ? ` ${url}` : "";

    if (result.type === "character" && result.guild) {
      return `${title} (character, ${result.guild.name}-${this.formatRealmName(result.guild.realm)})${urlSuffix}`;
    }

    return `${title} (${result.type})${urlSuffix}`;
  }

  private formatRealmName(value: string): string {
    return value
      .split("-")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(" ");
  }

  private limitMessage(message: string): string {
    const normalized = message.replace(/\s+/g, " ").trim();
    return normalized.length <= 450 ? normalized : `${normalized.slice(0, 447)}...`;
  }

  private getFrontendBaseUrl(): string {
    if (process.env.PUBLIC_BASE_URL) {
      return process.env.PUBLIC_BASE_URL.replace(/\/$/, "");
    }

    return process.env.NODE_ENV === "production" ? "https://suomiwow.vaarattu.tv" : "http://localhost:3000";
  }
}

export default new TwitchChatCommandService();
