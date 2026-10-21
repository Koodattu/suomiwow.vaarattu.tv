import { mainRaidBosses, raidLairs, competitiveWorldRank, RAID_ENCOUNTERS } from "../config/raid-encounters";
import Guild from "../models/Guild";
import Raid from "../models/Raid";
import { IGuildCrest } from "../models/Guild";
import { CompareDifficulty } from "../config/compare";

export interface CompareBossInfo {
  id: number;
  name: string;
  iconUrl?: string;
}

export interface CompareGuildBossMetric {
  bossId: number;
  pulls: number;
  timeSpent: number;
  kills: number;
  firstKillTime?: Date;
}

export interface CompareGuildMetric {
  id: string;
  name: string;
  realm: string;
  region: string;
  faction?: string;
  crest?: IGuildCrest;
  parentGuild?: string;
  guildRank?: number;
  worldRank?: number;
  wclWorldRank?: number;
  rioWorldRank?: number;
  totalPulls: number;
  totalTimeSpent: number;
  totalCombatTimeSpent: number;
  progressRaidTimeSpent: number;
  bossesDefeated: number;
  totalBosses: number;
  bosses: CompareGuildBossMetric[];
}

export interface RaidCompareResponse {
  raid: {
    id: number;
    name: string;
    iconUrl?: string;
    bosses: CompareBossInfo[];
  };
  difficulty: CompareDifficulty;
  guilds: CompareGuildMetric[];
  generatedAt: Date;
}

class CompareService {
  async getRaidCompare(raidId: number, difficulty: CompareDifficulty = "mythic"): Promise<RaidCompareResponse | null> {
    const raid = await Raid.findOne({ id: raidId }).lean();
    if (!raid) {
      return null;
    }

    const mainBosses = mainRaidBosses(raidId, raid.bosses);
    const mainBossIds = new Set(mainBosses.map(boss => boss.id));
    const displayBosses = [...mainBosses, ...raidLairs(raidId).map(lair =>
      raid.bosses.find(boss => boss.id === lair.id) ?? lair,
    )];
    const bossInfo = displayBosses.map((boss) => ({
      id: boss.id,
      name: boss.name,
      iconUrl: "iconUrl" in boss ? boss.iconUrl : undefined,
    }));

    const guilds = await Guild.aggregate([
      {
        $match: {
          excludedRaidIds: { $ne: raidId },
          $or: ["progress", "lairProgress"].map(field => ({
            [field]: { $elemMatch: {
              raidId, difficulty,
              $or: [{ bossesDefeated: { $gt: 0 } }, { "bosses.pullCount": { $gt: 0 } }],
            } },
          })),
        },
      },
      {
        $project: {
          _id: 1,
          name: 1,
          realm: 1,
          region: 1,
          faction: 1,
          crest: 1,
          parent_guild: 1,
          // Main-page rank is stored on Mythic once a guild starts Mythic.
          rankedProgress: {
            $arrayElemAt: [{ $filter: {
              input: "$progress", as: "p",
              cond: { $and: [{ $eq: ["$$p.raidId", raidId] }, { $gt: ["$$p.guildRank", 0] }] },
            } }, 0],
          },
          selectedLairs: {
            $filter: {
              input: { $ifNull: ["$lairProgress", []] }, as: "p",
              cond: { $and: [{ $eq: ["$$p.raidId", raidId] }, { $eq: ["$$p.difficulty", difficulty] }] },
            },
          },
          selectedProgress: {
            $arrayElemAt: [
              {
                $filter: {
                  input: "$progress",
                  as: "p",
                  cond: {
                    $and: [{ $eq: ["$$p.raidId", raidId] }, { $eq: ["$$p.difficulty", difficulty] }],
                  },
                },
              },
              0,
            ],
          },
        },
      },
      {
        $addFields: {
          sortRank: { $ifNull: ["$rankedProgress.guildRank", 99999] },
        },
      },
      {
        $sort: {
          sortRank: 1,
          "selectedProgress.worldRank": 1,
          name: 1,
        },
      },
    ]);

    const guildMetrics: CompareGuildMetric[] = guilds.map((guild) => {
      const progress = guild.selectedProgress ?? {};
      const encounterProgress = [...(progress.bosses ?? []), ...(guild.selectedLairs ?? []).flatMap((lair: any) => lair.bosses ?? [])];
      const bosses = bossInfo.map((boss) => {
        const bossProgress = encounterProgress.find((entry: any) => entry.bossId === boss.id);

        return {
          bossId: boss.id,
          pulls: bossProgress?.pullCount ?? 0,
          timeSpent: bossProgress?.timeSpent ?? 0,
          kills: bossProgress?.kills ?? 0,
          firstKillTime: bossProgress?.firstKillTime,
        };
      });

      const totalPulls = bosses.reduce((sum, boss) => sum + (mainBossIds.has(boss.bossId) ? boss.pulls : 0), 0);

      return {
        id: String(guild._id),
        name: guild.name,
        realm: guild.realm,
        region: guild.region,
        faction: guild.faction,
        crest: guild.crest,
        parentGuild: guild.parent_guild,
        guildRank: guild.rankedProgress?.guildRank,
        worldRank: competitiveWorldRank({ ...progress, raidId }),
        wclWorldRank: RAID_ENCOUNTERS[raidId] ? undefined : progress.wclWorldRank,
        rioWorldRank: progress.rioWorldRank,
        totalPulls,
        totalTimeSpent: progress.totalTimeSpent ?? 0,
        totalCombatTimeSpent: progress.totalCombatTimeSpent ?? 0,
        progressRaidTimeSpent: progress.progressRaidTimeSpent ?? 0,
        bossesDefeated: progress.bossesDefeated ?? 0,
        totalBosses: progress.totalBosses ?? mainBosses.length,
        bosses,
      };
    });

    return {
      raid: {
        id: raid.id,
        name: raid.name,
        iconUrl: raid.iconUrl,
        bosses: bossInfo,
      },
      difficulty,
      guilds: guildMetrics,
      generatedAt: new Date(),
    };
  }
}

export default new CompareService();
