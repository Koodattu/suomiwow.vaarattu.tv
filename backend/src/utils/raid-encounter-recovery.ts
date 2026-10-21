import { raidLairs } from "../config/raid-encounters";

/** Validate captured source evidence before any recovery writes are made. */
export function buildLairRecoveryFights(raidId: number, stored: any, captured: any, missingIds: number[]) {
  if (!captured || captured.code !== stored.code || captured.startTime !== stored.startTime) {
    throw new Error(`Missing or mismatched WCL snapshot for ${stored.code}`);
  }
  return missingIds.map(fightId => {
    const original = stored.fightSequence.find((fight: any) => fight.fightId === fightId);
    const fight = captured.fights?.find((candidate: any) => candidate.id === fightId);
    if (!original || !fight || !raidLairs(raidId).some(lair => lair.id === fight.encounterID) ||
        fight.encounterID !== original.encounterID || fight.difficulty !== original.difficulty ||
        typeof fight.kill !== "boolean" || !Number.isFinite(fight.startTime) || !Number.isFinite(fight.endTime) || fight.endTime < fight.startTime) {
      throw new Error(`Invalid WCL lair evidence for ${stored.code}:${fightId}`);
    }
    return {
      reportCode: stored.code, guildId: stored.guildId, fightId, zoneId: raidId,
      encounterID: fight.encounterID, encounterName: fight.name, difficulty: fight.difficulty,
      isKill: fight.kill, bossPercentage: fight.bossPercentage ?? 0, fightPercentage: fight.fightPercentage ?? 0,
      reportStartTime: captured.startTime, reportEndTime: captured.endTime,
      fightStartTime: fight.startTime, fightEndTime: fight.endTime, duration: fight.endTime - fight.startTime,
      timestamp: new Date(captured.startTime + fight.startTime),
    };
  });
}
