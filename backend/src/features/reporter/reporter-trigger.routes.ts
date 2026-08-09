import { Request, Response, Router } from "express";
import { requireAdmin } from "../../middleware/admin.middleware";
import reporterRunner, { ReporterRunInProgressError } from "./reporter-runner.service";

const router = Router();
router.use(requireAdmin);

router.post("/generate", async (_req: Request, res: Response) => {
  try {
    res.json({ post: await reporterRunner.generate("admin") });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Reporter generation failed";
    if (error instanceof ReporterRunInProgressError || message.includes("published")) return res.status(409).json({ error: message });
    if (message.includes("OPENAI_API_KEY") || message.includes("disabled")) return res.status(503).json({ error: message });
    res.status(500).json({ error: message });
  }
});

export default router;
