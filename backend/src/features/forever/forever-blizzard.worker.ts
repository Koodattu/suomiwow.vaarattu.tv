import { createHash, randomUUID } from "node:crypto";
import logger from "../../utils/logger";
import { ArmoryError, fetchForeverAchievements, fetchForeverItem, fetchForeverStatistics, type ForeverItemData } from "./forever-armory";
import { mergeBossKills, mergeRaidCriteria, parseAchievements, parseStatistics, type RaidCriterionSeen, type StoredBoss } from "./forever-details";
import { ForeverCharacterDetail, ForeverItem } from "./forever-details.models";
import { ForeverCharacter, ForeverWorker } from "./forever.models";
import { visibleForeverCharacters } from "./forever-visibility";

// The official profile API is a separate quota from the Armory website. Each four-second turn
// checks one character (two requests) and resolves up to two queued items (one or two requests
// each): at most about 5,400 requests an hour, 15% of Blizzard's 36,000-per-hour client limit.
// Item lookups are one-off: each resolved level is kept permanently.
// Characters go first so a backlog of new items never delays raid kill tracking.
const INTERVAL = 4_000;
const HOUR = 3600_000;
export const MIN_STATS_LEVEL = 40;
// Raid lockouts reset weekly, so twelve hours observes every raid kill with margin.
export function statsInterval(level: number) { return level >= 60 ? 12 * HOUR : 72 * HOUR; }
function phase(slug: string) { return createHash("sha256").update(slug).digest().readUInt32BE(0) % HOUR; }
export function nextStatsCheckAt(slug: string, level: number, now = Date.now()) {
  return new Date(now + statsInterval(level) + phase(slug));
}
const ITEM_RETRY = 7 * 24 * HOUR;
const ITEMS_PER_TURN = 2;

type Fetchers = {
  statistics: (slug: string) => Promise<unknown>;
  achievements: (slug: string) => Promise<unknown>;
  item: (id: number, expectedName?: string | null) => Promise<ForeverItemData | null>;
};

export class ForeverBlizzardRunner {
  private timer?: NodeJS.Timeout;
  private active?: Promise<void>;
  constructor(private readonly fetch: Fetchers = { statistics: fetchForeverStatistics, achievements: fetchForeverAchievements, item: fetchForeverItem }) {}

  start() {
    if (this.timer || !process.env.BLIZZARD_CLIENT_ID || !process.env.BLIZZARD_CLIENT_SECRET) return;
    const poll = () => {
      if (this.active) return;
      this.active = this.tick().catch(error => { logger.error("[Forever] Blizzard profile data check failed", error); })
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
      _id: "blizzard", nextRequestAt: { $lte: now }, $or: [{ leaseUntil: null }, { leaseUntil: { $lte: now } }],
    }, { $set: { leaseToken: token, leaseUntil: new Date(now.getTime() + 90_000), lastTickAt: now } });
    if (!lease) return;
    let nextRequestAt = new Date(now.getTime() + INTERVAL);
    let failure: ArmoryError | undefined;
    try {
      failure = await this.checkCharacter(now);
      for (let index = 0; index < ITEMS_PER_TURN && !failure; index++) {
        const item = await ForeverItem.findOne({ nextCheckAt: { $type: "date", $lte: now } }).sort({ nextCheckAt: 1, _id: 1 }).lean();
        if (!item) break;
        failure = await this.resolveItem(item._id as number, item.name ?? null, item.misses ?? 0);
      }
      if (failure && (failure.retryAfterMs || [429, 401, 403].includes(failure.status))) {
        nextRequestAt = new Date(Date.now() + Math.max(failure.retryAfterMs, 2 * 60_000));
      }
      await ForeverWorker.updateOne({ _id: "blizzard", leaseToken: token },
        failure ? { $set: { errorCode: failure.code } } : { $set: { lastSuccessAt: new Date() }, $unset: { errorCode: 1 } });
    } finally {
      await ForeverWorker.updateOne({ _id: "blizzard", leaseToken: token }, { $max: { nextRequestAt }, $unset: { leaseToken: 1, leaseUntil: 1 } });
    }
  }

  private async resolveItem(id: number, name: string | null, misses: number): Promise<ArmoryError | undefined> {
    try {
      const data = await this.fetch.item(id, name);
      const checkedAt = new Date();
      await ForeverItem.updateOne({ _id: id }, data
        ? { $set: { level: data.level, namespace: data.namespace, checkedAt, nextCheckAt: null, misses: 0 } }
        : { $set: { checkedAt, nextCheckAt: new Date(checkedAt.getTime() + ITEM_RETRY) }, $inc: { misses: 1 } });
      return undefined;
    } catch (error) {
      const failure = error instanceof ArmoryError ? error : new ArmoryError("unavailable");
      await ForeverItem.updateOne({ _id: id }, { $set: { nextCheckAt: new Date(Date.now() + Math.min(ITEM_RETRY, HOUR * 2 ** Math.min(misses, 6))) },
        $inc: { misses: 1 } });
      return failure;
    }
  }

  private async checkCharacter(now: Date): Promise<ArmoryError | undefined> {
    const eligible = { region: "eu", status: "tracked", level: { $gte: MIN_STATS_LEVEL } } as const;
    const character = await ForeverCharacter.findOne({ ...eligible, ...await visibleForeverCharacters(),
      $or: [{ statsNextCheckAt: { $exists: false } }, { statsNextCheckAt: null }, { statsNextCheckAt: { $lte: now } }],
    }).sort({ statsNextCheckAt: 1, _id: 1 }).select("slug level guild statsFailures").lean();
    if (!character) return undefined;
    const level = character.level ?? MIN_STATS_LEVEL;
    try {
      const statistics = parseStatistics(await this.fetch.statistics(character.slug), character.slug);
      const achievements = parseAchievements(await this.fetch.achievements(character.slug), character.slug);
      const fetchedAt = new Date();
      const previous = await ForeverCharacterDetail.findById(character._id).select("blizzard.bosses blizzard.raidCriteria blizzard.fetchedAt").lean();
      const bosses = mergeBossKills((previous?.blizzard?.bosses ?? []) as StoredBoss[], statistics.bosses, character.guild?.slug ?? null);
      const raidCriteria = mergeRaidCriteria((previous?.blizzard?.raidCriteria ?? []) as RaidCriterionSeen[], achievements.raidCriteria,
        fetchedAt, previous?.blizzard?.fetchedAt ?? null);
      await ForeverCharacterDetail.updateOne({ _id: character._id }, { $set: { region: "eu", slug: character.slug, blizzard: {
        fetchedAt, achievementPoints: achievements.points, achievementCount: achievements.achievements.length, records: statistics.records,
        achievements: achievements.achievements, bosses, raidCriteria, raidClears: achievements.raidClears,
      } } }, { upsert: true });
      await ForeverCharacter.updateOne({ _id: character._id }, { $set: { statsNextCheckAt: nextStatsCheckAt(character.slug, level, fetchedAt.getTime()), statsFailures: 0 } });
      return undefined;
    } catch (error) {
      const failure = error instanceof ArmoryError ? error : new ArmoryError("unavailable");
      const failures = (character.statsFailures ?? 0) + 1;
      // A missing profile (renamed, transferred or not yet published) waits a day; other errors back off from an hour.
      const delay = failure.status === 404 ? 24 * HOUR : Math.min(24 * HOUR, Math.max(failure.retryAfterMs, HOUR * 2 ** Math.min(failures - 1, 5)));
      await ForeverCharacter.updateOne({ _id: character._id }, { $set: { statsNextCheckAt: new Date(Date.now() + delay), statsFailures: failures } });
      return failure.status === 404 ? undefined : failure;
    }
  }
}

export default new ForeverBlizzardRunner();
