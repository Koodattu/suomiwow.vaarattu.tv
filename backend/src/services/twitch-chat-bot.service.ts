import { RefreshingAuthProvider } from "@twurple/auth";
import { ChatClient, type ChatMessage } from "@twurple/chat";
import mongoose from "mongoose";
import Event, { EventType, IEvent } from "../models/Event";
import Guild from "../models/Guild";
import TwitchBotSettings, { type TwitchBotDifficulty, type TwitchBotMessageTemplateKey, type TwitchBotMessageTemplates } from "../models/TwitchBotSettings";
import TwitchBotRuntimeState, {
  type ITwitchBotChannelBan,
  type ITwitchBotSharedChatSession,
  type TwitchBotCommandOutcome,
} from "../models/TwitchBotRuntimeState";
import TwitchChannelBotSettings from "../models/TwitchChannelBotSettings";
import TwitchChatAuditEvent, {
  type TwitchChatAuditDirection,
  type TwitchChatAuditKind,
} from "../models/TwitchChatAuditEvent";
import TwitchEventDelivery from "../models/TwitchEventDelivery";
import TwitchCcgRedemption from "../models/TwitchCcgRedemption";
import User from "../models/User";
import logger from "../utils/logger";
import twitchBotAuthService, { TwitchBotAuthStatus, TwitchBotRefreshedAccessToken } from "./twitch-bot-auth.service";
import twitchChatCommandService from "./twitch-chat-command.service";
import twitchCcgRewardService, { twitchCcgRewardKindMatch } from "./twitch-ccg-reward.service";
import twitchChannelPointsService from "./twitch-channel-points.service";

type TwitchEventDifficulty = "mythic" | "heroic";

export interface TwitchBotSettingsSnapshot {
  eventPublishingEnabled: boolean;
  eventTypes: EventType[];
  difficulties: TwitchEventDifficulty[];
  includeUrl: boolean;
  messageTemplates: TwitchBotMessageTemplates;
}

export interface TwitchChannelBotSettingsSnapshot {
  channelName: string;
  alertsEnabled: boolean;
  commandsEnabled: boolean;
  joinAnnouncementEnabled: boolean;
  lastJoinAnnouncementAt?: Date;
  updatedBy?: string;
  updatedAt?: Date;
}

export interface TwitchChatAuditQuery {
  channelName?: string;
  direction?: TwitchChatAuditDirection;
  kind?: TwitchChatAuditKind;
  page?: number;
  limit?: number;
}

interface TwitchOutboundAuditContext {
  kind: Exclude<TwitchChatAuditKind, "command" | "mention">;
  commandName?: string;
  userName?: string;
  relatedEventId?: mongoose.Types.ObjectId;
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
    sharedChatSessions: ITwitchBotSharedChatSession[];
    desiredCount: number;
    joinedCount: number;
    lastStartedAt?: Date;
    lastStoppedAt?: Date;
    lastConnectedAt?: Date;
    lastDisconnectedAt?: Date;
    lastReconciledAt?: Date;
    lastSharedChatCheckAt?: Date;
    lastMessageAt?: Date;
    lastInboundMessageAt?: Date;
    lastInboundChannel?: string;
    lastCommandAt?: Date;
    lastCommandChannel?: string;
    lastCommandName?: string;
    lastCommandOutcome?: TwitchBotCommandOutcome;
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
const CCG_LINK_PROMPT_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const BANNED_CHANNEL_RETRY_BASE_MS = 60 * 60 * 1000;
const BANNED_CHANNEL_RETRY_MAX_MS = 12 * 60 * 60 * 1000;
const INBOUND_DIAGNOSTIC_INTERVAL_MS = 30 * 1000;
const JOIN_ANNOUNCEMENT_COOLDOWN_MS = 12 * 60 * 60 * 1000;
const JOIN_ANNOUNCEMENT_MESSAGE = "SuomiWoW Bot is here! Type !commands or !komennot for features.";
const SHARED_CHAT_CACHE_MS = 60 * 1000;
const SHARED_CHAT_MESSAGE_DEDUPE_MS = 60 * 1000;

interface TwitchChannelTarget {
  channelName: string;
  broadcasterId?: string;
}

interface TwitchSharedChatApiSession {
  sessionId: string;
  hostBroadcasterId: string;
  participantBroadcasterIds: string[];
}

type TwitchBotMessagePlaceholder = (typeof MESSAGE_TEMPLATE_PLACEHOLDERS)[number];
type TwitchBotMessageTemplateValues = Record<TwitchBotMessagePlaceholder, string>;
type TwitchBotSettingsInput = Partial<Omit<TwitchBotSettingsSnapshot, "messageTemplates">> & { messageTemplates?: unknown };

export class TwitchBotSettingsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TwitchBotSettingsValidationError";
  }
}

export class TwitchBotChannelSettingsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TwitchBotChannelSettingsValidationError";
  }
}

class TwitchBotChannelBackoffError extends Error {
  constructor(
    readonly channel: string,
    readonly nextRetryAt: Date,
  ) {
    super(`Twitch bot is restricted from #${channel}; next join retry is ${nextRetryAt.toISOString()}`);
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
  private sharedChatSessionCache = new Map<string, { session: TwitchSharedChatApiSession | null; expiresAt: number }>();
  private sharedChatChannelByBroadcasterId = new Map<string, string>();
  private sharedChatRepresentativeBySessionId = new Map<string, string>();
  private sharedChatSessions: ITwitchBotSharedChatSession[] = [];
  private sharedChatMessageKeys = new Map<string, number>();
  private outboundQueue: Promise<void> = Promise.resolve();
  private diagnosticQueue: Promise<void> = Promise.resolve();
  private lastOutboundAt = 0;
  private lastInboundDiagnosticAt = 0;

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
    this.sharedChatSessions = [];
    this.sharedChatChannelByBroadcasterId.clear();
    this.sharedChatRepresentativeBySessionId.clear();
    this.sharedChatMessageKeys.clear();
    this.missingSince.clear();
    await this.writeRuntimeState({
      enabled: this.isEnabled(),
      running: false,
      connected: false,
      desiredChannels: [],
      joinedChannels: [],
      sharedChatSessions: [],
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
    const desiredChannels = this.running ? Array.from(this.desiredChannels).sort() : runtime?.desiredChannels || [];
    const chatConnected = this.chatClient ? this.chatClient.isConnected : false;
    const joinedChannels = chatConnected ? this.getClientJoinedChannels() : [];
    const bannedChannels =
      authStatus.twitchUserId && runtime?.channelBansBotUserId === authStatus.twitchUserId ? this.serializeChannelBans(runtime.channelBans) : [];
    const sharedChatSessions = this.running ? this.sharedChatSessions : runtime?.sharedChatSessions || [];

    return {
      ...authStatus,
      botEnabled: this.isEnabled(),
      settings,
      chat: {
        running: this.running,
        connected: chatConnected,
        desiredChannels,
        joinedChannels,
        bannedChannels,
        sharedChatSessions,
        desiredCount: desiredChannels.length,
        joinedCount: joinedChannels.length,
        lastStartedAt: runtime?.lastStartedAt,
        lastStoppedAt: runtime?.lastStoppedAt,
        lastConnectedAt: runtime?.lastConnectedAt,
        lastDisconnectedAt: runtime?.lastDisconnectedAt,
        lastReconciledAt: runtime?.lastReconciledAt,
        lastSharedChatCheckAt: runtime?.lastSharedChatCheckAt,
        lastMessageAt: runtime?.lastMessageAt,
        lastInboundMessageAt: runtime?.lastInboundMessageAt,
        lastInboundChannel: runtime?.lastInboundChannel,
        lastCommandAt: runtime?.lastCommandAt,
        lastCommandChannel: runtime?.lastCommandChannel,
        lastCommandName: runtime?.lastCommandName,
        lastCommandOutcome: runtime?.lastCommandOutcome,
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

  async getChannelSettings(channelName: string): Promise<TwitchChannelBotSettingsSnapshot> {
    const channel = this.requireChannelName(channelName);
    const stored = await TwitchChannelBotSettings.findOne({ channelName: channel }).lean();
    return this.toChannelSettingsSnapshot(channel, stored || undefined);
  }

  async listChannelSettings(): Promise<TwitchChannelBotSettingsSnapshot[]> {
    const [storedSettings, trackedChannelNames] = await Promise.all([
      TwitchChannelBotSettings.find().sort({ channelName: 1 }).lean(),
      Guild.distinct("streamers.channelName"),
    ]);
    const channels = new Set<string>();
    for (const channelName of trackedChannelNames) {
      if (typeof channelName !== "string") continue;
      const channel = this.normalizeChannelName(channelName);
      if (channel) channels.add(channel);
    }
    for (const setting of storedSettings) channels.add(setting.channelName);

    const homeChannel = this.normalizeChannelName(twitchChannelPointsService.getHomeChannel());
    if (homeChannel) channels.add(homeChannel);

    const storedByChannel = new Map(storedSettings.map((setting) => [setting.channelName, setting]));
    return Array.from(channels)
      .sort()
      .map((channel) => this.toChannelSettingsSnapshot(channel, storedByChannel.get(channel)));
  }

  async updateChannelSettings(
    channelName: string,
    input: Partial<Pick<TwitchChannelBotSettingsSnapshot, "alertsEnabled" | "commandsEnabled" | "joinAnnouncementEnabled">>,
    updatedBy: string,
  ): Promise<TwitchChannelBotSettingsSnapshot> {
    const channel = this.requireChannelName(channelName);
    const keys = ["alertsEnabled", "commandsEnabled", "joinAnnouncementEnabled"] as const;
    for (const key of keys) {
      if (input[key] !== undefined && typeof input[key] !== "boolean") {
        throw new TwitchBotChannelSettingsValidationError(`${key} must be a boolean`);
      }
    }

    const existing = await this.getChannelSettings(channel);
    const next = {
      alertsEnabled: input.alertsEnabled ?? existing.alertsEnabled,
      commandsEnabled: input.commandsEnabled ?? existing.commandsEnabled,
      joinAnnouncementEnabled: input.joinAnnouncementEnabled ?? existing.joinAnnouncementEnabled,
    };
    await TwitchChannelBotSettings.updateOne(
      { channelName: channel },
      {
        $set: {
          channelName: channel,
          ...next,
          updatedBy: updatedBy.slice(0, 100),
        },
      },
      { upsert: true },
    );

    const stored = await TwitchChannelBotSettings.findOne({ channelName: channel }).lean();
    return this.toChannelSettingsSnapshot(channel, stored || { channelName: channel, ...next, updatedBy });
  }

  async getChatAuditEvents(query: TwitchChatAuditQuery): Promise<{
    events: Array<Record<string, unknown>>;
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }> {
    const page = Math.max(1, Math.floor(query.page || 1));
    const limit = Math.min(100, Math.max(1, Math.floor(query.limit || 50)));
    const filter: Record<string, unknown> = {};
    if (query.channelName) filter.channelName = this.requireChannelName(query.channelName);
    if (query.direction && ["inbound", "outbound"].includes(query.direction)) filter.direction = query.direction;
    if (
      query.kind &&
      ["command", "mention", "command_reply", "progress_alert", "join_announcement", "reward", "system_reply"].includes(query.kind)
    ) {
      filter.kind = query.kind;
    }

    const [events, total] = await Promise.all([
      TwitchChatAuditEvent.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      TwitchChatAuditEvent.countDocuments(filter),
    ]);

    return {
      events: events.map((event) => ({ ...event, id: event._id.toString(), _id: undefined })),
      pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    };
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

    if (this.chatClient) {
      const clientConnected = this.chatClient.isConnected;
      if (this.connected !== clientConnected) {
        this.connected = clientConnected;
        if (!clientConnected) {
          this.joinedChannels.clear();
        }
        await this.writeRuntimeState({
          connected: clientConnected,
          joinedChannels: clientConnected ? this.getClientJoinedChannels() : [],
          ...(clientConnected ? { lastConnectedAt: new Date() } : { lastDisconnectedAt: new Date() }),
        });
      }

      if (!clientConnected) {
        return;
      }
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

      const chatClient = new ChatClient({ authProvider, channels: [], rejoinChannelsOnReconnect: true });
      chatClient.onMessage(async (channel, user, text, message) => {
        try {
          await this.handleMessage(channel, user, text, message);
        } catch (error) {
          await this.recordError("Unhandled Twitch chat message error", error).catch((recordingError) => {
            logger.error("[TwitchBot] Failed to persist an unhandled Twitch chat message error:", recordingError);
          });
        }
      });
      chatClient.onBan((channel, user) => {
        if (user.toLowerCase() === this.botLogin) {
          void this.handleBotBan(channel).catch((error) => logger.error(`[TwitchBot] Failed to record ban in #${channel}:`, error));
        }
      });
      chatClient.onTimeout((channel, user, duration) => {
        if (user.toLowerCase() === this.botLogin) {
          void this.handleBotTimeout(channel, duration).catch((error) => logger.error(`[TwitchBot] Failed to record timeout in #${channel}:`, error));
        }
      });
      chatClient.onMessageFailed((channel, reason) => {
        this.recordChatClientError(`Twitch rejected an outbound chat message in #${this.normalizeChannelName(channel) || channel}`, reason);
      });
      chatClient.onMessageRatelimit((channel) => {
        this.recordChatClientError(`Twitch rate-limited an outbound chat message in #${this.normalizeChannelName(channel) || channel}`, "msg_ratelimit");
      });
      chatClient.onNoPermission((channel) => {
        this.recordChatClientError(`Twitch denied permission for an outbound chat action in #${this.normalizeChannelName(channel) || channel}`, "no_permission");
      });
      chatClient.onAuthenticationFailure((reason, retryCount) => {
        this.recordChatClientError(`Twitch IRC authentication failed on attempt ${retryCount}`, reason);
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
    if (this.reconciling || !this.connected || !this.chatClient?.isConnected) {
      return;
    }

    this.reconciling = true;
    try {
      this.joinedChannels = new Set(this.getClientJoinedChannels());
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
        sharedChatSessions: this.sharedChatSessions,
        lastReconciledAt: new Date(),
        lastSharedChatCheckAt: new Date(),
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
      .select("streamers.channelName streamers.twitchUserId streamers.isLive streamers.isPlayingWoW")
      .lean();

    const homeChannel = this.normalizeChannelName(twitchChannelPointsService.getHomeChannel());
    const targetsByChannel = new Map<string, TwitchChannelTarget>();
    for (const guild of guilds) {
      for (const streamer of guild.streamers || []) {
        if (streamer.isLive && streamer.isPlayingWoW) {
          const channel = this.normalizeChannelName(streamer.channelName);
          if (channel) {
            const existing = targetsByChannel.get(channel);
            targetsByChannel.set(channel, {
              channelName: channel,
              broadcasterId: streamer.twitchUserId || existing?.broadcasterId,
            });
          }
        }
      }
    }

    if (homeChannel && !targetsByChannel.has(homeChannel)) targetsByChannel.set(homeChannel, { channelName: homeChannel });
    const desired = await this.deduplicateSharedChatTargets(Array.from(targetsByChannel.values()), true);
    if (desired.length > maxChannels) {
      logger.warn(`[TwitchBot] Desired channel count ${desired.length} exceeds cap ${maxChannels}; reserving the home channel and joining first ${maxChannels}`);
    }

    const ordered = homeChannel && desired.includes(homeChannel) ? [homeChannel, ...desired.filter((channel) => channel !== homeChannel)] : desired;
    return ordered.slice(0, maxChannels);
  }

  private async findDesiredChannelsForGuild(guildId: mongoose.Types.ObjectId): Promise<string[]> {
    const guild = await Guild.findById(guildId).select("streamers.channelName streamers.twitchUserId streamers.isLive streamers.isPlayingWoW").lean();
    if (!guild) {
      return [];
    }

    const targets = (guild.streamers || [])
      .filter((streamer) => streamer.isLive && streamer.isPlayingWoW)
      .flatMap((streamer) => {
        const channelName = this.normalizeChannelName(streamer.channelName);
        return channelName ? [{ channelName, broadcasterId: streamer.twitchUserId }] : [];
      });
    return this.deduplicateSharedChatTargets(targets, false);
  }

  private async deduplicateSharedChatTargets(targets: TwitchChannelTarget[], recordSessions: boolean): Promise<string[]> {
    const uniqueTargets = Array.from(new Map(targets.map((target) => [target.channelName, target])).values());
    if (recordSessions) {
      this.sharedChatChannelByBroadcasterId = new Map(
        uniqueTargets.flatMap((target) => (target.broadcasterId ? [[target.broadcasterId, target.channelName] as const] : [])),
      );
    }

    const targetsWithIds = uniqueTargets.filter((target): target is TwitchChannelTarget & { broadcasterId: string } => Boolean(target.broadcasterId));
    let accessTokenPromise: Promise<string> | undefined;
    const getAccessToken = () => (accessTokenPromise ||= twitchBotAuthService.getAccessToken());
    const directSessions = await Promise.all(
      targetsWithIds.map(async (target) => [target.broadcasterId, await this.getSharedChatSession(target.broadcasterId, getAccessToken)] as const),
    );
    const sessionByBroadcasterId = new Map<string, TwitchSharedChatApiSession>();
    for (const [queriedBroadcasterId, session] of directSessions) {
      if (!session) continue;
      sessionByBroadcasterId.set(queriedBroadcasterId, session);
      for (const participantId of session.participantBroadcasterIds) sessionByBroadcasterId.set(participantId, session);
    }

    const standaloneChannels = new Set(uniqueTargets.filter((target) => !target.broadcasterId).map((target) => target.channelName));
    const targetsBySession = new Map<string, { session: TwitchSharedChatApiSession; targets: TwitchChannelTarget[] }>();
    for (const target of targetsWithIds) {
      const session = sessionByBroadcasterId.get(target.broadcasterId);
      if (!session) {
        standaloneChannels.add(target.channelName);
        continue;
      }
      const group = targetsBySession.get(session.sessionId) || { session, targets: [] };
      group.targets.push(target);
      targetsBySession.set(session.sessionId, group);
    }

    const snapshots: ITwitchBotSharedChatSession[] = [];
    for (const { session, targets: sessionTargets } of targetsBySession.values()) {
      const trackedParticipantChannels = Array.from(
        new Set([
          ...session.participantBroadcasterIds
            .map((participantId) => this.sharedChatChannelByBroadcasterId.get(participantId))
            .filter((channel): channel is string => Boolean(channel)),
          ...sessionTargets.map((target) => target.channelName),
        ]),
      ).sort();
      const homeChannel = this.normalizeChannelName(twitchChannelPointsService.getHomeChannel());
      const existingRepresentative = this.sharedChatRepresentativeBySessionId.get(session.sessionId);
      const representative =
        (existingRepresentative && trackedParticipantChannels.includes(existingRepresentative) ? existingRepresentative : undefined) ||
        (homeChannel && trackedParticipantChannels.includes(homeChannel) ? homeChannel : undefined) ||
        this.sharedChatChannelByBroadcasterId.get(session.hostBroadcasterId) ||
        sessionTargets.map((target) => target.channelName).sort()[0];

      standaloneChannels.add(representative);
      if (recordSessions) {
        this.sharedChatRepresentativeBySessionId.set(session.sessionId, representative);
        snapshots.push({
          sessionId: session.sessionId,
          hostBroadcasterId: session.hostBroadcasterId,
          participantBroadcasterIds: session.participantBroadcasterIds,
          trackedChannels: trackedParticipantChannels,
          representativeChannel: representative,
          detectedAt: new Date(),
        });
      }
    }

    if (recordSessions) {
      this.sharedChatSessions = snapshots.sort((a, b) => a.representativeChannel.localeCompare(b.representativeChannel));
      const activeSessionIds = new Set(snapshots.map((session) => session.sessionId));
      for (const sessionId of this.sharedChatRepresentativeBySessionId.keys()) {
        if (!activeSessionIds.has(sessionId)) this.sharedChatRepresentativeBySessionId.delete(sessionId);
      }
    }

    return Array.from(standaloneChannels).sort();
  }

  private async getSharedChatSession(
    broadcasterId: string,
    getAccessToken: () => Promise<string>,
  ): Promise<TwitchSharedChatApiSession | null> {
    const cached = this.sharedChatSessionCache.get(broadcasterId);
    if (cached && cached.expiresAt > Date.now()) return cached.session;

    try {
      const accessToken = await getAccessToken();
      const params = new URLSearchParams({ broadcaster_id: broadcasterId });
      const response = await fetch(`https://api.twitch.tv/helix/shared_chat/session?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Client-ID": process.env.TWITCH_CLIENT_ID || "",
        },
      });
      if (!response.ok) throw new Error(`Twitch Shared Chat lookup returned HTTP ${response.status}`);

      const payload = (await response.json()) as {
        data?: Array<{
          session_id: string;
          host_broadcaster_id: string;
          participants?: Array<{ broadcaster_id: string }>;
        }>;
      };
      const rawSession = payload.data?.[0];
      const session = rawSession
        ? {
            sessionId: rawSession.session_id,
            hostBroadcasterId: rawSession.host_broadcaster_id,
            participantBroadcasterIds: (rawSession.participants || []).map((participant) => participant.broadcaster_id),
          }
        : null;
      const cacheEntry = { session, expiresAt: Date.now() + SHARED_CHAT_CACHE_MS };
      this.sharedChatSessionCache.set(broadcasterId, cacheEntry);
      for (const participantId of session?.participantBroadcasterIds || []) this.sharedChatSessionCache.set(participantId, cacheEntry);
      return session;
    } catch (error) {
      logger.warn(`[TwitchBot] Shared Chat lookup failed for broadcaster ${broadcasterId}; treating the channel independently:`, error);
      this.sharedChatSessionCache.set(broadcasterId, { session: null, expiresAt: Date.now() + SHARED_CHAT_CACHE_MS });
      return null;
    }
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
        logger.warn(
          `[TwitchBot] Twitch rejected chat access to #${channel} without a restriction duration; retry scheduled for ${ban.nextRetryAt.toISOString()}`,
        );
        throw new TwitchBotChannelBackoffError(channel, ban.nextRetryAt);
      }
      throw error;
    }

    if (existingBan) {
      await this.clearChannelBan(channel);
      logger.info(`[TwitchBot] Chat restriction cleared after successfully rejoining #${channel}`);
    }
    this.joinedChannels.add(channel);
    logger.info(`[TwitchBot] Joined #${channel}`);
    await this.maybeAnnounceJoin(channel);
  }

  private async maybeAnnounceJoin(channel: string): Promise<void> {
    if (channel === this.normalizeChannelName(twitchChannelPointsService.getHomeChannel())) return;

    try {
      const settings = await this.getChannelSettings(channel);
      if (!(await this.isSharedChatSettingEnabled(channel, "joinAnnouncementEnabled"))) return;
      if (settings.lastJoinAnnouncementAt && Date.now() - settings.lastJoinAnnouncementAt.getTime() < JOIN_ANNOUNCEMENT_COOLDOWN_MS) return;

      await this.queueSay(channel, JOIN_ANNOUNCEMENT_MESSAGE, { kind: "join_announcement" });
      await TwitchChannelBotSettings.updateOne(
        { channelName: channel },
        {
          $set: { lastJoinAnnouncementAt: new Date() },
          $setOnInsert: {
            channelName: channel,
            alertsEnabled: true,
            commandsEnabled: true,
            joinAnnouncementEnabled: true,
          },
        },
        { upsert: true },
      );
    } catch (error) {
      logger.error(`[TwitchBot] Failed to announce joining #${channel}:`, error);
    }
  }

  private async handleBotBan(channel: string): Promise<void> {
    const channelName = this.normalizeChannelName(channel);
    if (!channelName) {
      return;
    }

    await this.partRestrictedChannel(channelName);
    const ban = await this.recordChannelBan(channelName, { restrictionType: "permanent" });
    await this.writeRuntimeState({ joinedChannels: Array.from(this.joinedChannels).sort() });
    logger.warn(`[TwitchBot] Bot was permanently banned from #${channelName}; access check scheduled for ${ban.nextRetryAt.toISOString()}`);
  }

  private async handleBotTimeout(channel: string, durationSeconds: number): Promise<void> {
    const channelName = this.normalizeChannelName(channel);
    if (!channelName || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return;

    await this.partRestrictedChannel(channelName);
    const ban = await this.recordChannelBan(channelName, {
      restrictionType: "temporary",
      durationSeconds: Math.ceil(durationSeconds),
    });
    await this.writeRuntimeState({ joinedChannels: Array.from(this.joinedChannels).sort() });
    logger.warn(`[TwitchBot] Bot was timed out in #${channelName} until ${ban.expiresAt?.toISOString()}; rejoin scheduled for ${ban.nextRetryAt.toISOString()}`);
  }

  private async partRestrictedChannel(channelName: string): Promise<void> {
    try {
      if (this.chatClient?.currentChannels.some((channel) => this.normalizeChannelName(channel) === channelName)) {
        await this.chatClient.part(channelName);
      }
    } catch (error) {
      logger.warn(`[TwitchBot] Failed to leave restricted channel #${channelName}:`, error);
    }
    this.joinedChannels.delete(channelName);
  }

  private async partChannel(channel: string): Promise<void> {
    if (!this.chatClient || !this.joinedChannels.has(channel)) {
      return;
    }

    await this.chatClient.part(channel);
    this.joinedChannels.delete(channel);
    logger.info(`[TwitchBot] Left #${channel}`);
  }

  private getClientJoinedChannels(): string[] {
    if (!this.chatClient) {
      return [];
    }

    return this.chatClient.currentChannels
      .map((channel) => this.normalizeChannelName(channel))
      .filter((channel): channel is string => Boolean(channel))
      .sort();
  }

  private async handleMessage(channel: string, user: string, text: string, message?: ChatMessage): Promise<void> {
    const replyChannelName = this.normalizeChannelName(channel);
    if (!replyChannelName) {
      return;
    }

    if (this.botLogin && user.toLowerCase() === this.botLogin) {
      return;
    }

    if (this.isDuplicateSharedChatMessage(user, text, message)) return;
    const sourceChannelName = message?.sourceChannelId ? this.sharedChatChannelByBroadcasterId.get(message.sourceChannelId) : undefined;
    if (message?.sourceChannelId && !sourceChannelName) return;
    const channelName = sourceChannelName || replyChannelName;

    const commandName = this.getCommandName(text);
    this.recordInboundDiagnostic(channelName, Boolean(commandName));
    const auditEventId = commandName
      ? await this.recordInboundAudit("command", channelName, user, text, message, commandName, "received")
      : undefined;

    const parsed = twitchChatCommandService.parse(text);
    if (!parsed) {
      if (commandName) {
        await this.recordCommandOutcome(channelName, commandName, "unsupported", auditEventId);
      } else if (this.isBotMentioned(text, message)) {
        await this.recordInboundAudit("mention", channelName, user, text, message);
      }
      return;
    }

    this.recordCommandDiagnostic(channelName, parsed.name, "received");

    try {
      if (!(await this.isChannelAllowedToChat(channelName))) {
        await this.recordCommandOutcome(channelName, parsed.name, "channel_not_allowed", auditEventId);
        return;
      }

      const channelSettings = await this.getChannelSettings(channelName);
      if (parsed.name === "alerts") {
        const requestedState = this.parseAlertsState(parsed.args);
        const isBroadcaster = Boolean(
          message?.userInfo.isBroadcaster ||
          (message?.sourceChannelId && message.userInfo.userId === message.sourceChannelId),
        );
        if (requestedState !== null && !isBroadcaster) {
          await this.queueSay(replyChannelName, "Only the broadcaster can change progress alerts.", {
            kind: "command_reply",
            commandName: commandName || parsed.name,
            userName: user,
            relatedEventId: auditEventId,
          });
          await this.recordCommandOutcome(channelName, parsed.name, "replied", auditEventId);
          return;
        }

        if (this.isOnCooldown(channelName, user, parsed.name)) {
          await this.recordCommandOutcome(channelName, parsed.name, "cooldown", auditEventId);
          return;
        }

        const response = await this.handleAlertsCommand(channelSettings, parsed.args, user, isBroadcaster);
        await this.queueSay(replyChannelName, response, {
          kind: "command_reply",
          commandName: commandName || parsed.name,
          userName: user,
          relatedEventId: auditEventId,
        });
        await this.recordCommandOutcome(channelName, parsed.name, "replied", auditEventId);
        return;
      }

      if (!channelSettings.commandsEnabled) {
        await this.recordCommandOutcome(channelName, parsed.name, "channel_disabled", auditEventId);
        return;
      }

      if (this.isOnCooldown(channelName, user, parsed.name)) {
        await this.recordCommandOutcome(channelName, parsed.name, "cooldown", auditEventId);
        return;
      }

      const settings = await this.getSettings();
      const response = await twitchChatCommandService.handle(parsed, channelName, { includeUrl: settings.includeUrl });
      if (response) {
        await this.queueSay(replyChannelName, response, {
          kind: "command_reply",
          commandName: commandName || parsed.name,
          userName: user,
          relatedEventId: auditEventId,
        });
        await this.recordCommandOutcome(channelName, parsed.name, "replied", auditEventId);
      } else {
        await this.recordCommandOutcome(channelName, parsed.name, "no_response", auditEventId);
      }
    } catch (error) {
      await this.recordCommandOutcome(channelName, parsed.name, "handler_failed", auditEventId);
      try {
        await this.recordError(`Failed to handle Twitch chat command !${parsed.name} in #${channelName}`, error);
      } catch (recordingError) {
        logger.error("[TwitchBot] Failed to persist the Twitch chat command error:", recordingError);
      }

      try {
        await this.queueSay(replyChannelName, "Command failed. Please try again.", {
          kind: "system_reply",
          commandName: commandName || parsed.name,
          userName: user,
          relatedEventId: auditEventId,
        });
      } catch (replyError) {
        await this.recordCommandOutcome(channelName, parsed.name, "reply_failed", auditEventId);
        logger.error(`[TwitchBot] Failed to send the fallback command reply in #${channelName}:`, replyError);
      }
    }
  }

  private getCommandName(text: string): string | null {
    const match = /^!([^\s!]{1,32})/.exec(text.trim());
    return match ? match[1].toLowerCase().replace(/[^a-z0-9_-]/g, "?") : null;
  }

  private parseAlertsState(args: string): boolean | null {
    const value = args.trim().toLowerCase();
    if (value === "on") return true;
    if (value === "off") return false;
    return null;
  }

  private async handleAlertsCommand(
    settings: TwitchChannelBotSettingsSnapshot,
    args: string,
    userName: string,
    isBroadcaster: boolean,
  ): Promise<string> {
    const desiredState = this.parseAlertsState(args);
    if (desiredState === null) {
      if (args.trim().length > 0) return "Usage: !alerts <on|off>";
      return `Progress alerts are ${settings.alertsEnabled ? "on" : "off"} in #${settings.channelName}. Broadcaster: !alerts <on|off>.`;
    }
    if (!isBroadcaster) return "Only the broadcaster can change progress alerts.";
    if (settings.alertsEnabled === desiredState) {
      return `Progress alerts are already ${desiredState ? "on" : "off"} in #${settings.channelName}.`;
    }

    await this.updateChannelSettings(settings.channelName, { alertsEnabled: desiredState }, `broadcaster:${userName.toLowerCase()}`);
    return `Progress alerts are now ${desiredState ? "on" : "off"} in #${settings.channelName}.`;
  }

  private isBotMentioned(text: string, message?: ChatMessage): boolean {
    if (!this.botLogin) return false;
    if (message?.parentMessageUserName?.toLowerCase() === this.botLogin) return true;
    const escapedLogin = this.botLogin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|[^a-z0-9_])@${escapedLogin}(?:$|[^a-z0-9_])`, "i").test(text);
  }

  private isDuplicateSharedChatMessage(userName: string, text: string, message?: ChatMessage): boolean {
    if (!message?.sourceChannelId) return false;
    const sentAt = message.date?.getTime();
    if (!Number.isFinite(sentAt)) return false;

    const now = Date.now();
    if (this.sharedChatMessageKeys.size > 1000) {
      for (const [key, seenAt] of this.sharedChatMessageKeys) {
        if (now - seenAt > SHARED_CHAT_MESSAGE_DEDUPE_MS) this.sharedChatMessageKeys.delete(key);
      }
    }

    const key = `${message.sourceChannelId}:${message.userInfo.userId}:${sentAt}:${userName.toLowerCase()}:${text}`;
    const previous = this.sharedChatMessageKeys.get(key);
    this.sharedChatMessageKeys.set(key, now);
    return previous !== undefined && now - previous <= SHARED_CHAT_MESSAGE_DEDUPE_MS;
  }

  private async recordInboundAudit(
    kind: "command" | "mention",
    channelName: string,
    userName: string,
    text: string,
    message?: ChatMessage,
    commandName?: string,
    commandOutcome?: TwitchBotCommandOutcome,
  ): Promise<mongoose.Types.ObjectId | undefined> {
    try {
      const event = await TwitchChatAuditEvent.create({
        direction: "inbound",
        kind,
        channelName,
        message: text.slice(0, 500),
        twitchMessageId: message?.id,
        userId: message?.userInfo.userId,
        userName: userName.toLowerCase(),
        userDisplayName: message?.userInfo.displayName || userName,
        commandName,
        commandOutcome,
        deliveryStatus: "received",
      });
      return event._id;
    } catch (error) {
      logger.error("[TwitchBot] Failed to record inbound chat audit event:", error);
      return undefined;
    }
  }

  private async recordCommandOutcome(
    channelName: string,
    commandName: string,
    outcome: TwitchBotCommandOutcome,
    auditEventId?: mongoose.Types.ObjectId,
  ): Promise<void> {
    this.recordCommandDiagnostic(channelName, commandName, outcome);
    if (!auditEventId) return;
    try {
      await TwitchChatAuditEvent.updateOne({ _id: auditEventId }, { $set: { commandOutcome: outcome } });
    } catch (error) {
      logger.error("[TwitchBot] Failed to update Twitch command audit outcome:", error);
    }
  }

  private recordChatClientError(message: string, reason: string): void {
    void this.recordError(message, reason).catch((recordingError) => {
      logger.error("[TwitchBot] Failed to persist a Twitch IRC client error:", recordingError);
    });
  }

  private recordInboundDiagnostic(channelName: string, force: boolean): void {
    const now = Date.now();
    if (!force && now - this.lastInboundDiagnosticAt < INBOUND_DIAGNOSTIC_INTERVAL_MS) {
      return;
    }

    this.lastInboundDiagnosticAt = now;
    this.queueDiagnosticUpdate({
      lastInboundMessageAt: new Date(now),
      lastInboundChannel: channelName,
    });
  }

  private recordCommandDiagnostic(channelName: string, commandName: string, outcome: TwitchBotCommandOutcome): void {
    logger.info(`[TwitchBot] Command !${commandName} in #${channelName}: ${outcome}`);
    this.queueDiagnosticUpdate({
      lastCommandAt: new Date(),
      lastCommandChannel: channelName,
      lastCommandName: commandName,
      lastCommandOutcome: outcome,
    });
  }

  private queueDiagnosticUpdate(update: Parameters<TwitchChatBotService["writeRuntimeState"]>[0]): void {
    const task = this.diagnosticQueue
      .catch(() => undefined)
      .then(() => this.writeRuntimeState(update));

    this.diagnosticQueue = task.catch((error) => {
      logger.error("[TwitchBot] Failed to persist Twitch chat diagnostics:", error);
    });
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
    const enabledKinds = await twitchChannelPointsService.getEnabledRewardKinds();
    if (enabledKinds.length === 0) return;
    await twitchCcgRewardService.retryCardAssignments(enabledKinds);
    await twitchCcgRewardService.retryLinkedPending(enabledKinds);
    const now = new Date();
    const rewardKindFilter = twitchCcgRewardKindMatch(enabledKinds);
    await TwitchCcgRedemption.updateMany(
      { chatStatus: { $in: ["pending", "failed"] }, chatExpiresAt: { $lte: now }, ...rewardKindFilter },
      { $set: { chatStatus: "expired", chatLastError: "Chat delivery expired" } },
    );

    const deliveries = await TwitchCcgRedemption.find({
      chatStatus: { $in: ["pending", "failed"] },
      chatNextAttemptAt: { $lte: now },
      chatExpiresAt: { $gt: now },
      chatAttempts: { $lt: MAX_CCG_CHAT_DELIVERY_ATTEMPTS },
      ...rewardKindFilter,
    })
      .sort({ chatNextAttemptAt: 1 })
      .limit(20);

    const channel = this.normalizeChannelName(twitchChannelPointsService.getHomeChannel());
    if (!channel) throw new Error("TWITCH_BOT_HOME_CHANNEL is invalid");

    for (const delivery of deliveries) {
      try {
        if (!this.connected || !this.chatClient) throw new Error("Twitch chat is not connected");
        if (!this.joinedChannels.has(channel)) await this.joinChannel(channel);

        const linkedAccount = await User.exists({ "twitch.id": delivery.twitchUserId });
        if (delivery.grantStatus === "granted") {
          delivery.chatStatus = "skipped";
          delivery.chatLastError = undefined;
          await delivery.save();
          continue;
        }

        if (delivery.assignmentStatus === "pending") {
          delivery.chatNextAttemptAt = delivery.assignmentNextAttemptAt;
          await delivery.save();
          continue;
        }

        let message: string;
        if (delivery.grantStatus === "failed" || delivery.assignmentStatus === "failed") {
          delivery.chatMessageKind = "delivery_error";
          message = `@${delivery.twitchUserLogin} we couldn't deliver your CCG reward yet. We'll retry automatically.`;
        } else if (linkedAccount) {
          delivery.chatNextAttemptAt = delivery.grantNextAttemptAt;
          await delivery.save();
          continue;
        } else {
          const recentLinkPrompt = await TwitchCcgRedemption.exists({
            _id: { $ne: delivery._id },
            twitchUserId: delivery.twitchUserId,
            chatStatus: "sent",
            chatMessageKind: "account_link",
            chatSentAt: { $gte: new Date(now.getTime() - CCG_LINK_PROMPT_COOLDOWN_MS) },
          });
          if (recentLinkPrompt) {
            delivery.chatStatus = "skipped";
            delivery.chatLastError = undefined;
            await delivery.save();
            continue;
          }
          delivery.chatMessageKind = "account_link";
          message = `@${delivery.twitchUserLogin} connect your Twitch at ${this.getFrontendBaseUrl()}/profile to claim your CCG reward.`;
        }
        await this.queueSay(channel, message, {
          kind: "reward",
          userName: delivery.twitchUserLogin,
        });
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
        if (!(await this.isSharedChatSettingEnabled(channel, "alertsEnabled"))) continue;
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

        if (!(await this.isSharedChatSettingEnabled(channel, "alertsEnabled"))) {
          delivery.status = "expired";
          delivery.lastError = "Progress alerts are disabled for this Twitch channel or a linked Shared Chat channel";
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

        await this.queueSay(channel, this.formatEventMessage(event, settings), { kind: "progress_alert" });
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

  private async queueSay(channel: string, message: string, context: TwitchOutboundAuditContext): Promise<void> {
    const normalizedMessage = this.limitMessage(message);
    const task = this.outboundQueue
      .catch(() => undefined)
      .then(async () => {
        try {
          if (!this.chatClient?.isConnected) {
            throw new Error("Twitch chat is not connected");
          }

          const waitMs = Math.max(0, this.getOutboundDelayMs() - (Date.now() - this.lastOutboundAt));
          if (waitMs > 0) {
            await this.sleep(waitMs);
          }

          await this.chatClient.say(channel, normalizedMessage);
        } catch (error) {
          await this.recordOutboundAudit(channel, normalizedMessage, context, "failed", error);
          throw error;
        }

        this.lastOutboundAt = Date.now();
        await this.recordOutboundAudit(channel, normalizedMessage, context, "sent");
        try {
          await this.writeRuntimeState({ lastMessageAt: new Date() });
        } catch (error) {
          logger.error("[TwitchBot] Failed to update the last outbound message timestamp:", error);
        }
      });

    this.outboundQueue = task.catch(() => undefined);
    return task;
  }

  private async recordOutboundAudit(
    channelName: string,
    message: string,
    context: TwitchOutboundAuditContext,
    deliveryStatus: "sent" | "failed",
    error?: unknown,
  ): Promise<void> {
    try {
      await TwitchChatAuditEvent.create({
        direction: "outbound",
        kind: context.kind,
        channelName,
        message,
        userName: context.userName?.toLowerCase(),
        commandName: context.commandName,
        relatedEventId: context.relatedEventId,
        deliveryStatus,
        error: error instanceof Error ? error.message : error === undefined ? undefined : String(error),
      });
    } catch (auditError) {
      logger.error("[TwitchBot] Failed to record outbound chat audit event:", auditError);
    }
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

  private requireChannelName(channelName: string): string {
    const normalized = this.normalizeChannelName(channelName);
    if (!normalized) throw new TwitchBotChannelSettingsValidationError("Invalid Twitch channel name");
    return normalized;
  }

  private toChannelSettingsSnapshot(
    channelName: string,
    stored?: Partial<TwitchChannelBotSettingsSnapshot>,
  ): TwitchChannelBotSettingsSnapshot {
    return {
      channelName,
      alertsEnabled: stored?.alertsEnabled ?? true,
      commandsEnabled: stored?.commandsEnabled ?? true,
      joinAnnouncementEnabled: stored?.joinAnnouncementEnabled ?? true,
      lastJoinAnnouncementAt: stored?.lastJoinAnnouncementAt,
      updatedBy: stored?.updatedBy,
      updatedAt: stored?.updatedAt,
    };
  }

  private async isSharedChatSettingEnabled(
    representativeChannel: string,
    setting: "alertsEnabled" | "joinAnnouncementEnabled",
  ): Promise<boolean> {
    const sharedSession = this.sharedChatSessions.find((session) => session.representativeChannel === representativeChannel);
    const channels = sharedSession?.trackedChannels.length ? sharedSession.trackedChannels : [representativeChannel];
    const settings = await Promise.all(channels.map((channel) => this.getChannelSettings(channel)));
    return settings.every((channelSettings) => channelSettings[setting]);
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
        const reason = ["msg_banned", "timeout", "permanent_ban"].includes(String(ban.reason))
          ? (ban.reason as ITwitchBotChannelBan["reason"])
          : "msg_banned";
        const restrictionType = ["temporary", "permanent", "unknown"].includes(String(ban.restrictionType))
          ? (ban.restrictionType as ITwitchBotChannelBan["restrictionType"])
          : reason === "timeout"
            ? "temporary"
            : reason === "permanent_ban"
              ? "permanent"
              : "unknown";
        const durationSeconds = ban.durationSeconds === undefined ? undefined : Number(ban.durationSeconds);
        const expiresAt = ban.expiresAt === undefined ? undefined : new Date(ban.expiresAt as Date | string);
        if (
          !Number.isFinite(detectedAt.getTime()) ||
          !Number.isFinite(lastAttemptAt.getTime()) ||
          !Number.isFinite(nextRetryAt.getTime()) ||
          !Number.isInteger(failureCount) ||
          failureCount < 1 ||
          (durationSeconds !== undefined && (!Number.isInteger(durationSeconds) || durationSeconds < 1)) ||
          (expiresAt !== undefined && !Number.isFinite(expiresAt.getTime()))
        ) {
          return [];
        }

        return [
          {
            channelName,
            reason,
            restrictionType,
            detectedAt,
            lastAttemptAt,
            nextRetryAt,
            failureCount,
            durationSeconds,
            expiresAt,
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
        reason: ban.reason || "msg_banned",
        restrictionType: ban.restrictionType || "unknown",
        detectedAt: new Date(ban.detectedAt),
        lastAttemptAt: new Date(ban.lastAttemptAt),
        nextRetryAt: new Date(ban.nextRetryAt),
        failureCount: ban.failureCount,
        durationSeconds: ban.durationSeconds,
        expiresAt: ban.expiresAt ? new Date(ban.expiresAt) : undefined,
      });
    }
    this.channelBansBotUserId = botUserId;
  }

  private async recordChannelBan(
    channel: string,
    details?: { restrictionType: "temporary"; durationSeconds: number } | { restrictionType: "permanent" },
  ): Promise<ITwitchBotChannelBan> {
    if (!this.botUserId || this.channelBansBotUserId !== this.botUserId) {
      throw new Error("Twitch bot identity is unavailable while recording a channel ban");
    }

    const now = new Date();
    const existing = this.channelBans.get(channel);
    const failureCount = (existing?.failureCount || 0) + 1;
    const restrictionType = details?.restrictionType || (existing?.restrictionType === "permanent" ? "permanent" : "unknown");
    const durationSeconds = details?.restrictionType === "temporary" ? details.durationSeconds : undefined;
    const expiresAt = durationSeconds ? new Date(now.getTime() + durationSeconds * 1000) : undefined;
    const retryDelay =
      restrictionType === "temporary" && expiresAt
        ? Math.max(0, expiresAt.getTime() - now.getTime()) + 5000
        : restrictionType === "permanent"
          ? BANNED_CHANNEL_RETRY_MAX_MS
          : Math.min(BANNED_CHANNEL_RETRY_BASE_MS * 2 ** (failureCount - 1), BANNED_CHANNEL_RETRY_MAX_MS);
    const ban: ITwitchBotChannelBan = {
      reason: restrictionType === "temporary" ? "timeout" : restrictionType === "permanent" ? "permanent_ban" : "msg_banned",
      restrictionType,
      detectedAt: existing?.detectedAt || now,
      lastAttemptAt: now,
      nextRetryAt: new Date(now.getTime() + retryDelay),
      failureCount,
      durationSeconds,
      expiresAt,
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
    sharedChatSessions: ITwitchBotSharedChatSession[];
    lastEventCreatedAt: Date;
    lastStartedAt: Date;
    lastStoppedAt: Date;
    lastConnectedAt: Date;
    lastDisconnectedAt: Date;
    lastReconciledAt: Date;
    lastSharedChatCheckAt: Date;
    lastMessageAt: Date;
    lastInboundMessageAt: Date;
    lastInboundChannel: string;
    lastCommandAt: Date;
    lastCommandChannel: string;
    lastCommandName: string;
    lastCommandOutcome: TwitchBotCommandOutcome;
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
