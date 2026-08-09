import taskTracker from "../../services/task-tracker.service";
import logger from "../../utils/logger";
import reporterService from "./reporter.service";
import { ReporterRunSource } from "./reporter.types";

export class ReporterRunInProgressError extends Error {
  constructor() {
    super("A Reporter generation is already running");
  }
}

class ReporterRunner {
  private active = false;

  get isRunning(): boolean {
    return this.active;
  }

  async generate(source: ReporterRunSource) {
    if (this.active) throw new ReporterRunInProgressError();
    this.active = true;
    const taskId = await taskTracker.start("Reporter Weekly Article", { source });
    try {
      const post = await reporterService.generateWeeklyPost(source);
      await taskTracker.complete(taskId, {
        postId: post.id,
        weekKey: post.weekKey,
        inputTokens: post.usage.inputTokens,
        outputTokens: post.usage.outputTokens,
        estimatedCostUsd: post.usage.estimatedCostUsd,
      });
      logger.info(`[Reporter] ${source === "admin" ? "Manual" : "Scheduled"} draft generated`, {
        postId: post.id,
        weekKey: post.weekKey,
      });
      return post;
    } catch (error) {
      await taskTracker.fail(taskId, error instanceof Error ? error.message : String(error));
      logger.error("[Reporter] Generation failed", error);
      throw error;
    } finally {
      this.active = false;
    }
  }
}

export default new ReporterRunner();
