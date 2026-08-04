import { createHash } from "crypto";
import { NextFunction, Request, Response, Router } from "express";
import { CCG_GUEST_COOKIE } from "../config/ccg";
import { cacheMiddleware } from "../middleware/cache.middleware";
import ccgService, { CcgServiceError } from "../services/ccg.service";
import logger from "../utils/logger";

const router = Router();
const CCG_ANALYTICS_CACHE_TTL_MS = 15 * 60 * 1000;
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

function ownerRateLimitKey(req: Request): string {
  if (req.session.userId) return `user:${req.session.userId}`;
  const guestToken = typeof req.cookies?.[CCG_GUEST_COOKIE] === "string" ? req.cookies[CCG_GUEST_COOKIE] : null;
  if (guestToken) return `guest:${createHash("sha256").update(guestToken).digest("hex")}`;
  return `ip:${req.ip}`;
}

function rateLimit(limit: number, windowMs: number, identify: (req: Request) => string = (req) => `ip:${req.ip}`) {
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    pruneRateLimits(now);
    const routePath = typeof req.route?.path === "string" ? req.route.path : req.path;
    const key = `${identify(req)}:${req.baseUrl}${routePath}`;
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
  "/analytics",
  rateLimit(90, 60_000),
  cacheMiddleware(() => "ccg:analytics:v2", () => CCG_ANALYTICS_CACHE_TTL_MS),
  asyncRoute(async () => ccgService.getAnalytics()),
);

router.get(
  "/bootstrap",
  rateLimit(90, 60_000),
  asyncRoute(async (req, res) => ccgService.getBootstrap(req, res)),
);

router.get(
  "/session",
  rateLimit(90, 60_000),
  asyncRoute(async (req, res) => ccgService.getSession(req, res)),
);

router.get(
  "/activity",
  rateLimit(60, 60_000, ownerRateLimitKey),
  asyncRoute(async (req) => ccgService.getActivity(req, {
    filter: req.query.filter,
    cursor: req.query.cursor,
    limit: req.query.limit,
  })),
);

router.get(
  "/character-check",
  rateLimit(30, 60_000),
  asyncRoute(async (req) => ccgService.checkCharacter(req.query.name, req.query.realm)),
);

router.get(
  "/leaderboard",
  rateLimit(90, 60_000),
  asyncRoute(async (_req, res) => {
    res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    return ccgService.getLeaderboard();
  }),
);

router.get(
  "/leaderboard/me",
  rateLimit(60, 60_000),
  asyncRoute(async (req) => ccgService.getLeaderboardMe(req)),
);

router.get(
  "/leaderboard/records",
  rateLimit(90, 60_000),
  asyncRoute(async (_req, res) => {
    res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    return ccgService.getLeaderboardRecords();
  }),
);

router.put(
  "/leaderboard/showcase",
  rateLimit(20, 60_000),
  asyncRoute(async (req) => ccgService.updateLeaderboardShowcase(req, req.body ?? {})),
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
    res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    return ccgService.getCollectionGuilds(req.params.setSlug);
  }),
);

router.get(
  "/collection/catalog",
  rateLimit(90, 60_000),
  asyncRoute(async (req, res) => {
    const owner = await ccgService.resolveOwner(req, res);
    return ccgService.getCatalog(owner, undefined, {
      page: typeof req.query.page === "string" ? Number(req.query.page) : undefined,
      limit: typeof req.query.limit === "string" ? Number(req.query.limit) : undefined,
      owned: typeof req.query.owned === "string" ? req.query.owned : undefined,
      grade: typeof req.query.grade === "string" ? req.query.grade : undefined,
      finish: typeof req.query.finish === "string" ? req.query.finish : undefined,
      guildId: typeof req.query.guild === "string" ? req.query.guild : undefined,
      characterId: typeof req.query.character === "string" ? req.query.character : undefined,
      characterName: typeof req.query.characterName === "string" ? req.query.characterName : undefined,
      sort: typeof req.query.sort === "string" ? req.query.sort : undefined,
    });
  }),
);

router.get(
  "/collection/characters",
  rateLimit(90, 60_000),
  asyncRoute(async (req) => ccgService.searchCollectionCharacters(req.query.q, req.query.limit)),
);

router.get(
  "/collection/guilds",
  rateLimit(90, 60_000),
  asyncRoute(async (req, res) => {
    res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    return ccgService.getCollectionGuilds(typeof req.query.set === "string" ? req.query.set : undefined);
  }),
);

router.get(
  "/sets/:setSlug/featured",
  rateLimit(90, 60_000),
  asyncRoute(async (req, res) => {
    const owner = await ccgService.resolveOwner(req, res);
    return ccgService.getFeaturedCard(owner, req.params.setSlug);
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
      characterId: typeof req.query.character === "string" ? req.query.character : undefined,
      characterName: typeof req.query.characterName === "string" ? req.query.characterName : undefined,
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
      characterId: typeof req.query.character === "string" ? req.query.character : undefined,
      characterName: typeof req.query.characterName === "string" ? req.query.characterName : undefined,
      sort: typeof req.query.sort === "string" ? req.query.sort : undefined,
      alternativeOnly: req.query.alternative === "true",
      favoriteOnly: req.query.favorite === "true",
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

router.get(
  "/shares/:shareId",
  rateLimit(90, 60_000),
  asyncRoute(async (req) => ccgService.getShare(req.params.shareId)),
);

router.post(
  "/shares/card",
  rateLimit(20, 60_000),
  asyncRoute(async (req) => ccgService.createCardShare(req, req.body ?? {})),
);

router.post(
  "/shares/pack",
  rateLimit(20, 60_000),
  asyncRoute(async (req) => ccgService.createPackShare(req, req.body ?? {})),
);

router.post(
  "/packs/open",
  rateLimit(60, 60_000, ownerRateLimitKey),
  asyncRoute(async (req, res) => ccgService.openPack(req, res, req.body ?? {})),
);

router.post(
  "/redeem",
  rateLimit(10, 60_000),
  asyncRoute(async (req) => ccgService.redeemCode(req, req.body ?? {})),
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
