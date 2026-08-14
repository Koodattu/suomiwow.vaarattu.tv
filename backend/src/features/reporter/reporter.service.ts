import mongoose from "mongoose";
import { CLASSES } from "../../config/classes";
import { CURRENT_RAID_IDS, PRIMARY_RAID_ID } from "../../config/guilds";
import CharacterLeaderboard from "../../models/CharacterLeaderboard";
import Event, { EventType } from "../../models/Event";
import Fight from "../../models/Fight";
import Guild, { IGuildCrest, IRaidProgress } from "../../models/Guild";
import Pickem from "../../models/Pickem";
import Raid from "../../models/Raid";
import RaidAnalytics from "../../models/RaidAnalytics";
import mythicPlusService from "../../services/mythic-plus.service";
import logger from "../../utils/logger";
import { REPORTER_CONFIG } from "./reporter.config";
import { getReporterLinks, validateReporterContent } from "./reporter-content";
import { IReporterPost, ReporterGeneration, ReporterPost, ReporterSnapshot } from "./reporter.models";
import { generateReporterContent, ReporterOpenAIError } from "./reporter-openai";
import reporterSettingsService, { shouldAutoPublishReporterPost } from "./reporter-settings.service";
import {
  ReporterFact,
  ReporterGuildSnapshot,
  ReporterLink,
  ReporterLinkVisual,
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
  faction?: string;
  crest?: IGuildCrest;
  parent_guild?: string;
  excludedRaidIds?: number[];
  progress?: IRaidProgress[];
};

type LeanRaidVisuals = {
  id: number;
  name: string;
  iconUrl?: string;
  starts?: { eu?: Date };
  ends?: { eu?: Date };
  bosses: Array<{ id: number; name: string; iconUrl?: string; totalPhases?: number }>;
};

type LeanRaidAnalytics = {
  raidId: number;
  bosses: Array<{
    bossId: number;
    bossName: string;
    guildsKilled: number;
    pullCount: { average: number; lowest: number; highest: number };
  }>;
};

type MythicPlusReporterContext = {
  seasonSlug: string;
  seasonName: string;
  leaders: Array<{
    rank: number;
    name: string;
    realm: string;
    classId: number;
    guildName?: string;
    guildRealm?: string;
    score: number;
    specName?: string;
  }>;
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
  classID: number;
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

function formatOneDecimal(value: unknown): string | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(1) : undefined;
}

function logUrl(reportCode: string, fightId: number): string {
  return `https://www.warcraftlogs.com/reports/${encodeURIComponent(reportCode)}#fight=${fightId}`;
}

function hasReporterColor(color: IGuildCrest["emblem"]["color"] | undefined): color is IGuildCrest["emblem"]["color"] {
  return Boolean(color && [color.r, color.g, color.b, color.a].every((value) => typeof value === "number" && Number.isFinite(value)));
}

function snapshotGuildCrest(crest?: IGuildCrest): IGuildCrest | undefined {
  if (
    !crest?.emblem?.imageName ||
    !crest.border?.imageName ||
    !hasReporterColor(crest.emblem.color) ||
    !hasReporterColor(crest.border.color) ||
    !hasReporterColor(crest.background?.color)
  ) {
    return undefined;
  }
  return crest;
}

function snapshotProgress(progress: IRaidProgress, raid?: LeanRaidVisuals): ReporterProgressSnapshot {
  return {
    raidId: progress.raidId,
    raidName: progress.raidName,
    iconUrl: raid?.iconUrl,
    difficulty: progress.difficulty,
    bossesDefeated: progress.bossesDefeated,
    totalBosses: progress.totalBosses,
    guildRank: progress.guildRank,
    worldRank: progress.worldRank,
    bosses: progress.bosses.map((boss) => {
      const raidBoss = raid?.bosses.find((entry) => entry.id === boss.bossId) || raid?.bosses.find((entry) => entry.name === boss.bossName);
      return {
        bossId: boss.bossId,
        bossName: boss.bossName,
        iconUrl: raidBoss?.iconUrl,
        kills: boss.kills,
        bestPercent: boss.bestPercent,
        pullCount: boss.pullCount,
        firstKillTime: boss.firstKillTime?.toISOString(),
        firstKillReportCode: boss.firstKillReportCode,
        firstKillFightId: boss.firstKillFightId,
        bestPullReportCode: boss.bestPullReportCode,
        bestPullFightId: boss.bestPullFightId,
        totalPhases: raidBoss?.totalPhases,
        bestPullPhase: boss.bestPullPhase
          ? {
              phaseId: boss.bestPullPhase.phaseId,
              phaseName: boss.bestPullPhase.phaseName,
              bossHealth: boss.bestPullPhase.bossHealth,
              fightCompletion: boss.bestPullPhase.fightCompletion,
              displayString: boss.bestPullPhase.displayString,
            }
          : undefined,
      };
    }),
  };
}

function describeEvent(event: LeanEvent): string {
  const difficulty = event.difficulty === "mythic" ? "Mythic" : "Heroic";
  const boss = event.bossName || "an unnamed boss";
  const pulls = event.data.pullCount ? ` at ${event.data.pullCount} total recorded pulls` : "";
  const bestPercent = formatOneDecimal(event.data.bestPercent);
  const progress = event.data.progressDisplay || (bestPercent ? `${bestPercent}%` : "a new best");

  switch (event.type) {
    case "boss_kill":
      return `${event.guildName} killed ${boss} on ${difficulty}${pulls}${event.data.killRank ? `, recorded as tracked-guild kill rank ${event.data.killRank}` : ""}.`;
    case "best_pull":
      return `${event.guildName} moved its ${difficulty} ${boss} best pull to ${progress}${pulls}.`;
    case "hiatus":
      return `${event.guildName} reached ${event.data.hiatusDays || "several"} days without a tracked raid log in ${event.raidName}.`;
    case "regress":
      return `${event.guildName} pulled ${difficulty} ${boss} during a raid night without beating its previous best.`;
    case "reproge":
      return `${event.guildName} needed more than five pulls to kill ${difficulty} ${boss} again.`;
    case "milestone":
      return `${event.guildName} reached a ${difficulty} milestone in ${event.raidName}.`;
  }
}

function getProgressPhaseNumber(progressDisplay?: string): number | undefined {
  const match = progressDisplay?.match(/\b(?:stage|phase)\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b/i);
  if (!match) return undefined;
  const phaseNumber =
    { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 }[match[1].toLowerCase()] || Number(match[1]);
  return Number.isInteger(phaseNumber) && phaseNumber > 0 ? phaseNumber : undefined;
}

function getProgressPhaseLabel(progressDisplay?: string): string | undefined {
  const phaseNumber = getProgressPhaseNumber(progressDisplay);
  return phaseNumber ? `P${phaseNumber}` : undefined;
}

export function buildReporterFacts(input: {
  currentGuilds: ReporterGuildSnapshot[];
  previousGuilds: ReporterGuildSnapshot[];
  currentPlayers: ReporterPlayerSnapshot[];
  previousPlayers: ReporterPlayerSnapshot[];
  pickems: ReporterPickemSnapshot[];
  events: LeanEvent[];
  raids: LeanRaidVisuals[];
  raidAnalytics: LeanRaidAnalytics[];
  mythicPlus?: MythicPlusReporterContext;
  periodStart: Date;
  periodEnd: Date;
}): ReporterFact[] {
  let factNumber = 0;
  let linkNumber = 0;
  const facts: ReporterFact[] = [];
  const makeLink = (kind: ReporterLink["kind"], label: string, url: string, visual?: ReporterLinkVisual): ReporterLink => ({
    ref: `L${++linkNumber}`,
    kind,
    label,
    url,
    ...(visual ? { visual } : {}),
  });
  const guildVisual = (guild?: ReporterGuildSnapshot): ReporterLinkVisual | undefined =>
    guild?.crest ? { type: "guild-crest", crest: guild.crest, ...(guild.faction ? { faction: guild.faction } : {}) } : undefined;
  const addFact = (kind: string, summary: string, links: ReporterLink[], occurredAt?: string) => {
    facts.push({ id: `F${++factNumber}`, kind, summary, links, ...(occurredAt ? { occurredAt } : {}) });
  };
  const uniqueLinks = (links: ReporterLink[]) => {
    const byTarget = new Map<string, ReporterLink>();
    for (const link of links) {
      const key = `${link.kind}:${link.url}:${link.label}`;
      if (!byTarget.has(key)) byTarget.set(key, link);
    }
    return [...byTarget.values()];
  };

  const raidMap = new Map(input.raids.map((raid) => [raid.id, raid]));
  const raidAnalyticsMap = new Map(input.raidAnalytics.map((analytics) => [analytics.raidId, analytics]));
  const currentGuildMap = new Map(input.currentGuilds.map((guild) => [guild.guildId, guild]));
  const currentGuildIdentityMap = new Map(input.currentGuilds.map((guild) => [`${guild.realm.toLowerCase()}:${guild.name.toLowerCase()}`, guild]));
  const getEventGuild = (event: LeanEvent) =>
    currentGuildMap.get(event.guildId.toString()) ||
    currentGuildIdentityMap.get(`${(event.guildRealm || "").toLowerCase()}:${event.guildName.toLowerCase()}`);
  const getEventLinks = (event: LeanEvent, includeLog: boolean): ReporterLink[] => {
    const guild = getEventGuild(event);
    const raid = raidMap.get(event.raidId);
    const links = [makeLink("guild", event.guildName, guildUrl(guild?.realm || event.guildRealm || "unknown", event.guildName), guildVisual(guild))];
    if (raid) {
      links.push(makeLink("analytics", raid.name, "/raid-analytics", raid.iconUrl ? { type: "icon", iconUrl: raid.iconUrl } : undefined));
    }
    const progress = guild?.progress.find((entry) => entry.raidId === event.raidId && entry.difficulty === event.difficulty);
    const boss = progress?.bosses.find((entry) => entry.bossId === event.bossId);
    const raidBoss = raid?.bosses.find((entry) => entry.id === event.bossId) || raid?.bosses.find((entry) => entry.name === event.bossName);
    if (!includeLog) {
      if (event.bossName) {
        links.push(makeLink("boss", event.bossName, "/raid-analytics", raidBoss?.iconUrl ? { type: "icon", iconUrl: raidBoss.iconUrl } : undefined));
      }
      return links;
    }
    const reportCode = event.type === "boss_kill" ? boss?.firstKillReportCode : boss?.bestPullReportCode;
    const fightId = event.type === "boss_kill" ? boss?.firstKillFightId : boss?.bestPullFightId;
    if (reportCode && fightId) {
      links.push(
        makeLink(
          "log",
          event.bossName || boss?.bossName || "boss",
          logUrl(reportCode, fightId),
          boss?.iconUrl ? { type: "icon", iconUrl: boss.iconUrl, provider: "wcl" } : { type: "wcl" },
        ),
      );
    } else if (event.bossName) {
      links.push(makeLink("boss", event.bossName, "/raid-analytics", raidBoss?.iconUrl ? { type: "icon", iconUrl: raidBoss.iconUrl } : undefined));
    }
    return links;
  };

  const counts = new Map<EventType, number>();
  for (const event of input.events) counts.set(event.type, (counts.get(event.type) || 0) + 1);
  const primaryRaid = input.currentGuilds.flatMap((guild) => guild.progress).find((progress) => progress.raidId === PRIMARY_RAID_ID);
  const primaryRaidName = primaryRaid?.raidName || raidMap.get(PRIMARY_RAID_ID)?.name || "the primary tracked raid";
  addFact(
    "scene_summary",
    `Seven-day context: ${counts.get("boss_kill") || 0} new boss kills, ${counts.get("best_pull") || 0} best-pull improvements, ${counts.get("reproge") || 0} tracked guild-boss reclears that took more than five pulls, ${counts.get("regress") || 0} raid nights without a new best, and ${counts.get("hiatus") || 0} newly recorded long breaks from raiding.`,
    [
      makeLink("event", "the event feed", "/events"),
      makeLink(
        "analytics",
        primaryRaid ? primaryRaid.raidName : "raid analytics",
        "/raid-analytics",
        primaryRaid?.iconUrl ? { type: "icon", iconUrl: primaryRaid.iconUrl } : undefined,
      ),
    ],
  );

  for (const raid of input.raids) {
    const startsAt = raid.starts?.eu;
    const endsAt = raid.ends?.eu;
    if (!startsAt && !endsAt) continue;
    const elapsedDays = startsAt && startsAt <= input.periodEnd ? Math.floor((input.periodEnd.getTime() - startsAt.getTime()) / DAY_MS) : undefined;
    const remainingDays = endsAt && endsAt > input.periodEnd ? Math.ceil((endsAt.getTime() - input.periodEnd.getTime()) / DAY_MS) : undefined;
    addFact(
      "raid_timeline_context",
      `${raid.name} EU raid window: start ${startsAt ? startsAt.toISOString() : "not stored"}; end ${endsAt ? endsAt.toISOString() : "not stored"}${elapsedDays !== undefined ? `; ${elapsedDays} full days had elapsed since opening at the end of this reporting period` : ""}${remainingDays !== undefined ? `; ${remainingDays} days remained until the stored end date` : ""}.`,
      [makeLink("analytics", raid.name, "/raid-analytics", raid.iconUrl ? { type: "icon", iconUrl: raid.iconUrl } : undefined)],
    );
  }

  const bestPullGroups = new Map<string, LeanEvent[]>();
  const reclearEvents: LeanEvent[] = [];
  const otherEvents: LeanEvent[] = [];
  for (const event of input.events.slice(0, 50)) {
    if (event.type === "best_pull") {
      const key = `${event.guildId}:${event.raidId}:${event.bossId ?? event.bossName}:${event.difficulty}`;
      bestPullGroups.set(key, [...(bestPullGroups.get(key) || []), event]);
    } else if (event.type === "reproge") {
      reclearEvents.push(event);
    } else {
      otherEvents.push(event);
    }
  }

  for (const events of [...bestPullGroups.values()].sort((a, b) => b[0].timestamp.getTime() - a[0].timestamp.getTime())) {
    const ordered = [...events].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    const latest = ordered[ordered.length - 1];
    const latestGuild = getEventGuild(latest);
    const latestProgress = latestGuild?.progress.find((entry) => entry.raidId === latest.raidId && entry.difficulty === latest.difficulty);
    const latestBoss = latestProgress?.bosses.find((entry) => entry.bossId === latest.bossId);
    const phaseContext = latestBoss?.bestPullPhase;
    const latestPhaseNumber = getProgressPhaseNumber(phaseContext?.phaseName) || getProgressPhaseNumber(phaseContext?.displayString) || getProgressPhaseNumber(latest.data.progressDisplay);
    const latestPhase = latestPhaseNumber ? `P${latestPhaseNumber}` : undefined;
    const fightCompletion = formatOneDecimal(phaseContext?.fightCompletion);
    const bossHealth = formatOneDecimal(phaseContext?.bossHealth);
    const progressMeasure = fightCompletion ? "overall fight progress remaining" : "stored progress remaining";
    const points = ordered.map((event) => {
      const bestPercent = formatOneDecimal(event.data.bestPercent);
      const progress = bestPercent ? `${bestPercent}%` : event.data.progressDisplay || "a new best";
      return event.data.pullCount ? `${progress} ${progressMeasure} at ${event.data.pullCount} total pulls` : `${progress} ${progressMeasure}`;
    });
    const phasePosition = latestPhaseNumber && latestBoss?.totalPhases ? `P${latestPhaseNumber} of ${latestBoss.totalPhases}` : latestPhase;
    const phaseCaveat =
      latestPhaseNumber && latestBoss?.totalPhases
        ? latestPhaseNumber < latestBoss.totalPhases
          ? latestPhaseNumber + 1 === latestBoss.totalPhases
            ? ` P${latestPhaseNumber} was not the final phase; P${latestBoss.totalPhases}, the final phase, remained.`
            : ` P${latestPhaseNumber} was not the final phase; P${latestPhaseNumber + 1}-P${latestBoss.totalPhases} remained.`
          : ` ${phasePosition} is the final stored phase.`
        : "";
    const progressContext = fightCompletion
      ? bossHealth
        ? ` Current best-pull detail: ${fightCompletion}% overall fight progress remained, while the active phase's boss health was ${bossHealth}%${phasePosition ? ` in ${phasePosition}` : ""}. These are different measures.${phaseCaveat}`
        : ` Current best-pull detail: ${fightCompletion}% overall fight progress remained${phasePosition ? ` in ${phasePosition}` : ""}.${phaseCaveat}`
      : bossHealth
        ? ` Current best-pull detail: the active phase's boss health was ${bossHealth}%${phasePosition ? ` in ${phasePosition}` : ""}. Boss HP alone is not overall encounter progress.${phaseCaveat}`
        : latestPhase
          ? ` The latest best reached ${phasePosition || latestPhase}.${phaseCaveat}`
          : "";
    addFact(
      "progress_trajectory",
      `${latest.guildName} improved its ${latest.difficulty === "mythic" ? "Mythic" : "Heroic"} ${latest.bossName || "boss"} best pull ${ordered.length} time${ordered.length === 1 ? "" : "s"} during the reporting window: ${points.join("; ")}.${progressContext}`,
      uniqueLinks(getEventLinks(latest, true)),
      latest.timestamp.toISOString(),
    );

    const bossAnalytics = raidAnalyticsMap.get(latest.raidId)?.bosses.find((entry) => entry.bossId === latest.bossId);
    if (latest.difficulty === "mythic" && latestBoss && latestBoss.kills === 0 && bossAnalytics && bossAnalytics.guildsKilled > 0 && bossAnalytics.pullCount.average > 0) {
      addFact(
        "boss_benchmark",
        `Tracked-guild context for ${latest.difficulty === "mythic" ? "Mythic" : "Heroic"} ${latestBoss.bossName}: ${bossAnalytics.guildsKilled} tracked guilds have killed it, with an average first-kill total of ${bossAnalytics.pullCount.average} pulls and a stored range of ${bossAnalytics.pullCount.lowest}-${bossAnalytics.pullCount.highest}. ${latestGuild?.name || latest.guildName} has ${latestBoss.pullCount} total recorded pulls without a kill. This is context, not a kill prediction.`,
        uniqueLinks(getEventLinks(latest, false)),
      );
    }
  }

  if (reclearEvents.length > 0) {
    const ordered = [...reclearEvents].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    addFact(
      "reclear_roundup",
      `${ordered.length} tracked guild-boss reclears took more than five pulls: ${ordered
        .map((event) => `${event.guildName} — ${event.difficulty === "mythic" ? "Mythic" : "Heroic"} ${event.bossName || "boss"}`)
        .join("; ")}.`,
      uniqueLinks(ordered.flatMap((event) => getEventLinks(event, false))),
      ordered[0].timestamp.toISOString(),
    );
  }

  for (const event of otherEvents) {
    addFact(event.type, describeEvent(event), uniqueLinks(getEventLinks(event, event.type === "boss_kill")), event.timestamp.toISOString());
  }

  for (const raidId of CURRENT_RAID_IDS) {
    const raid = raidMap.get(raidId);
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
      [
        ...standings.map(({ guild }) => makeLink("guild", guild.name, guildUrl(guild.realm, guild.name), guildVisual(guild))),
        ...(raid ? [makeLink("analytics", raid.name, "/raid-analytics", raid.iconUrl ? { type: "icon", iconUrl: raid.iconUrl } : undefined)] : []),
      ],
    );
  }

  const previousGuildMap = new Map(input.previousGuilds.map((guild) => [guild.guildId, guild]));
  const movements: Array<{ importance: number; summary: string; guild: ReporterGuildSnapshot; raidId: number }> = [];
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
        raidId: progress.raidId,
        summary: `${guild.name} moved from ${old.bossesDefeated}/${old.totalBosses} to ${progress.bossesDefeated}/${progress.totalBosses} in ${progress.raidName} ${progress.difficulty}${old.guildRank && progress.guildRank ? `; its stored tracked-guild rank changed from ${old.guildRank} to ${progress.guildRank}` : ""}.`,
      });
    }
  }
  for (const movement of movements.sort((a, b) => b.importance - a.importance).slice(0, 15)) {
    const raidContext = raidMap.get(movement.raidId);
    addFact(
      "weekly_guild_movement",
      movement.summary,
      [
        makeLink("guild", movement.guild.name, guildUrl(movement.guild.realm, movement.guild.name), guildVisual(movement.guild)),
        ...(raidContext
          ? [makeLink("analytics", raidContext.name, "/raid-analytics", raidContext.iconUrl ? { type: "icon", iconUrl: raidContext.iconUrl } : undefined)]
          : []),
      ],
    );
  }

  const previousPlayerMap = new Map(input.previousPlayers.map((player) => [`${player.category}:${player.realm}:${player.name}`, player]));
  const hasPreviousPlayerSnapshot = input.previousPlayers.length > 0;
  for (const player of input.currentPlayers.filter((entry) => entry.rank <= 3)) {
    const old = previousPlayerMap.get(`${player.category}:${player.realm}:${player.name}`);
    const rankChanged = Boolean(old && old.rank !== player.rank);
    const enteredTopThree = hasPreviousPlayerSnapshot && !old;
    if (!rankChanged && !enteredTopThree && player.rank !== 1) continue;
    const movement = old
      ? `; one-week snapshot rank ${old.rank} to ${player.rank}, score ${old.score.toFixed(1)} to ${player.score.toFixed(1)}`
      : enteredTopThree
        ? "; entered the tracked top three since the previous snapshot"
        : "";
    const classInfo = CLASSES.find((entry) => entry.id === player.classId);
    const links = [
      makeLink(
        "character",
        player.name,
        characterUrl(player.realm, player.name),
        classInfo ? { type: "icon", iconUrl: `${classInfo.iconUrl}.jpg` } : undefined,
      ),
      makeLink("analytics", "character leaderboards", "/tierlists/characters"),
    ];
    const playerRaid = raidMap.get(PRIMARY_RAID_ID);
    if (playerRaid) {
      links.push(makeLink("analytics", playerRaid.name, "/raid-analytics", playerRaid.iconUrl ? { type: "icon", iconUrl: playerRaid.iconUrl } : undefined));
    }
    if (player.guildName && player.guildRealm) {
      const guild = currentGuildIdentityMap.get(`${player.guildRealm.toLowerCase()}:${player.guildName.toLowerCase()}`);
      links.push(makeLink("guild", player.guildName, guildUrl(player.guildRealm, player.guildName), guildVisual(guild)));
    }
    addFact(
      rankChanged || enteredTopThree ? "player_leaderboard_change" : "player_leaderboard_context",
      `${player.name} ${player.rank === 1 ? `currently leads the ${primaryRaidName} Mythic ${player.category.toUpperCase()} all-stars standings` : `is currently rank ${player.rank} in the ${primaryRaidName} Mythic ${player.category.toUpperCase()} all-stars standings`}, playing ${player.specName}, with score ${player.score.toFixed(1)}${movement}.`,
      links,
    );
  }

  if (input.mythicPlus?.leaders.length) {
    const links: ReporterLink[] = [makeLink("analytics", "Mythic+ leaderboard", "/characters?tab=mythic-plus")];
    for (const leader of input.mythicPlus.leaders) {
      const classInfo = CLASSES.find((entry) => entry.id === leader.classId);
      links.push(
        makeLink(
          "character",
          leader.name,
          characterUrl(leader.realm, leader.name),
          classInfo ? { type: "icon", iconUrl: `${classInfo.iconUrl}.jpg` } : undefined,
        ),
      );
      if (leader.guildName && leader.guildRealm) {
        const guild = currentGuildIdentityMap.get(`${leader.guildRealm.toLowerCase()}:${leader.guildName.toLowerCase()}`);
        links.push(makeLink("guild", leader.guildName, guildUrl(leader.guildRealm, leader.guildName), guildVisual(guild)));
      }
    }
    addFact(
      "mythic_plus_leaderboard_context",
      `Current ${input.mythicPlus.seasonName} tracked Mythic+ overall standings at reporting time: ${input.mythicPlus.leaders
        .map(
          (leader) =>
            `${leader.rank}. ${leader.name}${leader.specName ? ` (${leader.specName})` : ""} ${leader.score.toFixed(1)}${leader.guildName ? ` — ${leader.guildName}` : ""}`,
        )
        .join("; ")}. This is a current snapshot, not a claimed weekly change.`,
      uniqueLinks(links),
    );
  }

  for (const pickem of input.pickems) {
    const updatedAt = new Date(pickem.updatedAt).getTime();
    const votingStart = new Date(pickem.votingStart).getTime();
    const votingEnd = new Date(pickem.votingEnd).getTime();
    const periodStart = input.periodStart.getTime();
    const now = input.periodEnd.getTime();
    const changedDuringWindow =
      (updatedAt >= periodStart && updatedAt <= now) || (votingStart >= periodStart && votingStart <= now) || (votingEnd >= periodStart && votingEnd <= now);
    if (!changedDuringWindow) continue;
    const status = pickem.finalized ? "finalized" : now < votingStart ? "not yet open" : now <= votingEnd ? "open for voting" : "voting closed";
    const daysUntilVotingEnd = votingEnd > now ? Math.ceil((votingEnd - now) / DAY_MS) : undefined;
    addFact(
      "pickem_change",
      `${pickem.name} (${pickem.type}) is ${status}; voting window ${pickem.votingStart} to ${pickem.votingEnd}${daysUntilVotingEnd !== undefined ? `; ${daysUntilVotingEnd} days remained until voting closed at reporting time` : ""}.`,
      [makeLink("pickem", pickem.name, "/pickems")],
    );
  }

  return facts;
}

async function captureMythicPlusContext(): Promise<MythicPlusReporterContext | undefined> {
  try {
    const options = await mythicPlusService.getOptions();
    const seasonSlug = options.defaultSelection.season;
    if (!seasonSlug) return undefined;
    const season = options.seasons.find((entry) => entry.slug === seasonSlug);
    const leaderboard = await mythicPlusService.getLeaderboard({ season: seasonSlug, bucket: "all", page: 1, limit: 3 });
    if (leaderboard.data.length === 0) return undefined;
    return {
      seasonSlug,
      seasonName: season?.name || seasonSlug,
      leaders: leaderboard.data.map((entry) => ({
        rank: entry.rank,
        name: entry.character.name,
        realm: entry.character.realm,
        classId: entry.character.classID,
        guildName: entry.character.guild?.name,
        guildRealm: entry.character.guild?.realm,
        score: entry.score.value,
        specName: entry.bestSpec?.name || undefined,
      })),
    };
  } catch (error) {
    logger.warn("[Reporter] Mythic+ leaderboard context was unavailable", error);
    return undefined;
  }
}

async function captureSnapshot(periodStart: Date, periodEnd: Date, weekKey: string) {
  const guildQuery = Guild.find({}, { name: 1, realm: 1, faction: 1, crest: 1, parent_guild: 1, excludedRaidIds: 1, progress: 1 }).lean();
  const leaderboardBase = {
    zoneId: PRIMARY_RAID_ID,
    difficulty: 5,
    type: "allstars",
    encounterId: null,
    partition: null,
  } as const;

  const [rawGuilds, dps, healers, tanks, rawPickems, rawRaids, rawRaidAnalytics, mythicPlus] = await Promise.all([
    guildQuery,
    CharacterLeaderboard.find({ ...leaderboardBase, role: "dps", metric: "dps" }).sort({ score: -1 }).limit(5).lean(),
    CharacterLeaderboard.find({ ...leaderboardBase, role: "healer", metric: "hps" }).sort({ score: -1 }).limit(5).lean(),
    CharacterLeaderboard.find({ ...leaderboardBase, role: "tank", metric: "dps" }).sort({ score: -1 }).limit(5).lean(),
    Pickem.find({ $or: [{ active: true }, { updatedAt: { $gte: periodStart } }] }).sort({ votingStart: -1 }).lean(),
    Raid.find({ id: { $in: CURRENT_RAID_IDS } }).select("id name iconUrl starts.eu ends.eu bosses.id bosses.name bosses.iconUrl -_id").lean(),
    RaidAnalytics.find({ raidId: { $in: CURRENT_RAID_IDS } }).select("raidId bosses.bossId bosses.bossName bosses.guildsKilled bosses.pullCount -_id").lean(),
    captureMythicPlusContext(),
  ]);
  const rawRaidRows = rawRaids as unknown as LeanRaidVisuals[];
  const bossIds = rawRaidRows.flatMap((raid) => raid.bosses.map((boss) => boss.id));
  const phaseNamesByBoss =
    bossIds.length > 0
      ? await Fight.aggregate<{ _id: number; phaseNames: string[] }>([
          { $match: { encounterID: { $in: bossIds }, difficulty: 5, isKill: true, lastPhaseName: { $type: "string" } } },
          { $group: { _id: "$encounterID", phaseNames: { $addToSet: "$lastPhaseName" } } },
        ])
      : [];
  const phaseCountMap = new Map(
    phaseNamesByBoss.flatMap((entry) => {
      const totalPhases = Math.max(0, ...entry.phaseNames.map((name) => getProgressPhaseNumber(name) || 0));
      return totalPhases > 0 ? [[entry._id, totalPhases] as const] : [];
    }),
  );
  const raids = rawRaidRows.map((raid) => ({
    ...raid,
    bosses: raid.bosses.map((boss) => ({ ...boss, totalPhases: phaseCountMap.get(boss.id) })),
  }));
  const raidAnalytics = rawRaidAnalytics as unknown as LeanRaidAnalytics[];
  const raidVisuals = new Map(raids.map((raid) => [raid.id, raid]));

  const guilds: ReporterGuildSnapshot[] = (rawGuilds as unknown as LeanGuild[])
    .map((guild) => ({
      guildId: guild._id.toString(),
      name: guild.name,
      realm: guild.realm,
      faction: guild.faction,
      crest: snapshotGuildCrest(guild.crest),
      parentGuild: guild.parent_guild,
      progress: (guild.progress || [])
        .filter((progress) => CURRENT_RAID_IDS.includes(progress.raidId) && !(guild.excludedRaidIds || []).includes(progress.raidId))
        .map((progress) => snapshotProgress(progress, raidVisuals.get(progress.raidId))),
    }))
    .filter((guild) => guild.progress.length > 0);

  const mapPlayers = (category: ReporterPlayerSnapshot["category"], entries: unknown[]): ReporterPlayerSnapshot[] =>
    (entries as LeanLeaderboard[]).map((entry, index) => ({
      category,
      rank: index + 1,
      name: entry.name,
      realm: entry.realm,
      classId: entry.classID,
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

  const snapshot = await ReporterSnapshot.create({ weekKey, capturedAt: periodEnd, periodStart, periodEnd, guilds, players, pickems });
  return { snapshot, raids, raidAnalytics, mythicPlus };
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

    const [previousSnapshot, previousPost] = await Promise.all([
      ReporterSnapshot.findOne({
        capturedAt: {
          $gte: new Date(periodEnd.getTime() - 9 * DAY_MS),
          $lte: new Date(periodEnd.getTime() - 5 * DAY_MS),
        },
      }).sort({ capturedAt: -1 }),
      ReporterPost.findOne({ weekKey: { $ne: weekKey }, periodEnd: { $lt: periodEnd } }).sort({ periodEnd: -1 }),
    ]);
    const { snapshot, raids, raidAnalytics, mythicPlus } = await captureSnapshot(periodStart, periodEnd, weekKey);
    const events = (await Event.find({ timestamp: { $gte: periodStart, $lte: periodEnd }, raidId: { $in: CURRENT_RAID_IDS } })
      .sort({ timestamp: -1 })
      .limit(60)
      .lean()) as unknown as LeanEvent[];
    const facts = buildReporterFacts({
      currentGuilds: snapshot.guilds,
      previousGuilds: previousSnapshot?.guilds || [],
      currentPlayers: snapshot.players,
      previousPlayers: previousSnapshot?.players || [],
      pickems: snapshot.pickems,
      events,
      raids,
      raidAnalytics,
      mythicPlus,
      periodStart,
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
      const result = await generateReporterContent({
        periodStart,
        periodEnd,
        facts,
        ...(previousPost ? { previousDispatch: { title: previousPost.content.fi.title, summary: previousPost.content.fi.summary } } : {}),
      });
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

  async deletePost(id: string): Promise<{ deletedId: string }> {
    if (!mongoose.isValidObjectId(id)) throw new Error("Invalid Reporter post ID");
    const post = await ReporterPost.findByIdAndDelete(id);
    if (!post) throw new Error("Reporter post not found");
    return { deletedId: post._id.toString() };
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
