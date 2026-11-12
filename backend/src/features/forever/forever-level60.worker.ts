import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import logger from "../../utils/logger";
import { ArmoryError, fetchForeverAchievements } from "./forever-armory";
import { level60Classes, level60Estimate, level60Window } from "./forever-level60";
import { ForeverCharacter, ForeverWorker } from "./forever.models";
import { visibleForeverCharacters } from "./forever-visibility";

const INTERVAL = 10_000;
const SIX_HOURS = 6 * 60 * 60_000;

export class ForeverLevel60Runner {
  private timer?: NodeJS.Timeout;
  private active?: Promise<void>;
  constructor(private readonly fetchAchievements = fetchForeverAchievements) {}

  start() {
    if (this.timer || !process.env.BLIZZARD_CLIENT_ID || !process.env.BLIZZARD_CLIENT_SECRET) return;
    const poll = () => {
      if (this.active) return;
      this.active = this.tick().catch(() => { logger.error("[Forever] Level 60 milestone check failed"); })
        .finally(() => { this.active = undefined; });
    };
    this.timer = setInterval(poll, INTERVAL);
    poll();
  }

  async stop() {
    clearInterval(this.timer);
    this.timer = undefined;
    await this.active;
  }

  async tick() {
    const now = new Date(), token = randomUUID();
    const lease = await ForeverWorker.findOneAndUpdate({
      _id: "level60", nextRequestAt: { $lte: now },
      $or: [{ leaseUntil: null }, { leaseUntil: { $lte: now } }],
    }, { $set: { leaseToken: token, leaseUntil: new Date(now.getTime() + 90_000), lastTickAt: now } });
    if (!lease) return;
    let nextRequestAt = new Date(now.getTime() + INTERVAL);
    try {
      const eligible = { region: "eu", status: "tracked", level: 60 } as const;
      // Missing = new or pre-existing 60, date = retry, explicit null = finished.
      const character = await ForeverCharacter.findOne({ ...eligible, ...await visibleForeverCharacters(),
        className: { $in: level60Classes },
        $or: [{ level60NextCheckAt: { $exists: false } }, { level60NextCheckAt: { $lte: now } }],
      }).sort({ level60NextCheckAt: 1, _id: 1 }).select("slug className history lastLevelAt profileLevel sourceUpdatedAt").lean();
      if (!character) return;

      const window = character.lastLevelAt && level60Window(character.history, character.lastLevelAt, character);
      let estimate: Date | null | undefined = null, retryAt: Date | null = null;
      let failure: ArmoryError | undefined;
      if (window) {
        try {
          estimate = level60Estimate(await this.fetchAchievements(character.slug), character.slug, character.className!, window);
          if (estimate === undefined) retryAt = new Date(Date.now() + SIX_HOURS);
        } catch (error) {
          failure = error instanceof ArmoryError ? error : new ArmoryError("unavailable");
          retryAt = new Date(Date.now() + Math.max(failure.retryAfterMs, failure.status === 404 ? SIX_HOURS : 15 * 60_000));
          if (failure.status !== 404 || failure.retryAfterMs) {
            nextRequestAt = new Date(Date.now() + Math.max(failure.retryAfterMs, 2 * 60_000));
          }
        }
      }

      await mongoose.connection.transaction(async session => {
        const finished = new Date();
        const fence = await ForeverWorker.updateOne({ _id: "level60", leaseToken: token, leaseUntil: { $gt: finished } },
          failure ? { $set: { errorCode: failure.code } } : { $set: { lastSuccessAt: finished }, $unset: { errorCode: 1 } }, { session });
        if (!fence.matchedCount) return;
        await ForeverCharacter.updateOne({ _id: character._id, ...eligible, ...await visibleForeverCharacters(),
          slug: character.slug, className: character.className, lastLevelAt: character.lastLevelAt,
          profileLevel: character.profileLevel ?? null, sourceUpdatedAt: character.sourceUpdatedAt ?? null,
        }, { $set: { level60NextCheckAt: retryAt, ...(estimate ? { estimatedLevel60At: estimate } : {}) } }, { session });
      });
    } finally {
      await ForeverWorker.updateOne({ _id: "level60", leaseToken: token },
        { $max: { nextRequestAt }, $unset: { leaseToken: 1, leaseUntil: 1 } });
    }
  }
}

export default new ForeverLevel60Runner();
