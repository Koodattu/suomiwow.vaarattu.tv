export interface AvoidableMechanic {
  key: string;
  version: number;
  zoneId: number;
  encounterId: number;
  boss: string;
  name: string;
  damageSpellIds: number[];
  icon: string;
}
export interface MechanicOptions {
  mechanics: AvoidableMechanic[];
  raids: { id: number; name: string; expansion: string }[];
  guilds: { id: string; name: string; realm: string; region: string }[];
}
export interface MechanicFilters {
  mechanic: string;
  guildId?: string;
  outcome: "all" | "kills" | "wipes";
  sort: "damage" | "hits" | "hitsPerPull";
  page: number;
}
export interface MechanicLeaderboard {
  mechanic: AvoidableMechanic;
  rows: {
    key: string; name: string; realm: string; region: string; classId: number; guildName: string;
    damage: number; hits: number; directHits: number; ticks: number; pulls: number; hitsPerPull: number;
    reportCode: string; fightId: number; actorId: number;
  }[];
  totals: { players: number; damage: number; hits: number; maxDamage: number; maxHits: number; maxHitsPerPull: number };
  coverage: { pending: number; fetched: number; failed: number; archived: number; unavailable: number; duplicate: number };
  updatedAt: string | null;
  page: number;
  limit: number;
  totalPages: number;
}

export interface MechanicBackfillRequest {
  mechanicKeys: string[];
  guildId?: string;
  retryUnavailable: boolean;
}
export interface MechanicBackfillResult {
  queued: number;
  retried: number;
  mechanicKeys: string[];
}
export type MechanicJobStatus = "pending" | "in_progress" | "paused" | "completed" | "failed";
export interface MechanicCollectionStatus {
  mechanics: { key: string; coverage: MechanicLeaderboard["coverage"] }[];
  jobs: {
    id: string; guildId: string; guildName: string; status: MechanicJobStatus; mechanicKeys: string[];
    progress: { totalReportsEstimate: number; reportsFetched: number; fightsSaved: number; currentPage: number; percentComplete: number };
    lastError?: string; lastActivityAt: string;
  }[];
  counts: Record<MechanicJobStatus, number>;
  buckets: { client: RateLimitStatus; user: RateLimitStatus };
  processorPaused: boolean;
}
import type { RateLimitStatus } from "./index";
