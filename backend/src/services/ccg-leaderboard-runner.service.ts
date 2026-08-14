import type { CcgLeaderboardRefreshMode, CcgLeaderboardRefreshResult } from "./ccg-leaderboard.service";
import logger from "../utils/logger";
import ccgService from "./ccg.service";
import taskTracker from "./task-tracker.service";

export const CCG_LEADERBOARD_TASK_NAMES: Record<CcgLeaderboardRefreshMode, string> = {
  full: "CCG Leaderboard Full Rebuild",
  incremental: "CCG Leaderboard Incremental Refresh",
};

export type CcgLeaderboardRunSource = "admin" | "cron" | "startup";

class CcgLeaderboardRunner {
  private activeRun: CcgLeaderboardRefreshMode | null = null;

  async trigger(mode: CcgLeaderboardRefreshMode, source: CcgLeaderboardRunSource): Promise<boolean> {
    if (this.activeRun) return false;
    const start = await ccgService.startLeaderboardRefresh(mode);
    if (!start.started) return false;

    this.activeRun = mode;
    void this.track(mode, source, start.completion);
    return true;
  }

  private async track(
    requestedMode: CcgLeaderboardRefreshMode,
    source: CcgLeaderboardRunSource,
    completion: Promise<CcgLeaderboardRefreshResult>,
  ): Promise<void> {
    let taskId = "";
    const settledCompletion = completion.then(
      (result) => ({ result }),
      (error: unknown) => ({ error }),
    );
    try {
      taskId = await taskTracker.start(CCG_LEADERBOARD_TASK_NAMES[requestedMode], { source, requestedMode });
      const settled = await settledCompletion;
      if ("error" in settled) throw settled.error;
      const result = settled.result;
      await taskTracker.complete(taskId, {
        mode: result.mode,
        participants: result.participants,
        changedCollectors: result.changedCollectors,
        seriesScanned: result.seriesScanned,
        calculatedAt: result.calculatedAt?.toISOString() ?? null,
      });
      logger.info(
        `[CCG/Leaderboard] ${result.mode} refresh ranked ${result.participants} collector(s), `
        + `changed=${result.changedCollectors}, series=${result.seriesScanned}, durationMs=${result.durationMs}, source=${source}`,
      );
    } catch (error) {
      logger.error("[CCG/Leaderboard] Error:", error);
      await taskTracker.fail(taskId, error instanceof Error ? error.message : String(error));
    } finally {
      this.activeRun = null;
    }
  }
}

export default new CcgLeaderboardRunner();
