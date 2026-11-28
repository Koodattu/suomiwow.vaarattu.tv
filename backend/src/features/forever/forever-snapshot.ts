import { SharedSnapshotCacheService } from "../../services/shared-snapshot-cache.service";
import logger from "../../utils/logger";
import { ForeverWorker } from "./forever.models";
import { ForeverLeaderboardCache, ForeverLeaderboardLease } from "./forever-leaderboard.models";

const FRESH_MS = 60_000;
type Snapshot<T> = { generatedAt: string; sourceRevision?: number; builtAt?: number; data: T };

/** Public page snapshots share storage and moderation revisions with the leaderboard. */
export class ForeverSnapshotCache<T> {
  private readonly shared = new SharedSnapshotCacheService("Forever pages", () => 0,
    { cache: ForeverLeaderboardCache, leases: ForeverLeaderboardLease });
  private local?: { key: string; snapshot: Snapshot<T> };
  private readonly pending = new Map<string, Promise<Snapshot<T>>>();
  private timer?: ReturnType<typeof setInterval>;
  private warming?: Promise<void>;

  /** `freshMs` suits each page's source: pages fed by twice-daily profile checks can rebuild less often. */
  constructor(private readonly keyPrefix: string, private readonly build: () => Promise<T>, private readonly revisionField?: "namegameRevision",
    private readonly freshMs = FRESH_MS) {}

  async get(warm = false): Promise<T> {
    // Never reuse a pre-moderation snapshot, including while an older build is in flight.
    const worker = await ForeverWorker.findById("armory").select(this.revisionField ? `leaderboardRevision ${this.revisionField}` : "leaderboardRevision").lean();
    const key = `${this.keyPrefix}:${worker?.leaderboardRevision || 0}`;
    const freshAfter = Date.now() - (warm ? this.freshMs / 2 : this.freshMs);
    if (this.local?.key === key && Date.parse(this.local.snapshot.generatedAt) > freshAfter) return this.local.snapshot.data;
    let promise = this.pending.get(key);
    if (!promise) {
      const sourceRevision = this.revisionField ? worker?.[this.revisionField] ?? 0 : undefined;
      promise = this.shared.get<Snapshot<T>>(key, async previous => {
        // Periodically reconcile direct database repairs and mixed-version deployments.
        const reusable = warm && sourceRevision !== undefined && previous?.sourceRevision === sourceRevision
          && Date.parse(previous.generatedAt) > Date.now() - this.freshMs
          && (previous.builtAt ?? 0) > Date.now() - 15 * 60_000;
        const data = reusable ? previous.data : await this.build();
        return { generatedAt: new Date().toISOString(), ...(sourceRevision !== undefined ? { sourceRevision, builtAt: reusable ? previous.builtAt : Date.now() } : {}), data };
      }, this.freshMs, warm).then(snapshot => {
        this.local = { key, snapshot };
        return snapshot;
      }).finally(() => { this.pending.delete(key); });
      this.pending.set(key, promise);
    }
    return (await promise).data;
  }

  start() {
    if (this.timer) return;
    const warm = () => {
      if (this.warming) return;
      this.warming = this.get(true).then(() => undefined,
        error => { logger.error(`[Forever] ${this.keyPrefix} warm-up failed`, error); })
        .finally(() => { this.warming = undefined; });
    };
    warm();
    // Check more often than the refresh-ahead window so build time cannot push
    // the next eligible tick right up against expiry.
    this.timer = setInterval(warm, this.freshMs / 4);
    this.timer.unref();
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.warming;
    await Promise.allSettled(this.pending.values());
    this.local = undefined;
  }
}
