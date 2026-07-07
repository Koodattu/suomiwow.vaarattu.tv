import Guild from "../models/Guild";
import Raid from "../models/Raid";
import { IGuildCrest } from "../models/Guild";

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
  difficulty: "mythic";
  guilds: CompareGuildMetric[];
  generatedAt: Date;
}

class CompareService {
  async getRaidCompare(raidId: number): Promise<RaidCompareResponse | null> {
    const raid = await Raid.findOne({ id: raidId }).lean();
    if (!raid) {
      return null;
    }

    const bossInfo = raid.bosses.map((boss) => ({
      id: boss.id,
      name: boss.name,
      iconUrl: boss.iconUrl,
    }));

    const guilds = await Guild.aggregate([
      {
        $match: {
          excludedRaidIds: { $ne: raidId },
          progress: {
            $elemMatch: {
              raidId,
              difficulty: "mythic",
              bossesDefeated: { $gt: 0 },
            },
          },
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
          mythicProgress: {
            $arrayElemAt: [
              {
                $filter: {
                  input: "$progress",
                  as: "p",
                  cond: {
                    $and: [{ $eq: ["$$p.raidId", raidId] }, { $eq: ["$$p.difficulty", "mythic"] }],
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
          sortRank: { $ifNull: ["$mythicProgress.guildRank", 99999] },
        },
      },
      {
        $sort: {
          sortRank: 1,
          "mythicProgress.worldRank": 1,
          name: 1,
        },
      },
    ]);

    const guildMetrics: CompareGuildMetric[] = guilds.map((guild) => {
      const progress = guild.mythicProgress;
      const bosses = bossInfo.map((boss) => {
        const bossProgress = progress.bosses?.find((entry: any) => entry.bossId === boss.id);

        return {
          bossId: boss.id,
          pulls: bossProgress?.pullCount ?? 0,
          timeSpent: bossProgress?.timeSpent ?? 0,
          kills: bossProgress?.kills ?? 0,
          firstKillTime: bossProgress?.firstKillTime,
        };
      });

      const totalPulls = bosses.reduce((sum, boss) => sum + boss.pulls, 0);

      return {
        id: String(guild._id),
        name: guild.name,
        realm: guild.realm,
        region: guild.region,
        faction: guild.faction,
        crest: guild.crest,
        parentGuild: guild.parent_guild,
        guildRank: progress.guildRank,
        worldRank: progress.worldRank,
        wclWorldRank: progress.wclWorldRank,
        rioWorldRank: progress.rioWorldRank,
        totalPulls,
        totalTimeSpent: progress.totalTimeSpent ?? 0,
        totalCombatTimeSpent: progress.totalCombatTimeSpent ?? 0,
        progressRaidTimeSpent: progress.progressRaidTimeSpent ?? 0,
        bossesDefeated: progress.bossesDefeated ?? 0,
        totalBosses: progress.totalBosses ?? bossInfo.length,
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
      difficulty: "mythic",
      guilds: guildMetrics,
      generatedAt: new Date(),
    };
  }
}

export default new CompareService();
