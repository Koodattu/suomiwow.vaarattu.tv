import assert from "node:assert/strict";
import test from "node:test";
import { Types } from "mongoose";
import Guild from "../src/models/Guild";
import TwitchBotRuntimeState, { ITwitchBotChannelBan, ITwitchBotSharedChatSession } from "../src/models/TwitchBotRuntimeState";
import TwitchChatAuditEvent from "../src/models/TwitchChatAuditEvent";
import TwitchChannelBotSettings from "../src/models/TwitchChannelBotSettings";
import twitchChatBotService from "../src/services/twitch-chat-bot.service";
import twitchChatCommandService from "../src/services/twitch-chat-command.service";

type TwitchChatBotServiceInternals = {
  findDesiredChannels(): Promise<string[]>;
  findDesiredChannelsForGuild(guildId: Types.ObjectId): Promise<string[]>;
  deduplicateSharedChatTargets(targets: Array<{ channelName: string; broadcasterId?: string }>, recordSessions: boolean): Promise<string[]>;
  isChannelAllowedToChat(channelName: string): Promise<boolean>;
  isDuplicateSharedChatMessage(
    userName: string,
    text: string,
    message?: { sourceChannelId?: string; date?: Date; userInfo: { userId: string } },
  ): boolean;
  isSharedChatSettingEnabled(channelName: string, setting: "alertsEnabled" | "joinAnnouncementEnabled"): Promise<boolean>;
  recordChannelBan(
    channelName: string,
    details?: { restrictionType: "temporary"; durationSeconds: number } | { restrictionType: "permanent" },
  ): Promise<ITwitchBotChannelBan>;
  maybeAnnounceJoin(channelName: string): Promise<void>;
  handleMessage(
    channel: string,
    user: string,
    text: string,
    message?: {
      id: string;
      parentMessageUserName: string | null;
      sourceChannelId?: string;
      date?: Date;
      userInfo: { userId: string; displayName: string; isBroadcaster: boolean };
    },
  ): Promise<void>;
  getSettings: typeof twitchChatBotService.getSettings;
  getChannelSettings: typeof twitchChatBotService.getChannelSettings;
  updateChannelSettings: typeof twitchChatBotService.updateChannelSettings;
  chatClient: { isConnected: boolean; currentChannels: string[]; say(channel: string, message: string): Promise<void> } | null;
  connected: boolean;
  botLogin: string | null;
  botUserId: string | null;
  channelBansBotUserId: string | null;
  channelBans: Map<string, ITwitchBotChannelBan>;
  sharedChatSessionCache: Map<
    string,
    {
      session: { sessionId: string; hostBroadcasterId: string; participantBroadcasterIds: string[] } | null;
      expiresAt: number;
    }
  >;
  sharedChatChannelByBroadcasterId: Map<string, string>;
  sharedChatRepresentativeBySessionId: Map<string, string>;
  sharedChatSessions: ITwitchBotSharedChatSession[];
  sharedChatMessageKeys: Map<string, number>;
  diagnosticQueue: Promise<void>;
  outboundQueue: Promise<void>;
  lastOutboundAt: number;
  lastInboundDiagnosticAt: number;
  userCooldowns: Map<string, number>;
  channelCommandCooldowns: Map<string, number>;
};

test("accepts legacy channel restrictions that predate restrictionType", async () => {
  const timestamp = new Date("2026-08-31T12:00:00.000Z");
  const runtime = TwitchBotRuntimeState.hydrate({
    _id: new Types.ObjectId(),
    key: "twitch-chat-bot",
    enabled: true,
    running: true,
    connected: true,
    desiredChannels: [],
    joinedChannels: [],
    channelBans: {
      channel_alpha: {
        reason: "msg_banned",
        detectedAt: timestamp,
        lastAttemptAt: timestamp,
        nextRetryAt: timestamp,
        failureCount: 1,
      },
    },
  });

  await assert.doesNotReject(runtime.validate());
  assert.equal(runtime.channelBans.get("channel_alpha")?.restrictionType, "unknown");
});

test("targets live WoW streamers without requiring their guild to be raiding", async () => {
  const originalFind = Guild.find;
  const originalFindById = Guild.findById;
  const originalExists = Guild.exists;
  const service = twitchChatBotService as unknown as TwitchChatBotServiceInternals;
  const guildId = new Types.ObjectId();
  const streamer = { channelName: "TestChannel", isLive: true, isPlayingWoW: true };
  let findQuery: unknown;
  let guildSelection: unknown;
  let existsQuery: unknown;
  const originalHomeChannel = process.env.TWITCH_BOT_HOME_CHANNEL;
  process.env.TWITCH_BOT_HOME_CHANNEL = "vaarattu";

  Guild.find = ((query: unknown) => {
    findQuery = query;
    return {
      sort: () => ({
        select: () => ({
          lean: async () => [{ isCurrentlyRaiding: false, streamers: [streamer] }],
        }),
      }),
    };
  }) as unknown as typeof Guild.find;
  Guild.findById = (() => ({
    select: (selection: unknown) => {
      guildSelection = selection;
      return {
        lean: async () => ({ isCurrentlyRaiding: false, streamers: [streamer] }),
      };
    },
  })) as unknown as typeof Guild.findById;
  Guild.exists = ((query: unknown) => {
    existsQuery = query;
    return Promise.resolve({ _id: guildId });
  }) as unknown as typeof Guild.exists;

  try {
    assert.deepEqual(await service.findDesiredChannels(), ["vaarattu", "testchannel"]);
    assert.deepEqual(findQuery, {
      streamers: { $elemMatch: { isLive: true, isPlayingWoW: true } },
    });

    assert.deepEqual(await service.findDesiredChannelsForGuild(guildId), ["testchannel"]);
    assert.equal(guildSelection, "streamers.channelName streamers.twitchUserId streamers.isLive streamers.isPlayingWoW");

    assert.equal(await service.isChannelAllowedToChat("testchannel"), true);
    assert.deepEqual(existsQuery, {
      streamers: {
        $elemMatch: {
          channelName: /^testchannel$/i,
          isLive: true,
          isPlayingWoW: true,
        },
      },
    });

    existsQuery = undefined;
    assert.equal(await service.isChannelAllowedToChat("vaarattu"), true);
    assert.equal(existsQuery, undefined);
  } finally {
    Guild.find = originalFind;
    Guild.findById = originalFindById;
    Guild.exists = originalExists;
    if (originalHomeChannel === undefined) delete process.env.TWITCH_BOT_HOME_CHANNEL;
    else process.env.TWITCH_BOT_HOME_CHANNEL = originalHomeChannel;
  }
});

test("audits command replies, unsupported commands, and bot mentions", async () => {
  const service = twitchChatBotService as unknown as TwitchChatBotServiceInternals;
  const originalRuntimeUpdateOne = TwitchBotRuntimeState.updateOne;
  const originalAuditCreate = TwitchChatAuditEvent.create;
  const originalAuditUpdateOne = TwitchChatAuditEvent.updateOne;
  const originalCommandHandle = twitchChatCommandService.handle;
  const originalGetSettings = service.getSettings;
  const originalGetChannelSettings = service.getChannelSettings;
  const originalChatClient = service.chatClient;
  const originalConnected = service.connected;
  const originalBotLogin = service.botLogin;
  const originalSharedChatChannelMap = service.sharedChatChannelByBroadcasterId;
  const originalHomeChannel = process.env.TWITCH_BOT_HOME_CHANNEL;
  const runtimeUpdates: Array<Record<string, unknown>> = [];
  const auditCreates: Array<Record<string, unknown>> = [];
  const sentMessages: Array<{ channel: string; message: string }> = [];

  TwitchBotRuntimeState.updateOne = (async (_filter: unknown, update: { $set?: Record<string, unknown> }) => {
    runtimeUpdates.push(update.$set || {});
    return { acknowledged: true, matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
  }) as unknown as typeof TwitchBotRuntimeState.updateOne;
  TwitchChatAuditEvent.create = (async (event: Record<string, unknown>) => {
    auditCreates.push(event);
    return { _id: new Types.ObjectId() };
  }) as unknown as typeof TwitchChatAuditEvent.create;
  TwitchChatAuditEvent.updateOne = (async () => ({ acknowledged: true, matchedCount: 1, modifiedCount: 1 })) as unknown as typeof TwitchChatAuditEvent.updateOne;
  twitchChatCommandService.handle = (async () => "Test reply") as typeof twitchChatCommandService.handle;
  service.getSettings = async () => ({
    eventPublishingEnabled: true,
    eventTypes: [],
    difficulties: [],
    includeUrl: false,
    messageTemplates: { bossKill: "", bestPull: "", progressUpdate: "" },
  });
  service.getChannelSettings = async (channelName) => ({
    channelName,
    alertsEnabled: true,
    commandsEnabled: true,
    joinAnnouncementEnabled: true,
  });
  service.chatClient = {
    isConnected: true,
    currentChannels: ["#vaarattu"],
    say: async (channel, message) => {
      sentMessages.push({ channel, message });
    },
  };
  service.connected = true;
  service.botLogin = "vaarabot";
  service.sharedChatChannelByBroadcasterId = new Map();
  service.diagnosticQueue = Promise.resolve();
  service.outboundQueue = Promise.resolve();
  service.lastOutboundAt = 0;
  service.lastInboundDiagnosticAt = 0;
  service.userCooldowns.clear();
  service.channelCommandCooldowns.clear();
  process.env.TWITCH_BOT_HOME_CHANNEL = "vaarattu";

  try {
    await service.handleMessage("#vaarattu", "viewer", "!best");
    await service.handleMessage("#vaarattu", "viewer", "!best", {
      id: "shared-message-untracked",
      parentMessageUserName: null,
      sourceChannelId: "untracked-broadcaster",
      date: new Date(),
      userInfo: { userId: "viewer-1", displayName: "Viewer", isBroadcaster: false },
    });
    await service.handleMessage("#vaarattu", "viewer", "!doesnotexist");
    await service.handleMessage("#vaarattu", "viewer", "hey @vaarabot");
    await service.diagnosticQueue;

    assert.deepEqual(sentMessages, [{ channel: "vaarattu", message: "Test reply" }]);
    assert.deepEqual(
      runtimeUpdates.map((update) => update.lastCommandOutcome).filter(Boolean),
      ["received", "replied", "unsupported"],
    );
    assert.ok(runtimeUpdates.some((update) => update.lastInboundChannel === "vaarattu"));
    assert.ok(runtimeUpdates.some((update) => update.lastCommandName === "doesnotexist" && update.lastCommandOutcome === "unsupported"));
    assert.deepEqual(auditCreates.map((event) => event.kind), ["command", "command_reply", "command", "mention"]);
    assert.equal(auditCreates[0].userName, "viewer");
    assert.equal(auditCreates[1].message, "Test reply");
  } finally {
    TwitchBotRuntimeState.updateOne = originalRuntimeUpdateOne;
    TwitchChatAuditEvent.create = originalAuditCreate;
    TwitchChatAuditEvent.updateOne = originalAuditUpdateOne;
    twitchChatCommandService.handle = originalCommandHandle;
    service.getSettings = originalGetSettings;
    service.getChannelSettings = originalGetChannelSettings;
    service.chatClient = originalChatClient;
    service.connected = originalConnected;
    service.botLogin = originalBotLogin;
    service.sharedChatChannelByBroadcasterId = originalSharedChatChannelMap;
    service.diagnosticQueue = Promise.resolve();
    service.outboundQueue = Promise.resolve();
    service.lastOutboundAt = 0;
    service.lastInboundDiagnosticAt = 0;
    service.userCooldowns.clear();
    service.channelCommandCooldowns.clear();
    if (originalHomeChannel === undefined) delete process.env.TWITCH_BOT_HOME_CHANNEL;
    else process.env.TWITCH_BOT_HOME_CHANNEL = originalHomeChannel;
  }
});

test("lets the broadcaster persistently turn channel progress alerts off", async () => {
  const service = twitchChatBotService as unknown as TwitchChatBotServiceInternals;
  const originalRuntimeUpdateOne = TwitchBotRuntimeState.updateOne;
  const originalAuditCreate = TwitchChatAuditEvent.create;
  const originalAuditUpdateOne = TwitchChatAuditEvent.updateOne;
  const originalGetChannelSettings = service.getChannelSettings;
  const originalUpdateChannelSettings = service.updateChannelSettings;
  const originalChatClient = service.chatClient;
  const originalBotLogin = service.botLogin;
  const originalHomeChannel = process.env.TWITCH_BOT_HOME_CHANNEL;
  const settingUpdates: Array<{ channelName: string; alertsEnabled?: boolean; updatedBy: string }> = [];
  const sentMessages: string[] = [];

  TwitchBotRuntimeState.updateOne = (async () => ({ acknowledged: true, matchedCount: 1, modifiedCount: 1 })) as unknown as typeof TwitchBotRuntimeState.updateOne;
  TwitchChatAuditEvent.create = (async () => ({ _id: new Types.ObjectId() })) as unknown as typeof TwitchChatAuditEvent.create;
  TwitchChatAuditEvent.updateOne = (async () => ({ acknowledged: true, matchedCount: 1, modifiedCount: 1 })) as unknown as typeof TwitchChatAuditEvent.updateOne;
  service.getChannelSettings = async (channelName) => ({
    channelName,
    alertsEnabled: true,
    commandsEnabled: true,
    joinAnnouncementEnabled: true,
  });
  service.updateChannelSettings = async (channelName, input, updatedBy) => {
    settingUpdates.push({ channelName, alertsEnabled: input.alertsEnabled, updatedBy });
    return {
      channelName,
      alertsEnabled: input.alertsEnabled ?? true,
      commandsEnabled: true,
      joinAnnouncementEnabled: true,
      updatedBy,
    };
  };
  service.chatClient = {
    isConnected: true,
    currentChannels: ["#vaarattu"],
    say: async (_channel, message) => {
      sentMessages.push(message);
    },
  };
  service.botLogin = "vaarabot";
  service.diagnosticQueue = Promise.resolve();
  service.outboundQueue = Promise.resolve();
  service.lastOutboundAt = 0;
  service.userCooldowns.clear();
  service.channelCommandCooldowns.clear();
  process.env.TWITCH_BOT_HOME_CHANNEL = "vaarattu";

  try {
    await service.handleMessage("#vaarattu", "Viewer", "!alerts off", {
      id: "message-0",
      parentMessageUserName: null,
      userInfo: { userId: "viewer-1", displayName: "Viewer", isBroadcaster: false },
    });
    assert.deepEqual(settingUpdates, []);

    await service.handleMessage("#vaarattu", "Streamer", "!alerts off", {
      id: "message-1",
      parentMessageUserName: null,
      userInfo: { userId: "owner-1", displayName: "Streamer", isBroadcaster: true },
    });

    assert.deepEqual(settingUpdates, [{ channelName: "vaarattu", alertsEnabled: false, updatedBy: "broadcaster:streamer" }]);
    assert.deepEqual(sentMessages, ["Only the broadcaster can change progress alerts.", "Progress alerts are now off in #vaarattu."]);
  } finally {
    TwitchBotRuntimeState.updateOne = originalRuntimeUpdateOne;
    TwitchChatAuditEvent.create = originalAuditCreate;
    TwitchChatAuditEvent.updateOne = originalAuditUpdateOne;
    service.getChannelSettings = originalGetChannelSettings;
    service.updateChannelSettings = originalUpdateChannelSettings;
    service.chatClient = originalChatClient;
    service.botLogin = originalBotLogin;
    service.diagnosticQueue = Promise.resolve();
    service.outboundQueue = Promise.resolve();
    service.lastOutboundAt = 0;
    service.userCooldowns.clear();
    service.channelCommandCooldowns.clear();
    if (originalHomeChannel === undefined) delete process.env.TWITCH_BOT_HOME_CHANNEL;
    else process.env.TWITCH_BOT_HOME_CHANNEL = originalHomeChannel;
  }
});

test("announces joining a stream once within the persisted cooldown", async () => {
  const service = twitchChatBotService as unknown as TwitchChatBotServiceInternals;
  const originalRuntimeUpdateOne = TwitchBotRuntimeState.updateOne;
  const originalChannelUpdateOne = TwitchChannelBotSettings.updateOne;
  const originalAuditCreate = TwitchChatAuditEvent.create;
  const originalGetChannelSettings = service.getChannelSettings;
  const originalChatClient = service.chatClient;
  const originalHomeChannel = process.env.TWITCH_BOT_HOME_CHANNEL;
  const sentMessages: string[] = [];
  let lastJoinAnnouncementAt: Date | undefined;

  TwitchBotRuntimeState.updateOne = (async () => ({ acknowledged: true, matchedCount: 1, modifiedCount: 1 })) as unknown as typeof TwitchBotRuntimeState.updateOne;
  TwitchChannelBotSettings.updateOne = (async (_filter: unknown, update: { $set?: { lastJoinAnnouncementAt?: Date } }) => {
    lastJoinAnnouncementAt = update.$set?.lastJoinAnnouncementAt;
    return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
  }) as unknown as typeof TwitchChannelBotSettings.updateOne;
  TwitchChatAuditEvent.create = (async () => ({ _id: new Types.ObjectId() })) as unknown as typeof TwitchChatAuditEvent.create;
  service.getChannelSettings = async (channelName) => ({
    channelName,
    alertsEnabled: true,
    commandsEnabled: true,
    joinAnnouncementEnabled: true,
    lastJoinAnnouncementAt,
  });
  service.chatClient = {
    isConnected: true,
    currentChannels: ["#testchannel"],
    say: async (_channel, message) => {
      sentMessages.push(message);
    },
  };
  service.outboundQueue = Promise.resolve();
  service.lastOutboundAt = 0;
  process.env.TWITCH_BOT_HOME_CHANNEL = "vaarattu";

  try {
    await service.maybeAnnounceJoin("testchannel");
    await service.maybeAnnounceJoin("testchannel");
    await service.maybeAnnounceJoin("vaarattu");

    assert.deepEqual(sentMessages, ["SuomiWoW Bot is here! Type !commands or !komennot for features."]);
    assert.ok(lastJoinAnnouncementAt instanceof Date);
  } finally {
    TwitchBotRuntimeState.updateOne = originalRuntimeUpdateOne;
    TwitchChannelBotSettings.updateOne = originalChannelUpdateOne;
    TwitchChatAuditEvent.create = originalAuditCreate;
    service.getChannelSettings = originalGetChannelSettings;
    service.chatClient = originalChatClient;
    service.outboundQueue = Promise.resolve();
    service.lastOutboundAt = 0;
    if (originalHomeChannel === undefined) delete process.env.TWITCH_BOT_HOME_CHANNEL;
    else process.env.TWITCH_BOT_HOME_CHANNEL = originalHomeChannel;
  }
});

test("uses one stable representative for tracked Shared Chat channels", async () => {
  const service = twitchChatBotService as unknown as TwitchChatBotServiceInternals;
  const originalSessionCache = service.sharedChatSessionCache;
  const originalChannelMap = service.sharedChatChannelByBroadcasterId;
  const originalRepresentativeMap = service.sharedChatRepresentativeBySessionId;
  const originalSessions = service.sharedChatSessions;
  const originalGetChannelSettings = service.getChannelSettings;
  const originalHomeChannel = process.env.TWITCH_BOT_HOME_CHANNEL;
  const sharedSession = {
    sessionId: "shared-session-1",
    hostBroadcasterId: "broadcaster-beta",
    participantBroadcasterIds: ["broadcaster-alpha", "broadcaster-beta"],
  };

  service.sharedChatSessionCache = new Map(
    sharedSession.participantBroadcasterIds.map((broadcasterId) => [broadcasterId, { session: sharedSession, expiresAt: Date.now() + 60_000 }]),
  );
  service.sharedChatChannelByBroadcasterId = new Map();
  service.sharedChatRepresentativeBySessionId = new Map();
  service.sharedChatSessions = [];
  service.getChannelSettings = async (channelName) => ({
    channelName,
    alertsEnabled: channelName !== "alpha",
    commandsEnabled: true,
    joinAnnouncementEnabled: true,
  });
  process.env.TWITCH_BOT_HOME_CHANNEL = "vaarattu";

  try {
    const targets = [
      { channelName: "alpha", broadcasterId: "broadcaster-alpha" },
      { channelName: "beta", broadcasterId: "broadcaster-beta" },
    ];
    assert.deepEqual(await service.deduplicateSharedChatTargets(targets, true), ["beta"]);
    assert.equal(service.sharedChatSessions.length, 1);
    assert.deepEqual(service.sharedChatSessions[0].trackedChannels, ["alpha", "beta"]);
    assert.equal(service.sharedChatSessions[0].representativeChannel, "beta");

    assert.deepEqual(await service.deduplicateSharedChatTargets([targets[0]], false), ["beta"]);
    assert.equal(await service.isSharedChatSettingEnabled("beta", "alertsEnabled"), false);
  } finally {
    service.sharedChatSessionCache = originalSessionCache;
    service.sharedChatChannelByBroadcasterId = originalChannelMap;
    service.sharedChatRepresentativeBySessionId = originalRepresentativeMap;
    service.sharedChatSessions = originalSessions;
    service.getChannelSettings = originalGetChannelSettings;
    if (originalHomeChannel === undefined) delete process.env.TWITCH_BOT_HOME_CHANNEL;
    else process.env.TWITCH_BOT_HOME_CHANNEL = originalHomeChannel;
  }
});

test("deduplicates a Shared Chat message mirrored from the same source", () => {
  const service = twitchChatBotService as unknown as TwitchChatBotServiceInternals;
  const originalMessageKeys = service.sharedChatMessageKeys;
  service.sharedChatMessageKeys = new Map();
  const message = {
    sourceChannelId: "broadcaster-alpha",
    date: new Date("2026-08-31T12:00:00.000Z"),
    userInfo: { userId: "viewer-1" },
  };

  try {
    assert.equal(service.isDuplicateSharedChatMessage("viewer", "!best", message), false);
    assert.equal(service.isDuplicateSharedChatMessage("viewer", "!best", message), true);
  } finally {
    service.sharedChatMessageKeys = originalMessageKeys;
  }
});

test("records exact Twitch timeouts separately from permanent bans", async () => {
  const service = twitchChatBotService as unknown as TwitchChatBotServiceInternals;
  const originalRuntimeUpdateOne = TwitchBotRuntimeState.updateOne;
  const originalBotUserId = service.botUserId;
  const originalBansBotUserId = service.channelBansBotUserId;
  const originalChannelBans = service.channelBans;
  service.botUserId = "bot-user-1";
  service.channelBansBotUserId = "bot-user-1";
  service.channelBans = new Map();
  TwitchBotRuntimeState.updateOne = (async () => ({ acknowledged: true, matchedCount: 1, modifiedCount: 1 })) as unknown as typeof TwitchBotRuntimeState.updateOne;

  try {
    const beforeTimeout = Date.now();
    const timeout = await service.recordChannelBan("alpha", { restrictionType: "temporary", durationSeconds: 90 });
    assert.equal(timeout.reason, "timeout");
    assert.equal(timeout.restrictionType, "temporary");
    assert.equal(timeout.durationSeconds, 90);
    assert.ok(timeout.expiresAt);
    assert.ok(timeout.expiresAt.getTime() >= beforeTimeout + 90_000);
    assert.equal(timeout.nextRetryAt.getTime() - timeout.expiresAt.getTime(), 5000);

    const permanent = await service.recordChannelBan("beta", { restrictionType: "permanent" });
    assert.equal(permanent.reason, "permanent_ban");
    assert.equal(permanent.restrictionType, "permanent");
    assert.equal(permanent.durationSeconds, undefined);
    assert.equal(permanent.expiresAt, undefined);
  } finally {
    TwitchBotRuntimeState.updateOne = originalRuntimeUpdateOne;
    service.botUserId = originalBotUserId;
    service.channelBansBotUserId = originalBansBotUserId;
    service.channelBans = originalChannelBans;
  }
});
