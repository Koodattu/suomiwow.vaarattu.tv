import { CURRENT_RAID_IDS, TRACKED_RAIDS } from "../config/guilds";

export const PICKEM_PLACEHOLDER_RAID_ID = -1;
export const PICKEM_REFERENCE_RANKINGS_LIMIT = 15;

export function isPickemPlaceholderRaidIds(raidIds: readonly number[] | null | undefined): boolean {
  return raidIds?.length === 1 && raidIds[0] === PICKEM_PLACEHOLDER_RAID_ID;
}

export function isPickemReferenceRaidId(raidId: number): boolean {
  return Number.isInteger(raidId) && TRACKED_RAIDS.includes(raidId) && !CURRENT_RAID_IDS.includes(raidId);
}

export function getRegularPickemRaidIdsValidationError(value: unknown): string | null {
  if (!Array.isArray(value) || value.length === 0) {
    return "raidIds must be a non-empty array for regular pickems";
  }

  if (!value.every((raidId) => typeof raidId === "number" && Number.isInteger(raidId))) {
    return "raidIds must contain only integer raid IDs";
  }

  const raidIds = value as number[];
  if (isPickemPlaceholderRaidIds(raidIds)) {
    return null;
  }

  if (raidIds.includes(PICKEM_PLACEHOLDER_RAID_ID)) {
    return "The upcoming raid placeholder must be selected on its own";
  }

  if (raidIds.some((raidId) => raidId <= 0)) {
    return "raidIds must contain positive raid IDs or the upcoming raid placeholder";
  }

  if (new Set(raidIds).size !== raidIds.length) {
    return "raidIds must not contain duplicates";
  }

  return null;
}
