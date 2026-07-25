import { CcgTierGrade } from "../config/ccg";

export function shouldPublishCcgCardSnapshot(
  latestCard: { tierGrade: CcgTierGrade } | null | undefined,
  nextGrade: CcgTierGrade,
): boolean {
  return !latestCard || latestCard.tierGrade !== nextGrade;
}

export function nextCcgCardSnapshotVersion(latestCard: { snapshotVersion?: number | null } | null | undefined): number {
  const current = latestCard?.snapshotVersion;
  return Number.isInteger(current) && (current as number) > 0 ? (current as number) + 1 : latestCard ? 2 : 1;
}
