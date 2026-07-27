import { RefreshingAuthProvider } from "@twurple/auth";
import { ChatClient } from "@twurple/chat";
import mongoose from "mongoose";
import Event, { EventType, IEvent } from "../models/Event";
import Guild from "../models/Guild";
import TwitchBotSettings, { type TwitchBotDifficulty, type TwitchBotMessageTemplateKey, type TwitchBotMessageTemplates } from "../models/TwitchBotSettings";
import TwitchBotRuntimeState, { type ITwitchBotChannelBan } from "../models/TwitchBotRuntimeState";
import TwitchEventDelivery from "../models/TwitchEventDelivery";
import TwitchCcgRedemption from "../models/TwitchCcgRedemption";
import User from "../models/User";
import logger from "../utils/logger";
import twitchBotAuthService, { TwitchBotAuthStatus, TwitchBotRefreshedAccessToken } from "./twitch-bot-auth.service";
import twitchChatCommandService from "./twitch-chat-command.service";
import twitchCcgRewardService from "./twitch-ccg-reward.service";
import twitchChannelPointsService from "./twitch-channel-points.service";

type TwitchEventDifficulty = "mythic" | "heroic";

export interface TwitchBotSettingsSnapshot {
  eventPublishingEnabled: boolean;
  eventTypes: EventType[];
  difficulties: TwitchEventDifficulty[];
  includeUrl: boolean;
  messageTemplates: TwitchBotMessageTemplates;
}

export interface TwitchChatBotStatus extends TwitchBotAuthStatus {
  botEnabled: boolean;
  settings: TwitchBotSettingsSnapshot;
  chat: {
    running: boolean;
    connected: boolean;
    desiredChannels: string[];
    joinedChannels: string[];
    bannedChannels: Array<ITwitchBotChannelBan & { channelName: string }>;
    desiredCount: number;
    joinedCount: number;
    lastStartedAt?: Date;
    lastStoppedAt?: Date;
    lastConnectedAt?: Date;
    lastDisconnectedAt?: Date;
    lastReconciledAt?: Date;
    lastMessageAt?: Date;
    lastErrorAt?: Date;
    lastError?: string;
  };
  deliveries: {
    pending: number;
    failed: number;
    expired: number;
    sent24h: number;
  };
}

const VALID_EVENT_TYPES: EventType[] = ["boss_kill", "best_pull", "milestone", "hiatus", "regress", "reproge"];
const VALID_DIFFICULTIES: TwitchEventDifficulty[] = ["mythic", "heroic"];
const MESSAGE_TEMPLATE_KEYS: TwitchBotMessageTemplateKey[] = ["bossKill", "bestPull", "progressUpdate"];
const MESSAGE_TEMPLATE_MAX_LENGTH = 450;
const MESSAGE_TEMPLATE_PLACEHOLDERS = [
  "guild_name",
  "boss_name",
  "difficulty",
  "difficulty_short",
  "pulls",
  "pulls_phrase",
  "progress",
  "url",
  "url_suffix",
  "event_type",
] as const;
const DEFAULT_MESSAGE_TEMPLATES: TwitchBotMessageTemplates = {
  bossKill: "{difficulty} kill: {guild_name} defeated {boss_name}{pulls_phrase}.{url_suffix}",
  bestPull: "Best pull: {guild_name} reached {progress} on {boss_name}{pulls_phrase}.{url_suffix}",
  progressUpdate: "{difficulty}: {guild_name} updated progress on {boss_name}.{url_suffix}",
};
const RUNTIME_STATE_KEY = "runtime";
const SETTINGS_KEY = "global";
const MAX_DELIVERY_ATTEMPTS = 5;
const MAX_CCG_CHAT_DELIVERY_ATTEMPTS = 10;
const BANNED_CHANNEL_RETRY_BASE_MS = 60 * 60 * 1000;
const BANNED_CHANNEL_RETRY_MAX_MS = 12 * 60 * 60 * 1000;

type TwitchBotMessagePlaceholder = (typeof MESSAGE_TEMPLATE_PLACEHOLDERS)[number];
type TwitchBotMessageTemplateValues = Record<TwitchBotMessagePlaceholder, string>;
type TwitchBotSettingsInput = Partial<Omit<TwitchBotSettingsSnapshot, "messageTemplates">> & { messageTemplates?: unknown };

export class TwitchBotSettingsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TwitchBotSettingsValidationError";
  }
}

class TwitchBotChannelBackoffError extends Error {
  constructor(
    readonly channel: string,
    readonly nextRetryAt: Date,
  ) {
    super(`Twitch bot is banned from #${channel}; next join retry is ${nextRetryAt.toISOString()}`);
    this.name = "TwitchBotChannelBackoffError";
  }
}

class TwitchChatBotService {
  private chatClient: ChatClient | null = null;
  private reconcileInterval: NodeJS.Timeout | null = null;
  private eventPublisherInterval: NodeJS.Timeout | null = null;
  private running = false;
  private connected = false;
  private connecting = false;
  private reconciling = false;
  private publishing = false;
  private desiredChannels = new Set<string>();
  private joinedChannels = new Set<string>();
  private channelBans = new Map<string, ITwitchBotChannelBan>();
  private channelBansBotUserId: string | null = null;
  private botUserId: string | null = null;
  private botLogin: string | null = null;
  private channelJoinAttempts = new Map<string, Promise<void>>();
  private missingSince = new Map<string, number>();
  private userCooldowns = new Map<string, number>();
  private channelCommandCooldowns = new Map<string, number>();
  private outboundQueue: Promise<void> = Promise.resolve();
  private lastOutboundAt = 0;

  start(): void {
    if (!this.isEnabled()) {
      logger.info("[TwitchBot] Bot disabled by TWITCH_BOT_ENABLED=false");
      void this.writeRuntimeState({
        enabled: false,
        running: false,
        connected: false,
        desiredChannels: [],
        joinedChannels: [],
        lastStoppedAt: new Date(),
      });
      return;
    }

    if (this.running) {
      return;
    }

    this.running = true;
    const reconcileSeconds = Math.max(parseInt(process.env.TWITCH_BOT_RECONCILE_INTERVAL_SECONDS || "30", 10), 10);
    const eventSeconds = Math.max(parseInt(process.env.TWITCH_BOT_EVENT_POLL_INTERVAL_SECONDS || "30", 10), 10);

    this.reconcileInterval = setInterval(() => {
      void this.ensureConnectedAndReconcile();
    }, reconcileSeconds * 1000);

    this.eventPublisherInterval = setInterval(() => {
      void this.publishPendingEvents();
    }, eventSeconds * 1000);

    void this.writeRuntimeState({
      enabled: true,
      running: true,
      connected: false,
      lastStartedAt: new Date(),
    });
    logger.info(`[TwitchBot] Started IRC bot worker, reconcile every ${reconcileSeconds}s, event poll every ${eventSeconds}s`);
    void this.ensureConnectedAndReconcile();
    void this.publishPendingEvents();
  }

  async stop(): Promise<void> {
    this.running = false;

    if (this.reconcileInterval) {
      clearInterval(this.reconcileInterval);
      this.reconcileInterval = null;
    }

    if (this.eventPublisherInterval) {
      clearInterval(this.eventPublisherInterval);
      this.eventPublisherInterval = null;
    }

    await this.disconnectClient();
    this.desiredChannels.clear();
    this.joinedChannels.clear();
    this.missingSince.clear();
    await this.writeRuntimeState({
      enabled: this.isEnabled(),
      running: false,
      connected: false,
      desiredChannels: [],
      joinedChannels: [],
      lastStoppedAt: new Date(),
    });
  }

  async reconnect(): Promise<void> {
    await this.disconnectClient();
    await this.ensureConnectedAndReconcile();
  }

  async reconcileChannels(): Promise<{ desiredChannels: string[]; joinedChannels: string[] }> {
    await this.ensureConnectedAndReconcile();
    return {
      desiredChannels: Array.from(this.desiredChannels).sort(),
      joinedChannels: Array.from(this.joinedChannels).sort(),
    };
  }

  async getStatus(): Promise<TwitchChatBotStatus> {
    const [authStatus, runtime, deliveryCounts, sentCount, settings] = await Promise.all([
      twitchBotAuthService.getStatus(),
      TwitchBotRuntimeState.findOne({ key: RUNTIME_STATE_KEY }).lean(),
      TwitchEventDelivery.aggregate([{ $match: { status: { $in: ["pending", "failed", "expired"] } } }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
      TwitchEventDelivery.countDocuments({ status: "sent", sentAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } }),
      this.getSettings(),
    ]);
    const countsByStatus = new Map(deliveryCounts.map((entry: { _id: string; count: number }) => [entry._id, entry.count]));
    const desiredChannels = runtime?.desiredChannels?.length ? runtime.desiredChannels : Array.from(this.desiredChannels).sort();
    const joinedChannels = runtime?.joinedChannels?.length ? runtime.joinedChannels : Array.from(this.joinedChannels).sort();
    const bannedChannels =
      authStatus.twitchUserId && runtime?.channelBansBotUserId === authStatus.twitchUserId ? this.serializeChannelBans(runtime.channelBans) : [];

    return {
      ...authStatus,
      botEnabled: this.isEnabled(),
      settings,
      chat: {
        running: runtime?.running ?? this.running,
        connected: runtime?.connected ?? this.connected,
        desiredChannels,
        joinedChannels,
        bannedChannels,
        desiredCount: desiredChannels.length,
        joinedCount: joinedChannels.length,
        lastStartedAt: runtime?.lastStartedAt,
        lastStoppedAt: runtime?.lastStoppedAt,
        lastConnectedAt: runtime?.lastConnectedAt,
        lastDisconnectedAt: runtime?.lastDisconnectedAt,
        lastReconciledAt: runtime?.lastReconciledAt,
        lastMessageAt: runtime?.lastMessageAt,
        lastErrorAt: runtime?.lastErrorAt,
        lastError: runtime?.lastError,
      },
      deliveries: {
        pending: countsByStatus.get("pending") || 0,
        failed: countsByStatus.get("failed") || 0,
        expired: countsByStatus.get("expired") || 0,
        sent24h: sentCount,
      },
    };
  }

  async getSettings(): Promise<TwitchBotSettingsSnapshot> {
    const defaults = this.getDefaultSettings();
    const stored = await TwitchBotSettings.findOne({ key: SETTINGS_KEY }).lean();
    if (!stored) {
      return defaults;
    }

    return this.normalizeSettings({
      eventPublishingEnabled: stored.eventPublishingEnabled,
      eventTypes: stored.eventTypes,
      difficulties: stored.difficulties,
      includeUrl: stored.includeUrl,
      messageTemplates: stored.messageTemplates,
    });
  }

  async updateSettings(input: TwitchBotSettingsInput): Promise<TwitchBotSettingsSnapshot> {
    const existing = await this.getSettings();
    const next = this.normalizeSettings({
      ...existing,
      ...input,
    });

    await TwitchBotSettings.updateOne(
      { key: SETTINGS_KEY },
      {
        $set: {
          key: SETTINGS_KEY,
          eventPublishingEnabled: next.eventPublishingEnabled,
          eventTypes: next.eventTypes,
          difficulties: next.difficulties,
          includeUrl: next.includeUrl,
          messageTemplates: next.messageTemplates,
        },
      },
      { upsert: true },
    );

    return next;
  }

  private async ensureConnectedAndReconcile(): Promise<void> {
    if (!this.running || !this.isEnabled()) {
      return;
    }

    const botAuthStatus = await twitchBotAuthService.getStatus();
    if (!botAuthStatus.connected) {
      if (this.connected || this.chatClient) {
        await this.disconnectClient();
      } else {
        await this.writeRuntimeState({ enabled: true, running: this.running, connected: false });
      }
      return;
    }

    if (this.connected && this.botUserId && botAuthStatus.twitchUserId && botAuthStatus.twitchUserId !== this.botUserId) {
      logger.info("[TwitchBot] Connected bot account changed; reconnecting Twitch IRC");
      await this.disconnectClient();
    }

    if (!this.connected && !this.connecting) {
      await this.connectClient();
    }

    await this.reconcileJoinedChannels();
  }

  private async connectClient(): Promise<void> {
    if (this.connecting || this.connected) {
      return;
    }

    this.connecting = true;
    try {
      if (!process.env.TWITCH_CLIENT_ID || !process.env.TWITCH_CLIENT_SECRET) {
        throw new Error("Twitch OAuth credentials are not configured");
      }

      if (!(await twitchBotAuthService.hasConnectedBot())) {
        await this.writeRuntimeState({ enabled: true, running: this.running, connected: false });
        return;
      }

      const tokenData = await twitchBotAuthService.getTwurpleTokenData();
      const botAuthStatus = await twitchBotAuthService.getStatus();
      if (!botAuthStatus.twitchUserId || !botAuthStatus.twitchLogin) {
        throw new Error("Twitch bot identity is unavailable; verify the connected bot account");
      }
      this.botUserId = botAuthStatus.twitchUserId;
      this.botLogin = botAuthStatus.twitchLogin.toLowerCase();
      await this.loadChannelBans(this.botUserId);

      const authProvider = new RefreshingAuthProvider({
        clientId: process.env.TWITCH_CLIENT_ID,
        clientSecret: process.env.TWITCH_CLIENT_SECRET,
      });
      authProvider.onRefresh(async (userId, refreshedTokenData) => {
        await twitchBotAuthService.persistRefreshedToken(userId, this.normalizeTwurpleTokenData(refreshedTokenData));
      });
      await authProvider.addUserForToken(tokenData, ["chat"]);

      const chatClient = new ChatClient({ authProvider, channels: [] });
      chatClient.onMessage(async (channel, user, text) => {
        await this.handleMessage(channel, user, text);
      });
      chatClient.onBan((channel, user) => {
        if (user.toLowerCase() === this.botLogin) {
          void this.handleBotBan(channel).catch((error) => logger.error(`[TwitchBot] Failed to record ban in #${channel}:`, error));
        }
      });

      await chatClient.connect();
      this.chatClient = chatClient;
      this.connected = true;
      await this.writeRuntimeState({
        enabled: true,
        running: this.running,
        connected: true,
        lastConnectedAt: new Date(),
        lastError: undefined,
        lastErrorAt: undefined,
      });
      logger.info("[TwitchBot] Connected to Twitch IRC");
    } catch (error) {
      this.connected = false;
      this.chatClient = null;
      this.botUserId = null;
      this.botLogin = null;
      await this.recordError("Failed to connect to Twitch IRC", error);
    } finally {
      this.connecting = false;
    }
  }

  private async disconnectClient(): Promise<void> {
    const client = this.chatClient;
    this.chatClient = null;
    this.connected = false;
    this.botUserId = null;
    this.botLogin = null;

    if (client) {
      try {
        await client.quit();
      } catch (error) {
        logger.warn("[TwitchBot] Error while disconnecting from Twitch IRC:", error);
      }
    }

    this.joinedChannels.clear();
    await this.writeRuntimeState({
      enabled: this.isEnabled(),
      running: this.running,
      connected: false,
      joinedChannels: [],
      lastDisconnectedAt: new Date(),
    });
  }

  private async reconcileJoinedChannels(): Promise<void> {
    if (this.reconciling || !this.connected || !this.chatClient) {
      return;
    }

    this.reconciling = true;
    try {
      const desiredChannels = await this.findDesiredChannels();
      const desiredSet = new Set(desiredChannels);
      const now = Date.now();

      this.desiredChannels = desiredSet;
      for (const channel of desiredSet) {
        this.missingSince.delete(channel);
        if (!this.joinedChannels.has(channel)) {
          try {
            await this.joinChannel(channel);
            await this.sleep(this.getJoinDelayMs());
          } catch (error) {
            if (!(error instanceof TwitchBotChannelBackoffError)) {
              await this.recordError(`Failed to join Twitch channel #${channel}`, error);
            }
          }
        }
      }

      for (const channel of Array.from(this.joinedChannels)) {
        if (desiredSet.has(channel)) {
          continue;
        }

        const missingSince = this.missingSince.get(channel) || now;
        this.missingSince.set(channel, missingSince);
        if (now - missingSince >= this.getPartGraceMs()) {
          await this.partChannel(channel);
          this.missingSince.delete(channel);
          await this.sleep(250);
        }
      }

      await this.writeRuntimeState({
        enabled: true,
        running: this.running,
        connected: this.connected,
        desiredChannels: Array.from(this.desiredChannels).sort(),
        joinedChannels: Array.from(this.joinedChannels).sort(),
        lastReconciledAt: new Date(),
      });
    } catch (error) {
      await this.recordError("Failed to reconcile Twitch channels", error);
    } finally {
      this.reconciling = false;
    }
  }

  private async findDesiredChannels(): Promise<string[]> {
    const maxChannels = this.getMaxChannels();
    const guilds = await Guild.find({
      streamers: { $elemMatch: { isLive: true, isPlayingWoW: true } },
    })
      .sort({ name: 1, realm: 1 })
      .select("streamers.channelName streamers.isLive streamers.isPlayingWoW")
      .lean();

    const homeChannel = this.normalizeChannelName(twitchChannelPointsService.getHomeChannel());
    const channels = new Set<string>();
    for (const guild of guilds) {
      for (const streamer of guild.streamers || []) {
        if (streamer.isLive && streamer.isPlayingWoW) {
          const channel = this.normalizeChannelName(streamer.channelName);
          if (channel) {
            channels.add(channel);
          }
        }
      }
    }

    const liveChannels = Array.from(channels)
      .filter((channel) => channel !== homeChannel)
      .sort();
    const desired = homeChannel ? [homeChannel, ...liveChannels] : liveChannels;
    if (desired.length > maxChannels) {
      logger.warn(`[TwitchBot] Desired channel count ${desired.length} exceeds cap ${maxChannels}; reserving the home channel and joining first ${maxChannels}`);
    }

    return desired.slice(0, maxChannels);
  }

  private async findDesiredChannelsForGuild(guildId: mongoose.Types.ObjectId): Promise<string[]> {
    const guild = await Guild.findById(guildId).select("streamers.channelName streamers.isLive streamers.isPlayingWoW").lean();
    if (!guild) {
      return [];
    }

    return (guild.streamers || [])
      .filter((streamer) => streamer.isLive && streamer.isPlayingWoW)
      .map((streamer) => this.normalizeChannelName(streamer.channelName))
      .filter((channel): channel is string => Boolean(channel));
  }

  private async joinChannel(channel: string): Promise<void> {
    const chatClient = this.chatClient;
    if (!chatClient || this.joinedChannels.has(channel)) {
      return;
    }

    const activeAttempt = this.channelJoinAttempts.get(channel);
    if (activeAttempt) {
      return activeAttempt;
    }

    const attempt = this.attemptChannelJoin(channel, chatClient);
    this.channelJoinAttempts.set(channel, attempt);
    try {
      await attempt;
    } finally {
      if (this.channelJoinAttempts.get(channel) === attempt) {
        this.channelJoinAttempts.delete(channel);
      }
    }
  }

  private async attemptChannelJoin(channel: string, chatClient: ChatClient): Promise<void> {
    const existingBan = this.channelBans.get(channel);
    if (existingBan && existingBan.nextRetryAt.getTime() > Date.now()) {
      throw new TwitchBotChannelBackoffError(channel, existingBan.nextRetryAt);
    }

    try {
      await chatClient.join(channel);
    } catch (error) {
      if (this.getTwitchChatFailureReason(error) === "msg_banned") {
        const ban = await this.recordChannelBan(channel);
        logger.warn(`[TwitchBot] Bot is banned from #${channel}; retry scheduled for ${ban.nextRetryAt.toISOString()}`);
        throw new TwitchBotChannelBackoffError(channel, ban.nextRetryAt);
      }
      throw error;
    }

    if (existingBan) {
      await this.clearChannelBan(channel);
      logger.info(`[TwitchBot] Ban cleared after successfully rejoining #${channel}`);
    }
    this.joinedChannels.add(channel);
    logger.info(`[TwitchBot] Joined #${channel}`);
  }

  private async handleBotBan(channel: string): Promise<void> {
    const channelName = this.normalizeChannelName(channel);
    if (!channelName) {
      return;
    }

    this.joinedChannels.delete(channelName);
    const ban = await this.recordChannelBan(channelName);
    await this.writeRuntimeState({ joinedChannels: Array.from(this.joinedChannels).sort() });
    logger.warn(`[TwitchBot] Bot was banned from #${channelName}; retry scheduled for ${ban.nextRetryAt.toISOString()}`);
  }

  private async partChannel(channel: string): Promise<void> {
    if (!this.chatClient || !this.joinedChannels.has(channel)) {
      return;
    }

    await this.chatClient.part(channel);
    this.joinedChannels.delete(channel);
    logger.info(`[TwitchBot] Left #${channel}`);
  }

  private async handleMessage(channel: string, user: string, text: string): Promise<void> {
    const parsed = twitchChatCommandService.parse(text);
    if (!parsed) {
      return;
    }

    const channelName = this.normalizeChannelName(channel);
    if (!channelName) {
      return;
    }

    const botLogin = await twitchBotAuthService.getBotLogin();
    if (botLogin && user.toLowerCase() === botLogin.toLowerCase()) {
      return;
    }

    if (!(await this.isChannelAllowedToChat(channelName))) {
      return;
    }

    if (this.isOnCooldown(channelName, user, parsed.name)) {
      return;
    }

    try {
      const settings = await this.getSettings();
      const response = await twitchChatCommandService.handle(parsed, channelName, { includeUrl: settings.includeUrl });
      if (response) {
        await this.queueSay(channelName, response);
      }
    } catch (error) {
      try {
        await this.recordError(`Failed to handle Twitch chat command !${parsed.name} in #${channelName}`, error);
      } catch (recordingError) {
        logger.error("[TwitchBot] Failed to persist the Twitch chat command error:", recordingError);
      }

      try {
        await this.queueSay(channelName, "Command failed. Please try again.");
      } catch (replyError) {
        logger.error(`[TwitchBot] Failed to send the fallback command reply in #${channelName}:`, replyError);
      }
    }
  }

  private async isChannelAllowedToChat(channelName: string): Promise<boolean> {
    if (channelName === this.normalizeChannelName(twitchChannelPointsService.getHomeChannel())) {
      return true;
    }
    return Boolean(
      await Guild.exists({
        streamers: {
          $elemMatch: {
            channelName: new RegExp(`^${channelName}$`, "i"),
            isLive: true,
            isPlayingWoW: true,
          },
        },
      }),
    );
  }

  private isOnCooldown(channelName: string, user: string, commandName: string): boolean {
    const now = Date.now();
    this.pruneCooldowns(now);

    const userKey = `${channelName}:${user.toLowerCase()}`;
    const channelKey = `${channelName}:${commandName}`;
    const lastUserCommand = this.userCooldowns.get(userKey) || 0;
    const lastChannelCommand = this.channelCommandCooldowns.get(channelKey) || 0;

    if (now - lastUserCommand < 5000 || now - lastChannelCommand < 10000) {
      return true;
    }

    this.userCooldowns.set(userKey, now);
    this.channelCommandCooldowns.set(channelKey, now);
    return false;
  }

  private pruneCooldowns(now: number): void {
    if (this.userCooldowns.size < 5000 && this.channelCommandCooldowns.size < 1000) {
      return;
    }

    for (const [key, timestamp] of this.userCooldowns) {
      if (now - timestamp > 10 * 60 * 1000) {
        this.userCooldowns.delete(key);
      }
    }

    for (const [key, timestamp] of this.channelCommandCooldowns) {
      if (now - timestamp > 10 * 60 * 1000) {
        this.channelCommandCooldowns.delete(key);
      }
    }
  }

  private async publishPendingEvents(): Promise<void> {
    if (this.publishing || !this.running || !this.isEnabled()) {
      return;
    }

    this.publishing = true;
    try {
      await this.processChannelPointRewards();
      const settings = await this.getSettings();
      if (!settings.eventPublishingEnabled) {
        await this.expireStaleEventDeliveries();
        return;
      }

      await this.enqueueNewEventDeliveries(settings);
      await this.sendDueEventDeliveries(settings);
    } catch (error) {
      await this.recordError("Twitch event publisher error", error);
    } finally {
      this.publishing = false;
    }
  }

  private async processChannelPointRewards(): Promise<void> {
    await twitchCcgRewardService.retryLinkedPending();
    const now = new Date();
    await TwitchCcgRedemption.updateMany(
      { chatStatus: { $in: ["pending", "failed"] }, chatExpiresAt: { $lte: now } },
      { $set: { chatStatus: "expired", chatLastError: "Chat delivery expired" } },
    );

    const deliveries = await TwitchCcgRedemption.find({
      chatStatus: { $in: ["pending", "failed"] },
      chatNextAttemptAt: { $lte: now },
      chatExpiresAt: { $gt: now },
      chatAttempts: { $lt: MAX_CCG_CHAT_DELIVERY_ATTEMPTS },
    })
      .sort({ chatNextAttemptAt: 1 })
      .limit(20);

    const channel = this.normalizeChannelName(twitchChannelPointsService.getHomeChannel());
    if (!channel) throw new Error("TWITCH_BOT_HOME_CHANNEL is invalid");

    for (const delivery of deliveries) {
      try {
        if (!this.connected || !this.chatClient) throw new Error("Twitch chat is not connected");
        if (!this.joinedChannels.has(channel)) await this.joinChannel(channel);

        if (delivery.grantStatus !== "granted" && (await User.exists({ "twitch.id": delivery.twitchUserId }))) {
          delivery.chatNextAttemptAt = delivery.grantNextAttemptAt;
          await delivery.save();
          continue;
        }

        const message =
          delivery.grantStatus === "granted"
            ? `@${delivery.twitchUserLogin} packs were added successfully!`
            : `@${delivery.twitchUserLogin} connect your Twitch at ${this.getFrontendBaseUrl()}/profile to claim packs.`;
        await this.queueSay(channel, message);
        delivery.chatStatus = "sent";
        delivery.chatSentAt = new Date();
        delivery.chatLastError = undefined;
        await delivery.save();
      } catch (error) {
        if (error instanceof TwitchBotChannelBackoffError) {
          delivery.chatStatus = "failed";
          delivery.chatLastError = error.message;
          delivery.chatNextAttemptAt = error.nextRetryAt;
          await delivery.save();
          continue;
        }

        const attempts = delivery.chatAttempts + 1;
        delivery.chatStatus = "failed";
        delivery.chatAttempts = attempts;
        delivery.chatLastError = error instanceof Error ? error.message : String(error);
        delivery.chatNextAttemptAt = new Date(Date.now() + Math.min(60 * 60 * 1000, 2 ** attempts * 60 * 1000));
        await delivery.save();
      }
    }
  }

  private async enqueueNewEventDeliveries(settings: TwitchBotSettingsSnapshot): Promise<void> {
    let state = await TwitchBotRuntimeState.findOne({ key: RUNTIME_STATE_KEY });
    if (!state) {
      await this.writeRuntimeState({
        enabled: this.isEnabled(),
        running: this.running,
        connected: this.connected,
        desiredChannels: Array.from(this.desiredChannels).sort(),
        joinedChannels: Array.from(this.joinedChannels).sort(),
        lastEventCreatedAt: new Date(),
      });
      return;
    }

    if (!state.lastEventCreatedAt) {
      state.lastEventCreatedAt = new Date();
      await state.save();
      return;
    }

    const events = await Event.find({
      createdAt: { $gt: state.lastEventCreatedAt },
      type: { $in: settings.eventTypes },
      difficulty: { $in: settings.difficulties },
    })
      .sort({ createdAt: 1 })
      .limit(100);

    if (events.length === 0) {
      return;
    }

    const maxAgeMs = this.getEventMaxAgeMs();
    for (const event of events) {
      if (Date.now() - event.createdAt.getTime() > maxAgeMs) {
        state.lastEventCreatedAt = event.createdAt;
        await state.save();
        continue;
      }

      const targetChannels = await this.findDesiredChannelsForGuild(event.guildId);
      for (const channel of targetChannels) {
        await TwitchEventDelivery.updateOne(
          { eventId: event._id, channelName: channel },
          {
            $setOnInsert: {
              eventId: event._id,
              guildId: event.guildId,
              channelName: channel,
              status: "pending",
              attempts: 0,
              nextAttemptAt: new Date(),
              expiresAt: new Date(event.createdAt.getTime() + maxAgeMs),
            },
          },
          { upsert: true },
        );
      }

      state.lastEventCreatedAt = event.createdAt;
      await state.save();
    }
  }

  private async sendDueEventDeliveries(settings: TwitchBotSettingsSnapshot): Promise<void> {
    const now = new Date();
    await this.expireStaleEventDeliveries(now);

    const deliveries = await TwitchEventDelivery.find({
      status: { $in: ["pending", "failed"] },
      nextAttemptAt: { $lte: now },
      attempts: { $lt: MAX_DELIVERY_ATTEMPTS },
      expiresAt: { $gt: now },
    })
      .sort({ nextAttemptAt: 1 })
      .limit(20);

    for (const delivery of deliveries) {
      try {
        const channel = this.normalizeChannelName(delivery.channelName);
        if (!channel) {
          delivery.status = "expired";
          delivery.lastError = "Invalid Twitch channel name";
          await delivery.save();
          continue;
        }

        const targetChannels = await this.findDesiredChannelsForGuild(delivery.guildId);
        if (!targetChannels.includes(channel)) {
          delivery.status = "expired";
          delivery.lastError = "Twitch channel is no longer a live WoW target";
          await delivery.save();
          continue;
        }

        if (!this.connected || !this.chatClient) {
          throw new Error("Twitch chat is not connected");
        }

        if (!this.joinedChannels.has(channel)) {
          await this.joinChannel(channel);
        }

        const event = await Event.findById(delivery.eventId);
        if (!event) {
          delivery.status = "expired";
          delivery.lastError = "Event no longer exists";
          await delivery.save();
          continue;
        }

        await this.queueSay(channel, this.formatEventMessage(event, settings));
        delivery.status = "sent";
        delivery.sentAt = new Date();
        delivery.lastError = undefined;
        await delivery.save();
      } catch (error) {
        if (error instanceof TwitchBotChannelBackoffError) {
          delivery.status = "failed";
          delivery.lastError = error.message;
          delivery.nextAttemptAt = error.nextRetryAt;
          await delivery.save();
          continue;
        }

        const attempts = delivery.attempts + 1;
        delivery.status = "failed";
        delivery.attempts = attempts;
        delivery.lastError = error instanceof Error ? error.message : String(error);
        delivery.nextAttemptAt = new Date(Date.now() + Math.min(60 * 60 * 1000, 2 ** attempts * 60 * 1000));
        await delivery.save();
      }
    }
  }

  private async expireStaleEventDeliveries(now = new Date()): Promise<void> {
    await TwitchEventDelivery.updateMany(
      { status: { $in: ["pending", "failed"] }, expiresAt: { $lte: now } },
      { $set: { status: "expired", lastError: "Delivery expired before it could be sent" } },
    );
  }

  private async queueSay(channel: string, message: string): Promise<void> {
    const normalizedMessage = this.limitMessage(message);
    const task = this.outboundQueue
      .catch(() => undefined)
      .then(async () => {
        if (!this.chatClient || !this.connected) {
          throw new Error("Twitch chat is not connected");
        }

        const waitMs = Math.max(0, this.getOutboundDelayMs() - (Date.now() - this.lastOutboundAt));
        if (waitMs > 0) {
          await this.sleep(waitMs);
        }

        await this.chatClient.say(channel, normalizedMessage);
        this.lastOutboundAt = Date.now();
        await this.writeRuntimeState({ lastMessageAt: new Date() });
      });

    this.outboundQueue = task.catch(() => undefined);
    return task;
  }

  private formatEventMessage(event: IEvent, settings: TwitchBotSettingsSnapshot): string {
    const values = this.getEventMessageValues(event, settings);

    if (event.type === "boss_kill") {
      return this.limitMessage(this.renderMessageTemplate(settings.messageTemplates.bossKill, values));
    }

    if (event.type === "best_pull") {
      return this.limitMessage(this.renderMessageTemplate(settings.messageTemplates.bestPull, values));
    }

    return this.limitMessage(this.renderMessageTemplate(settings.messageTemplates.progressUpdate, values));
  }

  private getEventMessageValues(event: IEvent, settings: TwitchBotSettingsSnapshot): TwitchBotMessageTemplateValues {
    const difficulty = event.difficulty === "mythic" ? "Mythic" : "Heroic";
    const difficultyShort = event.difficulty === "mythic" ? "M" : "HC";
    const guildUrl = event.guildRealm ? `${this.getFrontendBaseUrl()}/guilds/${encodeURIComponent(event.guildRealm)}/${encodeURIComponent(event.guildName)}` : this.getFrontendBaseUrl();
    const pulls = typeof event.data.pullCount === "number" ? String(event.data.pullCount) : "";
    const progress = event.data.progressDisplay || (typeof event.data.bestPercent === "number" ? `${event.data.bestPercent.toFixed(1)}%` : "a new best pull");
    const url = settings.includeUrl ? guildUrl : "";

    return {
      guild_name: event.guildName,
      boss_name: event.bossName || "a boss",
      difficulty,
      difficulty_short: difficultyShort,
      pulls,
      pulls_phrase: pulls ? ` after ${pulls} pulls` : "",
      progress,
      url,
      url_suffix: url ? ` ${url}` : "",
      event_type: event.type,
    };
  }

  private renderMessageTemplate(template: string, values: TwitchBotMessageTemplateValues): string {
    return template.replace(/\{([a-z0-9_]+)\}/gi, (match, key: string) => values[key as TwitchBotMessagePlaceholder] ?? match);
  }

  private normalizeChannelName(channelName: string): string | null {
    const normalized = channelName.trim().replace(/^#/, "").toLowerCase();
    return /^[a-z0-9_]{3,25}$/.test(normalized) ? normalized : null;
  }

  private normalizeTwurpleTokenData(tokenData: TwitchBotRefreshedAccessToken): TwitchBotRefreshedAccessToken {
    return {
      accessToken: tokenData.accessToken,
      refreshToken: tokenData.refreshToken,
      expiresIn: typeof tokenData.expiresIn === "number" && Number.isFinite(tokenData.expiresIn) ? tokenData.expiresIn : 0,
      obtainmentTimestamp:
        typeof tokenData.obtainmentTimestamp === "number" && Number.isFinite(tokenData.obtainmentTimestamp) ? tokenData.obtainmentTimestamp : Date.now(),
    };
  }

  private serializeChannelBans(value: unknown): Array<ITwitchBotChannelBan & { channelName: string }> {
    const entries = value instanceof Map ? Array.from(value.entries()) : value && typeof value === "object" ? Object.entries(value) : [];

    return entries
      .flatMap(([storageKey, rawBan]) => {
        const channelName = this.getChannelNameFromBanStorageKey(storageKey);
        if (!channelName) {
          return [];
        }
        if (!rawBan || typeof rawBan !== "object") {
          return [];
        }

        const ban = rawBan as Partial<Record<keyof ITwitchBotChannelBan, unknown>>;
        const detectedAt = new Date(ban.detectedAt as Date | string);
        const lastAttemptAt = new Date(ban.lastAttemptAt as Date | string);
        const nextRetryAt = new Date(ban.nextRetryAt as Date | string);
        const failureCount = Number(ban.failureCount);
        if (
          ban.reason !== "msg_banned" ||
          !Number.isFinite(detectedAt.getTime()) ||
          !Number.isFinite(lastAttemptAt.getTime()) ||
          !Number.isFinite(nextRetryAt.getTime()) ||
          !Number.isInteger(failureCount) ||
          failureCount < 1
        ) {
          return [];
        }

        return [
          {
            channelName,
            reason: "msg_banned" as const,
            detectedAt,
            lastAttemptAt,
            nextRetryAt,
            failureCount,
          },
        ];
      })
      .sort((a, b) => a.channelName.localeCompare(b.channelName));
  }

  private async loadChannelBans(botUserId: string): Promise<void> {
    const runtime = await TwitchBotRuntimeState.findOne({ key: RUNTIME_STATE_KEY }).select("channelBansBotUserId channelBans");
    if (runtime?.channelBansBotUserId !== botUserId) {
      this.channelBans.clear();
      this.channelBansBotUserId = botUserId;
      await this.writeRuntimeState({ channelBansBotUserId: botUserId, channelBans: {} });
      return;
    }

    this.channelBans.clear();
    for (const [storageKey, ban] of runtime.channelBans?.entries() || []) {
      const channelName = this.getChannelNameFromBanStorageKey(storageKey);
      if (!channelName) {
        continue;
      }
      this.channelBans.set(channelName, {
        reason: "msg_banned",
        detectedAt: new Date(ban.detectedAt),
        lastAttemptAt: new Date(ban.lastAttemptAt),
        nextRetryAt: new Date(ban.nextRetryAt),
        failureCount: ban.failureCount,
      });
    }
    this.channelBansBotUserId = botUserId;
  }

  private async recordChannelBan(channel: string): Promise<ITwitchBotChannelBan> {
    if (!this.botUserId || this.channelBansBotUserId !== this.botUserId) {
      throw new Error("Twitch bot identity is unavailable while recording a channel ban");
    }

    const now = new Date();
    const existing = this.channelBans.get(channel);
    const failureCount = (existing?.failureCount || 0) + 1;
    const retryDelay = Math.min(BANNED_CHANNEL_RETRY_BASE_MS * 2 ** (failureCount - 1), BANNED_CHANNEL_RETRY_MAX_MS);
    const ban: ITwitchBotChannelBan = {
      reason: "msg_banned",
      detectedAt: existing?.detectedAt || now,
      lastAttemptAt: now,
      nextRetryAt: new Date(now.getTime() + retryDelay),
      failureCount,
    };

    await TwitchBotRuntimeState.updateOne(
      { key: RUNTIME_STATE_KEY },
      {
        $set: {
          channelBansBotUserId: this.botUserId,
          [`channelBans.${this.getChannelBanStorageKey(channel)}`]: ban,
        },
      },
    );
    this.channelBans.set(channel, ban);
    return ban;
  }

  private async clearChannelBan(channel: string): Promise<void> {
    await TwitchBotRuntimeState.updateOne({ key: RUNTIME_STATE_KEY }, { $unset: { [`channelBans.${this.getChannelBanStorageKey(channel)}`]: 1 } });
    this.channelBans.delete(channel);
  }

  private getChannelBanStorageKey(channel: string): string {
    return `channel_${channel}`;
  }

  private getChannelNameFromBanStorageKey(storageKey: string): string | null {
    return storageKey.startsWith("channel_") ? this.normalizeChannelName(storageKey.slice("channel_".length)) : null;
  }

  private getTwitchChatFailureReason(error: unknown): string {
    return typeof error === "string" ? error : error instanceof Error ? error.message : String(error);
  }

  private async writeRuntimeState(update: Partial<{
    enabled: boolean;
    running: boolean;
    connected: boolean;
    desiredChannels: string[];
    joinedChannels: string[];
    channelBansBotUserId: string;
    channelBans: Record<string, ITwitchBotChannelBan>;
    lastEventCreatedAt: Date;
    lastStartedAt: Date;
    lastStoppedAt: Date;
    lastConnectedAt: Date;
    lastDisconnectedAt: Date;
    lastReconciledAt: Date;
    lastMessageAt: Date;
    lastErrorAt?: Date;
    lastError?: string;
  }>): Promise<void> {
    const set: Record<string, unknown> = { key: RUNTIME_STATE_KEY };
    const unset: Record<string, 1> = {};

    for (const [key, value] of Object.entries(update)) {
      if (value === undefined) {
        unset[key] = 1;
      } else {
        set[key] = value;
      }
    }

    const mongoUpdate = {
      $set: set,
      ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}),
    };

    try {
      await TwitchBotRuntimeState.updateOne({ key: RUNTIME_STATE_KEY }, mongoUpdate, { upsert: true });
    } catch (error) {
      if (!this.isDuplicateKeyError(error)) {
        throw error;
      }

      await TwitchBotRuntimeState.updateOne({ key: RUNTIME_STATE_KEY }, mongoUpdate);
    }
  }

  private isDuplicateKeyError(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && (error as { code?: number }).code === 11000;
  }

  private async recordError(message: string, error: unknown): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`[TwitchBot] ${message}:`, error);
    await this.writeRuntimeState({
      enabled: this.isEnabled(),
      running: this.running,
      connected: this.connected,
      lastErrorAt: new Date(),
      lastError: errorMessage,
    });
  }

  private getDefaultSettings(): TwitchBotSettingsSnapshot {
    return {
      eventPublishingEnabled: process.env.TWITCH_BOT_EVENT_PUBLISHING_ENABLED !== "false",
      eventTypes: this.getDefaultEventTypes(),
      difficulties: this.getDefaultDifficulties(),
      includeUrl: process.env.TWITCH_BOT_INCLUDE_URL !== "false",
      messageTemplates: DEFAULT_MESSAGE_TEMPLATES,
    };
  }

  private normalizeSettings(input: TwitchBotSettingsInput): TwitchBotSettingsSnapshot {
    const defaults = this.getDefaultSettings();
    const rawEventTypes = Array.isArray(input.eventTypes) ? input.eventTypes : [];
    const rawDifficulties = Array.isArray(input.difficulties) ? input.difficulties : [];
    const eventTypes = rawEventTypes
      .map((value) => String(value).trim())
      .filter((value): value is EventType => VALID_EVENT_TYPES.includes(value as EventType));
    const difficulties = rawDifficulties
      .map((value) => String(value).trim())
      .filter((value): value is TwitchBotDifficulty => VALID_DIFFICULTIES.includes(value as TwitchBotDifficulty));

    return {
      eventPublishingEnabled: typeof input.eventPublishingEnabled === "boolean" ? input.eventPublishingEnabled : defaults.eventPublishingEnabled,
      eventTypes: eventTypes.length > 0 ? Array.from(new Set(eventTypes)) : defaults.eventTypes,
      difficulties: difficulties.length > 0 ? Array.from(new Set(difficulties)) : defaults.difficulties,
      includeUrl: typeof input.includeUrl === "boolean" ? input.includeUrl : defaults.includeUrl,
      messageTemplates: this.normalizeMessageTemplates(input.messageTemplates, defaults.messageTemplates),
    };
  }

  private normalizeMessageTemplates(input: unknown, defaults: TwitchBotMessageTemplates): TwitchBotMessageTemplates {
    const source = input && typeof input === "object" && !Array.isArray(input) ? (input as Partial<Record<TwitchBotMessageTemplateKey, unknown>>) : {};
    const templates: TwitchBotMessageTemplates = { ...defaults };

    for (const key of MESSAGE_TEMPLATE_KEYS) {
      const rawTemplate = source[key];
      if (rawTemplate === undefined || rawTemplate === null || String(rawTemplate).trim() === "") {
        templates[key] = defaults[key];
        continue;
      }

      const template = String(rawTemplate).replace(/\s+/g, " ").trim();
      this.validateMessageTemplate(key, template);
      templates[key] = template;
    }

    return templates;
  }

  private validateMessageTemplate(key: TwitchBotMessageTemplateKey, template: string): void {
    if (template.length > MESSAGE_TEMPLATE_MAX_LENGTH) {
      throw new TwitchBotSettingsValidationError(`${this.formatTemplateKey(key)} template must be ${MESSAGE_TEMPLATE_MAX_LENGTH} characters or fewer`);
    }

    const allowedPlaceholders = new Set<string>(MESSAGE_TEMPLATE_PLACEHOLDERS);
    const unknownPlaceholders = Array.from(template.matchAll(/\{([^{}]+)\}/g))
      .map((match) => match[1])
      .filter((placeholder) => !allowedPlaceholders.has(placeholder));

    if (unknownPlaceholders.length > 0) {
      throw new TwitchBotSettingsValidationError(
        `${this.formatTemplateKey(key)} template has unknown placeholder(s): ${Array.from(new Set(unknownPlaceholders))
          .map((placeholder) => `{${placeholder}}`)
          .join(", ")}`,
      );
    }

    const withoutPlaceholders = template.replace(/\{[^{}]+\}/g, "");
    if (/[{}]/.test(withoutPlaceholders)) {
      throw new TwitchBotSettingsValidationError(`${this.formatTemplateKey(key)} template has malformed placeholder braces`);
    }
  }

  private formatTemplateKey(key: TwitchBotMessageTemplateKey): string {
    if (key === "bossKill") return "Boss kill";
    if (key === "bestPull") return "Best pull";
    return "Progress update";
  }

  private getDefaultEventTypes(): EventType[] {
    const configured = (process.env.TWITCH_BOT_EVENT_TYPES || "boss_kill,best_pull")
      .split(/[,\s]+/)
      .map((value) => value.trim())
      .filter((value): value is EventType => VALID_EVENT_TYPES.includes(value as EventType));
    return configured.length > 0 ? configured : ["boss_kill", "best_pull"];
  }

  private getDefaultDifficulties(): TwitchEventDifficulty[] {
    const configured = (process.env.TWITCH_BOT_DIFFICULTIES || "mythic")
      .split(/[,\s]+/)
      .map((value) => value.trim())
      .filter((value): value is TwitchEventDifficulty => VALID_DIFFICULTIES.includes(value as TwitchEventDifficulty));
    return configured.length > 0 ? configured : ["mythic"];
  }

  private getEventMaxAgeMs(): number {
    return Math.max(parseInt(process.env.TWITCH_BOT_EVENT_MAX_AGE_MINUTES || "30", 10), 5) * 60 * 1000;
  }

  private getPartGraceMs(): number {
    return Math.max(parseInt(process.env.TWITCH_BOT_PART_GRACE_SECONDS || "300", 10), 30) * 1000;
  }

  private getMaxChannels(): number {
    return Math.max(parseInt(process.env.TWITCH_BOT_MAX_CHANNELS || "100", 10), 1);
  }

  private getJoinDelayMs(): number {
    return Math.max(parseInt(process.env.TWITCH_BOT_JOIN_DELAY_MS || "1100", 10), 250);
  }

  private getOutboundDelayMs(): number {
    return Math.max(parseInt(process.env.TWITCH_BOT_OUTBOUND_DELAY_MS || "1500", 10), 500);
  }

  private isEnabled(): boolean {
    return process.env.TWITCH_BOT_ENABLED !== "false";
  }

  private limitMessage(message: string): string {
    const normalized = message.replace(/\s+/g, " ").trim();
    return normalized.length <= 450 ? normalized : `${normalized.slice(0, 447)}...`;
  }

  private getFrontendBaseUrl(): string {
    if (process.env.PUBLIC_BASE_URL) {
      return process.env.PUBLIC_BASE_URL.replace(/\/$/, "");
    }

    return process.env.NODE_ENV === "production" ? "https://suomiwow.vaarattu.tv" : "http://localhost:3000";
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export default new TwitchChatBotService();
