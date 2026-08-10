import assert from "node:assert/strict";
import test from "node:test";
import { Types } from "mongoose";
import Guild from "../src/models/Guild";
import TwitchBotRuntimeState from "../src/models/TwitchBotRuntimeState";
import twitchChatBotService from "../src/services/twitch-chat-bot.service";
import twitchChatCommandService from "../src/services/twitch-chat-command.service";

type TwitchChatBotServiceInternals = {
  findDesiredChannels(): Promise<string[]>;
  findDesiredChannelsForGuild(guildId: Types.ObjectId): Promise<string[]>;
  isChannelAllowedToChat(channelName: string): Promise<boolean>;
  handleMessage(channel: string, user: string, text: string): Promise<void>;
  getSettings: typeof twitchChatBotService.getSettings;
  chatClient: { isConnected: boolean; currentChannels: string[]; say(channel: string, message: string): Promise<void> } | null;
  connected: boolean;
  botLogin: string | null;
  diagnosticQueue: Promise<void>;
  outboundQueue: Promise<void>;
  lastOutboundAt: number;
  lastInboundDiagnosticAt: number;
  userCooldowns: Map<string, number>;
  channelCommandCooldowns: Map<string, number>;
};

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
    assert.equal(guildSelection, "streamers.channelName streamers.isLive streamers.isPlayingWoW");

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

test("records whether an incoming ! command was replied to or unsupported", async () => {
  const service = twitchChatBotService as unknown as TwitchChatBotServiceInternals;
  const originalRuntimeUpdateOne = TwitchBotRuntimeState.updateOne;
  const originalCommandHandle = twitchChatCommandService.handle;
  const originalGetSettings = service.getSettings;
  const originalChatClient = service.chatClient;
  const originalConnected = service.connected;
  const originalBotLogin = service.botLogin;
  const originalHomeChannel = process.env.TWITCH_BOT_HOME_CHANNEL;
  const runtimeUpdates: Array<Record<string, unknown>> = [];
  const sentMessages: Array<{ channel: string; message: string }> = [];

  TwitchBotRuntimeState.updateOne = (async (_filter: unknown, update: { $set?: Record<string, unknown> }) => {
    runtimeUpdates.push(update.$set || {});
    return { acknowledged: true, matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
  }) as unknown as typeof TwitchBotRuntimeState.updateOne;
  twitchChatCommandService.handle = (async () => "Test reply") as typeof twitchChatCommandService.handle;
  service.getSettings = async () => ({
    eventPublishingEnabled: true,
    eventTypes: [],
    difficulties: [],
    includeUrl: false,
    messageTemplates: { bossKill: "", bestPull: "", progressUpdate: "" },
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
  service.diagnosticQueue = Promise.resolve();
  service.outboundQueue = Promise.resolve();
  service.lastOutboundAt = 0;
  service.lastInboundDiagnosticAt = 0;
  service.userCooldowns.clear();
  service.channelCommandCooldowns.clear();
  process.env.TWITCH_BOT_HOME_CHANNEL = "vaarattu";

  try {
    await service.handleMessage("#vaarattu", "viewer", "!best");
    await service.handleMessage("#vaarattu", "viewer", "!doesnotexist");
    await service.diagnosticQueue;

    assert.deepEqual(sentMessages, [{ channel: "vaarattu", message: "Test reply" }]);
    assert.deepEqual(
      runtimeUpdates.map((update) => update.lastCommandOutcome).filter(Boolean),
      ["received", "replied", "unsupported"],
    );
    assert.ok(runtimeUpdates.some((update) => update.lastInboundChannel === "vaarattu"));
    assert.ok(runtimeUpdates.some((update) => update.lastCommandName === "doesnotexist" && update.lastCommandOutcome === "unsupported"));
  } finally {
    TwitchBotRuntimeState.updateOne = originalRuntimeUpdateOne;
    twitchChatCommandService.handle = originalCommandHandle;
    service.getSettings = originalGetSettings;
    service.chatClient = originalChatClient;
    service.connected = originalConnected;
    service.botLogin = originalBotLogin;
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
