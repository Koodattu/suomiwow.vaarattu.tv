import crypto from "crypto";
import mongoose from "mongoose";
import { CLASSES } from "../config/classes";
import DiscordBotState from "../models/DiscordBotState";
import DiscordEventDelivery from "../models/DiscordEventDelivery";
import DiscordGuildIntegration, { IDiscordGuildIntegration } from "../models/DiscordGuildIntegration";
import Event, { EventType, IEvent } from "../models/Event";
import Guild from "../models/Guild";
import Raid from "../models/Raid";
import User, { IUser } from "../models/User";
import logger from "../utils/logger";
import { compareRaidsByPriority } from "../utils/raidPriority";
import searchService, { SearchResult } from "./search.service";

const DISCORD_API_BASE = "https://discord.com/api/v10";
const INSTALL_STATE_TTL_MS = 10 * 60 * 1000;
const SUPPRESS_EMBEDS_FLAG = 1 << 2;
const MAX_DELIVERY_ATTEMPTS = 5;
const EVENT_PUBLISHER_STATE_KEY = "eventPublisher";
const VALID_EVENT_TYPES: EventType[] = ["boss_kill", "best_pull", "hiatus", "regress", "reproge"];
const VALID_DIFFICULTIES = ["mythic", "heroic"] as const;
const TEXT_CHANNEL_TYPES = new Set([0, 5]);
const CLASS_COLORS: Record<number, number> = {
  1: 0xc41e3a,
  2: 0xff7c0a,
  3: 0xaad372,
  4: 0x3fc7eb,
  5: 0x00ff98,
  6: 0xf48cba,
  7: 0xffffff,
  8: 0xfff468,
  9: 0x0070dd,
  10: 0x8788ee,
  11: 0xc69b6d,
  12: 0xa330c9,
  13: 0x33937f,
};

type DiscordInteractionMessageData = {
  content?: string;
  embeds?: unknown[];
  flags?: number;
  allowed_mentions?: { parse: string[] };
};

type DiscordDifficulty = (typeof VALID_DIFFICULTIES)[number];

interface InstallState {
  userId: string;
  guildId?: string;
  expiresAt: Date;
}

interface DiscordTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  guild?: DiscordGuildResponse;
}

interface DiscordUserResponse {
  id: string;
  username: string;
  discriminator: string;
  avatar: string | null;
}

interface DiscordUserGuildResponse {
  id: string;
  name: string;
  icon: string | null;
  owner: boolean;
  permissions: string;
}

interface DiscordGuildResponse {
  id: string;
  name: string;
  icon: string | null;
}

interface DiscordChannelResponse {
  id: string;
  guild_id?: string;
  name: string;
  type: number;
  parent_id?: string | null;
}

interface DiscordMessageResponse {
  id: string;
}

export interface DiscordManageableGuild {
  id: string;
  name: string;
  icon: string | null;
  owner: boolean;
  permissions: string;
  canManage: boolean;
  botInstalled: boolean;
}

export interface DiscordChannelOption {
  id: string;
  name: string;
  type: number;
  parentId?: string | null;
}

export interface DiscordGuildOption {
  id: string;
  name: string;
  realm: string;
  region: string;
  parent_guild?: string;
}

export interface DiscordRaidOption {
  id: number;
  name: string;
  expansion: string;
  iconUrl?: string;
}

export interface DiscordIntegrationSettingsResponse {
  integration: ReturnType<DiscordBotService["serializeIntegration"]> | null;
  channels: DiscordChannelOption[];
  guildOptions: DiscordGuildOption[];
  raidOptions: DiscordRaidOption[];
  validEventTypes: EventType[];
  validDifficulties: DiscordDifficulty[];
}

interface UpdateDiscordIntegrationInput {
  searchEnabled?: boolean;
  eventsEnabled?: boolean;
  channelId?: string | null;
  guildIds?: string[];
  eventTypes?: EventType[];
  difficulties?: DiscordDifficulty[];
  raidIds?: number[];
}

class DiscordBotError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

class DiscordBotService {
  private clientId = process.env.DISCORD_CLIENT_ID || "";
  private clientSecret = process.env.DISCORD_CLIENT_SECRET || "";
  private botToken = process.env.DISCORD_BOT_TOKEN || "";
  private publicKey = process.env.DISCORD_PUBLIC_KEY || "";
  private installStates = new Map<string, InstallState>();
  private eventPublisherInterval: NodeJS.Timeout | null = null;
  private isPublishingEvents = false;
  private commandsRegistered = false;

  isConfigured(): boolean {
    return Boolean(this.clientId && this.clientSecret && this.botToken && this.publicKey);
  }

  getStatus() {
    return {
      enabled: this.isConfigured(),
      missing: {
        clientId: !this.clientId,
        clientSecret: !this.clientSecret,
        botToken: !this.botToken,
        publicKey: !this.publicKey,
      },
      installRedirectUri: this.getInstallRedirectUri(),
      interactionsEndpointUrl: `${this.getApiBaseUrl()}/api/discord/interactions`,
    };
  }

  async registerCommands(): Promise<void> {
    if (!this.isConfigured()) {
      logger.info("[DiscordBot] Bot integration disabled; command registration skipped");
      return;
    }

    if (this.commandsRegistered) {
      return;
    }

    try {
      const command = this.getApplicationCommandDefinition();
      const existingCommands = await this.discordRequest<Array<{ id: string; name: string }>>(
        "GET",
        `/applications/${this.clientId}/commands`,
        undefined,
        "Bot",
      );
      const existingCommand = existingCommands.find((item) => item.name === command.name);

      if (existingCommand) {
        await this.discordRequest("PATCH", `/applications/${this.clientId}/commands/${existingCommand.id}`, command, "Bot");
        logger.info("[DiscordBot] Updated global /suomiwow command");
      } else {
        await this.discordRequest("POST", `/applications/${this.clientId}/commands`, command, "Bot");
        logger.info("[DiscordBot] Registered global /suomiwow command");
      }

      logger.info(`[DiscordBot] Interaction endpoint should be configured as ${this.getApiBaseUrl()}/api/discord/interactions`);
      await this.registerInstalledGuildCommands();
      this.commandsRegistered = true;
    } catch (error) {
      logger.error("[DiscordBot] Failed to register application commands:", error);
    }
  }

  async registerGuildCommands(discordGuildId: string): Promise<void> {
    if (!this.isConfigured()) {
      return;
    }

    try {
      const command = this.getApplicationCommandDefinition();
      const existingCommands = await this.discordRequest<Array<{ id: string; name: string }>>(
        "GET",
        `/applications/${this.clientId}/guilds/${discordGuildId}/commands`,
        undefined,
        "Bot",
      );
      const existingCommand = existingCommands.find((item) => item.name === command.name);

      if (existingCommand) {
        await this.discordRequest("PATCH", `/applications/${this.clientId}/guilds/${discordGuildId}/commands/${existingCommand.id}`, command, "Bot");
        logger.info(`[DiscordBot] Updated guild /suomiwow command for ${discordGuildId}`);
      } else {
        await this.discordRequest("POST", `/applications/${this.clientId}/guilds/${discordGuildId}/commands`, command, "Bot");
        logger.info(`[DiscordBot] Registered guild /suomiwow command for ${discordGuildId}`);
      }
    } catch (error) {
      logger.error(`[DiscordBot] Failed to register guild command for ${discordGuildId}:`, error);
    }
  }

  private async registerInstalledGuildCommands(): Promise<void> {
    const integrations = await DiscordGuildIntegration.find({ isInstalled: true }).select("discordGuildId").lean();
    for (const integration of integrations) {
      await this.registerGuildCommands(integration.discordGuildId);
    }
  }

  startEventPublisher(): void {
    if (!this.isConfigured()) {
      logger.info("[DiscordBot] Bot integration disabled; event publisher skipped");
      return;
    }

    if (this.eventPublisherInterval) {
      return;
    }

    const intervalSeconds = Math.max(parseInt(process.env.DISCORD_EVENT_POLL_INTERVAL_SECONDS || "30", 10), 10);
    this.eventPublisherInterval = setInterval(() => {
      void this.publishPendingEvents();
    }, intervalSeconds * 1000);

    logger.info(`[DiscordBot] Event publisher started, polling every ${intervalSeconds}s`);
    void this.publishPendingEvents();
  }

  stopEventPublisher(): void {
    if (this.eventPublisherInterval) {
      clearInterval(this.eventPublisherInterval);
      this.eventPublisherInterval = null;
    }
  }

  createInstallUrl(user: IUser, guildId?: string): string {
    this.assertConfigured();
    this.cleanupInstallStates();

    const state = crypto.randomBytes(32).toString("hex");
    this.installStates.set(state, {
      userId: user._id.toString(),
      guildId,
      expiresAt: new Date(Date.now() + INSTALL_STATE_TTL_MS),
    });

    const params = new URLSearchParams({
      client_id: this.clientId,
      response_type: "code",
      redirect_uri: this.getInstallRedirectUri(),
      scope: "identify bot applications.commands",
      permissions: process.env.DISCORD_BOT_PERMISSIONS || "19456",
      integration_type: "0",
      state,
    });

    if (guildId) {
      params.set("guild_id", guildId);
      params.set("disable_guild_select", "true");
    }

    return `https://discord.com/oauth2/authorize?${params.toString()}`;
  }

  createSettingsRedirect(params: Record<string, string>): string {
    const searchParams = new URLSearchParams(params);
    return `${this.getFrontendBaseUrl()}/profile/discord?${searchParams.toString()}`;
  }

  async handleInstallCallback(code: string, state: string, callbackGuildId?: string): Promise<string> {
    this.assertConfigured();

    const installState = this.consumeInstallState(state);
    if (!installState) {
      return this.createSettingsRedirect({ error: "invalid_state" });
    }

    const user = await User.findById(installState.userId);
    if (!user) {
      return this.createSettingsRedirect({ error: "session_expired" });
    }

    try {
      const tokens = await this.exchangeInstallCode(code);
      const discordUser = await this.getDiscordUser(tokens.access_token);
      if (discordUser.id !== user.discord.id) {
        return this.createSettingsRedirect({ error: "discord_user_mismatch" });
      }

      const discordGuildId = callbackGuildId || tokens.guild?.id || installState.guildId;
      if (!discordGuildId) {
        return this.createSettingsRedirect({ error: "missing_guild" });
      }

      const discordGuild = await this.getBotGuild(discordGuildId);
      await this.upsertInstalledIntegration(user, discordGuild);
      void this.registerGuildCommands(discordGuildId);

      return this.createSettingsRedirect({ installed: "1", guildId: discordGuildId });
    } catch (error) {
      logger.error("[DiscordBot] Install callback failed:", error);
      return this.createSettingsRedirect({ error: "install_failed" });
    }
  }

  async getManageableGuilds(user: IUser): Promise<{ needsReconnect: boolean; guilds: DiscordManageableGuild[] }> {
    if (!this.isConfigured()) {
      return { needsReconnect: false, guilds: [] };
    }

    if (!this.hasDiscordScope(user, "guilds")) {
      return { needsReconnect: true, guilds: [] };
    }

    const accessToken = await this.getValidUserAccessToken(user);
    if (!accessToken) {
      return { needsReconnect: true, guilds: [] };
    }

    try {
      const guilds = await this.discordRequest<DiscordUserGuildResponse[]>("GET", "/users/@me/guilds", undefined, "Bearer", accessToken);
      const manageableGuilds = guilds.filter((guild) => this.canManageGuild(guild));
      const integrations = await DiscordGuildIntegration.find({ discordGuildId: { $in: manageableGuilds.map((guild) => guild.id) } }).lean();
      const installedGuildIds = await this.getAccessibleInstalledGuildIds(integrations.filter((integration) => integration.isInstalled));

      return {
        needsReconnect: false,
        guilds: manageableGuilds.map((guild) => ({
          id: guild.id,
          name: guild.name,
          icon: guild.icon,
          owner: guild.owner,
          permissions: guild.permissions,
          canManage: true,
          botInstalled: installedGuildIds.has(guild.id),
        })),
      };
    } catch (error) {
      logger.warn("[DiscordBot] Failed to fetch current user's guilds:", error);
      return { needsReconnect: true, guilds: [] };
    }
  }

  async getIntegrationsForUser(user: IUser) {
    const guildResult = await this.getManageableGuilds(user);
    if (guildResult.needsReconnect) {
      return { needsReconnect: true, integrations: [] };
    }

    const manageableGuildIds = guildResult.guilds.map((guild) => guild.id);
    const integrations = await DiscordGuildIntegration.find({ discordGuildId: { $in: manageableGuildIds } }).sort({ discordGuildName: 1 }).lean();

    return {
      needsReconnect: false,
      integrations: integrations.map((integration) => this.serializeIntegration(integration)),
    };
  }

  async getIntegrationSettings(user: IUser, discordGuildId: string): Promise<DiscordIntegrationSettingsResponse> {
    await this.ensureCanManageGuild(user, discordGuildId);

    const [integration, guildOptions, raidOptions] = await Promise.all([
      DiscordGuildIntegration.findOne({ discordGuildId }).lean(),
      this.getTrackedGuildOptions(),
      this.getRaidOptions(),
    ]);

    let serializedIntegration = integration ? this.serializeIntegration(integration) : null;
    let channels: DiscordChannelOption[] = [];

    if (integration?.isInstalled) {
      try {
        await this.getBotGuild(discordGuildId);
        channels = await this.getChannelOptions(discordGuildId);
      } catch (error) {
        if (this.isDiscordMissingAccessError(error)) {
          const lastError = "Bot is not installed in this server or no longer has access. Reinstall the bot from this page.";
          await this.markIntegrationUnavailable(discordGuildId, lastError, false);
          serializedIntegration = { ...serializedIntegration!, isInstalled: false, lastError };
        } else {
          throw error;
        }
      }
    }

    return {
      integration: serializedIntegration,
      channels,
      guildOptions,
      raidOptions,
      validEventTypes: VALID_EVENT_TYPES,
      validDifficulties: [...VALID_DIFFICULTIES],
    };
  }

  async updateIntegrationSettings(user: IUser, discordGuildId: string, input: UpdateDiscordIntegrationInput) {
    this.assertConfigured();
    const managedGuild = await this.ensureCanManageGuild(user, discordGuildId);
    const botGuild = await this.getBotGuild(discordGuildId);
    const integration = await this.upsertInstalledIntegration(user, {
      id: botGuild.id,
      name: botGuild.name || managedGuild.name,
      icon: botGuild.icon ?? managedGuild.icon,
    });

    const searchEnabled = typeof input.searchEnabled === "boolean" ? input.searchEnabled : integration.features.search;
    const eventsEnabled = typeof input.eventsEnabled === "boolean" ? input.eventsEnabled : integration.eventConfig.enabled;
    const channelId = typeof input.channelId === "string" && input.channelId.trim() ? input.channelId.trim() : undefined;
    const eventTypes = this.validateEventTypes(input.eventTypes ?? integration.eventConfig.eventTypes);
    const difficulties = this.validateDifficulties(input.difficulties ?? integration.eventConfig.difficulties);
    const raidIds = this.validateRaidIds(input.raidIds ?? integration.eventConfig.raidIds);
    const guildIds = await this.validateTrackedGuildIds(input.guildIds);

    if (eventsEnabled && !channelId) {
      throw new DiscordBotError("Select a Discord channel before enabling event announcements", 400);
    }

    let channelName: string | undefined;
    if (channelId) {
      const channels = await this.getChannelOptions(discordGuildId);
      const channel = channels.find((option) => option.id === channelId);
      if (!channel) {
        throw new DiscordBotError("Selected Discord channel is not available to the bot", 400);
      }
      channelName = channel.name;
    }

    integration.discordGuildName = botGuild.name || managedGuild.name;
    integration.discordGuildIcon = botGuild.icon ?? managedGuild.icon;
    integration.features.search = searchEnabled;
    integration.features.events = eventsEnabled;
    integration.eventConfig.enabled = eventsEnabled;
    integration.eventConfig.channelId = channelId;
    integration.eventConfig.channelName = channelName;
    integration.eventConfig.guildIds = guildIds.map((id) => new mongoose.Types.ObjectId(id));
    integration.eventConfig.eventTypes = eventTypes;
    integration.eventConfig.difficulties = difficulties;
    integration.eventConfig.raidIds = raidIds;
    integration.isInstalled = true;
    integration.lastSyncedAt = new Date();
    integration.lastError = undefined;
    await integration.save();

    return this.serializeIntegration(integration);
  }

  async sendTestMessage(user: IUser, discordGuildId: string) {
    this.assertConfigured();
    await this.ensureCanManageGuild(user, discordGuildId);

    const integration = await DiscordGuildIntegration.findOne({ discordGuildId });
    if (!integration?.eventConfig.channelId) {
      throw new DiscordBotError("Select and save an announcement channel first", 400);
    }

    const message = await this.discordRequest<DiscordMessageResponse>(
      "POST",
      `/channels/${integration.eventConfig.channelId}/messages`,
      {
        content: "Suomi WoW event announcements are connected.",
        allowed_mentions: { parse: [] },
      },
      "Bot",
    );

    return { success: true, messageId: message.id };
  }

  async uninstallIntegration(user: IUser, discordGuildId: string) {
    this.assertConfigured();
    await this.ensureCanManageGuild(user, discordGuildId);

    try {
      await this.discordRequest("DELETE", `/users/@me/guilds/${discordGuildId}`, undefined, "Bot");
    } catch (error) {
      if (!this.isDiscordMissingAccessError(error)) {
        throw error;
      }
    }

    await this.markIntegrationUnavailable(discordGuildId, "Bot uninstalled from this server.", false);
    const integration = await DiscordGuildIntegration.findOne({ discordGuildId });
    return integration ? this.serializeIntegration(integration) : null;
  }

  async handleInteraction(rawBody: string, signature: string | undefined, timestamp: string | undefined) {
    this.assertConfigured();

    if (!signature || !timestamp || !this.verifyInteractionSignature(rawBody, signature, timestamp)) {
      logger.warn("[DiscordBot] Interaction rejected because signature verification failed");
      throw new DiscordBotError("invalid request signature", 401);
    }

    const interaction = JSON.parse(rawBody);
    const subcommandName = interaction.data?.options?.find((option: { type: number }) => option.type === 1)?.name;
    logger.info(
      `[DiscordBot] Interaction verified: type=${interaction.type} command=${interaction.data?.name ?? "none"} subcommand=${subcommandName ?? "none"} guild=${interaction.guild_id ?? "none"}`,
    );

    if (interaction.type === 1) {
      return { type: 1 };
    }

    if (interaction.type === 4) {
      return this.handleAutocompleteInteraction(interaction);
    }

    if (interaction.type !== 2 || interaction.data?.name !== "suomiwow") {
      return this.interactionResponse("Unknown command.");
    }

    const subcommand = interaction.data.options?.find((option: { type: number }) => option.type === 1);
    if (!subcommand) {
      return this.interactionResponse("Use `/suomiwow search`.");
    }

    if (subcommand.name === "settings") {
      return this.interactionResponse("Settings are managed from the website profile page.");
    }

    if (subcommand.name === "search") {
      void this.respondToSearchInteraction(interaction, subcommand);
      return this.deferredInteractionResponse();
    }

    return this.interactionResponse("Unknown subcommand.");
  }

  private async publishPendingEvents(): Promise<void> {
    if (this.isPublishingEvents) {
      return;
    }

    this.isPublishingEvents = true;
    try {
      await this.enqueueNewEventDeliveries();
      await this.sendDueEventDeliveries();
    } catch (error) {
      logger.error("[DiscordBot] Event publisher error:", error);
    } finally {
      this.isPublishingEvents = false;
    }
  }

  private async enqueueNewEventDeliveries(): Promise<void> {
    let state = await DiscordBotState.findOne({ key: EVENT_PUBLISHER_STATE_KEY });
    if (!state) {
      await DiscordBotState.create({ key: EVENT_PUBLISHER_STATE_KEY, lastEventCreatedAt: new Date() });
      return;
    }

    if (!state.lastEventCreatedAt) {
      state.lastEventCreatedAt = new Date();
      await state.save();
      return;
    }

    const events = await Event.find({ createdAt: { $gt: state.lastEventCreatedAt } }).sort({ createdAt: 1 }).limit(100);
    if (events.length === 0) {
      return;
    }

    const integrations = await DiscordGuildIntegration.find({
      isInstalled: true,
      "features.events": true,
      "eventConfig.enabled": true,
      "eventConfig.channelId": { $exists: true, $ne: null },
    });

    for (const event of events) {
      const matchingIntegrations = integrations.filter((integration) => this.integrationMatchesEvent(integration, event));
      for (const integration of matchingIntegrations) {
        await DiscordEventDelivery.updateOne(
          { integrationId: integration._id, eventId: event._id },
          {
            $setOnInsert: {
              integrationId: integration._id,
              eventId: event._id,
              discordGuildId: integration.discordGuildId,
              channelId: integration.eventConfig.channelId,
              status: "pending",
              attempts: 0,
              nextAttemptAt: new Date(),
            },
          },
          { upsert: true },
        );
      }

      state.lastEventCreatedAt = event.createdAt;
      await state.save();
    }
  }

  private async sendDueEventDeliveries(): Promise<void> {
    const deliveries = await DiscordEventDelivery.find({
      status: { $in: ["pending", "failed"] },
      nextAttemptAt: { $lte: new Date() },
      attempts: { $lt: MAX_DELIVERY_ATTEMPTS },
    })
      .sort({ nextAttemptAt: 1 })
      .limit(20);

    for (const delivery of deliveries) {
      try {
        const [integration, event] = await Promise.all([DiscordGuildIntegration.findById(delivery.integrationId), Event.findById(delivery.eventId)]);
        if (!integration || !event || !integration.eventConfig.channelId || !this.integrationMatchesEvent(integration, event)) {
          delivery.status = "failed";
          delivery.attempts = MAX_DELIVERY_ATTEMPTS;
          delivery.lastError = "Delivery target no longer exists or no longer matches settings";
          await delivery.save();
          continue;
        }

        const discordMessage = await this.sendEventToChannel(event, integration);
        delivery.status = "sent";
        delivery.sentAt = new Date();
        delivery.discordMessageId = discordMessage.id;
        delivery.lastError = undefined;
        await delivery.save();
      } catch (error) {
        const attempts = delivery.attempts + 1;
        delivery.status = "failed";
        delivery.attempts = attempts;
        delivery.lastError = error instanceof Error ? error.message : String(error);
        delivery.nextAttemptAt = new Date(Date.now() + Math.min(60 * 60 * 1000, 2 ** attempts * 60 * 1000));
        await delivery.save();

        await DiscordGuildIntegration.updateOne({ _id: delivery.integrationId }, { $set: { lastError: delivery.lastError } });
      }
    }
  }

  private async sendEventToChannel(event: IEvent, integration: IDiscordGuildIntegration): Promise<DiscordMessageResponse> {
    return this.discordRequest<DiscordMessageResponse>(
      "POST",
      `/channels/${integration.eventConfig.channelId}/messages`,
      {
        embeds: [await this.buildEventEmbed(event)],
        allowed_mentions: { parse: [] },
      },
      "Bot",
    );
  }

  private async buildEventEmbed(event: IEvent) {
    const guildUrl = event.guildRealm ? `${this.getFrontendBaseUrl()}/guilds/${encodeURIComponent(event.guildRealm)}/${encodeURIComponent(event.guildName)}` : this.getFrontendBaseUrl();
    const title = this.getEventTitle(event);
    const fields = [
      { name: "Guild", value: event.guildRealm ? `[${event.guildName}-${event.guildRealm}](${guildUrl})` : event.guildName, inline: true },
      { name: "Raid", value: event.raidName, inline: true },
      { name: "Difficulty", value: this.capitalize(event.difficulty), inline: true },
    ];

    const detail = this.getEventDetail(event);
    if (detail) {
      fields.push({ name: "Details", value: detail, inline: false });
    }

    const liveStreamLinks = await this.getLiveStreamerLinks(event.guildId);
    if (liveStreamLinks.length > 0) {
      fields.push({ name: "Live", value: liveStreamLinks.join("\n"), inline: false });
    }

    return {
      title,
      url: guildUrl,
      color: this.getEventColor(event.type),
      fields,
      thumbnail: event.bossIconUrl ? { url: `${this.getFrontendBaseUrl()}/icons/${event.bossIconUrl}` } : undefined,
      timestamp: event.timestamp.toISOString(),
      footer: { text: "Suomi WoW" },
    };
  }

  private async getLiveStreamerLinks(guildId: mongoose.Types.ObjectId): Promise<string[]> {
    const guild = await Guild.findById(guildId).select("streamers.channelName streamers.isLive streamers.gameName").lean();
    const liveStreamers = (guild?.streamers ?? []).filter((streamer) => streamer.isLive).slice(0, 5);

    return liveStreamers.map((streamer) => {
      const channelName = streamer.channelName.trim();
      const label = streamer.gameName ? `${channelName} (${streamer.gameName})` : channelName;
      return `[${label}](https://www.twitch.tv/${encodeURIComponent(channelName)})`;
    });
  }

  private getEventTitle(event: IEvent): string {
    switch (event.type) {
      case "boss_kill":
        return `${event.guildName} killed ${event.bossName || "a boss"}`;
      case "best_pull":
        return `${event.guildName} improved on ${event.bossName || "a boss"}`;
      case "milestone":
        return `${event.guildName} reached a milestone`;
      case "hiatus":
        return `${event.guildName} appears inactive`;
      case "regress":
        return `${event.guildName} had a rough raid night`;
      case "reproge":
        return `${event.guildName} is reprogging ${event.bossName || "a boss"}`;
      default:
        return `${event.guildName} event`;
    }
  }

  private getEventDetail(event: IEvent): string | null {
    const details: string[] = [];
    if (event.bossName) details.push(`Boss: ${event.bossName}`);
    if (typeof event.data.killRank === "number") details.push(`Tracked guild kill rank: #${event.data.killRank}`);
    if (typeof event.data.pullCount === "number") details.push(`Pulls: ${event.data.pullCount}`);
    if (typeof event.data.bestPercent === "number") details.push(`Best pull: ${event.data.progressDisplay || `${event.data.bestPercent.toFixed(1)}%`}`);
    if (typeof event.data.hiatusDays === "number") details.push(`No recent raid logs for ${event.data.hiatusDays} days`);
    return details.length > 0 ? details.join("\n") : null;
  }

  private getEventColor(type: EventType): number {
    switch (type) {
      case "boss_kill":
        return 0x22c55e;
      case "best_pull":
        return 0x60a5fa;
      case "milestone":
        return 0xfacc15;
      case "hiatus":
        return 0x94a3b8;
      case "regress":
        return 0xef4444;
      case "reproge":
        return 0xa855f7;
      default:
        return 0x818cf8;
    }
  }

  private integrationMatchesEvent(integration: IDiscordGuildIntegration, event: IEvent): boolean {
    if (!integration.features.events || !integration.eventConfig.enabled || !integration.eventConfig.channelId) {
      return false;
    }

    if (!integration.eventConfig.eventTypes.includes(event.type)) {
      return false;
    }

    if (!integration.eventConfig.difficulties.includes(event.difficulty)) {
      return false;
    }

    if (integration.eventConfig.raidIds.length > 0 && !integration.eventConfig.raidIds.includes(event.raidId)) {
      return false;
    }

    if (integration.eventConfig.guildIds.length > 0) {
      return integration.eventConfig.guildIds.some((guildId) => guildId.toString() === event.guildId.toString());
    }

    return true;
  }

  private async handleSearchInteraction(interaction: any, subcommand: any) {
    const discordGuildId = interaction.guild_id;
    if (!discordGuildId) {
      return this.interactionResponse("Search is available inside Discord servers.");
    }

    const integration = await DiscordGuildIntegration.findOne({ discordGuildId }).lean();
    if (integration && !integration.features.search) {
      return this.interactionResponse("Search is disabled for this server.");
    }

    const query = this.getStringOption(subcommand, "query");
    if (!query || query.trim().length < 2) {
      return this.interactionResponse("Search query must be at least 2 characters.");
    }

    const results = await searchService.searchSite(query, 5);
    if (results.length === 0) {
      return this.interactionResponse(`No guilds or characters found for "${query}".`);
    }

    if (results.length === 1 && results[0].type === "character") {
      return this.interactionResponse(undefined, {
        embeds: [this.buildCharacterSearchEmbed(results[0])],
        suppressEmbeds: false,
      });
    }

    if (results.length === 1 && results[0].type === "guild") {
      return this.interactionResponse(undefined, {
        embeds: [this.buildGuildSearchEmbed(results[0])],
        suppressEmbeds: false,
      });
    }

    return this.interactionResponse(this.formatSearchResults(results));
  }

  private async respondToSearchInteraction(interaction: any, subcommand: any): Promise<void> {
    try {
      const response = await this.handleSearchInteraction(interaction, subcommand);
      await this.editInteractionResponse(interaction.token, response.data);
    } catch (error) {
      logger.error("[DiscordBot] Failed to send search interaction response:", error);
      await this.editInteractionResponse(interaction.token, { content: "Search failed. Please try again.", flags: SUPPRESS_EMBEDS_FLAG }).catch((followupError) => {
        logger.error("[DiscordBot] Failed to send search error response:", followupError);
      });
    }
  }

  private async handleAutocompleteInteraction(interaction: any) {
    const subcommand = interaction.data?.options?.find((option: { type: number }) => option.type === 1);
    if (interaction.data?.name !== "suomiwow" || subcommand?.name !== "search") {
      return { type: 8, data: { choices: [] } };
    }

    const focusedOption = subcommand.options?.find((option: { focused?: boolean }) => option.focused);
    const query = typeof focusedOption?.value === "string" ? focusedOption.value : "";
    const results = await searchService.searchSite(query, 5);

    return {
      type: 8,
      data: {
        choices: results.map((result) => ({
          name: `${this.capitalize(result.type)}: ${this.formatSearchResultTitle(result)}`.slice(0, 100),
          value: `${result.name}-${result.realm}`.slice(0, 100),
        })),
      },
    };
  }

  private formatSearchResults(results: SearchResult[]): string {
    const lines = results.map((result) => {
      const url = `${this.getFrontendBaseUrl()}${result.href}`;
      return `- ${this.capitalize(result.type)}: [${this.formatSearchResultTitle(result)}](${url})`;
    });

    return `Found ${results.length} result${results.length === 1 ? "" : "s"}:\n${lines.join("\n")}`;
  }

  private buildCharacterSearchEmbed(result: SearchResult) {
    const url = `${this.getFrontendBaseUrl()}${result.href}`;
    const classInfo = typeof result.classID === "number" ? CLASSES.find((classItem) => classItem.id === result.classID) : null;
    const fields = [
      { name: "Realm", value: this.formatRealmName(result.realm), inline: true },
      { name: "Class", value: classInfo?.name ?? "Unknown", inline: true },
    ];

    if (result.guild) {
      const guildUrl = `${this.getFrontendBaseUrl()}/guilds/${encodeURIComponent(result.guild.realm)}/${encodeURIComponent(result.guild.name)}`;
      fields.push({ name: "Latest guild", value: `[${result.guild.name}-${this.formatRealmName(result.guild.realm)}](${guildUrl})`, inline: false });
    }

    const classIconUrl = classInfo ? this.getClassIconUrl(classInfo.iconUrl) : undefined;

    return {
      title: this.formatSearchResultTitle(result),
      url,
      color: typeof result.classID === "number" ? CLASS_COLORS[result.classID] ?? 0x818cf8 : 0x818cf8,
      fields,
      thumbnail: classIconUrl ? { url: classIconUrl } : undefined,
      footer: { text: "Suomi WoW character" },
    };
  }

  private buildGuildSearchEmbed(result: SearchResult) {
    const url = `${this.getFrontendBaseUrl()}${result.href}`;
    const thumbnailUrl = this.getGuildThumbnailUrl(result);

    return {
      title: this.formatSearchResultTitle(result),
      url,
      color: this.getGuildEmbedColor(result),
      fields: [{ name: "Realm", value: this.formatRealmName(result.realm), inline: true }],
      thumbnail: thumbnailUrl ? { url: thumbnailUrl } : undefined,
      footer: { text: "Suomi WoW guild" },
    };
  }

  private formatSearchResultTitle(result: SearchResult): string {
    return `${result.name}-${this.formatRealmName(result.realm)}`;
  }

  private formatRealmName(value: string): string {
    return value
      .split("-")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(" ");
  }

  private getClassIconUrl(iconName: string): string {
    const filename = /\.[a-z0-9]+$/i.test(iconName) ? iconName : `${iconName}.jpg`;
    return this.getFrontendAssetUrl(`icons/${filename}`);
  }

  private getGuildThumbnailUrl(result: SearchResult): string {
    if (result.iconUrl) {
      if (/^https?:\/\//i.test(result.iconUrl)) return result.iconUrl;
      const iconPath = result.iconUrl.replace(/^\/+/, "");
      return this.getFrontendAssetUrl(iconPath.startsWith("icons/") ? iconPath : `icons/${iconPath}`);
    }

    if (result.crest?.emblem?.imageName) {
      return this.getFrontendAssetUrl(`components/${result.crest.emblem.imageName}`);
    }

    return this.getFrontendAssetUrl("logo.png");
  }

  private getGuildEmbedColor(result: SearchResult): number {
    const color = result.crest?.background?.color ?? result.crest?.emblem?.color;
    if (!color) return 0x38bdf8;

    const red = this.clampDiscordColorChannel(color.r);
    const green = this.clampDiscordColorChannel(color.g);
    const blue = this.clampDiscordColorChannel(color.b);
    return (red << 16) + (green << 8) + blue;
  }

  private clampDiscordColorChannel(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(255, Math.round(value)));
  }

  private getFrontendAssetUrl(path: string): string {
    if (/^https?:\/\//i.test(path)) return path;
    return `${this.getFrontendBaseUrl()}/${path
      .replace(/^\/+/, "")
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/")}`;
  }

  private getStringOption(subcommand: any, name: string): string | null {
    const option = subcommand.options?.find((item: { name: string }) => item.name === name);
    return typeof option?.value === "string" ? option.value : null;
  }

  private interactionResponse(content?: string, options: { embeds?: unknown[]; suppressEmbeds?: boolean } = {}) {
    return {
      type: 4,
      data: {
        ...(content ? { content } : {}),
        ...(options.embeds ? { embeds: options.embeds } : {}),
        flags: options.suppressEmbeds === false ? 0 : SUPPRESS_EMBEDS_FLAG,
        allowed_mentions: { parse: [] },
      },
    };
  }

  private deferredInteractionResponse() {
    return {
      type: 5,
      data: {
        flags: SUPPRESS_EMBEDS_FLAG,
      },
    };
  }

  private getApplicationCommandDefinition() {
    return {
      name: "suomiwow",
      type: 1,
      description: "Search Suomi WoW.",
      integration_types: [0],
      contexts: [0],
      options: [
        {
          type: 1,
          name: "search",
          description: "Find a tracked guild or character.",
          options: [
            {
              type: 3,
              name: "query",
              description: "Guild or character name.",
              required: true,
              autocomplete: true,
            },
          ],
        },
      ],
    };
  }

  private async upsertInstalledIntegration(user: IUser, discordGuild: DiscordGuildResponse): Promise<IDiscordGuildIntegration> {
    const integration = await DiscordGuildIntegration.findOneAndUpdate(
      { discordGuildId: discordGuild.id },
      {
        $set: {
          discordGuildName: discordGuild.name,
          discordGuildIcon: discordGuild.icon,
          installedByUserId: user._id,
          installedByDiscordId: user.discord.id,
          isInstalled: true,
          lastSyncedAt: new Date(),
        },
        $setOnInsert: {
          installedAt: new Date(),
          features: { search: true, events: false },
          eventConfig: {
            enabled: false,
            guildIds: [],
            eventTypes: ["boss_kill", "best_pull"],
            difficulties: ["mythic"],
            raidIds: [],
          },
        },
      },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
    );

    if (!integration) {
      throw new DiscordBotError("Failed to create Discord integration", 500);
    }

    return integration;
  }

  private serializeIntegration(integration: Pick<IDiscordGuildIntegration, any> | any) {
    return {
      id: integration._id.toString(),
      discordGuildId: integration.discordGuildId,
      discordGuildName: integration.discordGuildName,
      discordGuildIcon: integration.discordGuildIcon ?? null,
      features: {
        search: Boolean(integration.features?.search),
        events: Boolean(integration.features?.events),
      },
      eventConfig: {
        enabled: Boolean(integration.eventConfig?.enabled),
        channelId: integration.eventConfig?.channelId ?? null,
        channelName: integration.eventConfig?.channelName ?? null,
        guildIds: (integration.eventConfig?.guildIds ?? []).map((id: mongoose.Types.ObjectId | string) => id.toString()),
        eventTypes: integration.eventConfig?.eventTypes ?? [],
        difficulties: integration.eventConfig?.difficulties ?? [],
        raidIds: integration.eventConfig?.raidIds ?? [],
      },
      isInstalled: Boolean(integration.isInstalled),
      installedAt: integration.installedAt,
      lastSyncedAt: integration.lastSyncedAt ?? null,
      lastError: integration.lastError ?? null,
    };
  }

  private async getChannelOptions(discordGuildId: string): Promise<DiscordChannelOption[]> {
    if (!this.isConfigured()) {
      return [];
    }

    try {
      const channels = await this.discordRequest<DiscordChannelResponse[]>("GET", `/guilds/${discordGuildId}/channels`, undefined, "Bot");
      return channels
        .filter((channel) => TEXT_CHANNEL_TYPES.has(channel.type))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((channel) => ({
          id: channel.id,
          name: channel.name,
          type: channel.type,
          parentId: channel.parent_id ?? null,
        }));
    } catch (error) {
      if (this.isDiscordMissingAccessError(error)) {
        const lastError = "Bot cannot read this server's channels. Reinstall the bot or grant its role View Channels permission.";
        await this.markIntegrationUnavailable(discordGuildId, lastError);
        logger.warn(`[DiscordBot] Missing channel access for guild ${discordGuildId}: ${lastError}`);
        return [];
      }

      logger.warn(`[DiscordBot] Failed to fetch channels for guild ${discordGuildId}:`, error);
      return [];
    }
  }

  private async getAccessibleInstalledGuildIds(integrations: Array<{ _id: unknown; discordGuildId: string }>): Promise<Set<string>> {
    const accessibleGuildIds = await Promise.all(
      integrations.map(async (integration) => {
        try {
          await this.getBotGuild(integration.discordGuildId);
          return integration.discordGuildId;
        } catch (error) {
          if (this.isDiscordMissingAccessError(error)) {
            await this.markIntegrationUnavailable(
              integration.discordGuildId,
              "Bot is not installed in this server or no longer has access. Reinstall the bot from the Discord bot settings page.",
              false,
            );
            return null;
          }

          logger.warn(`[DiscordBot] Could not verify bot access for guild ${integration.discordGuildId}:`, error);
          return integration.discordGuildId;
        }
      }),
    );

    return new Set(accessibleGuildIds.filter((guildId): guildId is string => Boolean(guildId)));
  }

  private async markIntegrationUnavailable(discordGuildId: string, lastError: string, isInstalled?: boolean): Promise<void> {
    await DiscordGuildIntegration.updateOne(
      { discordGuildId },
      {
        $set: {
          ...(typeof isInstalled === "boolean" ? { isInstalled } : {}),
          lastError,
          lastSyncedAt: new Date(),
        },
      },
    );
  }

  private async getTrackedGuildOptions(): Promise<DiscordGuildOption[]> {
    const guilds = await Guild.find().select("_id name realm region parent_guild").sort({ name: 1, realm: 1 }).lean();
    return guilds.map((guild: any) => ({
      id: guild._id.toString(),
      name: guild.name,
      realm: guild.realm,
      region: guild.region,
      parent_guild: guild.parent_guild,
    }));
  }

  private async getRaidOptions(): Promise<DiscordRaidOption[]> {
    const raids = await Raid.find().select("id name expansion iconUrl").lean();
    return [...raids].sort(compareRaidsByPriority).map((raid) => ({
      id: raid.id,
      name: raid.name,
      expansion: raid.expansion,
      iconUrl: raid.iconUrl,
    }));
  }

  private async ensureCanManageGuild(user: IUser, discordGuildId: string): Promise<DiscordManageableGuild> {
    const result = await this.getManageableGuilds(user);
    if (result.needsReconnect) {
      throw new DiscordBotError("Reconnect Discord before managing server integrations", 401);
    }

    const guild = result.guilds.find((item) => item.id === discordGuildId);
    if (!guild) {
      throw new DiscordBotError("You need Manage Server permission for this Discord server", 403);
    }

    return guild;
  }

  private canManageGuild(guild: DiscordUserGuildResponse): boolean {
    const permissions = BigInt(guild.permissions || "0");
    const administrator = (permissions & (1n << 3n)) !== 0n;
    const manageGuild = (permissions & (1n << 5n)) !== 0n;
    return guild.owner || administrator || manageGuild;
  }

  private validateEventTypes(values: EventType[]): EventType[] {
    const eventTypes = values.filter((value) => VALID_EVENT_TYPES.includes(value));
    if (eventTypes.length === 0) {
      throw new DiscordBotError("Select at least one event type", 400);
    }
    return Array.from(new Set(eventTypes));
  }

  private validateDifficulties(values: DiscordDifficulty[]): DiscordDifficulty[] {
    const difficulties = values.filter((value) => VALID_DIFFICULTIES.includes(value));
    if (difficulties.length === 0) {
      throw new DiscordBotError("Select at least one difficulty", 400);
    }
    return Array.from(new Set(difficulties));
  }

  private validateRaidIds(values: number[]): number[] {
    return Array.from(new Set(values.filter((value) => Number.isInteger(value) && value > 0)));
  }

  private async validateTrackedGuildIds(values?: string[]): Promise<string[]> {
    if (!values || values.length === 0) {
      return [];
    }

    const validObjectIds = Array.from(new Set(values.filter((id) => mongoose.Types.ObjectId.isValid(id))));
    if (validObjectIds.length === 0) {
      return [];
    }

    const existingGuilds = await Guild.find({ _id: { $in: validObjectIds } }).select("_id").lean();
    return existingGuilds.map((guild: any) => guild._id.toString());
  }

  private hasDiscordScope(user: IUser, scope: string): boolean {
    return Boolean(user.discord.scope?.split(/\s+/).includes(scope));
  }

  private isDiscordMissingAccessError(error: unknown): boolean {
    return error instanceof DiscordBotError && error.statusCode === 403 && (error.message.includes('"code": 50001') || error.message.includes("Missing Access"));
  }

  private async getValidUserAccessToken(user: IUser): Promise<string | null> {
    if (user.discord.tokenExpiresAt.getTime() > Date.now() + 60 * 1000) {
      return user.discord.accessToken;
    }

    if (!user.discord.refreshToken || !this.clientId || !this.clientSecret) {
      return null;
    }

    try {
      const params = new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: "refresh_token",
        refresh_token: user.discord.refreshToken,
      });

      const response = await fetch(`${DISCORD_API_BASE}/oauth2/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });

      if (!response.ok) {
        return null;
      }

      const tokens = (await response.json()) as DiscordTokenResponse;
      user.discord.accessToken = tokens.access_token;
      if (tokens.refresh_token) {
        user.discord.refreshToken = tokens.refresh_token;
      }
      user.discord.tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);
      user.discord.scope = tokens.scope;
      await user.save();

      return user.discord.accessToken;
    } catch (error) {
      logger.warn("[DiscordBot] Failed to refresh Discord user token:", error);
      return null;
    }
  }

  private async exchangeInstallCode(code: string): Promise<DiscordTokenResponse> {
    const params = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: this.getInstallRedirectUri(),
    });

    const response = await fetch(`${DISCORD_API_BASE}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    if (!response.ok) {
      throw new DiscordBotError(`Discord token exchange failed: ${await response.text()}`, 502);
    }

    return response.json() as Promise<DiscordTokenResponse>;
  }

  private async getDiscordUser(accessToken: string): Promise<DiscordUserResponse> {
    return this.discordRequest<DiscordUserResponse>("GET", "/users/@me", undefined, "Bearer", accessToken);
  }

  private async getBotGuild(discordGuildId: string): Promise<DiscordGuildResponse> {
    return this.discordRequest<DiscordGuildResponse>("GET", `/guilds/${discordGuildId}`, undefined, "Bot");
  }

  private async editInteractionResponse(interactionToken: string, data: DiscordInteractionMessageData): Promise<void> {
    await this.discordWebhookRequest("PATCH", `/webhooks/${this.clientId}/${interactionToken}/messages/@original`, {
      content: data.content ?? "",
      embeds: data.embeds ?? [],
      flags: data.flags ?? SUPPRESS_EMBEDS_FLAG,
      allowed_mentions: data.allowed_mentions ?? { parse: [] },
    });
  }

  private async discordRequest<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    authType: "Bot" | "Bearer" = "Bot",
    bearerToken?: string,
    retryCount = 0,
  ): Promise<T> {
    const token = authType === "Bot" ? this.botToken : bearerToken;
    if (!token) {
      throw new DiscordBotError("Discord token is not configured", 503);
    }

    const response = await fetch(`${DISCORD_API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `${authType} ${token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (response.status === 429 && retryCount < 1) {
      const rateLimit = (await response.json().catch(() => null)) as { retry_after?: number } | null;
      const retryAfterMs = Math.ceil((rateLimit?.retry_after ?? 1) * 1000);
      await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
      return this.discordRequest<T>(method, path, body, authType, bearerToken, retryCount + 1);
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new DiscordBotError(`Discord API ${method} ${path} failed (${response.status}): ${errorText}`, response.status >= 500 ? 502 : response.status);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return response.json() as Promise<T>;
  }

  private async discordWebhookRequest<T = unknown>(method: string, path: string, body?: unknown, retryCount = 0): Promise<T> {
    const response = await fetch(`${DISCORD_API_BASE}${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });

    if (response.status === 429 && retryCount < 1) {
      const rateLimit = (await response.json().catch(() => null)) as { retry_after?: number } | null;
      const retryAfterMs = Math.ceil((rateLimit?.retry_after ?? 1) * 1000);
      await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
      return this.discordWebhookRequest<T>(method, path, body, retryCount + 1);
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new DiscordBotError(`Discord webhook ${method} ${path} failed (${response.status}): ${errorText}`, response.status >= 500 ? 502 : response.status);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return response.json() as Promise<T>;
  }

  private verifyInteractionSignature(rawBody: string, signature: string, timestamp: string): boolean {
    try {
      const publicKey = crypto.createPublicKey({
        key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(this.publicKey, "hex")]),
        format: "der",
        type: "spki",
      });

      return crypto.verify(null, Buffer.from(timestamp + rawBody), publicKey, Buffer.from(signature, "hex"));
    } catch (error) {
      logger.warn("[DiscordBot] Failed to verify interaction signature:", error);
      return false;
    }
  }

  private assertConfigured(): void {
    if (!this.isConfigured()) {
      throw new DiscordBotError("Discord bot integration is not configured", 503);
    }
  }

  private cleanupInstallStates(): void {
    const now = new Date();
    for (const [state, value] of this.installStates.entries()) {
      if (value.expiresAt < now) {
        this.installStates.delete(state);
      }
    }
  }

  private consumeInstallState(state: string): InstallState | null {
    this.cleanupInstallStates();
    const value = this.installStates.get(state);
    if (!value) {
      return null;
    }
    this.installStates.delete(state);
    return value.expiresAt > new Date() ? value : null;
  }

  private getInstallRedirectUri(): string {
    if (process.env.DISCORD_INSTALL_REDIRECT_URI) {
      return process.env.DISCORD_INSTALL_REDIRECT_URI;
    }

    return `${this.getApiBaseUrl()}/api/discord/install/callback`;
  }

  private getApiBaseUrl(): string {
    if (process.env.API_PUBLIC_URL) {
      return process.env.API_PUBLIC_URL.replace(/\/$/, "");
    }

    return process.env.NODE_ENV === "production" ? "https://suomiwow.vaarattu.tv" : "http://localhost:3001";
  }

  private getFrontendBaseUrl(): string {
    if (process.env.PUBLIC_BASE_URL) {
      return process.env.PUBLIC_BASE_URL.replace(/\/$/, "");
    }

    return process.env.NODE_ENV === "production" ? "https://suomiwow.vaarattu.tv" : "http://localhost:3000";
  }

  private capitalize(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1);
  }
}

export { DiscordBotError };
export default new DiscordBotService();
