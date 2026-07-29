import ccgPublisherService from "./ccg-publisher.service";
import taskTracker from "./task-tracker.service";
import logger from "../utils/logger";

type CcgRaidRunSource = "cron" | "admin";
type CcgRaidRunKind = "snapshot" | "publication";

class CcgRaidRunner {
  private activeRun: CcgRaidRunKind | null = null;

  triggerSnapshot(source: CcgRaidRunSource): boolean {
    return this.trigger("snapshot", source);
  }

  triggerPublication(source: CcgRaidRunSource): boolean {
    return this.trigger("publication", source);
  }

  private trigger(kind: CcgRaidRunKind, source: CcgRaidRunSource): boolean {
    if (this.activeRun) return false;
    this.activeRun = kind;
    void this.run(kind, source);
    return true;
  }

  private async run(kind: CcgRaidRunKind, source: CcgRaidRunSource): Promise<void> {
    let taskId = "";
    try {
      const taskName = kind === "snapshot" ? "CCG Weekly Raid Snapshot" : "CCG Weekly Raid Publication";
      taskId = await taskTracker.start(taskName, { source });
      const sets = await ccgPublisherService.getEnabledRaidSets();
      const results = [];
      for (const set of sets) {
        results.push({
          zoneId: set.zoneId,
          slug: set.slug,
          ...(kind === "snapshot"
            ? await ccgPublisherService.buildSnapshot(set.zoneId)
            : await ccgPublisherService.publishLatestWave(set.slug)),
        });
      }
      await taskTracker.complete(taskId, { sets: results });
      logger.info(
        `[CCG/${kind === "snapshot" ? "Snapshot" : "Publication"}] ${source === "admin" ? "Manual" : "Scheduled"} ${kind} run completed`,
      );
    } catch (error) {
      logger.error(`[CCG/${kind === "snapshot" ? "Snapshot" : "Publication"}] Error:`, error);
      if (taskId) await taskTracker.fail(taskId, error instanceof Error ? error.message : String(error));
    } finally {
      this.activeRun = null;
    }
  }
}

export default new CcgRaidRunner();
