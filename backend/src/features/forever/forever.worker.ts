import mongoose, { ClientSession } from "mongoose";
import { randomUUID } from "node:crypto";
import logger from "../../utils/logger";
import { ForeverCharacter, ForeverGuild, ForeverRequestLimit, ForeverWorker } from "./forever.models";
import { ArmoryError, fetchForeverCharacter, fetchForeverRoster, ForeverIdentity, ForeverMember, ForeverProfile } from "./forever-armory";
import { armoryQueueHealth, failureDelay, MINUTE, refreshDelay, validateProgress } from "./forever-policy";
import { visibleForeverCharacters } from "./forever-visibility";

const SPACING_MS = 500;
const IDLE_MS = 5_000;
const LEASE_MS = 90_000;
export async function initializeForever() {
  await Promise.all([ForeverCharacter.init(), ForeverGuild.init(), ForeverRequestLimit.init(), ForeverWorker.init()]);
  for (const id of ["armory", "twitch"]) {
    try { await ForeverWorker.updateOne({ _id: id }, { $setOnInsert: { nextRequestAt: new Date() } }, { upsert: true }); }
    catch (error) { if ((error as { code?: number }).code !== 11000) throw error; }
  }
}

async function fence(token: string, session: ClientSession) {
  const result = await ForeverWorker.updateOne({ _id: "armory", leaseToken: token, leaseUntil: { $gt: new Date() } },
    { $set: { leaseUntil: new Date(Date.now() + LEASE_MS) } }, { session });
  if (!result.matchedCount) throw new Error("Forever worker lease lost");
}

// Dependency boundary also lets tests exercise retries and approvals against a real database.
export class ForeverRunner {
  private timer?: NodeJS.Timeout;
  private active?: Promise<void>;
  private stopped = true;
  constructor(private readonly source = { character: fetchForeverCharacter, roster: fetchForeverRoster }) {}

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    const schedule = (delay = 0) => {
      if (this.stopped) return;
      this.timer = setTimeout(() => {
        let nextDelay = IDLE_MS;
        this.active = this.tick().then((wait) => { nextDelay = wait; })
          .catch(() => { logger.error("[Forever] Worker tick failed; persisted queue retained"); })
          .finally(() => { this.active = undefined; schedule(nextDelay); });
      }, delay);
    };
    schedule();
  }
  async stop() { this.stopped = true; clearTimeout(this.timer); await this.active; }

  async tick(): Promise<number> {
    const now = new Date(), token = randomUUID();
    const lease = await ForeverWorker.findOneAndUpdate({ _id: "armory", nextRequestAt: { $lte: now },
      $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lte: now } }],
    }, { $set: { leaseToken: token, leaseUntil: new Date(now.getTime() + LEASE_MS), lastTickAt: now } }, { returnDocument: "after" });
    if (!lease) return IDLE_MS;
    let nextRequestAt = new Date(Date.now() + SPACING_MS);
    try {
      const due = { $lte: now, $ne: null };
      const visible = await visibleForeverCharacters();
      const [priorityCharacter, scheduledCharacter, guild] = await Promise.all([
        ForeverCharacter.findOne({ ...visible, status: "tracked", refreshRequestedAt: { $ne: null } }).sort({ refreshRequestedAt: 1, _id: 1 }).lean(),
        ForeverCharacter.findOne({ ...visible, status: "tracked", nextFetchAt: due }).sort({ nextFetchAt: 1, _id: 1 }).lean(),
        ForeverGuild.findOne({ status: { $in: ["pending", "approved"] }, hidden: { $ne: true }, nextFetchAt: due }).sort({ nextFetchAt: 1, _id: 1 }).lean(),
      ]);
      const character = priorityCharacter || scheduledCharacter;
      const useGuild = !priorityCharacter && guild && (!character || guild.nextFetchAt! < character.nextFetchAt!);
      const job = useGuild ? guild : character;
      if (!job) {
        nextRequestAt = new Date(Date.now() + IDLE_MS);
        return IDLE_MS;
      }
      let profile: ForeverProfile | undefined, roster: ForeverMember[] | undefined, failure: ArmoryError | undefined;
      try {
        const identity = { region: job.region, slug: job.slug } as ForeverIdentity;
        // Space request starts, without adding another delay after a slow response.
        nextRequestAt = new Date(Date.now() + SPACING_MS);
        if (useGuild) roster = await this.source.roster(identity);
        else {
          profile = await this.source.character(identity);
          validateProgress(character!, profile);
        }
      } catch (error) { failure = error instanceof ArmoryError ? error : new ArmoryError("unavailable"); }
      const completedAt = new Date();
      const delay = failure ? failureDelay(job.failures, failure) : 0;
      const health = armoryQueueHealth(lease, `${useGuild ? "guild" : "character"}:${job._id}`, failure, completedAt.getTime());
      if (health.pauseMs) nextRequestAt = new Date(completedAt.getTime() + health.pauseMs);

      await mongoose.connection.transaction(async (session) => {
        await fence(token, session);
        const updateFailure = { $set: { lastAttemptAt: completedAt, errorCode: failure?.code,
          nextFetchAt: new Date(completedAt.getTime() + delay) }, $inc: { failures: 1 } };
        if (useGuild) {
          const current = await ForeverGuild.findById(job._id).session(session);
          if (current && !current.hidden && ["pending", "approved"].includes(current.status)) {
            if (failure) await ForeverGuild.updateOne({ _id: job._id }, updateFailure, { session });
            else {
              await ForeverGuild.updateOne({ _id: job._id }, { $set: { roster, lastAttemptAt: completedAt, lastFetchedAt: completedAt,
                failures: 0, nextFetchAt: current.status === "approved" ? new Date(completedAt.getTime() + 6 * 60 * MINUTE) : null },
                $unset: { errorCode: 1 } }, { session });
              if (current.status === "approved" && roster?.length) {
                // Only approved guilds can expand tracking. Never resume an explicit rejection/pause.
                await ForeverCharacter.bulkWrite(roster.map((member) => ({ updateOne: {
                  filter: { region: member.region, slug: member.slug },
                  update: { $setOnInsert: { region: member.region, slug: member.slug, source: "guild", status: "tracked", nextFetchAt: completedAt } }, upsert: true,
                } })), { session });
                await ForeverCharacter.updateMany({ region: current.region, slug: { $in: roster.map((member) => member.slug) }, status: "pending" },
                  { $set: { status: "tracked" } }, { session });
              }
            }
          }
        } else {
          // Clear only the request this fetch serves; a new request arriving in flight stays first.
          if (character?.refreshRequestedAt) await ForeverCharacter.updateOne({
            _id: job._id, refreshRequestedAt: character.refreshRequestedAt,
          }, { $unset: { refreshRequestedAt: 1 } }, { session });
          const current = await ForeverCharacter.findById(job._id).session(session);
          if (current?.status === "tracked") {
            if (failure) await ForeverCharacter.updateOne({ _id: job._id }, updateFailure, { session });
            else if (profile) {
              validateProgress(current, profile);
              const changed = current.level !== profile.level;
              const lastLevelAt = changed ? completedAt : current.lastLevelAt || completedAt;
              await ForeverCharacter.updateOne({ _id: job._id }, { $set: { ...profile,
                lastLevelAt, lastAttemptAt: completedAt, lastFetchedAt: completedAt, failures: 0,
                nextFetchAt: new Date(completedAt.getTime() + refreshDelay(profile.level, lastLevelAt)),
              }, $unset: { errorCode: 1 }, ...(changed ? { $push: { history: {
                level: profile.level, observedAt: completedAt, sourceUpdatedAt: profile.sourceUpdatedAt,
              } } } : {}) }, { session });
              if (profile.guild) await ForeverGuild.updateOne({ region: profile.guild.region, slug: profile.guild.slug },
                { $set: { name: profile.guild.name }, $setOnInsert: { status: "pending", nextFetchAt: completedAt } }, { upsert: true, session });
            }
          }
        }
        await ForeverWorker.updateOne({ _id: "armory", leaseToken: token }, {
          $set: { nextRequestAt, failedJobs: health.failedJobs, failureWindowStartedAt: health.failureWindowStartedAt,
            ...(!failure ? { lastSuccessAt: completedAt } : {}),
            ...(health.pauseMs ? { errorCode: failure!.code } : {}),
          },
          ...(!health.pauseMs ? { $unset: { errorCode: 1 } } : {}),
        }, { session });
      });
    } finally {
      await ForeverWorker.updateOne({ _id: "armory", leaseToken: token }, {
        $max: { nextRequestAt }, $unset: { leaseToken: 1, leaseUntil: 1 },
      });
    }
    return Math.max(0, nextRequestAt.getTime() - Date.now());
  }
}
export default new ForeverRunner();
