import { Request, Response, Router } from "express";
import reporterService from "./reporter.service";
import reporterSettingsService from "./reporter-settings.service";

const router = Router();

router.get("/posts", async (_req: Request, res: Response) => {
  try {
    const settings = await reporterSettingsService.get();
    if (!settings.featureEnabled) return res.status(404).json({ error: "Not found" });
    res.json({ posts: await reporterService.listPublishedPosts() });
  } catch {
    res.status(500).json({ error: "Failed to load Reporter articles" });
  }
});

router.get("/posts/:slug", async (req: Request, res: Response) => {
  try {
    const settings = await reporterSettingsService.get();
    if (!settings.featureEnabled) return res.status(404).json({ error: "Not found" });
    const post = await reporterService.getPublishedPost(req.params.slug);
    if (!post) return res.status(404).json({ error: "Reporter article not found" });
    res.json({ post });
  } catch {
    res.status(500).json({ error: "Failed to load Reporter article" });
  }
});

export default router;
