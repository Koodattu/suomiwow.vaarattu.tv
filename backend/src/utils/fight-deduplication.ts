export interface FightDeduplicationCandidate {
  encounterID?: number;
  difficulty?: number;
  bossPercentage?: number;
  fightPercentage?: number;
  duration?: number;
}

export type FightDeduplicationBuckets<T extends FightDeduplicationCandidate> = Map<string, T>;

const PERCENTAGE_TOLERANCE = 0.01;
const DURATION_TOLERANCE = 100;

function numericValue(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function bucketIndex(value: number, bucketSize: number): number {
  return Math.floor(value / bucketSize);
}

function bucketKey(encounterID: number, difficulty: number, bossPercentage: number, fightPercentage: number, duration: number): string {
  return `${encounterID}:${difficulty}:${bossPercentage}:${fightPercentage}:${duration}`;
}

export function findDuplicateFight<T extends FightDeduplicationCandidate>(fight: T, buckets: FightDeduplicationBuckets<T>): T | undefined {
  const encounterID = numericValue(fight.encounterID);
  const difficulty = numericValue(fight.difficulty);
  const bossPercentage = numericValue(fight.bossPercentage);
  const fightPercentage = numericValue(fight.fightPercentage);
  const duration = numericValue(fight.duration);
  const bossPercentageBucket = bucketIndex(bossPercentage, PERCENTAGE_TOLERANCE);
  const fightPercentageBucket = bucketIndex(fightPercentage, PERCENTAGE_TOLERANCE);
  const durationBucket = bucketIndex(duration, DURATION_TOLERANCE);

  for (let bossOffset = -1; bossOffset <= 1; bossOffset++) {
    for (let fightOffset = -1; fightOffset <= 1; fightOffset++) {
      for (let durationOffset = -1; durationOffset <= 1; durationOffset++) {
        const candidate = buckets.get(
          bucketKey(
            encounterID,
            difficulty,
            bossPercentageBucket + bossOffset,
            fightPercentageBucket + fightOffset,
            durationBucket + durationOffset,
          ),
        );
        if (!candidate) continue;

        if (
          Math.abs(bossPercentage - numericValue(candidate.bossPercentage)) <= PERCENTAGE_TOLERANCE &&
          Math.abs(fightPercentage - numericValue(candidate.fightPercentage)) <= PERCENTAGE_TOLERANCE &&
          Math.abs(duration - numericValue(candidate.duration)) <= DURATION_TOLERANCE
        ) {
          return candidate;
        }
      }
    }
  }

  const key = bucketKey(encounterID, difficulty, bossPercentageBucket, fightPercentageBucket, durationBucket);
  buckets.set(key, fight);

  return undefined;
}
