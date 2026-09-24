export interface CharacterDeathsResponse {
  summary: {
    pulls: number;
    evaluatedPulls: number;
    unconfirmedPulls: number;
    pullsWithDeaths: number;
    survivedPulls: number;
    deaths: number;
    firstThreePulls: number;
    averageFirstDeathTime: number | null;
  };
  timing: number[];
  events: Array<{
    reportCode: string;
    fightId: number;
    date: string;
    isKill: boolean;
    deathTime: number;
    duration: number;
    deathPercent: number;
    order: number | null;
    phase: string | null;
  }>;
  pagination: { currentPage: number; totalPages: number; totalItems: number };
}
