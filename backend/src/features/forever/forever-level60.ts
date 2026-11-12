import { ArmoryError } from "./forever-armory";

// The Forever static catalog has two Master achievement IDs per class.
const masterIds = new Map<string, readonly number[]>([
  ["Warrior", [61501, 63971]], ["Druid", [61504, 63974]], ["Hunter", [61993, 63977]],
  ["Mage", [61996, 63980]], ["Paladin", [61999, 63983]], ["Priest", [62002, 63986]],
  ["Rogue", [62005, 63989]], ["Shaman", [62008, 63992]], ["Warlock", [62011, 63995]],
]);
export const level60Classes = [...masterIds.keys()];
const DAY = 86_400_000;

type Observation = { level: number; observedAt: Date; sourceUpdatedAt?: Date | null };
type ProfileEvidence = { profileLevel?: number | null; sourceUpdatedAt?: Date | null };
export function level60Window(history: readonly Observation[], firstSeen: Date, profile?: ProfileEvidence) {
  // Level history contains increases only. A repeated, possibly stale roster
  // read is not fresh evidence that the player was still below the cap.
  let lower = 0, upper = firstSeen.getTime();
  for (const point of history) {
    if (point.level >= 1 && point.level < 60) lower = Math.max(lower, point.observedAt.getTime());
    if (point.level === 60) upper = Math.min(upper, point.observedAt.getTime(), point.sourceUpdatedAt?.getTime() ?? Infinity);
  }
  if (lower && profile?.profileLevel && profile.sourceUpdatedAt) {
    if (profile.profileLevel < 60) lower = Math.max(lower, profile.sourceUpdatedAt.getTime());
    if (profile.profileLevel === 60) upper = Math.min(upper, profile.sourceUpdatedAt.getTime());
  }
  return lower > 0 && upper > lower && upper - lower <= DAY ? { lower, upper } : null;
}

type Achievement = { id?: number; achievement?: { id?: number }; criteria?: { is_completed?: boolean }; completed_timestamp?: number };
// undefined means Blizzard hasn't published a completed class milestone yet.
// null means the published evidence can't identify a plausible finish.
export function level60Estimate(payload: unknown, slug: string, className: string, window: { lower: number; upper: number }): Date | null | undefined {
  const document = payload as { character?: { slug?: string }; achievements?: Achievement[] } | null;
  if (document?.character?.slug?.normalize("NFC") !== slug || !Array.isArray(document.achievements)) throw new ArmoryError("invalid_data");
  const ids = masterIds.get(className);
  const times = new Set<number>();
  for (const entry of document.achievements) {
    if (!entry?.id || !ids?.includes(entry.id) || entry.id !== entry.achievement?.id || entry.criteria?.is_completed !== true) continue;
    const at = entry.completed_timestamp;
    if (typeof at === "number" && Number.isSafeInteger(at) && at > 0) times.add(at);
  }
  if (!times.size) return undefined;
  const [at] = times;
  return times.size === 1 && at > window.lower && at <= window.upper ? new Date(at) : null;
}

type RankRow = { level?: number | null; lastLevelAt?: Date | null; estimatedLevel60At?: Date | null };
function finishMinute(row: RankRow): number {
  return Math.floor(((row.estimatedLevel60At ?? row.lastLevelAt)?.getTime() ?? Infinity) / 60_000);
}

// Input is already in first-observation and stable ID order within each level.
// Stable sorting preserves that order for equal minutes and for uncapped players.
export function compareForeverLevels(a: RankRow, b: RankRow): number {
  if (a.level !== 60 || b.level !== 60) return (b.level ?? 0) - (a.level ?? 0);
  const first = finishMinute(a), second = finishMinute(b);
  return first === second ? 0 : first - second;
}
