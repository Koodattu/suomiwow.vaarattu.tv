import { NextFunction, Request, Response, Router } from "express";
import ccgService, { CcgServiceError } from "../services/ccg.service";
import logger from "../utils/logger";

const router = Router();
const rateLimits = new Map<string, { count: number; resetAt: number }>();

function pruneRateLimits(now: number): void {
  if (rateLimits.size < 1000) return;
  for (const [key, value] of rateLimits) {
    if (value.resetAt <= now) rateLimits.delete(key);
  }
  while (rateLimits.size > 5000) {
    const oldest = rateLimits.keys().next().value;
    if (!oldest) break;
    rateLimits.delete(oldest);
  }
}

function rateLimit(limit: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    pruneRateLimits(now);
    const routePath = typeof req.route?.path === "string" ? req.route.path : req.path;
    const key = `${req.ip}:${req.baseUrl}${routePath}`;
    const current = rateLimits.get(key);
    if (!current || current.resetAt <= now) {
      rateLimits.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    current.count += 1;
    if (current.count > limit) return res.status(429).json({ error: "Too many requests. Please wait a moment.", code: "rate_limited" });
    next();
  };
}

function asyncRoute(handler: (req: Request, res: Response) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    try {
      const value = await handler(req, res);
      if (!res.headersSent) res.json(value);
    } catch (error) {
      if (error instanceof CcgServiceError) return res.status(error.status).json({ error: error.message, code: error.code });
      logger.error("[CCG] Request failed:", error);
      res.status(500).json({ error: "The card vault could not complete that request", code: "ccg_request_failed" });
    }
  };
}

router.get(
  "/session",
  rateLimit(90, 60_000),
  asyncRoute(async (req, res) => ccgService.getSession(req, res)),
);

router.get(
  "/sets",
  rateLimit(90, 60_000),
  asyncRoute(async (req, res) => {
    const owner = await ccgService.resolveOwner(req, res);
    return { sets: await ccgService.getSets(owner) };
  }),
);

router.get(
  "/sets/:setSlug/guilds",
  rateLimit(90, 60_000),
  asyncRoute(async (req, res) => {
    const owner = await ccgService.resolveOwner(req, res);
    return ccgService.getSetGuilds(owner, req.params.setSlug);
  }),
);

router.get(
  "/sets/:setSlug/catalog",
  rateLimit(90, 60_000),
  asyncRoute(async (req, res) => {
    const owner = await ccgService.resolveOwner(req, res);
    return ccgService.getCatalog(owner, req.params.setSlug, {
      page: typeof req.query.page === "string" ? Number(req.query.page) : undefined,
      limit: typeof req.query.limit === "string" ? Number(req.query.limit) : undefined,
      owned: typeof req.query.owned === "string" ? req.query.owned : undefined,
      grade: typeof req.query.grade === "string" ? req.query.grade : undefined,
      finish: typeof req.query.finish === "string" ? req.query.finish : undefined,
      guildId: typeof req.query.guild === "string" ? req.query.guild : undefined,
      sort: typeof req.query.sort === "string" ? req.query.sort : undefined,
    });
  }),
);

router.get(
  "/collection",
  rateLimit(90, 60_000),
  asyncRoute(async (req, res) => {
    const owner = await ccgService.resolveOwner(req, res);
    return ccgService.getCollection(owner, {
      page: typeof req.query.page === "string" ? Number(req.query.page) : undefined,
      limit: typeof req.query.limit === "string" ? Number(req.query.limit) : undefined,
      setSlug: typeof req.query.set === "string" ? req.query.set : undefined,
      grade: typeof req.query.grade === "string" ? req.query.grade : undefined,
      finish: typeof req.query.finish === "string" ? req.query.finish : undefined,
      search: typeof req.query.search === "string" ? req.query.search : undefined,
      guildId: typeof req.query.guild === "string" ? req.query.guild : undefined,
      sort: typeof req.query.sort === "string" ? req.query.sort : undefined,
    });
  }),
);

router.get(
  "/cards/:cardId",
  rateLimit(90, 60_000),
  asyncRoute(async (req, res) => {
    const owner = await ccgService.resolveOwner(req, res);
    return ccgService.getCard(req.params.cardId, owner);
  }),
);

router.post(
  "/packs/open",
  rateLimit(20, 60_000),
  asyncRoute(async (req, res) => ccgService.openPack(req, res, req.body ?? {})),
);

router.get(
  "/openings/:openingId",
  rateLimit(60, 60_000),
  asyncRoute(async (req, res) => {
    const owner = await ccgService.resolveOwner(req, res);
    return ccgService.getOpening(owner, req.params.openingId);
  }),
);

router.post(
  "/guest/claim",
  rateLimit(10, 60_000),
  asyncRoute(async (req) => ccgService.claimGuest(req, req.body ?? {})),
);

export default router;
