export interface DeathAnalysisPull {
  reportCode: string;
  fightId: number;
  date: string;
  duration: number;
  isKill: boolean;
  complete: boolean;
  rosterComplete: boolean;
  deaths: Array<{ deathTime: number; order: number | null; phase: string | null }>;
  otherDeathTimes: number[];
  phases: Array<{ time: number; name: string }>;
}

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
  timeline: DeathAnalysisPull[];
  eventOptions: { phases: string[]; hasUnknownPhase: boolean };
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
