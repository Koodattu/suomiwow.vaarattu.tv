import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after, before } from "node:test";
import mongoose from "mongoose";
import Guild from "../src/models/Guild";
import TwitchChannelBotSettings from "../src/models/TwitchChannelBotSettings";
import twitchChatBotService from "../src/services/twitch-chat-bot.service";

const database = `twitch_join_test_${randomUUID()}`;
const hour = 60 * 60 * 1000;
const channel = "raidchannel";
const streamStartedAt = new Date("2026-11-15T12:00:00Z");

interface JoinBot {
  maybeAnnounceJoin(channel: string): Promise<void>;
  queueSay(channel: string, message: string): Promise<void>;
}

function rejoin(channelName: string, send: JoinBot["queueSay"]): Promise<void> {
  const Bot = twitchChatBotService.constructor as new () => JoinBot;
  const bot = new Bot();
  bot.queueSay = send;
  return bot.maybeAnnounceJoin(channelName);
}

before(async () => {
  await mongoose.connect(`mongodb://127.0.0.1:27142/${database}?directConnection=true`, {
    autoCreate: false, autoIndex: false, serverSelectionTimeoutMS: 5000,
  });
  await TwitchChannelBotSettings.createIndexes();
  await Guild.collection.insertOne({
    name: "Raid guild", isCurrentlyRaiding: true,
    streamers: [{ channelName: channel, isLive: true, isPlayingWoW: true, streamStartedAt }],
  });
});

after(async () => {
  if (mongoose.connection.name === database) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

test("restarts and competing joins share one greeting per stream and a 16-hour channel cooldown", async (t) => {
  const messages: string[] = [];
  const join = () => rejoin(channel, async (name) => { messages.push(name); });

  const firstGreeting = streamStartedAt.getTime() + hour;
  t.mock.timers.enable({ apis: ["Date"], now: firstGreeting });
  await Promise.all(Array.from({ length: 8 }, join));
  assert.deepEqual(messages, [channel]);
  const first = await TwitchChannelBotSettings.findOne({ channelName: channel }).orFail().lean();
  assert.equal(first.lastJoinAnnouncementAt?.getTime(), firstGreeting);

  await Guild.updateOne({}, { $set: { "streamers.0.streamStartedAt": new Date(firstGreeting + 2 * hour) } });
  t.mock.timers.setTime(firstGreeting + 16 * hour - 1);
  await join();
  assert.deepEqual(messages, [channel]);

  t.mock.timers.setTime(firstGreeting + 16 * hour);
  await Promise.all([join(), join()]);
  assert.deepEqual(messages, [channel, channel]);

  t.mock.timers.setTime(firstGreeting + 36 * hour);
  await join();
  assert.deepEqual(messages, [channel, channel], "the same long stream was already greeted");
});

test("a stream without a start time uses the cooldown even when delivery is uncertain", async (t) => {
  const name = "legacychannel";
  const now = Date.now();
  t.mock.timers.enable({ apis: ["Date"], now });
  await Guild.updateOne({ name: "Raid guild" }, { $push: { streamers: { channelName: name, isLive: true, isPlayingWoW: true } } });
  await TwitchChannelBotSettings.create({ channelName: name, commandsEnabled: false, lastJoinAnnouncementAt: new Date(now - 17 * hour) });

  const send = t.mock.fn(async () => { throw new Error("Chat disconnected during send"); });
  await rejoin(name, send);
  await rejoin(name, send);
  assert.equal(send.mock.callCount(), 1);
  const settings = await TwitchChannelBotSettings.findOne({ channelName: name }).orFail().lean();
  assert.equal(settings.lastJoinAnnouncementAt?.getTime(), now);
  assert.equal(settings.commandsEnabled, false);
});
