export const MIN_GUILD_RAID_REPORTS_FOR_CHARACTER_ELIGIBILITY = 2;
export const MIN_CHARACTER_RAID_PULLS_FOR_RANKING_ELIGIBILITY = 40;
export const MIN_CHARACTER_RAID_MYTHIC_REPORTS_FOR_CCG_ELIGIBILITY = 3;

export const COMPLETE_CCG_SCORE_FILTER = {
  score: { $gte: 0 },
  parseScore: { $gte: 0 },
  survivalScore: { $gte: 0 },
  survivalPercentile: { $gte: 0 },
};
