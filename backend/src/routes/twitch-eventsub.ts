import { Request, Response, Router } from "express";
import twitchChannelPointsService from "../services/twitch-channel-points.service";
import logger from "../utils/logger";

const router = Router();

router.post("/channel-points", async (req: Request, res: Response) => {
  try {
    const rawBody = (req as Request & { rawBody?: string }).rawBody;
    if (!rawBody) return res.sendStatus(400);
    const result = await twitchChannelPointsService.handleWebhook(req.headers, rawBody);
    if (result.contentType) res.type(result.contentType);
    if (result.body !== undefined) return res.status(result.status).send(result.body);
    return res.sendStatus(result.status);
  } catch (error) {
    logger.error("Failed to process Twitch EventSub channel points webhook:", error);
    return res.sendStatus(500);
  }
});

export default router;
