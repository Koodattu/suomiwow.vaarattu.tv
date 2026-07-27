import { Request, Response, Router } from "express";
import mongoose from "mongoose";
import twitchCcgOverlayService, { TwitchCcgOverlayError } from "../services/twitch-ccg-overlay.service";
import logger from "../utils/logger";

const router = Router();

function readBearerToken(req: Request): string {
  const authorization = req.get("authorization") || "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
}

function respondToOverlayError(res: Response, error: unknown): Response {
  if (error instanceof TwitchCcgOverlayError) {
    return res.status(error.statusCode).json({ error: error.message, code: error.code });
  }
  logger.error("Twitch CCG overlay request failed:", error);
  return res.status(500).json({ error: "The overlay request failed", code: "overlay_error" });
}

router.get("/next", async (req: Request, res: Response) => {
  res.set("Cache-Control", "no-store");
  try {
    const event = await twitchCcgOverlayService.leaseNext(readBearerToken(req));
    return event ? res.json(event) : res.sendStatus(204);
  } catch (error) {
    return respondToOverlayError(res, error);
  }
});

router.post("/:eventId/ack", async (req: Request, res: Response) => {
  res.set("Cache-Control", "no-store");
  if (!mongoose.Types.ObjectId.isValid(req.params.eventId)) return res.status(400).json({ error: "Invalid overlay event", code: "invalid_event" });
  const leaseId = typeof req.body?.leaseId === "string" ? req.body.leaseId : "";
  if (!leaseId) return res.status(400).json({ error: "Missing overlay lease", code: "missing_lease" });
  try {
    await twitchCcgOverlayService.acknowledge(readBearerToken(req), req.params.eventId, leaseId);
    return res.sendStatus(204);
  } catch (error) {
    return respondToOverlayError(res, error);
  }
});

export default router;
