import { Router, Request, Response } from "express";
import discordBotService, { DiscordBotError } from "../services/discord-bot.service";
import discordService from "../services/discord.service";
import logger from "../utils/logger";

const router = Router();

async function getAuthenticatedUser(req: Request) {
  const userId = req.session.userId;
  if (!userId) {
    return null;
  }

  return discordService.getUserFromSession(userId);
}

function handleRouteError(res: Response, error: unknown, fallbackMessage: string): void {
  if (error instanceof DiscordBotError) {
    res.status(error.statusCode).json({ error: error.message });
    return;
  }

  logger.error(fallbackMessage, error);
  res.status(500).json({ error: fallbackMessage });
}

router.get("/status", (_req: Request, res: Response) => {
  res.json(discordBotService.getStatus());
});

router.get("/guilds", async (req: Request, res: Response) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const result = await discordBotService.getManageableGuilds(user);
    res.json(result);
  } catch (error) {
    handleRouteError(res, error, "Failed to fetch Discord guilds");
  }
});

router.get("/integrations", async (req: Request, res: Response) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const result = await discordBotService.getIntegrationsForUser(user);
    res.json(result);
  } catch (error) {
    handleRouteError(res, error, "Failed to fetch Discord integrations");
  }
});

router.get("/install-url", async (req: Request, res: Response) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const guildId = typeof req.query.guildId === "string" ? req.query.guildId : undefined;
    const url = discordBotService.createInstallUrl(user, guildId);
    res.json({ url });
  } catch (error) {
    handleRouteError(res, error, "Failed to create Discord install URL");
  }
});

router.get("/install/callback", async (req: Request, res: Response) => {
  const code = typeof req.query.code === "string" ? req.query.code : null;
  const state = typeof req.query.state === "string" ? req.query.state : null;
  const guildId = typeof req.query.guild_id === "string" ? req.query.guild_id : undefined;
  const oauthError = typeof req.query.error === "string" ? req.query.error : "missing_code";

  if (!code || !state) {
    return res.redirect(discordBotService.createSettingsRedirect({ error: oauthError }));
  }

  const redirectUrl = await discordBotService.handleInstallCallback(code, state, guildId);
  res.redirect(redirectUrl);
});

router.get("/integrations/:guildId/settings", async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const settings = await discordBotService.getIntegrationSettings(user, req.params.guildId);
    res.json(settings);
  } catch (error) {
    handleRouteError(res, error, "Failed to fetch Discord integration settings");
  }
});

router.put("/integrations/:guildId/settings", async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const integration = await discordBotService.updateIntegrationSettings(user, req.params.guildId, req.body);
    res.json({ integration });
  } catch (error) {
    handleRouteError(res, error, "Failed to update Discord integration settings");
  }
});

router.post("/integrations/:guildId/test-message", async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const result = await discordBotService.sendTestMessage(user, req.params.guildId);
    res.json(result);
  } catch (error) {
    handleRouteError(res, error, "Failed to send Discord test message");
  }
});

router.delete("/integrations/:guildId", async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const integration = await discordBotService.uninstallIntegration(user, req.params.guildId);
    res.json({ integration });
  } catch (error) {
    handleRouteError(res, error, "Failed to uninstall Discord bot");
  }
});

router.post("/interactions", async (req: Request, res: Response) => {
  try {
    logger.info(`[DiscordBot] Interaction POST received: type=${req.body?.type ?? "unknown"} guild=${req.body?.guild_id ?? "none"}`);

    const rawBody = (req as Request & { rawBody?: string }).rawBody;
    if (!rawBody) {
      logger.warn("[DiscordBot] Interaction request missing raw body");
      return res.status(400).json({ error: "Missing raw request body" });
    }

    const response = await discordBotService.handleInteraction(rawBody, req.header("X-Signature-Ed25519"), req.header("X-Signature-Timestamp"));
    res.json(response);
  } catch (error) {
    if (error instanceof DiscordBotError && error.statusCode === 401) {
      return res.status(401).send(error.message);
    }

    handleRouteError(res, error, "Failed to handle Discord interaction");
  }
});

export default router;
