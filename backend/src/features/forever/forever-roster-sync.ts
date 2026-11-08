import { AnyBulkWriteOperation, ClientSession, InferSchemaType } from "mongoose";
import { ForeverMember } from "./forever-armory";
import { ForeverCharacter, ForeverGuild } from "./forever.models";
import { PROFILE_AUDIT_INTERVAL, ROSTER_COVERAGE, ROSTER_LAG_FALLBACK } from "./forever-policy";

// Bulk updates contain plain history entries, not hydrated Mongoose subdocuments.
type StoredCharacter = Omit<InferSchemaType<typeof ForeverCharacter.schema>, "history"> & {
  history: { level: number; observedAt: Date; sourceUpdatedAt?: Date; source?: "character" | "roster" }[];
};

// An expired or withdrawn roster must not leave members waiting for a six-hour
// profile audit. Keep individual errors/backoffs and explicit pauses intact.
export async function releaseRosterCoverage(filter: Record<string, unknown>, now: Date, session?: ClientSession) {
  await ForeverCharacter.updateMany({ $and: [filter, { status: "tracked", failures: 0, rosterCoverageUntil: { $ne: null } }] },
    { $min: { nextFetchAt: now } }, { session });
  await ForeverCharacter.updateMany(filter, { $unset: { rosterCoverageUntil: 1 } }, { session });
}

export async function applyApprovedRoster(
  guild: { region: string; slug: string; name: string; individualUntil?: Date | null },
  roster: ForeverMember[], now: Date, session: ClientSession,
) {
  const identity = { region: guild.region, slug: guild.slug };
  const slugs = roster.map(member => member.slug);
  await releaseRosterCoverage({ region: guild.region, rosterGuildSlug: guild.slug, slug: { $nin: slugs } }, now, session);
  if (!roster.length) return;

  await ForeverCharacter.bulkWrite(roster.map(member => ({ updateOne: {
    filter: { region: member.region, slug: member.slug },
    update: { $setOnInsert: { region: member.region, slug: member.slug, source: "guild", status: "tracked", nextFetchAt: now } }, upsert: true,
  } })), { session });
  await ForeverCharacter.updateMany({ region: guild.region, slug: { $in: slugs }, status: "pending" },
    { $set: { status: "tracked", independentlyTracked: false } }, { session });
  const characters = await ForeverCharacter.find({ region: guild.region, slug: { $in: slugs }, status: "tracked" })
    .select("-history").session(session).lean();
  const members = new Map(roster.map(member => [member.slug, member]));
  const lagging = characters.filter(character => {
    const member = members.get(character.slug)!;
    return !member.isOutdated && character.guild?.slug === guild.slug && (character.level ?? 0) > member.level;
  }).length;
  const individualUntil = lagging ? new Date(now.getTime() + ROSTER_LAG_FALLBACK) : guild.individualUntil;
  const individual = !!individualUntil && individualUntil > now;
  await ForeverGuild.updateOne(identity, { $set: { rosterLaggingMembers: lagging,
    ...(lagging ? { individualUntil } : {}) } }, { session });
  if (individual) await releaseRosterCoverage({ region: guild.region, rosterGuildSlug: guild.slug }, now, session);

  // One rotating verification sample per roster, chosen by oldest successful
  // profile check. It also supplies portraits/rulesets and discovers guild moves.
  const probe = characters.filter(character => character.failures === 0 &&
    !members.get(character.slug)!.isOutdated && character.guild?.slug === guild.slug)
    .sort((a, b) => ((a.profileFetchedAt ?? a.lastFetchedAt)?.getTime() ?? 0) - ((b.profileFetchedAt ?? b.lastFetchedAt)?.getTime() ?? 0))[0];

  const writes: AnyBulkWriteOperation<StoredCharacter>[] = characters.map(character => {
    const member = members.get(character.slug)!;
    const fetchedProfile = character.profileFetchedAt ?? (character.sourceUpdatedAt ? character.lastFetchedAt : undefined);
    // A timestamp-less roster cannot overrule a profile that says this member
    // belongs elsewhere (including no guild). Verify that identity individually.
    const conflictingGuild = !!fetchedProfile && character.guild?.slug !== guild.slug;
    const usable = !member.isOutdated && !conflictingGuild && member.level >= (character.level ?? 0);
    if (!usable) return { updateOne: { filter: { _id: character._id }, update: {
      ...(character.failures === 0 ? { $min: { nextFetchAt: now } } : {}),
      ...(character.rosterGuildSlug === guild.slug ? { $unset: { rosterCoverageUntil: 1 as const } } : {}),
    } } };

    const changed = member.level > (character.level ?? 0);
    const covered = !individual && !!fetchedProfile && !!character.ruleset;
    const set: Record<string, unknown> = {
      name: member.name, level: member.level, className: member.className,
      ...(member.race ? { race: member.race } : {}), ...(member.faction ? { faction: member.faction } : {}),
      guild: { ...identity, name: guild.name }, lastFetchedAt: now,
      rosterObservedAt: now, rosterLevel: member.level, rosterGuildSlug: guild.slug,
      ...(fetchedProfile ? { profileFetchedAt: fetchedProfile } : {}),
      ...(fetchedProfile && character.profileLevel == null && !character.rosterObservedAt ? { profileLevel: character.level } : {}),
      ...(changed ? { lastLevelAt: now } : {}),
      ...(covered ? { rosterCoverageUntil: new Date(now.getTime() + ROSTER_COVERAGE) } : {}),
    };
    // Never swallow a requested refresh or replace a failure's retry deadline.
    if (covered && character.failures === 0 && !character.refreshRequestedAt && !character.refreshQueuedAt) {
      set.nextFetchAt = character._id.equals(probe?._id)
        ? now : new Date(fetchedProfile!.getTime() + PROFILE_AUDIT_INTERVAL);
    }
    return { updateOne: { filter: { _id: character._id }, update: {
      $set: set, ...(!covered ? { $unset: { rosterCoverageUntil: 1 as const } } : {}),
      ...(changed ? { $push: { history: { level: member.level, observedAt: now, source: "roster" as const } } } : {}),
    } } };
  });
  if (writes.length) await ForeverCharacter.bulkWrite<StoredCharacter>(writes, { session });
}
