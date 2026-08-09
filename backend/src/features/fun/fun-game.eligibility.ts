import { MIN_CHARACTER_RAID_MYTHIC_REPORTS_FOR_FUN_ELIGIBILITY } from "../../config/character-eligibility";
import { TRACKED_RAIDS } from "../../config/guilds";
import CharacterRaidParticipation from "../../models/CharacterRaidParticipation";

export const MIN_FUN_CHARACTER_MYTHIC_REPORTS = MIN_CHARACTER_RAID_MYTHIC_REPORTS_FOR_FUN_ELIGIBILITY;

export function funMythicParticipationFilter() {
  return {
    zoneId: { $in: TRACKED_RAIDS },
    mythicReportCount: { $gte: MIN_FUN_CHARACTER_MYTHIC_REPORTS },
  };
}

export function funMythicProgressMatch() {
  return {
    "progress.raidId": { $in: TRACKED_RAIDS },
    "progress.difficulty": "mythic" as const,
  };
}

export function funMythicGuildFilter() {
  return {
    progress: {
      $elemMatch: {
        raidId: { $in: TRACKED_RAIDS },
        difficulty: "mythic" as const,
        bosses: { $elemMatch: { pullCount: { $gt: 0 } } },
      },
    },
  };
}

export async function loadFunEligibleCanonicalCharacterIds(): Promise<number[]> {
  const ids = await CharacterRaidParticipation.distinct("wclCanonicalCharacterId", {
    ...funMythicParticipationFilter(),
  });
  return ids.filter((id): id is number => typeof id === "number");
}
