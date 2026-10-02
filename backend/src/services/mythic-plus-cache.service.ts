import { SharedSnapshotCacheService } from "./shared-snapshot-cache.service";

export const MYTHIC_PLUS_OPTIONS_CACHE_KEY = "mythic-plus:options:v2";
export const MYTHIC_PLUS_OPTIONS_TTL_MS = 24 * 60 * 60 * 1000;
export const MYTHIC_PLUS_LEADERBOARD_TTL_MS = 5 * 60 * 1000;

export class MythicPlusCacheService extends SharedSnapshotCacheService {
  constructor() {
    super("Mythic+ Cache", (key) => key === MYTHIC_PLUS_OPTIONS_CACHE_KEY ? 7 * 24 * 60 * 60 * 1000 : 60 * 60 * 1000);
  }

  async markOptionsStale(minAgeMs = 0): Promise<void> {
    await this.markStale(MYTHIC_PLUS_OPTIONS_CACHE_KEY, minAgeMs);
  }
}

export default new MythicPlusCacheService();
