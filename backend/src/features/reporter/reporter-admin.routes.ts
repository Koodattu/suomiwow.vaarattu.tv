import { Request, Response, Router } from "express";
import { requireAdmin } from "../../middleware/admin.middleware";
import reporterRunner from "./reporter-runner.service";
import reporterSettingsService from "./reporter-settings.service";
import reporterService from "./reporter.service";
import { ReporterPostStatus, ReporterSettingsUpdate } from "./reporter.types";

const router = Router();
router.use(requireAdmin);

router.get("/status", async (_req: Request, res: Response) => {
  try {
    res.json({ ...(await reporterService.getAdminStatus()), generationRunning: reporterRunner.isRunning });
  } catch {
    res.status(500).json({ error: "Failed to load Reporter status" });
  }
});

router.get("/posts", async (_req: Request, res: Response) => {
  try {
    res.json({ posts: await reporterService.listAdminPosts() });
  } catch {
    res.status(500).json({ error: "Failed to load Reporter articles" });
  }
});

router.patch("/settings", async (req: Request, res: Response) => {
  const input: ReporterSettingsUpdate = {};
  if (typeof req.body?.featureEnabled === "boolean") input.featureEnabled = req.body.featureEnabled;
  if (typeof req.body?.automationEnabled === "boolean") input.automationEnabled = req.body.automationEnabled;
  if (typeof req.body?.autoPublish === "boolean") input.autoPublish = req.body.autoPublish;
  try {
    res.json({ settings: await reporterSettingsService.update(input) });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to update Reporter settings" });
  }
});

router.patch("/posts/:id/status", async (req: Request, res: Response) => {
  const status = req.body?.status as ReporterPostStatus | undefined;
  if (status !== "draft" && status !== "published") return res.status(400).json({ error: "Status must be draft or published" });
  try {
    res.json({ post: await reporterService.updatePostStatus(req.params.id, status) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update Reporter article";
    res.status(message.includes("not found") ? 404 : 400).json({ error: message });
  }
});

router.delete("/posts/:id", async (req: Request, res: Response) => {
  if (reporterRunner.isRunning) return res.status(409).json({ error: "Wait for the active Reporter generation to finish before deleting an article" });
  try {
    res.json(await reporterService.deletePost(req.params.id));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete Reporter article";
    if (message.includes("not found")) return res.status(404).json({ error: message });
    if (message.includes("Invalid")) return res.status(400).json({ error: message });
    res.status(500).json({ error: "Failed to delete Reporter article" });
  }
});

export default router;
