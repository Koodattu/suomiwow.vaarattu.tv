import { mainRaidBosses, RAID_ENCOUNTERS } from "../config/raid-encounters";
import type { IBossProgress } from "../models/Guild";

type RaceBossProgress = Pick<IBossProgress, "bossId" | "kills" | "pullCount" | "bestPercent" | "bestPullPhase" | "firstKillTime">;

export function getPenultimateBossSummary(raidId: number, raidBosses: { id: number; name: string }[], bosses: RaceBossProgress[] = []) {
  return getRaceBossSummary(raidId, raidBosses, bosses, "penultimate");
}

export function getFinalBossSummary(raidId: number, raidBosses: { id: number; name: string }[], bosses: RaceBossProgress[] = []) {
  return getRaceBossSummary(raidId, raidBosses, bosses, "final");
}

function getRaceBossSummary(raidId: number, raidBosses: { id: number; name: string }[], bosses: RaceBossProgress[], targetType: "final" | "penultimate") {
  raidBosses = mainRaidBosses(raidId, raidBosses);
  const penultimateId = RAID_ENCOUNTERS[raidId]?.main[RAID_ENCOUNTERS[raidId].main.length - 2] ?? raidBosses[raidBosses.length - 2]?.id;
  const finalBossId = RAID_ENCOUNTERS[raidId]?.final ?? raidBosses[raidBosses.length - 1]?.id;
  const targetId = targetType === "final" ? finalBossId : penultimateId;
  const target = raidBosses.find((entry) => entry.id === targetId);
  if (!target) return undefined;

  const boss = bosses.find((entry) => entry.bossId === target.id);
  const hasReachedBoss = Boolean(boss && (boss.kills > 0 || boss.pullCount > 0));
  const precedingBosses = raidBosses.filter((entry) => entry.id !== target.id && (targetType === "final" || entry.id !== finalBossId));
  const precedingBossesKilled = precedingBosses.every((preceding) => bosses.some((entry) => entry.bossId === preceding.id && entry.kills > 0));

  return {
    bossId: target.id,
    bossName: target.name,
    eligible: hasReachedBoss || precedingBossesKilled,
    kills: boss?.kills ?? 0,
    pullCount: boss?.pullCount ?? 0,
    bestPercent: boss?.bestPercent ?? 100,
    bestPullPhase: boss?.bestPullPhase,
    firstKillTime: boss?.firstKillTime,
  };
}
