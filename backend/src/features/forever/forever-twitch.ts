import mongoose from "mongoose";
import { randomUUID } from "node:crypto";
import twitchService from "../../services/twitch.service";
import logger from "../../utils/logger";
import { ForeverCharacter, ForeverWorker } from "./forever.models";
import { visibleForeverCharacters } from "./forever-visibility";

// Store logins, never arbitrary links. Empty values explicitly remove an association.
export function normalizeTwitchChannel(value: unknown): string | null {
  if (value === null || value === "") return null;
  if (typeof value !== "string") throw new Error("invalid_twitch");
  let channel = value.trim().toLowerCase();
  if (!channel) return null;
  if (/^(www\.)?twitch\.tv\//.test(channel)) channel = `https://${channel}`;
  if (/^https:\/\//.test(channel)) {
    const url = new URL(channel);
    if (!["twitch.tv", "www.twitch.tv"].includes(url.hostname) || url.port || url.username || url.password || url.search || url.hash) throw new Error("invalid_twitch");
    channel = url.pathname.replace(/^\//, "").replace(/\/$/, "");
  }
  if (!/^[a-z0-9_]{3,25}$/.test(channel)) throw new Error("invalid_twitch");
  return channel;
}

// Independent from the Armory queue: a Blizzard outage must not freeze live status.
export class ForeverTwitchRunner {
  private timer?: NodeJS.Timeout;
  private active?: Promise<void>;
  private stopped = true;
  constructor(private readonly source: Pick<typeof twitchService, "isEnabled" | "getStreamStatus"> = twitchService) {}
  start() {
    if (!this.stopped || !this.source.isEnabled()) return;
    this.stopped = false;
    const schedule = () => {
      if (this.stopped) return;
      this.timer = setTimeout(() => {
        this.active = this.tick().catch(() => { logger.error("[Forever] Twitch status check failed"); })
          .finally(() => { this.active = undefined; schedule(); });
      }, 15_000);
    };
    schedule();
  }
  async stop() { this.stopped = true; clearTimeout(this.timer); await this.active; }
  async tick() {
    if (!this.source.isEnabled()) return;
    const now = new Date(), token = randomUUID();
    const lease = await ForeverWorker.findOneAndUpdate({ _id: "twitch", nextRequestAt: { $lte: now },
      $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lte: now } }],
    }, { $set: { leaseToken: token, leaseUntil: new Date(now.getTime() + 90_000), lastTickAt: now } });
    if (!lease) return;
    let nextRequestAt = new Date(Date.now() + 15_000);
    try {
      // Twenty logins fit Twitch's default response page, even if every channel is live.
      const visible = await visibleForeverCharacters();
      const due = await ForeverCharacter.find({ ...visible, status: "tracked", twitchChannel: { $type: "string", $ne: "" },
        $or: [{ twitchNextCheckAt: { $exists: false } }, { twitchNextCheckAt: { $lte: now } }],
      }).sort({ twitchNextCheckAt: 1, _id: 1 }).limit(20).select("twitchChannel").lean();
      const channels = [...new Set(due.map((character) => character.twitchChannel!))];
      if (!channels.length) return;
      const statuses = await this.source.getStreamStatus(channels, AbortSignal.timeout(20_000));
      const checkedAt = new Date();
      await mongoose.connection.transaction(async (session) => {
        const fence = await ForeverWorker.updateOne({ _id: "twitch", leaseToken: token, leaseUntil: { $gt: checkedAt } },
          { $set: { lastSuccessAt: checkedAt }, $unset: { errorCode: 1 } }, { session });
        if (!fence.matchedCount) throw new Error("Forever Twitch lease lost");
        for (const channel of channels) {
          const status = statuses.get(channel);
          if (!status) throw new Error("Incomplete Twitch status response");
          // Matching the channel prevents an in-flight result from overwriting an admin edit.
          await ForeverCharacter.updateMany({ ...visible, status: "tracked", twitchChannel: channel }, { $set: {
            twitchIsLive: status.isLive, twitchCheckedAt: checkedAt, twitchNextCheckAt: new Date(checkedAt.getTime() + 120_000),
          } }, { session });
        }
      });
    } catch {
      nextRequestAt = new Date(Date.now() + 120_000);
      // Retain the last observation; the UI expires its live badge after five minutes.
      await ForeverWorker.updateOne({ _id: "twitch", leaseToken: token }, { $set: { errorCode: "twitch_unavailable" } });
    } finally {
      await ForeverWorker.updateOne({ _id: "twitch", leaseToken: token }, {
        $max: { nextRequestAt }, $unset: { leaseToken: 1, leaseUntil: 1 },
      });
    }
  }
}
export default new ForeverTwitchRunner();
