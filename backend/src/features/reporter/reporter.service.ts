import mongoose from "mongoose";
import { CURRENT_RAID_IDS, PRIMARY_RAID_ID } from "../../config/guilds";
import CharacterLeaderboard from "../../models/CharacterLeaderboard";
import Event, { EventType } from "../../models/Event";
import Guild, { IRaidProgress } from "../../models/Guild";
import Pickem from "../../models/Pickem";
import { REPORTER_CONFIG } from "./reporter.config";
import { getReporterLinks, validateReporterContent } from "./reporter-content";
import { IReporterPost, ReporterGeneration, ReporterPost, ReporterSnapshot } from "./reporter.models";
import { generateReporterContent, ReporterOpenAIError } from "./reporter-openai";
import reporterSettingsService, { shouldAutoPublishReporterPost } from "./reporter-settings.service";
import {
  ReporterFact,
  ReporterGuildSnapshot,
  ReporterLink,
  ReporterPickemSnapshot,
  ReporterPlayerSnapshot,
  ReporterPostStatus,
  ReporterProgressSnapshot,
  ReporterRunSource,
} from "./reporter.types";

const DAY_MS = 24 * 60 * 60 * 1000;

type LeanGuild = {
  _id: mongoose.Types.ObjectId;
  name: string;
  realm: string;
  parent_guild?: string;
  excludedRaidIds?: number[];
  progress?: IRaidProgress[];
};

type LeanEvent = {
  type: EventType;
  guildId: mongoose.Types.ObjectId;
  guildName: string;
  guildRealm?: string;
  raidId: number;
  raidName: string;
  bossId?: number;
  bossName?: string;
  difficulty: "mythic" | "heroic";
  data: {
    killRank?: number;
    pullCount?: number;
    bestPercent?: number;
    progressDisplay?: string;
    hiatusDays?: number;
  };
  timestamp: Date;
};

type LeanLeaderboard = {
  name: string;
  realm: string;
  guildName?: string | null;
  guildRealm?: string | null;
  role: string;
  specName: string;
  score: number;
};

type LeanPickem = {
  pickemId: string;
  name: string;
  type: string;
  active: boolean;
  votingStart: Date;
  votingEnd: Date;
  finalized: boolean;
  updatedAt: Date;
};

function getHelsinkiDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: REPORTER_CONFIG.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function encodePath(value: string): string {
  return encodeURIComponent(value);
}

function guildUrl(realm: string, name: string): string {
  return `/guilds/${encodePath(realm)}/${encodePath(name)}`;
}

function characterUrl(realm: string, name: string): string {
  return `/characters/${encodePath(realm)}/${encodePath(name)}`;
}

function logUrl(reportCode: string, fightId: number): string {
  return `https://www.warcraftlogs.com/reports/${encodeURIComponent(reportCode)}#fight=${fightId}`;
}

function snapshotProgress(progress: IRaidProgress): ReporterProgressSnapshot {
  return {
    raidId: progress.raidId,
    raidName: progress.raidName,
    difficulty: progress.difficulty,
    bossesDefeated: progress.bossesDefeated,
    totalBosses: progress.totalBosses,
    guildRank: progress.guildRank,
    worldRank: progress.worldRank,
    bosses: progress.bosses.map((boss) => ({
      bossId: boss.bossId,
      bossName: boss.bossName,
      kills: boss.kills,
      bestPercent: boss.bestPercent,
      pullCount: boss.pullCount,
      firstKillTime: boss.firstKillTime?.toISOString(),
      firstKillReportCode: boss.firstKillReportCode,
      firstKillFightId: boss.firstKillFightId,
      bestPullReportCode: boss.bestPullReportCode,
      bestPullFightId: boss.bestPullFightId,
    })),
  };
}

function describeEvent(event: LeanEvent): string {
  const difficulty = event.difficulty === "mythic" ? "Mythic" : "Heroic";
  const boss = event.bossName || "an unnamed boss";
  const pulls = event.data.pullCount ? ` after ${event.data.pullCount} recorded pulls` : "";
  const progress = event.data.progressDisplay || (event.data.bestPercent !== undefined ? `${event.data.bestPercent.toFixed(1)}%` : "a new best");

  switch (event.type) {
    case "boss_kill":
      return `${event.guildName} killed ${boss} on ${difficulty}${pulls}${event.data.killRank ? `, recorded as tracked-guild kill rank ${event.data.killRank}` : ""}.`;
    case "best_pull":
      return `${event.guildName} improved its ${difficulty} ${boss} progress to ${progress}${pulls}.`;
    case "hiatus":
      return `${event.guildName} crossed the ${event.data.hiatusDays || "recorded"}-day inactivity threshold for ${event.raidName}.`;
    case "regress":
      return `${event.guildName} logged a ${difficulty} ${boss} regression event: a raid session with pulls but no progress improvement.`;
    case "reproge":
      return `${event.guildName} needed more than five pulls to re-kill ${boss} on ${difficulty}, recorded as re-progression.`;
    case "milestone":
      return `${event.guildName} reached a ${difficulty} milestone in ${event.raidName}.`;
  }
}

function buildFacts(input: {
  currentGuilds: ReporterGuildSnapshot[];
  previousGuilds: ReporterGuildSnapshot[];
  currentPlayers: ReporterPlayerSnapshot[];
  previousPlayers: ReporterPlayerSnapshot[];
  pickems: ReporterPickemSnapshot[];
  events: LeanEvent[];
  periodEnd: Date;
}): ReporterFact[] {
  let factNumber = 0;
  let linkNumber = 0;
  const facts: ReporterFact[] = [];
  const makeLink = (kind: ReporterLink["kind"], label: string, url: string): ReporterLink => ({
    ref: `L${++linkNumber}`,
    kind,
    label,
    url,
  });
  const addFact = (kind: string, summary: string, links: ReporterLink[], occurredAt?: string) => {
    facts.push({ id: `F${++factNumber}`, kind, summary, links, ...(occurredAt ? { occurredAt } : {}) });
  };

  const counts = new Map<EventType, number>();
  for (const event of input.events) counts.set(event.type, (counts.get(event.type) || 0) + 1);
  addFact(
    "scene_summary",
    `The seven-day window contains ${input.events.length} tracked events: ${counts.get("boss_kill") || 0} boss kills, ${counts.get("best_pull") || 0} best-pull improvements, ${counts.get("reproge") || 0} re-progression events, ${counts.get("regress") || 0} regression events, and ${counts.get("hiatus") || 0} inactivity events.`,
    [makeLink("event", "the event feed", "/events"), makeLink("analytics", "raid analytics", "/raid-analytics")],
  );

  const currentGuildMap = new Map(input.currentGuilds.map((guild) => [guild.guildId, guild]));
  for (const event of input.events.slice(0, 50)) {
    const guild = currentGuildMap.get(event.guildId.toString());
    const links = [makeLink("guild", event.guildName, guildUrl(guild?.realm || event.guildRealm || "unknown", event.guildName))];
    const progress = guild?.progress.find((entry) => entry.raidId === event.raidId && entry.difficulty === event.difficulty);
    const boss = progress?.bosses.find((entry) => entry.bossId === event.bossId);
    const reportCode = event.type === "boss_kill" ? boss?.firstKillReportCode : boss?.bestPullReportCode;
    const fightId = event.type === "boss_kill" ? boss?.firstKillFightId : boss?.bestPullFightId;
    if (reportCode && fightId) links.push(makeLink("log", `${event.bossName || "boss"} log`, logUrl(reportCode, fightId)));
    addFact(event.type, describeEvent(event), links, event.timestamp.toISOString());
  }

  for (const raidId of CURRENT_RAID_IDS) {
    const standings = input.currentGuilds
      .flatMap((guild) => guild.progress.filter((progress) => progress.raidId === raidId && progress.difficulty === "mythic").map((progress) => ({ guild, progress })))
      .sort((a, b) => (a.progress.guildRank ?? 999_999) - (b.progress.guildRank ?? 999_999) || b.progress.bossesDefeated - a.progress.bossesDefeated)
      .slice(0, 5);
    if (standings.length === 0) continue;
    addFact(
      "current_standings",
      `Current ${standings[0].progress.raidName} Mythic tracked-guild standings: ${standings
        .map(({ guild, progress }, index) => `${index + 1}. ${guild.name} ${progress.bossesDefeated}/${progress.totalBosses}${progress.guildRank ? ` (stored guild rank ${progress.guildRank})` : ""}`)
        .join("; ")}.`,
      standings.map(({ guild }) => makeLink("guild", guild.name, guildUrl(guild.realm, guild.name))),
    );
  }

  const previousGuildMap = new Map(input.previousGuilds.map((guild) => [guild.guildId, guild]));
  const movements: Array<{ importance: number; summary: string; guild: ReporterGuildSnapshot }> = [];
  for (const guild of input.currentGuilds) {
    const previous = previousGuildMap.get(guild.guildId);
    if (!previous) continue;
    for (const progress of guild.progress) {
      const old = previous.progress.find((entry) => entry.raidId === progress.raidId && entry.difficulty === progress.difficulty);
      if (!old) continue;
      const bossDelta = progress.bossesDefeated - old.bossesDefeated;
      const rankDelta = old.guildRank && progress.guildRank ? old.guildRank - progress.guildRank : 0;
      if (bossDelta === 0 && rankDelta === 0) continue;
      movements.push({
        importance: bossDelta * 100 + Math.abs(rankDelta),
        guild,
        summary: `${guild.name} moved from ${old.bossesDefeated}/${old.totalBosses} to ${progress.bossesDefeated}/${progress.totalBosses} in ${progress.raidName} ${progress.difficulty}${old.guildRank && progress.guildRank ? `; its stored tracked-guild rank changed from ${old.guildRank} to ${progress.guildRank}` : ""}.`,
      });
    }
  }
  for (const movement of movements.sort((a, b) => b.importance - a.importance).slice(0, 15)) {
    addFact("weekly_guild_movement", movement.summary, [makeLink("guild", movement.guild.name, guildUrl(movement.guild.realm, movement.guild.name))]);
  }

  const previousPlayerMap = new Map(input.previousPlayers.map((player) => [`${player.category}:${player.realm}:${player.name}`, player]));
  for (const player of input.currentPlayers.filter((entry) => entry.rank <= 3)) {
    const old = previousPlayerMap.get(`${player.category}:${player.realm}:${player.name}`);
    const movement = old ? `; one-week snapshot rank ${old.rank} to ${player.rank}, score ${old.score.toFixed(1)} to ${player.score.toFixed(1)}` : "";
    const links = [makeLink("character", player.name, characterUrl(player.realm, player.name))];
    if (player.guildName && player.guildRealm) links.push(makeLink("guild", player.guildName, guildUrl(player.guildRealm, player.guildName)));
    addFact(
      "player_leaderboard",
      `${player.name} is currently rank ${player.rank} in the ${player.category} Mythic all-stars snapshot for raid ${PRIMARY_RAID_ID}, playing ${player.specName}, with score ${player.score.toFixed(1)}${movement}.`,
      links,
    );
  }

  for (const pickem of input.pickems) {
    const now = input.periodEnd.getTime();
    const status = pickem.finalized ? "finalized" : now < new Date(pickem.votingStart).getTime() ? "not yet open" : now <= new Date(pickem.votingEnd).getTime() ? "open for voting" : "voting closed";
    addFact(
      "pickem_status",
      `${pickem.name} (${pickem.type}) is ${status}; voting window ${pickem.votingStart} to ${pickem.votingEnd}.`,
      [makeLink("pickem", pickem.name, "/pickems")],
    );
  }

  return facts;
}

async function captureSnapshot(periodStart: Date, periodEnd: Date, weekKey: string) {
  const guildQuery = Guild.find({}, { name: 1, realm: 1, parent_guild: 1, excludedRaidIds: 1, progress: 1 }).lean();
  const leaderboardBase = {
    zoneId: PRIMARY_RAID_ID,
    difficulty: 5,
    type: "allstars",
    encounterId: null,
    partition: null,
  } as const;

  const [rawGuilds, dps, healers, tanks, rawPickems] = await Promise.all([
    guildQuery,
    CharacterLeaderboard.find({ ...leaderboardBase, role: "dps", metric: "dps" }).sort({ score: -1 }).limit(5).lean(),
    CharacterLeaderboard.find({ ...leaderboardBase, role: "healer", metric: "hps" }).sort({ score: -1 }).limit(5).lean(),
    CharacterLeaderboard.find({ ...leaderboardBase, role: "tank", metric: "dps" }).sort({ score: -1 }).limit(5).lean(),
    Pickem.find({ $or: [{ active: true }, { updatedAt: { $gte: periodStart } }] }).sort({ votingStart: -1 }).lean(),
  ]);

  const guilds: ReporterGuildSnapshot[] = (rawGuilds as unknown as LeanGuild[])
    .map((guild) => ({
      guildId: guild._id.toString(),
      name: guild.name,
      realm: guild.realm,
      parentGuild: guild.parent_guild,
      progress: (guild.progress || [])
        .filter((progress) => CURRENT_RAID_IDS.includes(progress.raidId) && !(guild.excludedRaidIds || []).includes(progress.raidId))
        .map(snapshotProgress),
    }))
    .filter((guild) => guild.progress.length > 0);

  const mapPlayers = (category: ReporterPlayerSnapshot["category"], entries: unknown[]): ReporterPlayerSnapshot[] =>
    (entries as LeanLeaderboard[]).map((entry, index) => ({
      category,
      rank: index + 1,
      name: entry.name,
      realm: entry.realm,
      guildName: entry.guildName || undefined,
      guildRealm: entry.guildRealm || undefined,
      role: entry.role,
      specName: entry.specName,
      score: entry.score,
    }));

  const players = [...mapPlayers("dps", dps as unknown[]), ...mapPlayers("healer", healers as unknown[]), ...mapPlayers("tank", tanks as unknown[])];
  const pickems: ReporterPickemSnapshot[] = (rawPickems as unknown as LeanPickem[]).map((pickem) => ({
    pickemId: pickem.pickemId,
    name: pickem.name,
    type: pickem.type,
    active: pickem.active,
    votingStart: pickem.votingStart.toISOString(),
    votingEnd: pickem.votingEnd.toISOString(),
    finalized: pickem.finalized,
    updatedAt: pickem.updatedAt.toISOString(),
  }));

  return ReporterSnapshot.create({ weekKey, capturedAt: periodEnd, periodStart, periodEnd, guilds, players, pickems });
}

function serializePost(post: IReporterPost, includeFacts: boolean) {
  const data = post.toObject();
  return {
    id: post._id.toString(),
    weekKey: data.weekKey,
    slug: data.slug,
    status: data.status,
    periodStart: data.periodStart,
    periodEnd: data.periodEnd,
    content: data.content,
    usage: data.usage,
    publishedAt: data.publishedAt,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    links: getReporterLinks(data.facts),
    ...(includeFacts
      ? {
          facts: data.facts,
          snapshotId: data.snapshotId,
          previousSnapshotId: data.previousSnapshotId,
          generationId: data.generationId,
        }
      : {}),
  };
}

class ReporterService {
  async generateWeeklyPost(source: ReporterRunSource) {
    const settings = await reporterSettingsService.get();
    if (!settings.featureEnabled) throw new Error("Reporter feature is disabled");
    if (source === "cron" && !settings.automationEnabled) throw new Error("Reporter weekly automation is disabled");
    const periodEnd = new Date();
    const periodStart = new Date(periodEnd.getTime() - 7 * DAY_MS);
    const weekKey = getHelsinkiDateKey(periodEnd);
    const existing = await ReporterPost.findOne({ weekKey });
    if (existing?.status === "published") throw new Error("This week's Reporter article is published; move it back to draft before regenerating");

    const previousSnapshot = await ReporterSnapshot.findOne({
      capturedAt: {
        $gte: new Date(periodEnd.getTime() - 9 * DAY_MS),
        $lte: new Date(periodEnd.getTime() - 5 * DAY_MS),
      },
    }).sort({ capturedAt: -1 });
    const snapshot = await captureSnapshot(periodStart, periodEnd, weekKey);
    const events = (await Event.find({ timestamp: { $gte: periodStart, $lte: periodEnd }, raidId: { $in: CURRENT_RAID_IDS } })
      .sort({ timestamp: -1 })
      .limit(60)
      .lean()) as unknown as LeanEvent[];
    const facts = buildFacts({
      currentGuilds: snapshot.guilds,
      previousGuilds: previousSnapshot?.guilds || [],
      currentPlayers: snapshot.players,
      previousPlayers: previousSnapshot?.players || [],
      pickems: snapshot.pickems,
      events,
      periodEnd,
    });

    const startedAt = new Date();
    const generation = await ReporterGeneration.create({
      weekKey,
      source,
      status: "running",
      modelId: REPORTER_CONFIG.model,
      reasoningEffort: REPORTER_CONFIG.reasoningEffort,
      promptVersion: REPORTER_CONFIG.promptVersion,
      snapshotId: snapshot._id,
      startedAt,
    });

    try {
      const result = await generateReporterContent({ periodStart, periodEnd, facts });
      generation.responseId = result.responseId;
      generation.usage = result.usage;
      validateReporterContent(result.content, facts);
      const autoPublish = shouldAutoPublishReporterPost(source, settings);

      const postUpdate: Record<string, Record<string, unknown>> = {
        $set: {
          slug: weekKey,
          status: autoPublish ? "published" : "draft",
          periodStart,
          periodEnd,
          snapshotId: snapshot._id,
          generationId: generation._id,
          facts,
          content: result.content,
          usage: result.usage,
        },
        $setOnInsert: { weekKey },
      };
      if (previousSnapshot) {
        postUpdate.$set.previousSnapshotId = previousSnapshot._id;
      } else {
        postUpdate.$unset = { previousSnapshotId: 1 };
      }
      if (autoPublish) {
        postUpdate.$set.publishedAt = periodEnd;
      } else {
        postUpdate.$unset = { ...(postUpdate.$unset || {}), publishedAt: 1 };
      }

      const post = await ReporterPost.findOneAndUpdate(
        { weekKey },
        postUpdate,
        { upsert: true, new: true, runValidators: true },
      );
      if (!post) throw new Error("Reporter article could not be saved");

      generation.status = "completed";
      generation.completedAt = new Date();
      generation.durationMs = generation.completedAt.getTime() - startedAt.getTime();
      await generation.save();
      return serializePost(post, true);
    } catch (error) {
      if (error instanceof ReporterOpenAIError) {
        generation.responseId = error.responseId;
        generation.usage = error.usage;
      }
      generation.status = "failed";
      generation.error = error instanceof Error ? error.message : String(error);
      generation.completedAt = new Date();
      generation.durationMs = generation.completedAt.getTime() - startedAt.getTime();
      await generation.save();
      throw error;
    }
  }

  async getAdminStatus() {
    const [settings, postCount, draftCount, publishedCount, generationTotals] = await Promise.all([
      reporterSettingsService.get(),
      ReporterPost.countDocuments(),
      ReporterPost.countDocuments({ status: "draft" }),
      ReporterPost.countDocuments({ status: "published" }),
      ReporterGeneration.aggregate<{
        attempts: number;
        completed: number;
        failed: number;
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        estimatedCostUsd: number;
      }>([
        {
          $group: {
            _id: null,
            attempts: { $sum: 1 },
            completed: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } },
            failed: { $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] } },
            inputTokens: { $sum: { $ifNull: ["$usage.inputTokens", 0] } },
            outputTokens: { $sum: { $ifNull: ["$usage.outputTokens", 0] } },
            totalTokens: { $sum: { $ifNull: ["$usage.totalTokens", 0] } },
            estimatedCostUsd: { $sum: { $ifNull: ["$usage.estimatedCostUsd", 0] } },
          },
        },
      ]),
    ]);
    return {
      config: {
        featureEnabled: settings.featureEnabled,
        automationEnabled: settings.automationEnabled,
        autoPublish: settings.autoPublish,
        settingsUpdatedAt: settings.updatedAt,
        apiKeyConfigured: Boolean(process.env.OPENAI_API_KEY?.trim()),
        schedule: REPORTER_CONFIG.schedule,
        timeZone: REPORTER_CONFIG.timeZone,
        model: REPORTER_CONFIG.model,
        reasoningEffort: REPORTER_CONFIG.reasoningEffort,
        promptVersion: REPORTER_CONFIG.promptVersion,
        pricing: REPORTER_CONFIG.pricing,
      },
      posts: { total: postCount, drafts: draftCount, published: publishedCount },
      usage: generationTotals[0] || { attempts: 0, completed: 0, failed: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0 },
    };
  }

  async listAdminPosts() {
    const posts = await ReporterPost.find().sort({ periodEnd: -1 }).limit(50);
    return posts.map((post) => serializePost(post, true));
  }

  async updatePostStatus(id: string, status: ReporterPostStatus) {
    if (!mongoose.isValidObjectId(id)) throw new Error("Invalid Reporter post ID");
    const post = await ReporterPost.findByIdAndUpdate(
      id,
      status === "published" ? { $set: { status, publishedAt: new Date() } } : { $set: { status }, $unset: { publishedAt: 1 } },
      { new: true, runValidators: true },
    );
    if (!post) throw new Error("Reporter post not found");
    return serializePost(post, true);
  }

  async listPublishedPosts() {
    const posts = await ReporterPost.find({ status: "published" }).sort({ publishedAt: -1 }).limit(30);
    return posts.map((post) => serializePost(post, false));
  }

  async getPublishedPost(slug: string) {
    const post = await ReporterPost.findOne({ slug, status: "published" });
    return post ? serializePost(post, false) : null;
  }
}

export default new ReporterService();
