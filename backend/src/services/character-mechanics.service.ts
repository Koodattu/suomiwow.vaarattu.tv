import mongoose from "mongoose";
import { MIN_CHARACTER_RAID_PULLS_FOR_RANKING_ELIGIBILITY } from "../config/character-eligibility";
import { CURRENT_RAID_IDS } from "../config/guilds";
import CharacterMechanicsLeaderboard, { CHARACTER_MECHANICS_SCORE_VERSION, IMechanicsBossScore } from "../models/CharacterMechanicsLeaderboard";
import Character from "../models/Character";
import CharacterReportAppearance from "../models/CharacterReportAppearance";
import Fight, { IFightCombatant, IPlayerDeath } from "../models/Fight";
import Ranking from "../models/Ranking";
import Report from "../models/Report";
import cacheService from "./cache.service";
import { getPrimaryCharacterRaidGuilds } from "./character-raid-guild.service";
import logger from "../utils/logger";
import { slugifySpecName } from "../utils/spec";
import { resolveCharacterRaidIdentity, type RaidIdentityParseEvidence, type RaidIdentityResolution } from "../utils/character-raid-identity";

const MYTHIC_DIFFICULTY = 5;
const PARSE_WEIGHT = 0.5;
const SURVIVAL_WEIGHT = 0.5;
const REPORT_LOOKUP_BATCH_SIZE = 500;
const REPORT_GROUP_BATCH_SIZE = 200;
const FIGHT_CURSOR_BATCH_SIZE = 1000;
const DEATH_TIMING_EXPONENT = 1.15;
const MIN_RAID_FIGHT_COVERAGE = 0.9;
const RAID_WIDE_DEATH_MIN_ROSTER_SHARE = 0.5;
const RAID_WIDE_DEATH_MIN_PLAYERS = 10;
const RAID_WIDE_DEATH_WINDOW_MS = 1_000;
const LIKELY_RESET_MAX_DURATION_MS = 30_000;
const LIKELY_RESET_MAX_UNIQUE_DEATHS = 2;

type Metric = "dps" | "hps";
type Role = "dps" | "healer" | "tank";
type MechanicsScoreType = "combined" | "survival";

type BuildResult = {
  zones: Array<{
    zoneId: number;
    entries: number;
    fights: number;
    reports: number;
    appearances: number;
    status: "built" | "skipped";
    eligibleFights: number;
    evaluatedFights: number;
    coverage: number;
    reason?: string;
  }>;
  entries: number;
};

type QueryResponse = {
  data: any[];
  pagination: {
    totalItems: number;
    totalRankedItems: number;
    totalPages: number;
    currentPage: number;
    pageSize: number;
  };
};

type SurvivalStats = {
  pulls: number;
  evaluatedPulls: number;
  deaths: number;
  survivedPulls: number;
  earlyDeaths: number; // Pulls where this character was among the first three unique deaths
  scoreTotal: number;
  deathPercentTotal: number;
  earlyDeathSeverityTotal: number;
};

type AppearanceIdentity = {
  characterId: mongoose.Types.ObjectId;
  wclCanonicalCharacterId: number;
  name: string;
  realm: string;
  region: string;
  classID: number;
};

type ParseRow = {
  characterId: mongoose.Types.ObjectId;
  wclCanonicalCharacterId: number;
  name: string;
  realm: string;
  region: string;
  classID: number;
  specName: string;
  bestSpecName: string;
  role: Role;
  metric: Metric;
  ilvl: number;
  bestAmount: number;
  encounterId: number;
  encounterName: string;
  rankPercent: number;
  medianPercent: number;
  totalKills: number;
  partition: number;
  updatedAt: Date;
};

type MechanicsFight = {
  reportCode: string;
  fightId: number;
  encounterID: number;
  encounterName: string;
  duration: number;
  isKill: boolean;
  deaths?: IPlayerDeath[];
  combatants?: IFightCombatant[];
};

type DeathRecord = {
  order: number;
  deathPercent: number;
  deathTime: number;
};

class CharacterMechanicsService {
  private isBuilding = false;
  private mechanicsIndexesCreated = false;
  private fightLookupIndexCreated = false;

  async buildCurrentRaidMechanicsLeaderboards(): Promise<BuildResult> {
    return this.buildMechanicsLeaderboards(CURRENT_RAID_IDS);
  }

  async buildMechanicsLeaderboards(zoneIds: number[]): Promise<BuildResult> {
    if (this.isBuilding) {
      throw new Error("Character mechanics leaderboard build is already running");
    }

    this.isBuilding = true;
    const startedAt = Date.now();
    const zoneResults: BuildResult["zones"] = [];
    let totalEntries = 0;

    try {
      logger.info(`[MechanicsLeaderboard] Starting mechanics leaderboard build for raid(s): ${zoneIds.join(", ")}`);

      for (const zoneId of zoneIds) {
        const result = await this.buildZoneMechanicsLeaderboard(zoneId);
        zoneResults.push(result);
        if (result.status === "built") totalEntries += result.entries;
      }

      await cacheService.invalidatePattern(/^character-mechanics:/);
      await cacheService.invalidatePattern(/^characters:profile:/);

      const duration = Math.round((Date.now() - startedAt) / 1000);
      logger.info(`[MechanicsLeaderboard] Build completed: ${totalEntries} entries across ${zoneIds.length} raid(s) in ${duration}s`);

      return { zones: zoneResults, entries: totalEntries };
    } finally {
      this.isBuilding = false;
    }
  }

  private async buildZoneMechanicsLeaderboard(zoneId: number): Promise<BuildResult["zones"][number]> {
    const startedAt = Date.now();
    await this.ensureBuildIndexes();

    const parseRows = (await Ranking.aggregate([
      {
        $match: {
          zoneId,
          difficulty: MYTHIC_DIFFICULTY,
          metric: { $in: ["dps", "hps"] },
          rankPercent: { $ne: null },
          bestAmount: { $gt: 0 },
        },
      },
      { $sort: { rankPercent: -1, bestAmount: -1, totalKills: -1, partition: -1 } },
      {
        $group: {
          _id: { characterId: "$characterId", encounterId: "$encounter.id", metric: "$metric", specName: "$specName" },
          characterId: { $first: "$characterId" },
          wclCanonicalCharacterId: { $first: "$wclCanonicalCharacterId" },
          name: { $first: "$name" },
          realm: { $first: "$realm" },
          region: { $first: "$region" },
          classID: { $first: "$classID" },
          specName: { $first: "$specName" },
          bestSpecName: { $first: "$bestSpecName" },
          role: { $first: "$role" },
          metric: { $first: "$metric" },
          ilvl: { $first: "$ilvl" },
          bestAmount: { $first: "$bestAmount" },
          encounterId: { $first: "$encounter.id" },
          encounterName: { $first: "$encounter.name" },
          rankPercent: { $first: "$rankPercent" },
          medianPercent: { $first: "$medianPercent" },
          totalKills: { $first: "$totalKills" },
          partition: { $first: "$partition" },
          updatedAt: { $first: "$updatedAt" },
        },
      },
    ]).allowDiskUse(true)) as ParseRow[];

    if (parseRows.length === 0) {
      await CharacterMechanicsLeaderboard.deleteMany({ zoneId });
      logger.info(`[MechanicsLeaderboard] Raid ${zoneId}: no parse rows found, cleared existing mechanics entries`);
      return { zoneId, entries: 0, fights: 0, reports: 0, appearances: 0, status: "built", eligibleFights: 0, evaluatedFights: 0, coverage: 1 };
    }

    const encounterIds = Array.from(new Set(parseRows.map((row) => row.encounterId).filter((id): id is number => typeof id === "number")));
    const survivalBuild = await this.buildSurvivalStatsFromFetchedFights(zoneId, encounterIds);
    if (survivalBuild.coverage < MIN_RAID_FIGHT_COVERAGE) {
      const reason = `Fight-detail coverage ${(survivalBuild.coverage * 100).toFixed(1)}% is below the ${(MIN_RAID_FIGHT_COVERAGE * 100).toFixed(0)}% rebuild threshold`;
      logger.warn(`[MechanicsLeaderboard] Raid ${zoneId}: skipped without replacing existing entries. ${reason}`);
      return {
        zoneId,
        entries: 0,
        fights: survivalBuild.fights,
        reports: survivalBuild.reports,
        appearances: survivalBuild.appearances,
        status: "skipped",
        eligibleFights: survivalBuild.eligibleFights,
        evaluatedFights: survivalBuild.fights,
        coverage: survivalBuild.coverage,
        reason,
      };
    }

    const identityByCharacter = this.resolveRaidIdentities(parseRows, survivalBuild.specPullsByCharacter, survivalBuild.unknownSpecPullsByCharacter);
    const selectedParseRows = parseRows.filter((row) => {
      const identity = identityByCharacter.get(this.getCharacterKey(row.characterId));
      return Boolean(identity && slugifySpecName(row.specName) === identity.specName && row.metric === identity.metric);
    });

    const guildByCharacter = await getPrimaryCharacterRaidGuilds(
      zoneId,
      selectedParseRows.map((row) => row.characterId),
    );

    const bossEntries = selectedParseRows.flatMap((row) => {
      const identity = identityByCharacter.get(this.getCharacterKey(row.characterId))!;
      const { specName, role } = identity;
      const survival = survivalBuild.stats.get(this.getCharacterEncounterKey(row.characterId, row.encounterId));
      const survivalSummary = this.summarizeSurvivalStats(survival);
      if (survivalSummary.survivalScore === null) return [];

      const parseScore = this.roundScore(row.rankPercent ?? 0);
      const score = this.combineScores(parseScore, survivalSummary.survivalScore);
      const guild = guildByCharacter.get(String(row.characterId)) ?? null;

      return [
        {
          zoneId,
          difficulty: MYTHIC_DIFFICULTY,
          type: "boss" as const,
          encounterId: row.encounterId,
          metric: role === "healer" ? "hps" : "dps",
          characterId: row.characterId,
          wclCanonicalCharacterId: row.wclCanonicalCharacterId,
          name: row.name,
          realm: row.realm,
          region: row.region,
          classID: row.classID,
          specName,
          bestSpecName: specName,
          role,
          identityMethod: identity.method,
          identityConfidence: identity.confidence,
          ilvl: row.ilvl ?? 0,
          score,
          parseScore,
          survivalScore: survivalSummary.survivalScore,
          survivalPercentile: null,
          encounterName: row.encounterName,
          rankPercent: row.rankPercent ?? 0,
          medianPercent: row.medianPercent ?? 0,
          totalKills: row.totalKills ?? 0,
          bestAmount: row.bestAmount ?? 0,
          pulls: survivalSummary.pulls,
          evaluatedPulls: survivalSummary.evaluatedPulls,
          deaths: survivalSummary.deaths,
          survivedPulls: survivalSummary.survivedPulls,
          earlyDeaths: survivalSummary.earlyDeaths,
          averageDeathPercent: survivalSummary.averageDeathPercent,
          deathDataAvailable: true,
          bossScores: [],
          scoreVersion: CHARACTER_MECHANICS_SCORE_VERSION,
          raidFightCoverage: survivalBuild.coverage,
          eligibleFightCount: survivalBuild.eligibleFights,
          evaluatedFightCount: survivalBuild.fights,
          guildName: guild?.name ?? null,
          guildRealm: guild?.realm ?? null,
          sourcePartition: row.partition ?? 0,
          updatedAt: row.updatedAt ?? new Date(),
        },
      ];
    });

    this.normalizeBossSurvivalScores(bossEntries);

    const overallEntries = this.buildOverallEntries(bossEntries);
    const entries = [...bossEntries, ...overallEntries];

    await CharacterMechanicsLeaderboard.deleteMany({ zoneId });

    if (entries.length > 0) {
      const BATCH_SIZE = 5000;
      for (let i = 0; i < entries.length; i += BATCH_SIZE) {
        const batch = entries.slice(i, i + BATCH_SIZE);
        await CharacterMechanicsLeaderboard.bulkWrite(
          batch.map((entry) => ({
            replaceOne: {
              filter: this.toUniqueFilter(entry),
              replacement: entry,
              upsert: true,
            },
          })),
          { ordered: false },
        );
      }
    }

    const duration = Math.round((Date.now() - startedAt) / 1000);
    logger.info(
      `[MechanicsLeaderboard] Raid ${zoneId}: built ${entries.length} entries from ${selectedParseRows.length}/${parseRows.length} identity-matched parse rows, ${survivalBuild.fights}/${survivalBuild.eligibleFights} evaluated fight(s), ${survivalBuild.appearances} appearance lookup row(s) in ${duration}s`,
    );

    return {
      zoneId,
      entries: entries.length,
      fights: survivalBuild.fights,
      reports: survivalBuild.reports,
      appearances: survivalBuild.appearances,
      status: "built",
      eligibleFights: survivalBuild.eligibleFights,
      evaluatedFights: survivalBuild.fights,
      coverage: survivalBuild.coverage,
    };
  }

  private async ensureBuildIndexes(): Promise<void> {
    if (!this.mechanicsIndexesCreated) {
      await CharacterMechanicsLeaderboard.createIndexes();
      this.mechanicsIndexesCreated = true;
    }

    if (!this.fightLookupIndexCreated) {
      await Fight.collection.createIndex(
        {
          zoneId: 1,
          difficulty: 1,
          deathEventsFetchStatus: 1,
          combatantInfoFetchStatus: 1,
          reportCode: 1,
          fightId: 1,
          encounterID: 1,
        },
        { name: "mechanics_fight_details_lookup" },
      );
      this.fightLookupIndexCreated = true;
    }
  }

  private async buildSurvivalStatsFromFetchedFights(
    zoneId: number,
    encounterIds: number[],
  ): Promise<{
    stats: Map<string, SurvivalStats>;
    specPullsByCharacter: Map<string, Map<string, number>>;
    unknownSpecPullsByCharacter: Map<string, number>;
    fights: number;
    eligibleFights: number;
    coverage: number;
    reports: number;
    appearances: number;
  }> {
    const survivalByCharacterEncounter = new Map<string, SurvivalStats>();
    const specPullsByCharacter = new Map<string, Map<string, number>>();
    const unknownSpecPullsByCharacter = new Map<string, number>();
    const fightGroups = new Map<string, MechanicsFight[]>();
    const seenReports = new Set<string>();
    let fightCount = 0;
    let appearanceLookupRows = 0;
    let currentReportCode: string | null = null;
    const eligibleFightQuery = {
      zoneId,
      difficulty: MYTHIC_DIFFICULTY,
      encounterID: { $in: encounterIds },
      reportEndTime: { $gt: 0 },
      duration: { $gt: 0 },
    };
    const eligibleFights = await Fight.countDocuments(eligibleFightQuery);

    const cursor = Fight.find({
      ...eligibleFightQuery,
      deathEventsFetchStatus: "fetched",
      $or: [
        { combatantInfoRosterComplete: true, combatantInfoFetchStatus: { $in: ["fetched", "partial"] } },
        { combatantInfoRosterComplete: { $exists: false }, combatantInfoFetchStatus: "fetched", combatants: { $exists: true, $ne: [] } },
      ],
    })
      .select("reportCode fightId encounterID encounterName duration isKill deaths combatants")
      .sort({ reportCode: 1, fightId: 1 })
      .lean()
      .cursor({ batchSize: FIGHT_CURSOR_BATCH_SIZE });

    const flushFightGroups = async () => {
      if (fightGroups.size === 0) return;
      const reportCodes = Array.from(fightGroups.keys());
      const reportRegions = await this.findReportRegions(reportCodes);
      const groupedFights = Array.from(fightGroups.values()).flat();
      const [appearances, aliases] = await Promise.all([
        this.findReportAppearances(reportCodes),
        this.findCharacterAliases(groupedFights, reportRegions),
      ]);
      appearanceLookupRows += appearances.length + aliases.length;
      this.addSurvivalStats(
        groupedFights,
        appearances,
        aliases,
        reportRegions,
        survivalByCharacterEncounter,
        specPullsByCharacter,
        unknownSpecPullsByCharacter,
      );
      fightGroups.clear();
    };

    for await (const fight of cursor as AsyncIterable<MechanicsFight>) {
      if (!fight.reportCode) continue;

      if (currentReportCode && fight.reportCode !== currentReportCode && fightGroups.size >= REPORT_GROUP_BATCH_SIZE) {
        await flushFightGroups();
      }

      currentReportCode = fight.reportCode;
      fightCount += 1;
      seenReports.add(fight.reportCode);

      if (!fightGroups.has(fight.reportCode)) {
        fightGroups.set(fight.reportCode, []);
      }
      fightGroups.get(fight.reportCode)!.push(fight);
    }

    await flushFightGroups();

    return {
      stats: survivalByCharacterEncounter,
      specPullsByCharacter,
      unknownSpecPullsByCharacter,
      fights: fightCount,
      eligibleFights,
      coverage: eligibleFights > 0 ? fightCount / eligibleFights : 1,
      reports: seenReports.size,
      appearances: appearanceLookupRows,
    };
  }

  private async findReportAppearances(reportCodes: string[]): Promise<Array<AppearanceIdentity & { reportCode: string }>> {
    const appearances: Array<AppearanceIdentity & { reportCode: string }> = [];

    for (let i = 0; i < reportCodes.length; i += REPORT_LOOKUP_BATCH_SIZE) {
      const batch = reportCodes.slice(i, i + REPORT_LOOKUP_BATCH_SIZE);
      const rows = (await CharacterReportAppearance.find({
        reportCode: { $in: batch },
        hidden: false,
        characterId: { $ne: null },
        wclCanonicalCharacterId: { $ne: null },
      } as any)
        .select("reportCode characterId wclCanonicalCharacterId characterName characterRealm characterRegion classID")
        .lean()) as any[];

      for (const row of rows) {
        if (!row.characterId || typeof row.wclCanonicalCharacterId !== "number") continue;
        appearances.push({
          reportCode: row.reportCode,
          characterId: row.characterId,
          wclCanonicalCharacterId: row.wclCanonicalCharacterId,
          name: row.characterName,
          realm: row.characterRealm,
          region: row.characterRegion,
          classID: row.classID,
        });
      }
    }

    return appearances;
  }

  private async findReportRegions(reportCodes: string[]): Promise<Map<string, string>> {
    const reports = await Report.find({ code: { $in: reportCodes } }).select("code sourceGuildSnapshot.region").lean();
    return new Map(
      reports.flatMap((report) => {
        const region = report.sourceGuildSnapshot?.region;
        return typeof region === "string" && region ? [[report.code, region] as const] : [];
      }),
    );
  }

  private async findCharacterAliases(fights: MechanicsFight[], reportRegions: Map<string, string>): Promise<AppearanceIdentity[]> {
    const names = Array.from(new Set(fights.flatMap((fight) => (fight.combatants ?? []).map((combatant) => combatant.name)).filter(Boolean)));
    const regions = Array.from(new Set(reportRegions.values()));
    if (names.length === 0 || regions.length === 0) return [];

    const [characters, appearances] = await Promise.all([
      Character.find({ name: { $in: names }, region: { $in: regions } })
        .collation({ locale: "en", strength: 2 })
        .select("_id wclCanonicalCharacterId name realm region classID")
        .lean(),
      CharacterReportAppearance.find({
        characterName: { $in: names },
        characterRegion: { $in: regions },
        hidden: false,
        characterId: { $ne: null },
        wclCanonicalCharacterId: { $ne: null },
      } as any)
        .collation({ locale: "en", strength: 2 })
        .select("characterId wclCanonicalCharacterId characterName characterRealm characterRegion classID")
        .lean(),
    ]);

    const aliases: AppearanceIdentity[] = characters.map((character) => ({
      characterId: character._id,
      wclCanonicalCharacterId: character.wclCanonicalCharacterId,
      name: character.name,
      realm: character.realm,
      region: character.region,
      classID: character.classID,
    }));
    for (const appearance of appearances as any[]) {
      if (!appearance.characterId || typeof appearance.wclCanonicalCharacterId !== "number") continue;
      aliases.push({
        characterId: appearance.characterId,
        wclCanonicalCharacterId: appearance.wclCanonicalCharacterId,
        name: appearance.characterName,
        realm: appearance.characterRealm,
        region: appearance.characterRegion,
        classID: appearance.classID,
      });
    }

    return aliases;
  }

  private addSurvivalStats(
    fights: Array<{
      reportCode: string;
      fightId: number;
      encounterID: number;
      duration: number;
      isKill: boolean;
      deaths?: IPlayerDeath[];
      combatants?: IFightCombatant[];
    }>,
    appearances: Array<AppearanceIdentity & { reportCode: string }>,
    aliases: AppearanceIdentity[],
    reportRegions: Map<string, string>,
    survivalByCharacterEncounter: Map<string, SurvivalStats>,
    specPullsByCharacter: Map<string, Map<string, number>>,
    unknownSpecPullsByCharacter: Map<string, number>,
  ): void {
    const exactIdentityByReport = new Map<string, Map<string, AppearanceIdentity & { reportCode: string }>>();
    const nameIdentityByReport = new Map<string, Map<string, (AppearanceIdentity & { reportCode: string }) | null>>();
    const globalIdentityByRegion = new Map<string, AppearanceIdentity | null>();

    for (const appearance of appearances) {
      if (!exactIdentityByReport.has(appearance.reportCode)) {
        exactIdentityByReport.set(appearance.reportCode, new Map());
        nameIdentityByReport.set(appearance.reportCode, new Map());
      }

      exactIdentityByReport.get(appearance.reportCode)!.set(this.getDeathIdentityKey(appearance.name, appearance.realm), appearance);

      const nameKey = this.normalizeIdentityPart(appearance.name);
      const nameMap = nameIdentityByReport.get(appearance.reportCode)!;
      nameMap.set(nameKey, nameMap.has(nameKey) ? null : appearance);
    }

    for (const alias of aliases) {
      const key = this.getRegionalIdentityKey(alias.region, alias.name, alias.realm);
      if (!globalIdentityByRegion.has(key)) {
        globalIdentityByRegion.set(key, alias);
        continue;
      }
      const existing = globalIdentityByRegion.get(key);
      if (!existing || this.getCharacterKey(existing.characterId) !== this.getCharacterKey(alias.characterId)) {
        globalIdentityByRegion.set(key, null);
      }
    }

    for (const fight of fights) {
      if (!fight.duration || fight.duration <= 0 || !fight.combatants?.length) continue;

      const deathsByCharacter = new Map<string, DeathRecord[]>();
      const seenDeathEvents = new Set<string>();
      const deaths = [...(fight.deaths ?? [])]
        .filter((death) => Number.isFinite(death.deathTime) && death.deathTime >= 0 && death.deathTime <= fight.duration)
        .sort((left, right) => left.deathTime - right.deathTime)
        .filter((death) => {
          const eventKey = `${this.getDeathIdentityKey(death.name, death.server)}|${death.deathTime}`;
          if (seenDeathEvents.has(eventKey)) return false;
          seenDeathEvents.add(eventKey);
          return true;
        });
      const exactMap = exactIdentityByReport.get(fight.reportCode) ?? new Map();
      const nameMap = nameIdentityByReport.get(fight.reportCode) ?? new Map();
      const reportRegion = reportRegions.get(fight.reportCode) ?? "";
      const participants = new Map<string, { appearance: AppearanceIdentity; specName: string | null }>();
      const raidWideDeathStart = this.detectRaidWideDeathStart(fight, deaths);
      const neutralPull = this.isLikelyReset(fight, deaths);

      for (const combatant of fight.combatants) {
        const appearance =
          exactMap.get(this.getDeathIdentityKey(combatant.name, combatant.server)) ??
          nameMap.get(this.normalizeIdentityPart(combatant.name)) ??
          globalIdentityByRegion.get(this.getRegionalIdentityKey(reportRegion, combatant.name, combatant.server)) ??
          null;
        if (!appearance) continue;

        const characterKey = this.getCharacterKey(appearance.characterId);
        participants.set(characterKey, { appearance, specName: combatant.specName ? slugifySpecName(combatant.specName) : null });
      }

      const meaningfulDeaths = deaths.filter((death) => {
        return raidWideDeathStart === null || death.deathTime < raidWideDeathStart;
      });

      const firstDeathPlayersByTime = new Map<number, string[]>();
      const firstDeathTimeByPlayer = new Map<string, number>();
      for (const death of meaningfulDeaths) {
        const deathIdentityKey = this.getDeathIdentityKey(death.name, death.server);
        if (firstDeathTimeByPlayer.has(deathIdentityKey)) continue;
        firstDeathTimeByPlayer.set(deathIdentityKey, death.deathTime);
        const players = firstDeathPlayersByTime.get(death.deathTime) ?? [];
        players.push(deathIdentityKey);
        firstDeathPlayersByTime.set(death.deathTime, players);
      }

      const deathOrderByPlayer = new Map<string, number>();
      let priorUniqueDeaths = 0;
      for (const [, playerKeys] of [...firstDeathPlayersByTime.entries()].sort((left, right) => left[0] - right[0])) {
        const sharedOrder = priorUniqueDeaths + 1;
        for (const playerKey of playerKeys) {
          deathOrderByPlayer.set(playerKey, sharedOrder);
        }
        priorUniqueDeaths += playerKeys.length;
      }

      for (const death of meaningfulDeaths) {
        const deathTime = death.deathTime;
        const deathIdentityKey = this.getDeathIdentityKey(death.name, death.server);
        const appearance =
          exactMap.get(deathIdentityKey) ??
          nameMap.get(this.normalizeIdentityPart(death.name)) ??
          globalIdentityByRegion.get(this.getRegionalIdentityKey(reportRegion, death.name, death.server)) ??
          null;
        if (!appearance) continue;

        const characterKey = this.getCharacterKey(appearance.characterId);
        if (!deathsByCharacter.has(characterKey)) {
          deathsByCharacter.set(characterKey, []);
        }
        deathsByCharacter.get(characterKey)!.push({
          order: deathOrderByPlayer.get(deathIdentityKey)!,
          deathPercent: this.clamp(deathTime / fight.duration, 0, 1),
          deathTime,
        });
      }

      for (const { appearance, specName } of participants.values()) {
        const characterKey = this.getCharacterKey(appearance.characterId);
        const deathRecords = deathsByCharacter.get(characterKey) ?? [];
        this.addPullToStats(
          survivalByCharacterEncounter,
          this.getCharacterEncounterKey(appearance.characterId, fight.encounterID),
          deathRecords,
          neutralPull,
        );

        if (specName) {
          if (!specPullsByCharacter.has(characterKey)) specPullsByCharacter.set(characterKey, new Map());
          const pullsBySpec = specPullsByCharacter.get(characterKey)!;
          pullsBySpec.set(specName, (pullsBySpec.get(specName) ?? 0) + 1);
        } else {
          unknownSpecPullsByCharacter.set(characterKey, (unknownSpecPullsByCharacter.get(characterKey) ?? 0) + 1);
        }
      }
    }
  }

  private addPullToStats(statsByKey: Map<string, SurvivalStats>, key: string, deathRecords: DeathRecord[], neutralPull = false): void {
    const stats = statsByKey.get(key) ?? {
      pulls: 0,
      evaluatedPulls: 0,
      deaths: 0,
      survivedPulls: 0,
      earlyDeaths: 0,
      scoreTotal: 0,
      deathPercentTotal: 0,
      earlyDeathSeverityTotal: 0,
    };

    stats.pulls += 1;
    if (neutralPull) {
      statsByKey.set(key, stats);
      return;
    }

    stats.evaluatedPulls += 1;
    if (deathRecords.length === 0) {
      stats.survivedPulls += 1;
      stats.scoreTotal += 100;
    } else {
      const firstDeath = deathRecords[0];
      if (firstDeath.order <= 3) {
        stats.earlyDeaths += 1;
        stats.earlyDeathSeverityTotal += firstDeath.order === 1 ? 1 : firstDeath.order === 2 ? 0.75 : 0.5;
      }

      for (const deathRecord of deathRecords) {
        stats.deaths += 1;
        stats.deathPercentTotal += deathRecord.deathPercent;
      }
      stats.scoreTotal += this.scorePullDeaths(deathRecords);
    }

    statsByKey.set(key, stats);
  }

  private resolveRaidIdentities(
    parseRows: ParseRow[],
    specPullsByCharacter: Map<string, Map<string, number>>,
    unknownSpecPullsByCharacter: Map<string, number>,
  ): Map<string, RaidIdentityResolution> {
    const rowsByCharacter = new Map<string, ParseRow[]>();
    for (const row of parseRows) {
      const characterKey = this.getCharacterKey(row.characterId);
      if (!rowsByCharacter.has(characterKey)) rowsByCharacter.set(characterKey, []);
      rowsByCharacter.get(characterKey)!.push(row);
    }

    const identities = new Map<string, RaidIdentityResolution>();
    for (const [characterKey, rows] of rowsByCharacter) {
      const parseEvidence: RaidIdentityParseEvidence[] = rows.map((row) => ({
        specName: row.specName,
        metric: row.metric,
        encounterId: row.encounterId,
        rankPercent: row.rankPercent ?? 0,
        totalKills: row.totalKills ?? 0,
      }));
      const identity = resolveCharacterRaidIdentity({
        classID: rows[0].classID,
        specPulls: specPullsByCharacter.get(characterKey),
        unknownSpecPulls: unknownSpecPullsByCharacter.get(characterKey) ?? 0,
        parseEvidence,
      });
      if (identity) identities.set(characterKey, identity);
    }
    return identities;
  }

  private detectRaidWideDeathStart(
    fight: { combatants?: IFightCombatant[] },
    deaths: IPlayerDeath[],
  ): number | null {
    const requiredDeaths = this.getRequiredClusterDeaths(fight, deaths, RAID_WIDE_DEATH_MIN_ROSTER_SHARE);
    if (requiredDeaths === null) return null;

    const events = this.getTimedDeaths(deaths);
    for (let startIndex = 0; startIndex < events.length; startIndex += 1) {
      const clusterStart = events[startIndex].deathTime;
      const players = new Set<string>();
      for (let endIndex = startIndex; endIndex < events.length; endIndex += 1) {
        const event = events[endIndex];
        if (event.deathTime - clusterStart > RAID_WIDE_DEATH_WINDOW_MS) break;
        players.add(event.identityKey);
        if (players.size >= requiredDeaths) return clusterStart;
      }
    }
    return null;
  }

  private isLikelyReset(fight: Pick<MechanicsFight, "duration" | "isKill">, deaths: IPlayerDeath[]): boolean {
    if (fight.isKill) return false;
    const uniqueDeaths = new Set(deaths.map((death) => this.getDeathIdentityKey(death.name, death.server))).size;
    return uniqueDeaths === 0
      || (fight.duration <= LIKELY_RESET_MAX_DURATION_MS && uniqueDeaths <= LIKELY_RESET_MAX_UNIQUE_DEATHS);
  }

  private getRequiredClusterDeaths(
    fight: { combatants?: IFightCombatant[] },
    deaths: IPlayerDeath[],
    minimumRosterShare: number,
  ): number | null {
    const combatantRosterSize = new Set(
      (fight.combatants ?? []).map((combatant) => this.getDeathIdentityKey(combatant.name, combatant.server)),
    ).size;
    const deathRosterSize = new Set(
      deaths.map((death) => this.getDeathIdentityKey(death.name, death.server)),
    ).size;
    const rosterSize = Math.max(combatantRosterSize, deathRosterSize);
    return rosterSize > 0
      ? Math.max(RAID_WIDE_DEATH_MIN_PLAYERS, Math.ceil(rosterSize * minimumRosterShare))
      : null;
  }

  private getTimedDeaths(deaths: IPlayerDeath[]): Array<{ identityKey: string; deathTime: number }> {
    return deaths
      .map((death) => ({
        identityKey: this.getDeathIdentityKey(death.name, death.server),
        deathTime: Number.isFinite(death.deathTime) ? death.deathTime : 0,
      }))
      .sort((left, right) => left.deathTime - right.deathTime);
  }

  private normalizeBossSurvivalScores(bossEntries: any[]): void {
    const groups = new Map<string, any[]>();
    for (const entry of bossEntries) {
      if (typeof entry.survivalScore !== "number") continue;
      const key = `${entry.encounterId}|${entry.role}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(entry);
    }

    for (const entries of groups.values()) {
      const eligibleEntries = entries.filter(
        (entry) => entry.evaluatedPulls >= MIN_CHARACTER_RAID_PULLS_FOR_RANKING_ELIGIBILITY,
      );
      const referenceEntries = eligibleEntries.length >= 2 ? eligibleEntries : entries;
      const populationMean = referenceEntries.reduce((sum, entry) => sum + entry.survivalScore, 0) / referenceEntries.length;
      for (const entry of entries) {
        const sampleWeight = entry.evaluatedPulls / (entry.evaluatedPulls + 20);
        entry.survivalScore = this.roundScore(populationMean + (entry.survivalScore - populationMean) * sampleWeight);
      }

      const sortedReferenceScores = referenceEntries.map((entry) => entry.survivalScore).sort((left, right) => left - right);
      for (const entry of entries) {
        const firstEqualIndex = sortedReferenceScores.findIndex((score) => score >= entry.survivalScore);
        const lowerCount = firstEqualIndex === -1 ? sortedReferenceScores.length : firstEqualIndex;
        let equalCount = 0;
        for (let index = lowerCount; index < sortedReferenceScores.length && sortedReferenceScores[index] === entry.survivalScore; index += 1) {
          equalCount += 1;
        }
        const averageRank = equalCount > 0 ? lowerCount + (equalCount - 1) / 2 : lowerCount;
        const percentile = sortedReferenceScores.length === 1
          ? 50
          : this.roundScore(this.clamp((averageRank / (sortedReferenceScores.length - 1)) * 100, 0, 100));
        entry.survivalPercentile = percentile;
        entry.score = this.combineScores(entry.parseScore, percentile);
      }
    }
  }

  private buildOverallEntries(bossEntries: any[]): any[] {
    const groups = new Map<string, any[]>();
    for (const entry of bossEntries) {
      const key = `${entry.characterId}|${entry.specName}|${entry.metric}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(entry);
    }

    const overallEntries: any[] = [];

    for (const entries of groups.values()) {
      const sortedBossScores: IMechanicsBossScore[] = entries
        .map((entry) => ({
          encounterId: entry.encounterId,
          encounterName: entry.encounterName,
          score: entry.score,
          parseScore: entry.parseScore,
          survivalScore: entry.survivalScore,
          survivalPercentile: entry.survivalPercentile,
          pulls: entry.pulls,
          evaluatedPulls: entry.evaluatedPulls,
          deaths: entry.deaths,
          survivedPulls: entry.survivedPulls,
          earlyDeaths: entry.earlyDeaths,
          averageDeathPercent: entry.averageDeathPercent,
          deathDataAvailable: entry.deathDataAvailable,
          specName: entry.specName,
          rankPercent: entry.rankPercent,
        }))
        .sort((a, b) => a.encounterId - b.encounterId);

      const representative = this.getOverallRepresentative(entries);
      const totals = this.summarizeBossScores(sortedBossScores);

      overallEntries.push({
        ...representative,
        type: "overall" as const,
        encounterId: null,
        encounterName: "",
        score: totals.score,
        parseScore: totals.parseScore,
        survivalScore: totals.survivalScore,
        survivalPercentile: totals.survivalPercentile,
        pulls: totals.pulls,
        evaluatedPulls: totals.evaluatedPulls,
        deaths: totals.deaths,
        survivedPulls: totals.survivedPulls,
        earlyDeaths: totals.earlyDeaths,
        averageDeathPercent: totals.averageDeathPercent,
        deathDataAvailable: totals.deathDataAvailable,
        bossScores: sortedBossScores,
        totalKills: entries.reduce((sum, entry) => sum + (entry.totalKills ?? 0), 0),
        bestAmount: 0,
        ilvl: Math.round(entries.reduce((sum, entry) => sum + (entry.ilvl ?? 0), 0) / entries.length),
        rankPercent: totals.parseScore,
        medianPercent: 0,
        updatedAt: entries.reduce((latest, entry) => (entry.updatedAt > latest ? entry.updatedAt : latest), representative.updatedAt),
      });
    }

    return overallEntries;
  }

  private getOverallRepresentative(entries: any[]): any {
    const identities = new Map<string, { row: any; pulls: number; encounters: number; scoreTotal: number }>();

    for (const entry of entries) {
      const key = `${entry.role}|${entry.specName}`;
      const identity = identities.get(key) ?? { row: entry, pulls: 0, encounters: 0, scoreTotal: 0 };
      identity.pulls += Math.max(entry.pulls ?? 0, 0);
      identity.encounters += 1;
      identity.scoreTotal += entry.score ?? 0;

      const rowUpdatedAt = entry.updatedAt ? new Date(entry.updatedAt).getTime() : 0;
      const currentUpdatedAt = identity.row.updatedAt ? new Date(identity.row.updatedAt).getTime() : 0;
      if (rowUpdatedAt > currentUpdatedAt) identity.row = entry;
      identities.set(key, identity);
    }

    return Array.from(identities.values()).sort((left, right) => {
      if (left.pulls !== right.pulls) return right.pulls - left.pulls;
      if (left.encounters !== right.encounters) return right.encounters - left.encounters;

      const leftAverageScore = left.scoreTotal / left.encounters;
      const rightAverageScore = right.scoreTotal / right.encounters;
      if (leftAverageScore !== rightAverageScore) return rightAverageScore - leftAverageScore;

      return `${left.row.role}|${left.row.specName}`.localeCompare(`${right.row.role}|${right.row.specName}`);
    })[0].row;
  }

  async getMechanicsRankings(options: {
    zoneId: number;
    encounterId?: number;
    classId?: number;
    specName?: string;
    role?: Role;
    metric?: Metric;
    scoreType?: MechanicsScoreType;
    limit?: number;
    page?: number;
    characterName?: string;
    guildName?: string;
  }): Promise<QueryResponse> {
    const { zoneId, encounterId, classId, specName, role, metric = "dps", scoreType = "combined", limit = 100, page = 1, characterName, guildName } = options;
    const normalizedSpecName = specName?.trim().toLowerCase();
    const normalizedRole = role?.toLowerCase() as Role | undefined;
    const normalizedCharacterName = characterName?.trim();
    const normalizedGuildName = guildName?.trim();
    const partialNameRegex = normalizedCharacterName ? this.getAccentInsensitiveRegex(normalizedCharacterName) : undefined;
    const partialGuildNameRegex = normalizedGuildName ? new RegExp(this.escapeRegex(normalizedGuildName), "i") : undefined;
    const safeLimit = Math.min(Math.max(limit, 1), 500);
    const isBossType = encounterId !== undefined;
    const scoreField = scoreType === "survival" ? "survivalPercentile" : "score";

    const baseQuery: any = {
      zoneId,
      difficulty: MYTHIC_DIFFICULTY,
      type: isBossType ? "boss" : "overall",
      encounterId: encounterId ?? null,
      metric,
      deathDataAvailable: true,
      survivalScore: { $ne: null },
      survivalPercentile: { $ne: null },
      evaluatedPulls: { $gte: MIN_CHARACTER_RAID_PULLS_FOR_RANKING_ELIGIBILITY },
    };

    if (classId !== undefined) baseQuery.classID = classId;
    if (normalizedRole !== undefined) baseQuery.role = normalizedRole;

    if (!isBossType && normalizedSpecName !== undefined) {
      return this.getOverallSpecMechanicsRankings({
        baseQuery,
        normalizedSpecName,
        partialNameRegex,
        partialGuildNameRegex,
        scoreType,
        page,
        safeLimit,
      });
    }

    if (normalizedSpecName !== undefined) baseQuery.specName = normalizedSpecName;

    const totalRankedItems = await CharacterMechanicsLeaderboard.countDocuments(baseQuery);
    let fetchQuery: any = { ...baseQuery };
    let totalItems = totalRankedItems;
    let needsGlobalRanks = false;
    const effectivePage = Math.max(page, 1);
    const effectiveSkip = (effectivePage - 1) * safeLimit;

    if (partialNameRegex) {
      fetchQuery.name = partialNameRegex;
      totalItems = await CharacterMechanicsLeaderboard.countDocuments(fetchQuery);
      needsGlobalRanks = true;
    }

    if (partialGuildNameRegex) {
      fetchQuery.guildName = partialGuildNameRegex;
      totalItems = await CharacterMechanicsLeaderboard.countDocuments(fetchQuery);
      needsGlobalRanks = true;
    }

    const entries = await CharacterMechanicsLeaderboard.find(fetchQuery)
      .sort({ [scoreField]: -1, name: 1 })
      .skip(effectiveSkip)
      .limit(safeLimit)
      .lean();

    const ranks =
      needsGlobalRanks && entries.length > 0
        ? await Promise.all(
            entries.map(async (entry: any) => {
              const count = await CharacterMechanicsLeaderboard.countDocuments({
                ...baseQuery,
                [scoreField]: { $gt: entry[scoreField] },
              });
              return count + 1;
            }),
          )
        : entries.map((_, index) => effectiveSkip + index + 1);

    return {
      data: entries.map((entry: any, index) => this.toResponseRow(entry, ranks[index], isBossType, scoreType)),
      pagination: {
        totalItems,
        totalRankedItems,
        totalPages: Math.ceil(totalItems / safeLimit),
        currentPage: effectivePage,
        pageSize: safeLimit,
      },
    };
  }

  private async getOverallSpecMechanicsRankings(options: {
    baseQuery: any;
    normalizedSpecName: string;
    partialNameRegex?: RegExp;
    partialGuildNameRegex?: RegExp;
    scoreType: MechanicsScoreType;
    page: number;
    safeLimit: number;
  }): Promise<QueryResponse> {
    const { baseQuery, normalizedSpecName, partialNameRegex, partialGuildNameRegex, scoreType, page, safeLimit } = options;
    const entries = (await CharacterMechanicsLeaderboard.find({
      ...baseQuery,
      bossScores: { $elemMatch: { specName: normalizedSpecName, deathDataAvailable: true, survivalScore: { $ne: null }, survivalPercentile: { $ne: null } } },
    }).lean()) as any[];
    const scoredEntries: any[] = [];

    for (const entry of entries) {
      entry.bossScores = (entry.bossScores ?? []).filter(
        (bossScore: IMechanicsBossScore) => bossScore.specName === normalizedSpecName && bossScore.deathDataAvailable === true && bossScore.survivalScore !== null && bossScore.survivalPercentile !== null,
      );
      if (entry.bossScores.length === 0) continue;

      const totals = this.summarizeBossScores(entry.bossScores);
      entry.score = totals.score;
      entry.parseScore = totals.parseScore;
      entry.survivalScore = totals.survivalScore;
      entry.survivalPercentile = totals.survivalPercentile;
      entry.pulls = totals.pulls;
      entry.evaluatedPulls = totals.evaluatedPulls;
      entry.deaths = totals.deaths;
      entry.survivedPulls = totals.survivedPulls;
      entry.earlyDeaths = totals.earlyDeaths;
      entry.averageDeathPercent = totals.averageDeathPercent;
      entry.deathDataAvailable = totals.deathDataAvailable;
      if (entry.evaluatedPulls < MIN_CHARACTER_RAID_PULLS_FOR_RANKING_ELIGIBILITY) continue;
      entry.specName = normalizedSpecName;
      scoredEntries.push(entry);
    }

    scoredEntries.sort((a, b) => this.compareMechanicsRankValues(a, b, scoreType));
    const totalRankedItems = scoredEntries.length;
    let displayEntries = scoredEntries;
    if (partialNameRegex) displayEntries = displayEntries.filter((entry) => partialNameRegex.test(entry.name ?? ""));
    if (partialGuildNameRegex) displayEntries = displayEntries.filter((entry) => partialGuildNameRegex.test(entry.guildName ?? ""));

    const effectivePage = Math.max(page, 1);
    const effectiveSkip = (effectivePage - 1) * safeLimit;
    const pageEntries = displayEntries.slice(effectiveSkip, effectiveSkip + safeLimit);
    const rankMap = new Map(scoredEntries.map((entry, index) => [entry, index + 1]));

    return {
      data: pageEntries.map((entry) => this.toResponseRow(entry, rankMap.get(entry) ?? 0, false, scoreType)),
      pagination: {
        totalItems: displayEntries.length,
        totalRankedItems,
        totalPages: Math.ceil(displayEntries.length / safeLimit),
        currentPage: effectivePage,
        pageSize: safeLimit,
      },
    };
  }

  private getMechanicsRankValue(entry: any, scoreType: MechanicsScoreType): number {
    const value = scoreType === "survival" ? entry.survivalPercentile : entry.score;
    return typeof value === "number" && Number.isFinite(value) ? value : -Infinity;
  }

  private compareMechanicsRankValues(a: any, b: any, scoreType: MechanicsScoreType): number {
    const scoreDiff = this.getMechanicsRankValue(b, scoreType) - this.getMechanicsRankValue(a, scoreType);
    if (scoreDiff !== 0) return scoreDiff;
    return (a.name ?? "").localeCompare(b.name ?? "");
  }

  private toResponseRow(entry: any, rank: number, isBossType: boolean, scoreType: MechanicsScoreType = "combined"): any {
    const guild = entry.guildName && entry.guildRealm ? { name: entry.guildName, realm: entry.guildRealm } : null;
    const scoreValue = this.getMechanicsRankValue(entry, scoreType);
    const row: any = {
      rank,
      character: {
        wclCanonicalCharacterId: entry.wclCanonicalCharacterId,
        name: entry.name,
        realm: entry.realm,
        region: entry.region,
        classID: entry.classID,
        guild,
      },
      context: {
        zoneId: entry.zoneId,
        difficulty: entry.difficulty,
        metric: entry.metric ?? "dps",
        partition: entry.sourcePartition,
        encounterId: entry.encounterId,
          specName: entry.specName,
          bestSpecName: entry.bestSpecName || undefined,
          role: entry.role,
          identityMethod: entry.identityMethod,
          identityConfidence: entry.identityConfidence,
          ilvl: entry.ilvl,
      },
      score: {
        type: "mechanics",
        value: Number.isFinite(scoreValue) ? scoreValue : 0,
      },
      stats: {
        rankPercent: entry.rankPercent,
        medianPercent: entry.medianPercent,
        mechanics: {
          parseScore: entry.parseScore,
          survivalScore: entry.survivalScore,
          survivalPercentile: entry.survivalPercentile,
          pulls: entry.pulls,
          evaluatedPulls: entry.evaluatedPulls,
          deaths: entry.deaths,
          survivedPulls: entry.survivedPulls,
          earlyDeaths: entry.earlyDeaths,
          averageDeathPercent: entry.averageDeathPercent,
          deathDataAvailable: entry.deathDataAvailable,
          scoreVersion: entry.scoreVersion,
          raidFightCoverage: entry.raidFightCoverage,
          eligibleFightCount: entry.eligibleFightCount,
          evaluatedFightCount: entry.evaluatedFightCount,
        },
      },
      updatedAt: entry.updatedAt ? new Date(entry.updatedAt).toISOString() : undefined,
    };

    if (isBossType) {
      row.encounter = {
        id: entry.encounterId,
        name: entry.encounterName,
      };
    } else if (entry.bossScores?.length > 0) {
      row.bossScores = entry.bossScores;
    }

    return row;
  }

  private summarizeSurvivalStats(stats?: SurvivalStats): {
    survivalScore: number | null;
    pulls: number;
    evaluatedPulls: number;
    deaths: number;
    survivedPulls: number;
    earlyDeaths: number;
    averageDeathPercent: number | null;
  } {
    if (!stats || stats.evaluatedPulls <= 0) {
      return {
        survivalScore: null,
        pulls: 0,
        evaluatedPulls: 0,
        deaths: 0,
        survivedPulls: 0,
        earlyDeaths: 0,
        averageDeathPercent: null,
      };
    }

    return {
      survivalScore: this.capSurvivalScore(stats.scoreTotal / stats.evaluatedPulls, stats),
      pulls: stats.pulls,
      evaluatedPulls: stats.evaluatedPulls,
      deaths: stats.deaths,
      survivedPulls: stats.survivedPulls,
      earlyDeaths: stats.earlyDeaths,
      averageDeathPercent: stats.deaths > 0 ? this.roundScore((stats.deathPercentTotal / stats.deaths) * 100) : null,
    };
  }

  private summarizeBossScores(bossScores: IMechanicsBossScore[]): {
    score: number;
    parseScore: number;
    survivalScore: number | null;
    survivalPercentile: number | null;
    pulls: number;
    evaluatedPulls: number;
    deaths: number;
    survivedPulls: number;
    earlyDeaths: number;
    averageDeathPercent: number | null;
    deathDataAvailable: boolean;
  } {
    if (bossScores.length === 0) {
      return {
        score: 0,
        parseScore: 0,
        survivalScore: null,
        survivalPercentile: null,
        pulls: 0,
        evaluatedPulls: 0,
        deaths: 0,
        survivedPulls: 0,
        earlyDeaths: 0,
        averageDeathPercent: null,
        deathDataAvailable: false,
      };
    }

    const parseScore = this.roundScore(bossScores.reduce((sum, bossScore) => sum + bossScore.parseScore, 0) / bossScores.length);
    const survivalScores = bossScores.filter((bossScore) => bossScore.survivalScore !== null);
    const survivalScore = survivalScores.length > 0
      ? this.roundScore(survivalScores.reduce((sum, bossScore) => sum + (bossScore.survivalScore ?? 0), 0) / survivalScores.length)
      : null;
    const survivalPercentiles = bossScores.filter((bossScore) => bossScore.survivalPercentile !== null);
    const survivalPercentile = survivalPercentiles.length > 0
      ? this.roundScore(survivalPercentiles.reduce((sum, bossScore) => sum + (bossScore.survivalPercentile ?? 0), 0) / survivalPercentiles.length)
      : null;
    const score = survivalPercentile !== null ? this.combineScores(parseScore, survivalPercentile) : this.roundScore(bossScores.reduce((sum, bossScore) => sum + bossScore.score, 0) / bossScores.length);
    const pulls = bossScores.reduce((sum, bossScore) => sum + bossScore.pulls, 0);
    const evaluatedPulls = bossScores.reduce((sum, bossScore) => sum + bossScore.evaluatedPulls, 0);
    const deaths = bossScores.reduce((sum, bossScore) => sum + bossScore.deaths, 0);
    const survivedPulls = bossScores.reduce((sum, bossScore) => sum + bossScore.survivedPulls, 0);
    const earlyDeaths = bossScores.reduce((sum, bossScore) => sum + bossScore.earlyDeaths, 0);
    const deathPercentTotal = bossScores.reduce((sum, bossScore) => sum + (bossScore.averageDeathPercent ?? 0) * bossScore.deaths, 0);

    return {
      score,
      parseScore,
      survivalScore,
      survivalPercentile,
      pulls,
      evaluatedPulls,
      deaths,
      survivedPulls,
      earlyDeaths,
      averageDeathPercent: deaths > 0 ? this.roundScore(deathPercentTotal / deaths) : null,
      deathDataAvailable: evaluatedPulls > 0,
    };
  }

  private combineScores(parseScore: number, survivalScore: number): number {
    return this.roundScore(parseScore * PARSE_WEIGHT + survivalScore * SURVIVAL_WEIGHT);
  }

  private scoreDeath(deathPercent: number, deathOrder: number): number {
    const orderWeight = deathOrder <= 1 ? 1 : deathOrder === 2 ? 0.9 : deathOrder === 3 ? 0.8 : 0.65;
    const floorPenalty = deathOrder <= 1 ? 10 : deathOrder === 2 ? 8 : deathOrder === 3 ? 6 : 4;
    const penalty = floorPenalty + (100 - floorPenalty) * Math.pow(1 - deathPercent, DEATH_TIMING_EXPONENT) * orderWeight;
    return this.roundScore(this.clamp(100 - penalty, 0, 100));
  }

  private scorePullDeaths(deathRecords: DeathRecord[]): number {
    if (deathRecords.length === 0) return 100;

    const [firstDeath, ...repeatDeaths] = deathRecords;
    let score = this.scoreDeath(firstDeath.deathPercent, firstDeath.order);

    for (let index = 0; index < repeatDeaths.length; index += 1) {
      score -= this.scoreRepeatDeathPenalty(repeatDeaths[index].deathPercent, index + 1);
    }

    return this.roundScore(this.clamp(score, 0, 100));
  }

  private scoreRepeatDeathPenalty(deathPercent: number, repeatIndex: number): number {
    const repeatWeight = Math.min(1.75, 1 + repeatIndex * 0.25);
    return this.roundScore((8 + 20 * Math.pow(1 - deathPercent, 0.8)) * repeatWeight);
  }

  private capSurvivalScore(rawScore: number, stats: SurvivalStats): number {
    const earlyDeathSeverityRate = stats.earlyDeathSeverityTotal / stats.evaluatedPulls;
    const earlyDeathCap = 100 - 90 * Math.min(earlyDeathSeverityRate, 1);

    return this.roundScore(this.clamp(Math.min(rawScore, earlyDeathCap), 0, 100));
  }

  private toUniqueFilter(entry: any): Record<string, unknown> {
    return {
      zoneId: entry.zoneId,
      difficulty: entry.difficulty,
      type: entry.type,
      encounterId: entry.encounterId,
      metric: entry.metric,
      characterId: entry.characterId,
    };
  }

  private getCharacterEncounterKey(characterId: mongoose.Types.ObjectId, encounterId: number): string {
    return `${this.getCharacterKey(characterId)}|${encounterId}`;
  }

  private getCharacterKey(characterId: mongoose.Types.ObjectId): string {
    return String(characterId);
  }

  private getDeathIdentityKey(name: string, realm: string): string {
    return `${this.normalizeIdentityPart(name)}|${this.normalizeIdentityPart(realm)}`;
  }

  private getRegionalIdentityKey(region: string, name: string, realm: string): string {
    return `${this.normalizeIdentityPart(region)}|${this.getDeathIdentityKey(name, realm)}`;
  }

  private normalizeIdentityPart(value: string): string {
    return (value ?? "").toLowerCase().replace(/['`\-\s]/g, "");
  }

  private roundScore(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.round(value * 10) / 10;
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }

  private escapeRegex(input: string): string {
    return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  private getAccentInsensitiveRegex(input: string): RegExp {
    const escaped = this.escapeRegex(input.trim());
    return new RegExp(escaped, "i");
  }
}

export default new CharacterMechanicsService();
