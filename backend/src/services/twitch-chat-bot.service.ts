import { RefreshingAuthProvider } from "@twurple/auth";
import { ChatClient } from "@twurple/chat";
import mongoose from "mongoose";
import Event, { EventType, IEvent } from "../models/Event";
import Guild from "../models/Guild";
import TwitchBotRuntimeState from "../models/TwitchBotRuntimeState";
import TwitchEventDelivery from "../models/TwitchEventDelivery";
import logger from "../utils/logger";
import twitchBotAuthService, { TwitchBotAuthStatus, TwitchBotRefreshedAccessToken } from "./twitch-bot-auth.service";
import twitchChatCommandService from "./twitch-chat-command.service";

type TwitchEventDifficulty = "mythic" | "heroic";

export interface TwitchChatBotStatus extends TwitchBotAuthStatus {
  botEnabled: boolean;
  chat: {
    running: boolean;
    connected: boolean;
    desiredChannels: string[];
    joinedChannels: string[];
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
const RUNTIME_STATE_KEY = "runtime";
const MAX_DELIVERY_ATTEMPTS = 5;

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
    const [authStatus, runtime, deliveryCounts, sentCount] = await Promise.all([
      twitchBotAuthService.getStatus(),
      TwitchBotRuntimeState.findOne({ key: RUNTIME_STATE_KEY }).lean(),
      TwitchEventDelivery.aggregate([{ $match: { status: { $in: ["pending", "failed", "expired"] } } }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
      TwitchEventDelivery.countDocuments({ status: "sent", sentAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } }),
    ]);
    const countsByStatus = new Map(deliveryCounts.map((entry: { _id: string; count: number }) => [entry._id, entry.count]));
    const desiredChannels = runtime?.desiredChannels?.length ? runtime.desiredChannels : Array.from(this.desiredChannels).sort();
    const joinedChannels = runtime?.joinedChannels?.length ? runtime.joinedChannels : Array.from(this.joinedChannels).sort();

    return {
      ...authStatus,
      botEnabled: this.isEnabled(),
      chat: {
        running: runtime?.running ?? this.running,
        connected: runtime?.connected ?? this.connected,
        desiredChannels,
        joinedChannels,
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

  private async ensureConnectedAndReconcile(): Promise<void> {
    if (!this.running || !this.isEnabled()) {
      return;
    }

    if (!(await twitchBotAuthService.hasConnectedBot())) {
      if (this.connected || this.chatClient) {
        await this.disconnectClient();
      } else {
        await this.writeRuntimeState({ enabled: true, running: this.running, connected: false });
      }
      return;
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
      await this.recordError("Failed to connect to Twitch IRC", error);
    } finally {
      this.connecting = false;
    }
  }

  private async disconnectClient(): Promise<void> {
    const client = this.chatClient;
    this.chatClient = null;
    this.connected = false;

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
          await this.joinChannel(channel);
          await this.sleep(this.getJoinDelayMs());
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
      isCurrentlyRaiding: true,
      streamers: { $elemMatch: { isLive: true, isPlayingWoW: true } },
    })
      .sort({ name: 1, realm: 1 })
      .select("streamers.channelName streamers.isLive streamers.isPlayingWoW")
      .lean();

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

    const desired = Array.from(channels).sort();
    if (desired.length > maxChannels) {
      logger.warn(`[TwitchBot] Desired channel count ${desired.length} exceeds cap ${maxChannels}; joining first ${maxChannels}`);
    }

    return desired.slice(0, maxChannels);
  }

  private async findDesiredChannelsForGuild(guildId: mongoose.Types.ObjectId): Promise<string[]> {
    const guild = await Guild.findById(guildId).select("isCurrentlyRaiding streamers.channelName streamers.isLive streamers.isPlayingWoW").lean();
    if (!guild?.isCurrentlyRaiding) {
      return [];
    }

    return (guild.streamers || [])
      .filter((streamer) => streamer.isLive && streamer.isPlayingWoW)
      .map((streamer) => this.normalizeChannelName(streamer.channelName))
      .filter((channel): channel is string => Boolean(channel));
  }

  private async joinChannel(channel: string): Promise<void> {
    if (!this.chatClient || this.joinedChannels.has(channel)) {
      return;
    }

    await this.chatClient.join(channel);
    this.joinedChannels.add(channel);
    logger.info(`[TwitchBot] Joined #${channel}`);
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

    if (this.isOnCooldown(channelName, user, parsed.name)) {
      return;
    }

    try {
      const response = await twitchChatCommandService.handle(parsed, channelName);
      if (response) {
        await this.queueSay(channelName, response);
      }
    } catch (error) {
      await this.recordError("Failed to handle Twitch chat command", error);
      await this.queueSay(channelName, "Command failed. Please try again.");
    }
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
      await this.enqueueNewEventDeliveries();
      await this.sendDueEventDeliveries();
    } catch (error) {
      await this.recordError("Twitch event publisher error", error);
    } finally {
      this.publishing = false;
    }
  }

  private async enqueueNewEventDeliveries(): Promise<void> {
    let state = await TwitchBotRuntimeState.findOne({ key: RUNTIME_STATE_KEY });
    if (!state) {
      await TwitchBotRuntimeState.create({
        key: RUNTIME_STATE_KEY,
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
      type: { $in: this.getEventTypes() },
      difficulty: { $in: this.getDifficulties() },
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

  private async sendDueEventDeliveries(): Promise<void> {
    const now = new Date();
    await TwitchEventDelivery.updateMany(
      { status: { $in: ["pending", "failed"] }, expiresAt: { $lte: now } },
      { $set: { status: "expired", lastError: "Delivery expired before it could be sent" } },
    );

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
          delivery.lastError = "Twitch channel is no longer a live raiding target";
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

        await this.queueSay(channel, this.formatEventMessage(event));
        delivery.status = "sent";
        delivery.sentAt = new Date();
        delivery.lastError = undefined;
        await delivery.save();
      } catch (error) {
        const attempts = delivery.attempts + 1;
        delivery.status = "failed";
        delivery.attempts = attempts;
        delivery.lastError = error instanceof Error ? error.message : String(error);
        delivery.nextAttemptAt = new Date(Date.now() + Math.min(60 * 60 * 1000, 2 ** attempts * 60 * 1000));
        await delivery.save();
      }
    }
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

  private formatEventMessage(event: IEvent): string {
    const difficulty = event.difficulty === "mythic" ? "Mythic" : "Heroic";
    const bossName = event.bossName || "a boss";
    const guildUrl = event.guildRealm ? `${this.getFrontendBaseUrl()}/guilds/${encodeURIComponent(event.guildRealm)}/${encodeURIComponent(event.guildName)}` : this.getFrontendBaseUrl();

    if (event.type === "boss_kill") {
      const pulls = typeof event.data.pullCount === "number" ? ` after ${event.data.pullCount} pulls` : "";
      return this.limitMessage(`${difficulty} kill: ${event.guildName} defeated ${bossName}${pulls}. ${guildUrl}`);
    }

    if (event.type === "best_pull") {
      const progress = event.data.progressDisplay || (typeof event.data.bestPercent === "number" ? `${event.data.bestPercent.toFixed(1)}%` : "a new best pull");
      const pulls = typeof event.data.pullCount === "number" ? ` after ${event.data.pullCount} pulls` : "";
      return this.limitMessage(`Best pull: ${event.guildName} reached ${progress} on ${bossName}${pulls}. ${guildUrl}`);
    }

    return this.limitMessage(`${difficulty}: ${event.guildName} updated progress on ${bossName}. ${guildUrl}`);
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

  private async writeRuntimeState(update: Partial<{
    enabled: boolean;
    running: boolean;
    connected: boolean;
    desiredChannels: string[];
    joinedChannels: string[];
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

    await TwitchBotRuntimeState.updateOne(
      { key: RUNTIME_STATE_KEY },
      {
        $set: set,
        ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}),
      },
      { upsert: true },
    );
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

  private getEventTypes(): EventType[] {
    const configured = (process.env.TWITCH_BOT_EVENT_TYPES || "boss_kill,best_pull")
      .split(/[,\s]+/)
      .map((value) => value.trim())
      .filter((value): value is EventType => VALID_EVENT_TYPES.includes(value as EventType));
    return configured.length > 0 ? configured : ["boss_kill", "best_pull"];
  }

  private getDifficulties(): TwitchEventDifficulty[] {
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
