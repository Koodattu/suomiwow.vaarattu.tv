import cron from "node-cron";
import logger from "../../utils/logger";
import { REPORTER_CONFIG } from "./reporter.config";
import reporterRunner, { ReporterRunInProgressError } from "./reporter-runner.service";
import reporterSettingsService from "./reporter-settings.service";

class ReporterScheduler {
  private task: ReturnType<typeof cron.schedule> | null = null;

  start(): void {
    if (this.task) return;
    if (!cron.validate(REPORTER_CONFIG.schedule)) {
      throw new Error(`Invalid REPORTER_WEEKLY_SCHEDULE: ${REPORTER_CONFIG.schedule}`);
    }

    this.task = cron.schedule(
      REPORTER_CONFIG.schedule,
      () => {
        void reporterSettingsService
          .get()
          .then((settings) => {
            if (!settings.featureEnabled || !settings.automationEnabled) {
              logger.info("[Reporter] Scheduled run skipped because Reporter or weekly automation is disabled");
              return;
            }
            return reporterRunner.generate("cron");
          })
          .catch((error) => {
            if (!(error instanceof ReporterRunInProgressError)) logger.error("[Reporter] Scheduled run failed", error);
          });
      },
      { timezone: REPORTER_CONFIG.timeZone },
    );
    logger.info(`[Reporter] Weekly schedule registered with '${REPORTER_CONFIG.schedule}' (${REPORTER_CONFIG.timeZone}); database switches control execution`);
  }

  stop(): void {
    this.task?.stop();
    this.task = null;
  }
}

export default new ReporterScheduler();
