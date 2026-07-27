import assert from "node:assert/strict";
import test from "node:test";
import { Types } from "mongoose";
import Guild from "../src/models/Guild";
import twitchChatBotService from "../src/services/twitch-chat-bot.service";

type TwitchChatBotServiceInternals = {
  findDesiredChannels(): Promise<string[]>;
  findDesiredChannelsForGuild(guildId: Types.ObjectId): Promise<string[]>;
  isChannelAllowedToChat(channelName: string): Promise<boolean>;
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
