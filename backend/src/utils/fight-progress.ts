export type FightProgressSource = "kill" | "fight" | "boss" | "unknown";

export interface FightProgressInput {
  isKill?: boolean;
  fightPercentage?: number | null;
  bossPercentage?: number | null;
}

export interface ResolvedFightProgress {
  percentage: number | null;
  source: FightProgressSource;
}

function isUsableWipePercentage(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 100;
}

export function resolveFightProgress(fight: FightProgressInput): ResolvedFightProgress {
  if (fight.isKill === true) {
    return { percentage: 0, source: "kill" };
  }

  if (isUsableWipePercentage(fight.fightPercentage)) {
    return { percentage: fight.fightPercentage, source: "fight" };
  }

  if (isUsableWipePercentage(fight.bossPercentage)) {
    return { percentage: fight.bossPercentage, source: "boss" };
  }

  return { percentage: null, source: "unknown" };
}
