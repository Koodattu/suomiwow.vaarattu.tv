import mongoose, { ClientSession } from "mongoose";
import { randomUUID } from "node:crypto";
import logger from "../../utils/logger";
import { ForeverCharacter, ForeverGuild, ForeverRequestLimit, ForeverWorker } from "./forever.models";
import { ArmoryError, fetchForeverCharacter, fetchForeverRoster, ForeverIdentity, ForeverMember, ForeverProfile } from "./forever-armory";
import { armoryQueueHealth, failureDelay, lowLevelCharacters, LOW_LEVEL_RECHECK_INTERVAL, MIN_PROFILE_LEVEL, nextProfileAuditAt, nextRosterFetchAt, profileFetchEligibility, profileComparison, refreshDelay, validateProgress } from "./forever-policy";
import { visibleForeverCharacters } from "./forever-visibility";
import { applyApprovedRoster, releaseRosterCoverage, scheduleUncoveredLowLevels } from "./forever-roster-sync";
import { foreverSeedRecords } from "./forever-seed";
import { confirmedGuildRuleset } from "./forever-guild-ruleset";

const SPACING_MS = 500;
const IDLE_MS = 5_000;
const LEASE_MS = 90_000;
export async function initializeForever() {
  await Promise.all([ForeverCharacter.init(), ForeverGuild.init(), ForeverRequestLimit.init(), ForeverWorker.init()]);
  for (const id of ["armory", "twitch"]) {
    try { await ForeverWorker.updateOne({ _id: id }, { $setOnInsert: { nextRequestAt: new Date() } }, { upsert: true }); }
    catch (error) { if ((error as { code?: number }).code !== 11000) throw error; }
  }
  // Existing seed names can have been imported by a guild before seeding.
  // Mark their independent provenance without resuming pauses or changing history.
  await ForeverCharacter.updateMany({ region: "eu", slug: { $in: foreverSeedRecords().map(record => record.slug) }, independentlyTracked: { $ne: true } },
    { $set: { independentlyTracked: true } }, { timestamps: false });
  await ForeverCharacter.updateMany({ source: "proposal", status: "tracked", independentlyTracked: { $exists: false } },
    { $set: { independentlyTracked: true } }, { timestamps: false });
  await ForeverCharacter.updateMany({ $and: [lowLevelCharacters, { rosterCoverageUntil: { $gt: new Date() } }] },
    { $set: { nextFetchAt: null, failures: 0 }, $unset: { errorCode: 1, refreshRequestedAt: 1, refreshQueuedAt: 1, lowLevelRecheck: 1 } }, { timestamps: false });
  const legacyGuilds = await ForeverGuild.find({ status: "approved", hidden: { $ne: true }, failures: 0, rosterPollingVersion: { $ne: 1 } }).select("region slug").lean();
  for (const guild of legacyGuilds) await ForeverGuild.updateOne({ _id: guild._id, failures: 0, rosterPollingVersion: { $ne: 1 } },
    { $set: { rosterPollingVersion: 1, nextFetchAt: nextRosterFetchAt(guild) } });
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
      await releaseRosterCoverage({ rosterCoverageUntil: { $lte: now, $ne: null } }, now);
      await scheduleUncoveredLowLevels(now);
      const visible = await visibleForeverCharacters();
      const baseCharacterDue = { ...visible, status: "tracked" as const, nextFetchAt: due };
      const characterDue = { ...baseCharacterDue, ...profileFetchEligibility };
      const firstProfile = { profileFetchedAt: null, sourceUpdatedAt: null };
      const guildDue = { status: { $in: ["pending", "approved"] as const }, hidden: { $ne: true }, nextFetchAt: due };
      const [priorityCharacter, unclassifiedCharacter, newCharacter, regularCharacter, newGuild, regularGuild] = await Promise.all([
        ForeverCharacter.findOne({ ...visible, ...profileFetchEligibility, status: "tracked", refreshRequestedAt: { $ne: null } }).sort({ refreshRequestedAt: 1, _id: 1 }).lean(),
        ForeverCharacter.findOne({ $and: [characterDue, firstProfile, { ruleset: { $in: [null, "", "Unknown"] } }] }).sort({ nextFetchAt: 1, _id: 1 }).lean(),
        ForeverCharacter.findOne({ ...characterDue, ...firstProfile }).sort({ nextFetchAt: 1, _id: 1 }).lean(),
        ForeverCharacter.findOne({ $and: [baseCharacterDue, { $or: [
          { $and: [profileFetchEligibility, { $or: [{ profileFetchedAt: { $ne: null } }, { sourceUpdatedAt: { $ne: null } }] }] },
          { lowLevelRecheck: true, rosterCoverageUntil: null },
        ] }] }).sort({ nextFetchAt: 1, _id: 1 }).lean(),
        ForeverGuild.findOne({ ...guildDue, lastFetchedAt: null }).sort({ nextFetchAt: 1, _id: 1 }).lean(),
        ForeverGuild.findOne({ ...guildDue, lastFetchedAt: { $ne: null } }).sort({ nextFetchAt: 1, _id: 1 }).lean(),
      ]);
      // Two new-character turns favor missing rulesets, the third serves any
      // first profile, and the fourth reserves an existing profile refresh.
      // All automatic lanes obey due dates, including upstream-error backoff.
      const newCharacterTurns = lease.consecutiveNewCharacters ?? 0;
      const firstCharacter = (newCharacterTurns < 2 ? unclassifiedCharacter : null) || newCharacter;
      const character = priorityCharacter || (newCharacterTurns < 3 ? firstCharacter || regularCharacter : regularCharacter || firstCharacter);
      const guild = (lease.consecutiveNewGuilds ?? 0) < 3 ? newGuild || regularGuild : regularGuild || newGuild;
      // A due roster updates a whole guild. Do not bury it behind thousands of
      // overdue individual jobs. Reserve at least every fourth turn for an
      // eligible character even during guild outages; instant refresh wins.
      const useGuild = !priorityCharacter && guild && (!character || (lease.consecutiveGuilds ?? 0) < 3);
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
          if (character!.lowLevelRecheck && profile.level < MIN_PROFILE_LEVEL) throw new ArmoryError("not_found", 404);
          validateProgress({ level: character!.profileLevel ?? (character!.rosterObservedAt ? undefined : character!.level),
            sourceUpdatedAt: character!.sourceUpdatedAt }, profile);
        }
      } catch (error) { failure = error instanceof ArmoryError ? error : new ArmoryError("unavailable"); }
      const completedAt = new Date();
      const delay = failure ? Math.max(failureDelay(job.failures, failure),
        !useGuild && character!.lowLevelRecheck ? LOW_LEVEL_RECHECK_INTERVAL : 0) : 0;
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
                failures: 0, rosterPollingVersion: 1,
                nextFetchAt: current.status === "approved" ? nextRosterFetchAt(current, completedAt.getTime()) : null },
                $unset: { errorCode: 1 } }, { session });
              if (current.status === "approved") await applyApprovedRoster(current, roster!, completedAt, session);
            }
          }
        } else {
          // Clear only the request this fetch serves; a new request arriving in flight stays first.
          if (character?.refreshRequestedAt) await ForeverCharacter.updateOne({
            _id: job._id, refreshRequestedAt: character.refreshRequestedAt,
          }, { $unset: { refreshRequestedAt: 1 } }, { session });
          if (character?.refreshQueuedAt) await ForeverCharacter.updateOne({ _id: job._id, refreshQueuedAt: character.refreshQueuedAt },
            { $unset: { refreshQueuedAt: 1 } }, { session });
          const current = await ForeverCharacter.findOne({ _id: job._id, ...await visibleForeverCharacters() }).session(session);
          if (current?.status === "tracked") {
            if (failure) await ForeverCharacter.updateOne({ _id: job._id }, updateFailure, { session });
            else if (profile) {
              validateProgress({ level: current.profileLevel ?? (current.rosterObservedAt ? undefined : current.level), sourceUpdatedAt: current.sourceUpdatedAt }, profile);
              const changed = profile.level > (current.level ?? 0);
              const lastLevelAt = changed ? completedAt : current.lastLevelAt || completedAt;
              let covered = !!current.rosterCoverageUntil && current.rosterCoverageUntil > completedAt &&
                current.rosterGuildSlug === profile.guild?.slug;
              if (current.rosterObservedAt && current.rosterLevel != null && current.rosterGuildSlug === profile.guild?.slug) {
                const comparison = profileComparison(current.rosterLevel, profile, current.rosterObservedAt);
                await ForeverGuild.updateOne({ region: current.region, slug: current.rosterGuildSlug }, {
                  $inc: { profileComparisons: 1, profileAheadCount: Number(comparison.profileAhead), rosterAheadCount: Number(comparison.rosterAhead) },
                  $set: { lastComparedAt: completedAt },
                }, { session });
                if (comparison.profileAhead) {
                  covered = false;
                  await releaseRosterCoverage({ _id: current._id }, completedAt, session);
                }
              }
              const keepGuildClassification = current.rulesetInferredFromGuild &&
                (profile.ruleset === "Unknown" || !["Alliance", "Horde"].includes(profile.faction));
              await ForeverCharacter.updateOne({ _id: job._id }, { $set: { ...profile,
                ...(keepGuildClassification ? { faction: current.faction, ruleset: current.ruleset } : {}),
                level: Math.max(profile.level, current.level ?? 0), profileLevel: profile.level, profileFetchedAt: completedAt,
                lastLevelAt, lastAttemptAt: completedAt, lastFetchedAt: completedAt, failures: 0,
                nextFetchAt: current.refreshRequestedAt || current.refreshQueuedAt ? completedAt
                  : covered ? nextProfileAuditAt(current, completedAt) : new Date(completedAt.getTime() + refreshDelay(Math.max(profile.level, current.level ?? 0), lastLevelAt)),
              }, $unset: { errorCode: 1, ...(!keepGuildClassification ? { rulesetInferredFromGuild: 1 } : {}),
                lowLevelRecheck: 1, ...(!covered ? { rosterCoverageUntil: 1 } : {}) }, ...(changed ? { $push: { history: {
                level: profile.level, observedAt: completedAt, sourceUpdatedAt: profile.sourceUpdatedAt, source: "character",
              } } } : {}) }, { session });
              if (profile.guild) await ForeverGuild.updateOne({ region: profile.guild.region, slug: profile.guild.slug },
                { $set: { name: profile.guild.name }, $setOnInsert: { status: "pending", nextFetchAt: completedAt } }, { upsert: true, session });
              // A newly verified profile may complete the three-member quorum.
              // Fetch a fresh roster promptly rather than waiting another 15m.
              if (profile.guild && (!current.ruleset || current.ruleset === "Unknown")) {
                const targetGuild = await ForeverGuild.findOne({ region: profile.guild.region, slug: profile.guild.slug,
                  status: "approved", hidden: { $ne: true }, failures: 0 }).select("region slug roster").session(session).lean();
                if (targetGuild) {
                  const evidence = await ForeverCharacter.find({ region: targetGuild.region, slug: { $in: targetGuild.roster.map(member => member.slug) } })
                    .select("slug guild faction ruleset rulesetInferredFromGuild sourceUpdatedAt").session(session).lean();
                  if (confirmedGuildRuleset(targetGuild, targetGuild.roster, evidence)) await ForeverGuild.updateOne({ _id: targetGuild._id },
                    { $min: { nextFetchAt: completedAt } }, { session });
                }
              }
            }
          }
        }
        await ForeverWorker.updateOne({ _id: "armory", leaseToken: token }, {
          $set: { nextRequestAt, failedJobs: health.failedJobs, failureWindowStartedAt: health.failureWindowStartedAt,
            consecutiveGuilds: useGuild ? Math.min(3, (lease.consecutiveGuilds ?? 0) + 1) : 0,
            ...(!useGuild && !priorityCharacter ? { consecutiveNewCharacters: character!.lowLevelRecheck || character!.profileFetchedAt || character!.sourceUpdatedAt
              ? 0 : Math.min(3, newCharacterTurns + 1) } : {}),
            ...(useGuild ? { consecutiveNewGuilds: guild!.lastFetchedAt ? 0 : Math.min(3, (lease.consecutiveNewGuilds ?? 0) + 1) } : {}),
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
