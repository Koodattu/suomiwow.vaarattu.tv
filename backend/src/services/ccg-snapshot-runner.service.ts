import ccgPublisherService from "./ccg-publisher.service";
import taskTracker from "./task-tracker.service";
import logger from "../utils/logger";

type CcgSnapshotRunSource = "cron" | "admin";

class CcgSnapshotRunner {
  private running = false;

  trigger(source: CcgSnapshotRunSource): boolean {
    if (this.running) return false;
    void this.run(source);
    return true;
  }

  private async run(source: CcgSnapshotRunSource): Promise<void> {
    this.running = true;
    let taskId = "";
    try {
      taskId = await taskTracker.start("CCG Weekly Raid Snapshot", { source });
      const sets = await ccgPublisherService.getEnabledRaidSets();
      const results = [];
      for (const set of sets) {
        results.push({
          zoneId: set.zoneId,
          slug: set.slug,
          ...(await ccgPublisherService.buildSnapshot(set.zoneId)),
        });
      }
      await taskTracker.complete(taskId, { sets: results });
      logger.info(`[CCG/Snapshot] ${source === "admin" ? "Manual" : "Scheduled"} snapshot run completed`);
    } catch (error) {
      logger.error("[CCG/Snapshot] Error:", error);
      await taskTracker.fail(taskId, error instanceof Error ? error.message : String(error));
    } finally {
      this.running = false;
    }
  }
}

export default new CcgSnapshotRunner();
