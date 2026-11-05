import { ArmoryError } from "./forever-armory";

export const MINUTE = 60_000;
interface ArmoryQueueHealth {
  failedJobs?: string[];
  failureWindowStartedAt?: Date | null;
}

// Isolated launch failures must not stop unrelated profiles. Require ten distinct
// failed jobs without a healthy response within five minutes before pausing.
export function armoryQueueHealth(previous: ArmoryQueueHealth, job: string, error?: ArmoryError, now = Date.now()) {
  const healthy = { failedJobs: [] as string[], failureWindowStartedAt: null, pauseMs: 0 };
  if (!error) return healthy;
  if (error.retryAfterMs > 0 || [429, 401, 403].includes(error.status)) {
    return { ...healthy, pauseMs: Math.max(2 * MINUTE, error.retryAfterMs) };
  }
  // Missing, stale or mismatched individual profiles are not evidence of an outage.
  if (error.status === 404 || ["stale_data", "identity_mismatch"].includes(error.code)) return healthy;
  const startedAt = previous.failureWindowStartedAt?.getTime();
  const inWindow = startedAt != null && now - startedAt < 5 * MINUTE;
  const failedJobs = [...new Set([...(inWindow ? previous.failedJobs ?? [] : []), job])];
  if (failedJobs.length >= 10) return { ...healthy, pauseMs: 2 * MINUTE };
  return { failedJobs, failureWindowStartedAt: inWindow ? previous.failureWindowStartedAt! : new Date(now), pauseMs: 0 };
}

export function failureDelay(failures: number, error: ArmoryError, jitter = Math.random()): number {
  const base = error.status === 404 ? 15 * MINUTE : 2 * MINUTE;
  return Math.max(error.retryAfterMs, Math.min(24 * 60 * MINUTE, base * 2 ** Math.min(failures, 10)) * (1 + jitter * 0.2));
}
export function refreshDelay(level: number, lastLevelAt: Date, now = Date.now()): number {
  if (level >= 60) return 6 * 60 * MINUTE;
  return now - lastLevelAt.getTime() > 24 * 60 * MINUTE ? 60 * MINUTE : 2 * MINUTE;
}
export function validateProgress(previous: { level?: number | null; sourceUpdatedAt?: Date | null }, next: { level: number; sourceUpdatedAt: Date }): void {
  if ((previous.level != null && next.level < previous.level) ||
      (previous.sourceUpdatedAt && next.sourceUpdatedAt < previous.sourceUpdatedAt)) throw new ArmoryError("stale_data");
}
export function mayRequestRefresh(character: { status: string; failures: number; nextFetchAt?: Date | null; lastAttemptAt?: Date | null }, now = Date.now()): boolean {
  return character.status === "tracked" && character.failures === 0 &&
    !!character.nextFetchAt && character.nextFetchAt.getTime() > now &&
    (!character.lastAttemptAt || now - character.lastAttemptAt.getTime() >= 5 * MINUTE);
}
