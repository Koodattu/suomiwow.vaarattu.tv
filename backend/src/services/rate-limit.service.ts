import logger from "../utils/logger";
import RateLimitState from "../models/RateLimitState";

export interface WCLRateLimitData {
  limitPerHour: number;
  pointsSpentThisHour: number;
  pointsResetIn: number;
}

export type WCLRateLimitEndpoint = "client" | "user";
export type RateLimitStatusSource = "unknown" | "observed" | "estimated" | "rate_limited";

export interface WCLRateLimitBucketIdentity {
  endpoint: WCLRateLimitEndpoint;
  bucketId: "shared" | WCLRateLimitEndpoint;
  persistentKey: string;
  sharedCredentialBucket: boolean;
}

export interface RateLimitStatus {
  endpoint: WCLRateLimitEndpoint;
  bucketId: string;
  sharedCredentialBucket: boolean;
  pointsUsed: number;
  pointsMax: number;
  pointsRemaining: number;
  percentUsed: number;
  resetAt: Date;
  resetInSeconds: number;
  isNearLimit: boolean;
  isHardLimited: boolean;
  isManuallyPaused: boolean;
  isPaused: boolean;
  source: RateLimitStatusSource;
  lastUpdated: Date;
  lastObservedAt: Date | null;
  lastEstimatedAt: Date | null;
  last429At: Date | null;
}

interface RateLimitConfig {
  liveOperationsReserve: number;
  warningThreshold: number;
  pauseThreshold: number;
}

interface BucketState {
  pointsUsed: number;
  pointsMax: number;
  resetAt: Date;
  lastUpdated: Date;
  lastObservedAt: Date | null;
  lastEstimatedAt: Date | null;
  last429At: Date | null;
  rateLimitedUntil: Date | null;
  source: RateLimitStatusSource;
  estimatedRequestsSinceObservation: number;
}

const LEGACY_STATE_KEY = "warcraftlogs";
const DEFAULT_POINTS_MAX = 3600;
const RESET_WINDOW_TOLERANCE_MS = 60_000;
const DEFAULT_WINDOW_MS = 60 * 60 * 1000;

export function resolveWclRateLimitBucket(
  endpoint: WCLRateLimitEndpoint,
  environment: { WCL_CLIENT_ID?: string; WCL_OAUTH_CLIENT_ID?: string } = process.env,
): WCLRateLimitBucketIdentity {
  const clientId = environment.WCL_CLIENT_ID || "";
  const userClientId = environment.WCL_OAUTH_CLIENT_ID || clientId;
  const sharedCredentialBucket = clientId.length > 0 && clientId === userClientId;
  const bucketId = sharedCredentialBucket ? "shared" : endpoint;

  return {
    endpoint,
    bucketId,
    persistentKey: `warcraftlogs:${bucketId}`,
    sharedCredentialBucket,
  };
}

export class RateLimitService {
  private readonly apiProbeRequestInterval = 25;
  private readonly apiProbeMaxAgeMs = 5 * 60 * 1000;
  private readonly apiProbeNearLimitRequestInterval = 5;
  private readonly bucketStates = new Map<string, BucketState>();
  private readonly lastHardLimitRefreshAt = new Map<string, number>();
  private manualPause = false;

  private config: RateLimitConfig = {
    liveOperationsReserve: 20,
    warningThreshold: 70,
    pauseThreshold: 80,
  };

  private onPauseCallbacks: Array<(endpoint: WCLRateLimitEndpoint) => void> = [];
  private onResumeCallbacks: Array<(endpoint: WCLRateLimitEndpoint) => void> = [];

  getBucketIdentity(endpoint: WCLRateLimitEndpoint = "client"): WCLRateLimitBucketIdentity {
    return resolveWclRateLimitBucket(endpoint);
  }

  async updateFromResponse(
    rateLimitData: WCLRateLimitData,
    endpoint: WCLRateLimitEndpoint = "client",
    minimumQueryCharge = 0,
  ): Promise<void> {
    if (!rateLimitData) return;

    const identity = this.getBucketIdentity(endpoint);
    const state = this.getBucketState(identity);
    const now = new Date();
    const observedResetAt = new Date(now.getTime() + Math.max(0, rateLimitData.pointsResetIn) * 1000);
    const observedPoints = Math.max(0, rateLimitData.pointsSpentThisHour + Math.max(0, minimumQueryCharge));
    const wasNearLimit = this.isNearLimit(endpoint);
    const hardLimited = this.isStateHardLimited(state, now);
    const sameWindow = this.isSameWindow(state.resetAt, observedResetAt);

    if (!hardLimited) {
      const retainedEstimate = sameWindow && state.pointsUsed > observedPoints;
      state.pointsUsed = retainedEstimate ? state.pointsUsed : observedPoints;
      state.pointsMax = rateLimitData.limitPerHour;
      state.resetAt = observedResetAt;
      state.rateLimitedUntil = null;
      state.source = retainedEstimate ? "estimated" : "observed";
      state.estimatedRequestsSinceObservation = retainedEstimate ? state.estimatedRequestsSinceObservation : 0;
    }
    state.lastObservedAt = now;
    state.lastUpdated = now;

    try {
      const epoch = new Date(0);
      const hardLimitExpression = { $gt: [{ $ifNull: ["$rateLimitedUntil", epoch] }, now] };
      const sameWindowExpression = {
        $lte: [
          { $abs: { $subtract: [{ $ifNull: ["$resetAt", epoch] }, observedResetAt] } },
          RESET_WINDOW_TOLERANCE_MS,
        ],
      };
      const currentPointsExpression = { $ifNull: ["$pointsUsed", 0] };
      const retainedEstimateExpression = {
        $and: [sameWindowExpression, { $gt: [currentPointsExpression, observedPoints] }],
      };

      const updated = await RateLimitState.findOneAndUpdate(
        { key: identity.persistentKey },
        [{
          $set: {
            key: identity.persistentKey,
            pointsUsed: {
              $cond: [
                hardLimitExpression,
                currentPointsExpression,
                { $cond: [retainedEstimateExpression, currentPointsExpression, observedPoints] },
              ],
            },
            pointsMax: { $cond: [hardLimitExpression, { $ifNull: ["$pointsMax", rateLimitData.limitPerHour] }, rateLimitData.limitPerHour] },
            resetAt: { $cond: [hardLimitExpression, "$resetAt", observedResetAt] },
            lastUpdated: now,
            lastObservedAt: now,
            lastEstimatedAt: { $ifNull: ["$lastEstimatedAt", null] },
            last429At: { $ifNull: ["$last429At", null] },
            rateLimitedUntil: { $cond: [hardLimitExpression, "$rateLimitedUntil", null] },
            source: {
              $cond: [hardLimitExpression, "rate_limited", { $cond: [retainedEstimateExpression, "estimated", "observed"] }],
            },
            estimatedRequestsSinceObservation: {
              $cond: [
                hardLimitExpression,
                { $ifNull: ["$estimatedRequestsSinceObservation", 0] },
                { $cond: [retainedEstimateExpression, { $ifNull: ["$estimatedRequestsSinceObservation", 0] }, 0] },
              ],
            },
            manualPause: { $ifNull: ["$manualPause", false] },
          },
        }],
        { upsert: true, returnDocument: "after", updatePipeline: true },
      ).lean();
      if (updated) this.hydrateBucketState(identity, updated);
    } catch (error) {
      logger.error(`[RateLimit] Failed to persist observed ${identity.bucketId} bucket state:`, error);
    }

    const percentUsed = this.getPercentUsed(endpoint);
    const isNearNow = this.isNearLimit(endpoint);
    if (!wasNearLimit && isNearNow) {
      logger.warn(
        `[RateLimit] Approaching limit for endpoint=${endpoint} bucket=${identity.bucketId}: ${this.getBucketState(identity).pointsUsed.toFixed(0)}/${this.getBucketState(identity).pointsMax} (${percentUsed.toFixed(1)}%), resets at ${this.getBucketState(identity).resetAt.toISOString()}`,
      );
      this.notifyPause(endpoint);
    } else if (wasNearLimit && !isNearNow) {
      logger.info(`[RateLimit] Rate limit cleared for endpoint=${endpoint} bucket=${identity.bucketId}: ${percentUsed.toFixed(1)}% used`);
      this.notifyResume(endpoint);
    }
  }

  async recordEstimatedUsage(points: number, endpoint: WCLRateLimitEndpoint = "client"): Promise<void> {
    if (!Number.isFinite(points) || points <= 0) return;

    const identity = this.getBucketIdentity(endpoint);
    const state = this.getBucketState(identity);
    const now = new Date();
    const amount = Math.ceil(points);
    if (this.isStateHardLimited(state, now)) return;

    if (state.resetAt.getTime() <= now.getTime()) {
      state.pointsUsed = 0;
      state.resetAt = new Date(now.getTime() + DEFAULT_WINDOW_MS);
    }
    state.pointsUsed += amount;
    state.lastUpdated = now;
    state.lastEstimatedAt = now;
    state.source = "estimated";
    state.estimatedRequestsSinceObservation += 1;

    try {
      const epoch = new Date(0);
      const fallbackResetAt = new Date(now.getTime() + DEFAULT_WINDOW_MS);
      const hardLimitExpression = { $gt: [{ $ifNull: ["$rateLimitedUntil", epoch] }, now] };
      const activeWindowExpression = { $gt: [{ $ifNull: ["$resetAt", epoch] }, now] };
      const updated = await RateLimitState.findOneAndUpdate(
        { key: identity.persistentKey },
        [{
          $set: {
            key: identity.persistentKey,
            pointsUsed: {
              $cond: [
                hardLimitExpression,
                { $ifNull: ["$pointsUsed", 0] },
                {
                  $add: [
                    { $cond: [activeWindowExpression, { $ifNull: ["$pointsUsed", 0] }, 0] },
                    amount,
                  ],
                },
              ],
            },
            pointsMax: { $ifNull: ["$pointsMax", DEFAULT_POINTS_MAX] },
            resetAt: { $cond: [hardLimitExpression, "$resetAt", { $cond: [activeWindowExpression, "$resetAt", fallbackResetAt] }] },
            lastUpdated: { $cond: [hardLimitExpression, { $ifNull: ["$lastUpdated", now] }, now] },
            lastObservedAt: { $ifNull: ["$lastObservedAt", null] },
            lastEstimatedAt: { $cond: [hardLimitExpression, { $ifNull: ["$lastEstimatedAt", null] }, now] },
            last429At: { $ifNull: ["$last429At", null] },
            rateLimitedUntil: { $cond: [hardLimitExpression, "$rateLimitedUntil", null] },
            source: { $cond: [hardLimitExpression, "rate_limited", "estimated"] },
            estimatedRequestsSinceObservation: {
              $cond: [
                hardLimitExpression,
                { $ifNull: ["$estimatedRequestsSinceObservation", 0] },
                {
                  $add: [
                    { $cond: [activeWindowExpression, { $ifNull: ["$estimatedRequestsSinceObservation", 0] }, 0] },
                    1,
                  ],
                },
              ],
            },
            manualPause: { $ifNull: ["$manualPause", false] },
          },
        }],
        { upsert: true, returnDocument: "after", updatePipeline: true },
      ).lean();
      if (updated) this.hydrateBucketState(identity, updated);
    } catch (error) {
      logger.error(`[RateLimit] Failed to persist estimated ${identity.bucketId} bucket usage:`, error);
    }
  }

  async recordRateLimited(
    endpoint: WCLRateLimitEndpoint,
    retryAfterMs: number,
  ): Promise<RateLimitStatus> {
    const identity = this.getBucketIdentity(endpoint);
    const state = this.getBucketState(identity);
    const now = new Date();
    const retryAt = new Date(now.getTime() + Math.max(1000, retryAfterMs));
    const wasHardLimited = this.isStateHardLimited(state, now);
    const currentHardLimit = state.rateLimitedUntil && state.rateLimitedUntil > retryAt ? state.rateLimitedUntil : retryAt;

    state.pointsUsed = Math.max(state.pointsUsed, state.pointsMax);
    state.resetAt = currentHardLimit;
    state.lastUpdated = now;
    state.last429At = now;
    state.rateLimitedUntil = currentHardLimit;
    state.source = "rate_limited";

    try {
      const epoch = new Date(0);
      const existingHardLimitExpression = { $ifNull: ["$rateLimitedUntil", epoch] };
      const effectiveHardLimitExpression = {
        $cond: [{ $gt: [existingHardLimitExpression, retryAt] }, existingHardLimitExpression, retryAt],
      };
      const pointsMaxExpression = { $ifNull: ["$pointsMax", DEFAULT_POINTS_MAX] };
      const currentPointsExpression = { $ifNull: ["$pointsUsed", 0] };
      const updated = await RateLimitState.findOneAndUpdate(
        { key: identity.persistentKey },
        [{
          $set: {
            key: identity.persistentKey,
            pointsUsed: { $cond: [{ $gt: [currentPointsExpression, pointsMaxExpression] }, currentPointsExpression, pointsMaxExpression] },
            pointsMax: pointsMaxExpression,
            resetAt: effectiveHardLimitExpression,
            lastUpdated: now,
            lastObservedAt: { $ifNull: ["$lastObservedAt", null] },
            lastEstimatedAt: { $ifNull: ["$lastEstimatedAt", null] },
            last429At: now,
            rateLimitedUntil: effectiveHardLimitExpression,
            source: "rate_limited",
            estimatedRequestsSinceObservation: { $ifNull: ["$estimatedRequestsSinceObservation", 0] },
            manualPause: { $ifNull: ["$manualPause", false] },
          },
        }],
        { upsert: true, returnDocument: "after", updatePipeline: true },
      ).lean();
      if (updated) this.hydrateBucketState(identity, updated);
    } catch (error) {
      logger.error(`[RateLimit] Failed to persist HTTP 429 for ${identity.bucketId} bucket:`, error);
    }

    if (!wasHardLimited) this.notifyPause(endpoint);
    return this.getStatus(endpoint);
  }

  shouldProbeApiState(endpoint: WCLRateLimitEndpoint = "client"): boolean {
    const state = this.getBucketState(this.getBucketIdentity(endpoint));
    const probeAgeMs = Date.now() - (state.lastObservedAt?.getTime() ?? 0);
    if (probeAgeMs >= this.apiProbeMaxAgeMs) return true;
    if (state.estimatedRequestsSinceObservation >= this.apiProbeRequestInterval) return true;
    return this.getPercentUsed(endpoint) >= this.config.warningThreshold
      && state.estimatedRequestsSinceObservation >= this.apiProbeNearLimitRequestInterval;
  }

  isNearLimit(endpoint: WCLRateLimitEndpoint = "client"): boolean {
    return this.getPercentUsed(endpoint) >= this.config.pauseThreshold;
  }

  isHardLimited(endpoint: WCLRateLimitEndpoint = "client"): boolean {
    return this.isStateHardLimited(this.getBucketState(this.getBucketIdentity(endpoint)), new Date());
  }

  canProceedBackground(endpoint: WCLRateLimitEndpoint = "client"): boolean {
    if (this.manualPause || this.isHardLimited(endpoint)) return false;
    return !this.isNearLimit(endpoint);
  }

  canProceedLive(endpoint: WCLRateLimitEndpoint = "client"): boolean {
    return !this.isHardLimited(endpoint) && this.getPercentUsed(endpoint) < 95;
  }

  getBackgroundCapacity(endpoint: WCLRateLimitEndpoint = "client"): number {
    const state = this.getBucketState(this.getBucketIdentity(endpoint));
    const pointsUsed = this.hasResetOccurred(state) ? 0 : state.pointsUsed;
    const reservePoints = state.pointsMax * (this.config.liveOperationsReserve / 100);
    return Math.max(0, state.pointsMax - reservePoints - pointsUsed);
  }

  getTimeUntilReset(endpoint: WCLRateLimitEndpoint = "client"): number {
    const state = this.getBucketState(this.getBucketIdentity(endpoint));
    const resetTime = Math.max(state.resetAt.getTime(), state.rateLimitedUntil?.getTime() ?? 0);
    return Math.max(0, resetTime - Date.now());
  }

  getPercentUsed(endpoint: WCLRateLimitEndpoint = "client"): number {
    const state = this.getBucketState(this.getBucketIdentity(endpoint));
    if (state.pointsMax === 0 || this.hasResetOccurred(state)) return 0;
    return (state.pointsUsed / state.pointsMax) * 100;
  }

  async setManualPause(paused: boolean): Promise<void> {
    if (this.manualPause !== paused) {
      this.manualPause = paused;
      if (paused) {
        logger.info("[RateLimit] Background processing manually paused by admin");
        this.notifyPause("client");
      } else {
        logger.info("[RateLimit] Background processing manually resumed by admin");
        if (this.canProceedBackground("client")) this.notifyResume("client");
      }
    }

    const now = new Date();
    await RateLimitState.updateOne(
      { key: LEGACY_STATE_KEY },
      {
        $set: { manualPause: paused },
        $setOnInsert: {
          pointsUsed: 0,
          pointsMax: DEFAULT_POINTS_MAX,
          resetAt: new Date(now.getTime() + DEFAULT_WINDOW_MS),
          lastUpdated: now,
          source: "unknown",
          estimatedRequestsSinceObservation: 0,
        },
      },
      { upsert: true },
    );
  }

  async refreshSharedState(endpoint: WCLRateLimitEndpoint = "client"): Promise<void> {
    const identity = this.getBucketIdentity(endpoint);
    const [control, bucket] = await Promise.all([
      RateLimitState.findOne({ key: LEGACY_STATE_KEY }).select({ manualPause: 1 }).lean(),
      this.loadPersistedBucket(identity),
    ]);
    this.manualPause = control?.manualPause === true;
    if (bucket) this.hydrateBucketState(identity, bucket);
  }

  getStatus(endpoint: WCLRateLimitEndpoint = "client"): RateLimitStatus {
    const identity = this.getBucketIdentity(endpoint);
    const state = this.getBucketState(identity);
    const resetOccurred = this.hasResetOccurred(state);
    const pointsUsed = resetOccurred ? 0 : state.pointsUsed;
    const pointsRemaining = Math.max(0, state.pointsMax - pointsUsed);
    const percentUsed = state.pointsMax === 0 ? 0 : (pointsUsed / state.pointsMax) * 100;
    const isHardLimited = this.isStateHardLimited(state, new Date());

    return {
      endpoint,
      bucketId: identity.bucketId,
      sharedCredentialBucket: identity.sharedCredentialBucket,
      pointsUsed: Math.round(pointsUsed),
      pointsMax: state.pointsMax,
      pointsRemaining: Math.round(pointsRemaining),
      percentUsed: Math.round(percentUsed * 10) / 10,
      resetAt: state.resetAt,
      resetInSeconds: Math.max(0, Math.ceil(this.getTimeUntilReset(endpoint) / 1000)),
      isNearLimit: percentUsed >= this.config.pauseThreshold,
      isHardLimited,
      isManuallyPaused: this.manualPause,
      isPaused: this.manualPause || isHardLimited || percentUsed >= this.config.pauseThreshold,
      source: resetOccurred && !isHardLimited ? "unknown" : state.source,
      lastUpdated: state.lastUpdated,
      lastObservedAt: state.lastObservedAt,
      lastEstimatedAt: state.lastEstimatedAt,
      last429At: state.last429At,
    };
  }

  async getSharedStatus(endpoint: WCLRateLimitEndpoint = "client"): Promise<RateLimitStatus> {
    await this.refreshSharedState(endpoint);
    return this.getStatus(endpoint);
  }

  async getAllSharedStatuses(): Promise<{ client: RateLimitStatus; user: RateLimitStatus }> {
    const clientIdentity = this.getBucketIdentity("client");
    const userIdentity = this.getBucketIdentity("user");
    const controlPromise = RateLimitState.findOne({ key: LEGACY_STATE_KEY }).select({ manualPause: 1 }).lean();

    if (clientIdentity.persistentKey === userIdentity.persistentKey) {
      const [control, bucket] = await Promise.all([controlPromise, this.loadPersistedBucket(clientIdentity)]);
      this.manualPause = control?.manualPause === true;
      if (bucket) this.hydrateBucketState(clientIdentity, bucket);
    } else {
      const [control, clientBucket, userBucket] = await Promise.all([
        controlPromise,
        this.loadPersistedBucket(clientIdentity),
        this.loadPersistedBucket(userIdentity),
      ]);
      this.manualPause = control?.manualPause === true;
      if (clientBucket) this.hydrateBucketState(clientIdentity, clientBucket);
      if (userBucket) this.hydrateBucketState(userIdentity, userBucket);
    }

    return { client: this.getStatus("client"), user: this.getStatus("user") };
  }

  onPause(callback: (endpoint: WCLRateLimitEndpoint) => void): void {
    this.onPauseCallbacks.push(callback);
  }

  onResume(callback: (endpoint: WCLRateLimitEndpoint) => void): void {
    this.onResumeCallbacks.push(callback);
  }

  async waitForHardLimit(endpoint: WCLRateLimitEndpoint): Promise<void> {
    await this.refreshHardLimitState(endpoint);
    while (this.isHardLimited(endpoint)) {
      const waitMs = Math.max(1000, Math.min(30_000, this.getTimeUntilReset(endpoint) + 1000));
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      await this.refreshHardLimitState(endpoint);
    }
  }

  async waitForReset(endpoint: WCLRateLimitEndpoint = "client"): Promise<void> {
    await this.refreshSharedState(endpoint);
    while (this.manualPause) {
      logger.info("[RateLimit] Background processing manually paused, waiting before resuming...");
      await new Promise((resolve) => setTimeout(resolve, 30_000));
      await this.refreshSharedState(endpoint);
    }

    const timeUntilReset = this.getTimeUntilReset(endpoint);
    if (timeUntilReset <= 0) return;

    const identity = this.getBucketIdentity(endpoint);
    logger.info(`[RateLimit] Waiting ${Math.ceil(timeUntilReset / 1000)}s for endpoint=${endpoint} bucket=${identity.bucketId} reset...`);
    await new Promise((resolve) => setTimeout(resolve, timeUntilReset + 1000));
    await this.refreshSharedState(endpoint);

    while (this.manualPause) {
      logger.info("[RateLimit] Rate limit reset, but background processing is manually paused...");
      await new Promise((resolve) => setTimeout(resolve, 30_000));
      await this.refreshSharedState(endpoint);
    }

    logger.info(`[RateLimit] Reset completed for endpoint=${endpoint} bucket=${identity.bucketId}`);
  }

  updateConfig(newConfig: Partial<RateLimitConfig>): void {
    this.config = { ...this.config, ...newConfig };
    logger.info("[RateLimit] Configuration updated:", this.config);
  }

  getConfig(): RateLimitConfig {
    return { ...this.config };
  }

  forceReset(endpoint: WCLRateLimitEndpoint = "client"): void {
    const state = this.getBucketState(this.getBucketIdentity(endpoint));
    state.pointsUsed = 0;
    state.resetAt = new Date(Date.now() + DEFAULT_WINDOW_MS);
    state.rateLimitedUntil = null;
    state.source = "unknown";
    state.lastUpdated = new Date();
    logger.info(`[RateLimit] State force reset for endpoint=${endpoint}`);
  }

  private getBucketState(identity: WCLRateLimitBucketIdentity): BucketState {
    const existing = this.bucketStates.get(identity.persistentKey);
    if (existing) return existing;

    const state: BucketState = {
      pointsUsed: 0,
      pointsMax: DEFAULT_POINTS_MAX,
      resetAt: new Date(0),
      lastUpdated: new Date(0),
      lastObservedAt: null,
      lastEstimatedAt: null,
      last429At: null,
      rateLimitedUntil: null,
      source: "unknown",
      estimatedRequestsSinceObservation: 0,
    };
    this.bucketStates.set(identity.persistentKey, state);
    return state;
  }

  private async loadPersistedBucket(identity: WCLRateLimitBucketIdentity): Promise<Record<string, any> | null> {
    const bucket = await RateLimitState.findOne({ key: identity.persistentKey }).lean();
    if (bucket) return bucket;

    if (identity.endpoint === "client" || identity.sharedCredentialBucket) {
      const legacy = await RateLimitState.findOne({ key: LEGACY_STATE_KEY }).lean();
      if (!legacy) return null;

      const migratedState: Record<string, unknown> = {
        pointsUsed: legacy.pointsUsed,
        pointsMax: legacy.pointsMax,
        resetAt: legacy.resetAt,
        lastUpdated: legacy.lastUpdated,
        source: legacy.source || "unknown",
        estimatedRequestsSinceObservation: legacy.estimatedRequestsSinceObservation || 0,
        manualPause: false,
      };
      if (legacy.lastObservedAt) migratedState.lastObservedAt = legacy.lastObservedAt;
      if (legacy.lastEstimatedAt) migratedState.lastEstimatedAt = legacy.lastEstimatedAt;
      if (legacy.last429At) migratedState.last429At = legacy.last429At;
      if (legacy.rateLimitedUntil) migratedState.rateLimitedUntil = legacy.rateLimitedUntil;

      try {
        await RateLimitState.updateOne(
          { key: identity.persistentKey },
          { $setOnInsert: migratedState },
          { upsert: true },
        );
        return (await RateLimitState.findOne({ key: identity.persistentKey }).lean()) || legacy;
      } catch (error) {
        logger.warn(`[RateLimit] Failed to migrate legacy state into ${identity.bucketId} bucket; using legacy snapshot:`, error);
        return legacy;
      }
    }
    return null;
  }

  private async refreshHardLimitState(endpoint: WCLRateLimitEndpoint): Promise<void> {
    const identity = this.getBucketIdentity(endpoint);
    const lastRefreshAt = this.lastHardLimitRefreshAt.get(identity.persistentKey) ?? 0;
    if (Date.now() - lastRefreshAt < 1000) return;

    try {
      const bucket = await this.loadPersistedBucket(identity);
      if (bucket) this.hydrateBucketState(identity, bucket);
      this.lastHardLimitRefreshAt.set(identity.persistentKey, Date.now());
    } catch (error) {
      logger.warn(`[RateLimit] Failed to refresh shared hard-limit state for endpoint=${endpoint}; using local state:`, error);
    }
  }

  private hydrateBucketState(identity: WCLRateLimitBucketIdentity, persisted: Record<string, any>): void {
    const state = this.getBucketState(identity);
    state.pointsUsed = Number(persisted.pointsUsed) || 0;
    state.pointsMax = Number(persisted.pointsMax) || DEFAULT_POINTS_MAX;
    state.resetAt = persisted.resetAt ? new Date(persisted.resetAt) : new Date(0);
    state.lastUpdated = persisted.lastUpdated ? new Date(persisted.lastUpdated) : new Date(0);
    state.lastObservedAt = persisted.lastObservedAt ? new Date(persisted.lastObservedAt) : null;
    state.lastEstimatedAt = persisted.lastEstimatedAt ? new Date(persisted.lastEstimatedAt) : null;
    state.last429At = persisted.last429At ? new Date(persisted.last429At) : null;
    state.rateLimitedUntil = persisted.rateLimitedUntil ? new Date(persisted.rateLimitedUntil) : null;
    state.source = ["observed", "estimated", "rate_limited"].includes(persisted.source) ? persisted.source : "unknown";
    state.estimatedRequestsSinceObservation = Number(persisted.estimatedRequestsSinceObservation) || 0;
  }

  private isSameWindow(first: Date, second: Date): boolean {
    return first.getTime() > 0 && Math.abs(first.getTime() - second.getTime()) <= RESET_WINDOW_TOLERANCE_MS;
  }

  private hasResetOccurred(state: BucketState): boolean {
    return Date.now() > state.resetAt.getTime() && !this.isStateHardLimited(state, new Date());
  }

  private isStateHardLimited(state: BucketState, now: Date): boolean {
    return Boolean(state.rateLimitedUntil && state.rateLimitedUntil.getTime() > now.getTime());
  }

  private notifyPause(endpoint: WCLRateLimitEndpoint): void {
    for (const callback of this.onPauseCallbacks) {
      try {
        callback(endpoint);
      } catch (error) {
        logger.error("[RateLimit] Error in pause callback:", error);
      }
    }
  }

  private notifyResume(endpoint: WCLRateLimitEndpoint): void {
    for (const callback of this.onResumeCallbacks) {
      try {
        callback(endpoint);
      } catch (error) {
        logger.error("[RateLimit] Error in resume callback:", error);
      }
    }
  }
}

export const rateLimitService = new RateLimitService();
export default rateLimitService;
