import mongoose from "mongoose";
import { createHash } from "node:crypto";
import { ForeverCharacter, ForeverGuild, ForeverRequestLimit, ForeverWorker } from "./forever.models";
import { ArmoryError, armoryUrl, normalizeSlug, parseArmoryInput } from "./forever-armory";
import { mayRequestRefresh, MINUTE } from "./forever-policy";
import { normalizeTwitchChannel } from "./forever-twitch";
import { visibleForeverCharacters } from "./forever-visibility";
import foreverRunner from "./forever.worker";
import { releaseRosterCoverage } from "./forever-roster-sync";

export class ForeverError extends Error {
  constructor(public code: string, public status = 400) { super(code); }
}
export function objectId(value: unknown): mongoose.Types.ObjectId {
  if (typeof value !== "string" || !/^[a-f\d]{24}$/i.test(value)) throw new ForeverError("not_found", 404);
  return new mongoose.Types.ObjectId(value);
}

export async function consumeLimit(userId: string, action: string, max: number, now = Date.now()): Promise<void> {
  const hour = Math.floor(now / (60 * MINUTE));
  const hash = createHash("sha256").update(`${userId}:${action}:${hour}`).digest("hex");
  try {
    const result = await ForeverRequestLimit.findOneAndUpdate({ _id: hash, count: { $lt: max } }, {
      $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((hour + 2) * 60 * MINUTE) },
    }, { upsert: true, returnDocument: "after" });
    if (!result) throw new ForeverError("rate_limited", 429);
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      // Another request may have created the bucket after our upsert matched nothing.
      // Retry only the bounded increment; a full bucket still cannot exceed max.
      const result = await ForeverRequestLimit.findOneAndUpdate({ _id: hash, count: { $lt: max } }, { $inc: { count: 1 } }, { returnDocument: "after" });
      if (result) return;
      throw new ForeverError("rate_limited", 429);
    }
    throw error;
  }
}

function twitchChannelInput(value: unknown) {
  try { return normalizeTwitchChannel(value); } catch { throw new ForeverError("invalid_twitch"); }
}

export async function setCharacterTwitch(id: unknown, value: unknown) {
  const twitchChannel = twitchChannelInput(value);
  const result = await ForeverCharacter.updateOne({ _id: objectId(id) }, {
    ...(twitchChannel ? { $set: { twitchChannel } } : {}),
    $unset: { twitchIsLive: 1, twitchCheckedAt: 1, twitchNextCheckAt: 1, ...(!twitchChannel ? { twitchChannel: 1 } : {}) },
  });
  if (!result.matchedCount) throw new ForeverError("not_found", 404);
}

export async function addCharacter(url: unknown, source: "admin" | "proposal", userId: string, twitch?: unknown) {
  const twitchChannel = source === "admin" && twitch !== undefined ? twitchChannelInput(twitch) : undefined;
  let identity;
  try { identity = parseArmoryInput(url); } catch (error) {
    if (error instanceof ArmoryError) throw new ForeverError("invalid_url");
    throw error;
  }
  if (source === "proposal") await consumeLimit(userId, "proposal", 5);
  try {
    await ForeverCharacter.updateOne(identity, { $setOnInsert: {
      ...identity, source, proposedBy: userId, status: "pending", nextFetchAt: new Date(),
    } }, { upsert: true });
  } catch (error) { if ((error as { code?: number }).code !== 11000) throw error; }
  if (source === "admin") {
    // Explicit admin action may resume a paused/rejected character. Existing retry deadlines remain intact.
    await ForeverCharacter.updateOne(identity, { $set: { status: "tracked", independentlyTracked: true } });
  }
  const character = await ForeverCharacter.findOne(identity).select("status").lean();
  if (twitchChannel !== undefined) await setCharacterTwitch(String(character!._id), twitchChannel);
  return { id: String(character!._id), status: character!.status };
}

export async function addGuild(input: unknown, source: "admin" | "proposal", userId: string) {
  let identity;
  try { identity = parseArmoryInput(input, "guild"); } catch { throw new ForeverError("invalid_url"); }
  if (source === "proposal") await consumeLimit(userId, "proposal", 5);
  const name = typeof input === "string" && !/^https?:/i.test(input.trim()) ? input.trim() : identity.slug.replace(/-/g, " ");
  try {
    await ForeverGuild.updateOne(identity, { $setOnInsert: {
      ...identity, name, proposedBy: userId, status: source === "proposal" ? "proposed" : "pending", nextFetchAt: new Date(),
    } }, { upsert: true });
  } catch (error) { if ((error as { code?: number }).code !== 11000) throw error; }
  // Admin additions queue a preview; importing members still requires explicit approval.
  if (source === "admin") await ForeverGuild.updateOne({ ...identity, status: { $in: ["proposed", "rejected"] } }, { $set: { status: "pending", nextFetchAt: new Date() } });
  const guild = await ForeverGuild.findOne(identity).select("status").lean();
  return { id: String(guild!._id), status: guild!.status };
}

export async function setGuildVisibility(id: unknown, hidden: unknown) {
  if (typeof hidden !== "boolean") throw new ForeverError("invalid_input");
  const result = await ForeverGuild.updateOne({ _id: objectId(id) }, { $set: { hidden } });
  if (!result.matchedCount) throw new ForeverError("not_found", 404);
  if (hidden) {
    const guild = await ForeverGuild.findById(objectId(id)).select("region slug").lean();
    await releaseRosterCoverage({ region: guild!.region, rosterGuildSlug: guild!.slug }, new Date());
  }
}

export async function setCharacterStatus(id: unknown, status: unknown) {
  if (!["tracked", "paused", "rejected"].includes(String(status))) throw new ForeverError("invalid_input");
  const result = await ForeverCharacter.updateOne({ _id: objectId(id) }, { $set: { status, ...(status === "tracked" ? { independentlyTracked: true } : {}) } });
  if (!result.matchedCount) throw new ForeverError("not_found", 404);
}

export async function adminCharacterAction(ids: unknown, action: unknown) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 50 || !["tracked", "paused", "rejected", "retry"].includes(String(action))) throw new ForeverError("invalid_input");
  const uniqueIds = [...new Set(ids.map((id) => String(objectId(id))))];
  const filter: Record<string, unknown> = { _id: { $in: uniqueIds } };
  if (action === "retry") {
    filter.status = "tracked";
    filter.$or = [{ lastAttemptAt: { $exists: false } }, { lastAttemptAt: { $lte: new Date(Date.now() - 5 * MINUTE) } }];
  } else if (action === "paused") filter.status = "tracked";
  else if (action === "rejected") filter.status = "pending";
  else filter.$or = [{ status: { $ne: "tracked" } }, { independentlyTracked: { $ne: true } }];
  // Admin retries override an individual backoff, never the shared Retry-After pause.
  const result = await ForeverCharacter.updateMany(filter, { $set: action === "retry" ? { nextFetchAt: new Date(), refreshQueuedAt: new Date() }
    : { status: action, ...(action === "tracked" ? { independentlyTracked: true } : {}) } });
  return { updated: result.modifiedCount, skipped: uniqueIds.length - result.modifiedCount };
}

export async function adminRefreshNow(id: unknown) {
  const requestedAt = new Date();
  const characterId = objectId(id);
  const result = await ForeverCharacter.updateOne({ ...await visibleForeverCharacters(), _id: characterId, status: "tracked" }, {
    $set: { refreshRequestedAt: requestedAt, nextFetchAt: requestedAt },
  });
  if (!result.matchedCount) throw new ForeverError("not_found", 404);
  // Try immediately using the same distributed lease and rate limits as the worker.
  // If it is busy, the persisted priority request is picked up on its next tick.
  await foreverRunner.tick();
  const character = await ForeverCharacter.findById(characterId).select("refreshRequestedAt lastAttemptAt errorCode").lean();
  const attempted = !character?.refreshRequestedAt && character?.lastAttemptAt && character.lastAttemptAt >= requestedAt;
  return { refreshState: attempted ? (character.errorCode ? "failed" : "refreshed") : "prioritized" };
}

export async function requestRefresh(id: unknown, userId: string) {
  await consumeLimit(userId, "refresh", 10);
  const character = await ForeverCharacter.findOne({ ...await visibleForeverCharacters(), _id: objectId(id), status: "tracked" }).lean();
  if (!character) throw new ForeverError("not_found", 404);
  if (mayRequestRefresh(character)) {
    await ForeverCharacter.updateOne({ _id: character._id, status: "tracked", failures: 0, nextFetchAt: character.nextFetchAt },
      { $set: { nextFetchAt: new Date(), refreshQueuedAt: new Date() } });
  }
  return { queued: true };
}

export async function setGuildStatus(id: unknown, status: unknown) {
  if (!["approved", "paused", "rejected"].includes(String(status))) throw new ForeverError("invalid_input");
  const result = await ForeverGuild.updateOne({ _id: objectId(id) }, { $set: { status } });
  if (!result.matchedCount) throw new ForeverError("not_found", 404);
  // Approval queues a fresh roster. Pausing stops expansion; already tracked members remain tracked.
  if (status === "approved") await ForeverGuild.updateOne({ _id: objectId(id), failures: 0 }, { $set: { nextFetchAt: new Date() } });
  else {
    const guild = await ForeverGuild.findById(objectId(id)).select("region slug").lean();
    await releaseRosterCoverage({ region: guild!.region, rosterGuildSlug: guild!.slug }, new Date());
  }
}

export async function refreshGuild(id: unknown) {
  const guild = await ForeverGuild.findById(objectId(id)).lean();
  if (!guild) throw new ForeverError("not_found", 404);
  const result = await ForeverGuild.updateOne({ _id: guild._id, status: { $in: ["pending", "approved"] }, hidden: { $ne: true },
    $or: [{ lastAttemptAt: { $exists: false } }, { lastAttemptAt: { $lte: new Date(Date.now() - 5 * MINUTE) } }],
  }, { $set: { nextFetchAt: new Date() } });
  return { updated: result.modifiedCount, skipped: 1 - result.modifiedCount };
}

const publicFields = "region slug name level className race faction ruleset avatarUrl guild lastFetchedAt lastAttemptAt nextFetchAt sourceUpdatedAt errorCode twitchChannel twitchIsLive twitchCheckedAt";
const skyborneRaces = ["Skyborne", "Windshaper Skyborne", "High Order Skyborne"];
const levelRankOrder = { level: -1, lastLevelAt: 1, _id: 1 } as const;
export async function leaderboard(query: { page?: unknown; race?: unknown; className?: unknown; faction?: unknown; ruleset?: unknown; guild?: unknown; twitch?: unknown; search?: unknown } = {}) {
  const pageNumber = Math.min(1000, Math.max(1, Number.parseInt(String(query.page), 10) || 1));
  const visible = await visibleForeverCharacters();
  const base = { ...visible, region: "eu", status: "tracked" as const, level: { $gte: 1 } };
  const filter: Record<string, unknown> = { ...base };
  if (query.twitch !== undefined && query.twitch !== "") {
    if (query.twitch !== "only") throw new ForeverError("invalid_input");
    filter.twitchChannel = { $type: "string", $ne: "" };
  }
  if (query.search !== undefined && query.search !== "") {
    if (typeof query.search !== "string" || query.search.length > 100) throw new ForeverError("invalid_input");
    const escaped = query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (escaped) filter.$or = ["name", "guild.name"].map((field) => ({ [field]: { $regex: escaped, $options: "i" } }));
  }
  const fields = ["race", "className", "faction", "ruleset", "guild"] as const;
  for (const field of fields) {
    const value = query[field];
    if (value === undefined || value === "") continue;
    if (typeof value !== "string" || value.length > (field === "guild" ? 150 : 80)) throw new ForeverError("invalid_input");
    filter[field === "guild" ? "guild.name" : field] = field === "race" && value === "Skyborne" ? { $in: skyborneRaces } : value;
  }
  const [characters, breakdown, pending, options, worker, rankedIds] = await Promise.all([
    ForeverCharacter.find(filter).select(publicFields).sort(levelRankOrder).skip((pageNumber - 1) * 50).limit(50).lean(),
    ForeverCharacter.aggregate<{
      summary: { total: number; averageLevel: number; atMaxLevel: number }[];
      factions: { name: string | null; count: number }[];
      rulesets: { name: string | null; count: number }[];
      combinations: { faction: string | null; ruleset: string | null; count: number }[];
    }>([
      { $match: filter },
      { $facet: {
        summary: [{ $group: {
          _id: null, total: { $sum: 1 }, averageLevel: { $avg: "$level" },
          atMaxLevel: { $sum: { $cond: [{ $eq: ["$level", 60] }, 1, 0] } },
        } }],
        factions: [
          { $group: { _id: { $cond: [{ $eq: [{ $ifNull: ["$faction", ""] }, ""] }, null, "$faction"] }, count: { $sum: 1 } } },
          { $sort: { count: -1, _id: 1 } }, { $project: { _id: 0, name: "$_id", count: 1 } },
        ],
        rulesets: [
          { $group: { _id: { $cond: [{ $eq: [{ $ifNull: ["$ruleset", ""] }, ""] }, null, "$ruleset"] }, count: { $sum: 1 } } },
          { $sort: { count: -1, _id: 1 } }, { $project: { _id: 0, name: "$_id", count: 1 } },
        ],
        combinations: [
          { $group: { _id: {
            faction: { $cond: [{ $eq: [{ $ifNull: ["$faction", ""] }, ""] }, null, "$faction"] },
            ruleset: { $cond: [{ $eq: [{ $ifNull: ["$ruleset", ""] }, ""] }, null, "$ruleset"] },
          }, count: { $sum: 1 } } },
          { $sort: { count: -1, "_id.faction": 1, "_id.ruleset": 1 } },
          { $project: { _id: 0, faction: "$_id.faction", ruleset: "$_id.ruleset", count: 1 } },
        ],
      } },
    ]),
    ForeverCharacter.countDocuments({ ...visible, status: "tracked", level: { $exists: false }, region: "eu" }),
    Promise.all(fields.map((field) => ForeverCharacter.distinct(field === "guild" ? "guild.name" : field, base).then((values: (string | null)[]) =>
      [...new Set(values.filter((value): value is string => !!value).map((value) => field === "race" && skyborneRaces.includes(value) ? "Skyborne" : value))].sort((a, b) => a.localeCompare(b, "en"))))),
    ForeverWorker.findById("armory").select("lastTickAt lastSuccessAt nextRequestAt errorCode").lean(),
    // One ordered ID scan, covered by the rank index when no guilds are hidden.
    // Never load histories or issue a rank query for each returned character.
    ForeverCharacter.find(base).select("_id").sort(levelRankOrder).lean(),
  ]);
  const population = breakdown[0];
  const summary = population.summary[0];
  const total = summary?.total || 0;
  const statistics = { factions: population.factions, rulesets: population.rulesets, combinations: population.combinations, averageLevel: summary?.averageLevel ?? null, atMaxLevel: summary?.atMaxLevel || 0 };
  const ranks = new Map(rankedIds.map((entry, index) => [String(entry._id), index + 1]));
  const ranked = characters.map((character) => ({ ...character, rank: ranks.get(String(character._id)) }));
  return { characters: ranked, total, totalRanked: rankedIds.length, statistics, pending, filterOptions: Object.fromEntries(fields.map((field, index) => [field, options[index]])), page: pageNumber, pageSize: 50, worker, enabled: true };
}
export async function characterDetail(id: unknown) {
  let identity: Record<string, unknown>;
  if (typeof id === "string" && /^[a-f\d]{24}$/i.test(id)) identity = { _id: objectId(id) };
  else {
    try { identity = { region: "eu", slug: normalizeSlug(id) }; }
    catch { throw new ForeverError("not_found", 404); }
  }
  const character = await ForeverCharacter.findOne({ ...await visibleForeverCharacters(), ...identity, status: "tracked" }).select(`${publicFields} history`).lean();
  if (!character) throw new ForeverError("not_found", 404);
  return { ...character, armoryUrl: armoryUrl(character as { region: "eu" | "us"; slug: string }) };
}
export async function adminOverview(query: { status?: unknown; characterPage?: unknown; guildPage?: unknown; search?: unknown; health?: unknown; guildStatus?: unknown; guildSearch?: unknown } = {}) {
  const characterPage = Math.min(1000, Math.max(1, Number.parseInt(String(query.characterPage), 10) || 1));
  const guildPage = Math.min(1000, Math.max(1, Number.parseInt(String(query.guildPage), 10) || 1));
  const status = query.status;
  const filter: Record<string, unknown> =
    status === "pending" || status === "tracked" || status === "paused" || status === "rejected" ? { status } : {};
  const searchFilter = (value: unknown, fields: string[]) => {
    if (value === undefined || value === "") return {};
    if (typeof value !== "string" || value.length > 100) throw new ForeverError("invalid_input");
    const escaped = value.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return { $or: fields.map((field) => ({ [field]: { $regex: escaped, $options: "i" } })) };
  };
  Object.assign(filter, searchFilter(query.search, ["name", "slug", "guild.name", "twitchChannel"]));
  if (query.health === "errors") filter.errorCode = { $exists: true };
  else if (query.health === "unfetched") filter.lastFetchedAt = { $exists: false };
  else if (query.health !== undefined && query.health !== "all") throw new ForeverError("invalid_input");
  const guildFilter: Record<string, unknown> = searchFilter(query.guildSearch, ["name", "slug"]);
  if (["proposed", "pending", "approved", "paused", "rejected"].includes(String(query.guildStatus))) guildFilter.status = query.guildStatus;
  const [characters, guilds, worker, totalCharacters, totalGuilds, characterCounts, guildCounts] = await Promise.all([
    ForeverCharacter.find(filter).select("-history -proposedBy").sort({ createdAt: -1, _id: -1 }).skip((characterPage - 1) * 50).limit(50).lean(),
    ForeverGuild.aggregate([{ $match: guildFilter }, { $sort: { name: 1, _id: 1 } }, { $skip: (guildPage - 1) * 50 }, { $limit: 50 },
      { $addFields: { rosterCount: { $size: { $ifNull: ["$roster", []] } } } }, { $project: { roster: 0 } }]),
    ForeverWorker.findById("armory").select("-leaseToken").lean(),
    ForeverCharacter.countDocuments(filter), ForeverGuild.countDocuments(guildFilter),
    ForeverCharacter.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    ForeverGuild.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
  ]);
  return { characters, guilds, worker, totalCharacters, totalGuilds,
    characterCounts: Object.fromEntries(characterCounts.map((entry) => [entry._id, entry.count])),
    guildCounts: Object.fromEntries(guildCounts.map((entry) => [entry._id, entry.count])), enabled: true };
}
export async function guildDetail(id: unknown) {
  const guild = await ForeverGuild.findById(objectId(id)).lean();
  if (!guild) throw new ForeverError("not_found", 404);
  const characters = await ForeverCharacter.find({ region: guild.region, slug: { $in: guild.roster.map((member) => member.slug) } }).select("slug status").lean();
  const tracked = new Map(characters.map((character) => [character.slug, character]));
  return { ...guild, roster: guild.roster.map((member) => ({ ...member, trackingStatus: tracked.get(member.slug)?.status || "untracked" })) };
}
