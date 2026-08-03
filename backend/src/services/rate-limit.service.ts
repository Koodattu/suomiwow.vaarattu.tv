import logger from "../utils/logger";
import RateLimitState from "../models/RateLimitState";

/**
 * Rate limit data structure matching WarcraftLogs API response
 */
export interface WCLRateLimitData {
  limitPerHour: number;
  pointsSpentThisHour: number;
  pointsResetIn: number; // seconds until reset
}

/**
 * Global rate limit status for consumers
 */
export interface RateLimitStatus {
  pointsUsed: number;
  pointsMax: number;
  pointsRemaining: number;
  percentUsed: number;
  resetAt: Date;
  resetInSeconds: number;
  isNearLimit: boolean;
  isPaused: boolean;
  lastUpdated: Date;
}

/**
 * Rate limit thresholds configuration
 */
interface RateLimitConfig {
  // Percentage of rate limit to reserve for live operations (0-100)
  liveOperationsReserve: number;
  // Percentage at which to warn about approaching limit
  warningThreshold: number;
  // Percentage at which background processing should pause
  pauseThreshold: number;
}

/**
 * Global Rate Limit Service
 *
 * Centralized tracking of WarcraftLogs API rate limits.
 * All WCL API calls should update this service with rate limit data from responses.
 * Background processors should check this service before making requests.
 */
class RateLimitService {
  private readonly stateKey = "warcraftlogs";
  private readonly apiProbeRequestInterval = 25;
  private readonly apiProbeMaxAgeMs = 5 * 60 * 1000;
  private readonly apiProbeNearLimitRequestInterval = 5;

  // Current rate limit state
  private pointsUsed: number = 0;
  private pointsMax: number = 3600; // Default WCL limit, updated from API responses
  private resetAt: Date = new Date();
  private lastUpdated: Date = new Date(0);
  private lastApiProbeAt: Date = new Date(0);
  private estimatedRequestsSinceApiProbe = 0;

  // Manual pause state (admin can pause background processing)
  private manualPause: boolean = false;

  // Configuration
  private config: RateLimitConfig = {
    liveOperationsReserve: 20, // Reserve 20% for live operations
    warningThreshold: 70, // Warn at 70%
    pauseThreshold: 80, // Pause background at 80%
  };

  // Event callbacks for state changes
  private onPauseCallbacks: Array<() => void> = [];
  private onResumeCallbacks: Array<() => void> = [];

  /**
   * Update rate limit state from WCL API response
   * Should be called after every WCL API request
   */
  async updateFromResponse(rateLimitData: WCLRateLimitData): Promise<void> {
    if (!rateLimitData) {
      return;
    }

    const wasNearLimit = this.isNearLimit();

    this.pointsUsed = rateLimitData.pointsSpentThisHour;
    this.pointsMax = rateLimitData.limitPerHour;
    this.resetAt = new Date(Date.now() + rateLimitData.pointsResetIn * 1000);
    this.lastUpdated = new Date();
    this.lastApiProbeAt = this.lastUpdated;
    this.estimatedRequestsSinceApiProbe = 0;
    await this.persistState();

    const percentUsed = this.getPercentUsed();
    const isNearNow = this.isNearLimit();

    // Log significant changes
    if (!wasNearLimit && isNearNow) {
      logger.warn(`[RateLimit] ⚠️  Approaching rate limit: ${this.pointsUsed.toFixed(0)}/${this.pointsMax} (${percentUsed.toFixed(1)}%), resets at ${this.resetAt.toISOString()}`);
      this.notifyPause();
    } else if (wasNearLimit && !isNearNow) {
      logger.info(`[RateLimit] ✅ Rate limit cleared: ${this.pointsUsed.toFixed(0)}/${this.pointsMax} (${percentUsed.toFixed(1)}%)`);
      this.notifyResume();
    }

    // Debug log every update (at debug level to avoid spam)
    logger.debug(`[RateLimit] Updated: ${this.pointsUsed.toFixed(0)}/${this.pointsMax} points (${percentUsed.toFixed(1)}%), resets in ${rateLimitData.pointsResetIn}s`);
  }

  /**
   * Check if we're near the rate limit (should pause background processing)
   */
  isNearLimit(): boolean {
    return this.getPercentUsed() >= this.config.pauseThreshold;
  }

  /**
   * Check if background processing should proceed
   * Returns false if paused (either manually or due to rate limits)
   */
  canProceedBackground(): boolean {
    // Check manual pause first
    if (this.manualPause) {
      return false;
    }

    // Check if rate limit has reset since we last exceeded it
    if (this.hasResetOccurred()) {
      this.pointsUsed = 0;
      return true;
    }

    // Check if we're near the limit
    return !this.isNearLimit();
  }

  /**
   * Check if enough capacity exists for a live operation
   * Live operations always get priority (they use the reserved 20%)
   */
  canProceedLive(): boolean {
    // Live operations can proceed even during rate limit warnings
    // They only stop at hard limit
    return this.getPercentUsed() < 95;
  }

  /**
   * Get points available for background processing
   * This accounts for the reserve capacity for live operations
   */
  getBackgroundCapacity(): number {
    const reservePoints = this.pointsMax * (this.config.liveOperationsReserve / 100);
    const availableForBackground = this.pointsMax - reservePoints - this.pointsUsed;
    return Math.max(0, availableForBackground);
  }

  /**
   * Get estimated time until rate limit resets (in milliseconds)
   */
  getTimeUntilReset(): number {
    const now = Date.now();
    const resetTime = this.resetAt.getTime();
    return Math.max(0, resetTime - now);
  }

  /**
   * Check if a reset has occurred since the last update
   */
  private hasResetOccurred(): boolean {
    return Date.now() > this.resetAt.getTime();
  }

  /**
   * Get current percentage of rate limit used
   */
  getPercentUsed(): number {
    if (this.pointsMax === 0) return 0;
    return (this.pointsUsed / this.pointsMax) * 100;
  }

  /**
   * Set manual pause state (admin control)
   */
  async setManualPause(paused: boolean): Promise<void> {
    if (this.manualPause !== paused) {
      this.manualPause = paused;
      if (paused) {
        logger.info("[RateLimit] Background processing manually paused by admin");
        this.notifyPause();
      } else {
        logger.info("[RateLimit] Background processing manually resumed by admin");
        if (this.canProceedBackground()) {
          this.notifyResume();
        }
      }
    }
    await this.persistState({ includeManualPause: true });
  }

  /**
   * Conservatively account for an API query that intentionally omitted
   * rateLimitData. A later standalone probe replaces this estimate with WCL's
   * authoritative shared-key usage.
   */
  async recordEstimatedUsage(points: number): Promise<void> {
    if (!Number.isFinite(points) || points <= 0) return;
    if (this.hasResetOccurred()) this.pointsUsed = 0;

    this.pointsUsed += Math.ceil(points);
    this.estimatedRequestsSinceApiProbe += 1;
    this.lastUpdated = new Date();
    await this.persistState();
  }

  shouldProbeApiState(): boolean {
    const probeAgeMs = Date.now() - this.lastApiProbeAt.getTime();
    if (probeAgeMs >= this.apiProbeMaxAgeMs) return true;
    if (this.estimatedRequestsSinceApiProbe >= this.apiProbeRequestInterval) return true;
    return this.getPercentUsed() >= this.config.warningThreshold
      && this.estimatedRequestsSinceApiProbe >= this.apiProbeNearLimitRequestInterval;
  }

  async refreshSharedState(): Promise<void> {
    const state = await RateLimitState.findOne({ key: this.stateKey }).lean();
    if (!state) return;

    this.manualPause = state.manualPause === true;
    this.pointsUsed = Date.now() > state.resetAt.getTime() ? 0 : state.pointsUsed;
    this.pointsMax = state.pointsMax;
    this.resetAt = state.resetAt;
    this.lastUpdated = state.lastUpdated;
  }

  /**
   * Get current status for API/UI consumption
   */
  getStatus(): RateLimitStatus {
    // Check if reset has occurred
    if (this.hasResetOccurred()) {
      this.pointsUsed = 0;
    }

    const pointsRemaining = Math.max(0, this.pointsMax - this.pointsUsed);
    const percentUsed = this.getPercentUsed();

    return {
      pointsUsed: Math.round(this.pointsUsed),
      pointsMax: this.pointsMax,
      pointsRemaining: Math.round(pointsRemaining),
      percentUsed: Math.round(percentUsed * 10) / 10,
      resetAt: this.resetAt,
      resetInSeconds: Math.max(0, Math.ceil(this.getTimeUntilReset() / 1000)),
      isNearLimit: this.isNearLimit(),
      isPaused: this.manualPause || this.isNearLimit(),
      lastUpdated: this.lastUpdated,
    };
  }

  /**
   * Get status from shared persistent state when available.
   * This lets the API process show WCL usage observed by the worker process.
   */
  async getSharedStatus(): Promise<RateLimitStatus> {
    const state = await RateLimitState.findOne({ key: this.stateKey }).lean();

    if (!state) {
      return this.getStatus();
    }

    const pointsUsed = Date.now() > state.resetAt.getTime() ? 0 : state.pointsUsed;
    const pointsMax = state.pointsMax;
    const pointsRemaining = Math.max(0, pointsMax - pointsUsed);
    const percentUsed = pointsMax === 0 ? 0 : (pointsUsed / pointsMax) * 100;
    const resetInSeconds = Math.max(0, Math.ceil((state.resetAt.getTime() - Date.now()) / 1000));

    return {
      pointsUsed: Math.round(pointsUsed),
      pointsMax,
      pointsRemaining: Math.round(pointsRemaining),
      percentUsed: Math.round(percentUsed * 10) / 10,
      resetAt: state.resetAt,
      resetInSeconds,
      isNearLimit: percentUsed >= this.config.pauseThreshold,
      isPaused: state.manualPause === true || this.manualPause || percentUsed >= this.config.pauseThreshold,
      lastUpdated: state.lastUpdated,
    };
  }

  private async persistState(options: { includeManualPause?: boolean } = {}): Promise<void> {
    try {
      const updateSet: Record<string, unknown> = {
        pointsUsed: this.pointsUsed,
        pointsMax: this.pointsMax,
        resetAt: this.resetAt,
        lastUpdated: this.lastUpdated,
      };
      if (options.includeManualPause) {
        updateSet.manualPause = this.manualPause;
      }
      const update: Record<string, unknown> = { $set: updateSet };
      if (!options.includeManualPause) {
        update.$setOnInsert = {
          manualPause: this.manualPause,
        };
      }

      await RateLimitState.updateOne(
        { key: this.stateKey },
        update,
        { upsert: true },
      );
    } catch (error) {
      logger.error("[RateLimit] Failed to persist state:", error);
    }
  }

  /**
   * Register callback for when background processing should pause
   */
  onPause(callback: () => void): void {
    this.onPauseCallbacks.push(callback);
  }

  /**
   * Register callback for when background processing can resume
   */
  onResume(callback: () => void): void {
    this.onResumeCallbacks.push(callback);
  }

  /**
   * Notify all pause listeners
   */
  private notifyPause(): void {
    for (const callback of this.onPauseCallbacks) {
      try {
        callback();
      } catch (error) {
        logger.error("[RateLimit] Error in pause callback:", error);
      }
    }
  }

  /**
   * Notify all resume listeners
   */
  private notifyResume(): void {
    for (const callback of this.onResumeCallbacks) {
      try {
        callback();
      } catch (error) {
        logger.error("[RateLimit] Error in resume callback:", error);
      }
    }
  }

  /**
   * Wait for rate limit to reset (used by background processors)
   * Returns a promise that resolves when it's safe to proceed
   */
  async waitForReset(): Promise<void> {
    await this.refreshSharedState();
    while (this.manualPause) {
      logger.info("[RateLimit] Background processing manually paused, waiting before resuming...");
      await new Promise((resolve) => setTimeout(resolve, 30000));
      await this.refreshSharedState();
    }

    const timeUntilReset = this.getTimeUntilReset();

    if (timeUntilReset <= 0) {
      this.pointsUsed = 0;
      return;
    }

    logger.info(`[RateLimit] Waiting ${Math.ceil(timeUntilReset / 1000)}s for rate limit reset...`);

    await new Promise((resolve) => setTimeout(resolve, timeUntilReset + 1000)); // Add 1s buffer

    await this.refreshSharedState();
    while (this.manualPause) {
      logger.info("[RateLimit] Rate limit reset, but background processing is manually paused...");
      await new Promise((resolve) => setTimeout(resolve, 30000));
      await this.refreshSharedState();
    }

    this.pointsUsed = 0;
    logger.info("[RateLimit] Rate limit reset, resuming operations");
  }

  /**
   * Update configuration (for testing or admin adjustments)
   */
  updateConfig(newConfig: Partial<RateLimitConfig>): void {
    this.config = { ...this.config, ...newConfig };
    logger.info(`[RateLimit] Configuration updated:`, this.config);
  }

  /**
   * Get current configuration
   */
  getConfig(): RateLimitConfig {
    return { ...this.config };
  }

  /**
   * Force reset state (for testing or recovery)
   */
  forceReset(): void {
    this.pointsUsed = 0;
    this.resetAt = new Date(Date.now() + 3600 * 1000);
    this.lastUpdated = new Date();
    logger.info("[RateLimit] State force reset");
  }
}

// Export singleton instance
export const rateLimitService = new RateLimitService();
export default rateLimitService;
