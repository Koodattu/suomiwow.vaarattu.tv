import mongoose from "mongoose";
import { createHash } from "node:crypto";
import { ForeverCharacter, ForeverGuild, ForeverRequestLimit, ForeverWorker } from "./forever.models";
import { ArmoryError, armoryUrl, parseArmoryUrl } from "./forever-armory";
import { mayRequestRefresh, MINUTE } from "./forever-policy";

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
    if ((error as { code?: number }).code === 11000) throw new ForeverError("rate_limited", 429);
    throw error;
  }
}

export async function addCharacter(url: unknown, source: "admin" | "proposal", userId: string) {
  let identity;
  try { identity = parseArmoryUrl(url); } catch (error) {
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
    await ForeverCharacter.updateOne(identity, { $set: { status: "tracked" } });
  }
  const character = await ForeverCharacter.findOne(identity).select("status").lean();
  return { id: String(character!._id), status: character!.status };
}

export async function setCharacterStatus(id: unknown, status: unknown) {
  if (!["tracked", "paused", "rejected"].includes(String(status))) throw new ForeverError("invalid_input");
  const result = await ForeverCharacter.updateOne({ _id: objectId(id) }, { $set: { status } });
  if (!result.matchedCount) throw new ForeverError("not_found", 404);
}

export async function requestRefresh(id: unknown, userId: string) {
  await consumeLimit(userId, "refresh", 10);
  const character = await ForeverCharacter.findOne({ _id: objectId(id), status: "tracked" }).lean();
  if (!character) throw new ForeverError("not_found", 404);
  if (mayRequestRefresh(character)) {
    await ForeverCharacter.updateOne({ _id: character._id, status: "tracked", failures: 0, nextFetchAt: character.nextFetchAt },
      { $set: { nextFetchAt: new Date() } });
  }
  return { queued: true };
}

export async function setGuildStatus(id: unknown, status: unknown) {
  if (!["approved", "paused"].includes(String(status))) throw new ForeverError("invalid_input");
  const result = await ForeverGuild.updateOne({ _id: objectId(id) }, { $set: { status } });
  if (!result.matchedCount) throw new ForeverError("not_found", 404);
  // Approval queues a fresh roster. Pausing stops expansion; already tracked members remain tracked.
  if (status === "approved") await ForeverGuild.updateOne({ _id: objectId(id), failures: 0 }, { $set: { nextFetchAt: new Date() } });
}

export async function refreshGuild(id: unknown) {
  const guild = await ForeverGuild.findById(objectId(id)).lean();
  if (!guild) throw new ForeverError("not_found", 404);
  if (guild.status === "paused" || guild.failures > 0) return;
  await ForeverGuild.updateOne({ _id: guild._id, failures: 0 }, { $set: { nextFetchAt: new Date() } });
}

const publicFields = "region slug name level className race faction ruleset avatarUrl guild lastFetchedAt lastAttemptAt nextFetchAt sourceUpdatedAt errorCode";
export async function leaderboard(region: unknown, ruleset: unknown, page: unknown) {
  const pageNumber = Math.min(1000, Math.max(1, Number.parseInt(String(page), 10) || 1));
  const filter: Record<string, unknown> = { status: "tracked", level: { $gte: 1 } };
  if (region === "eu" || region === "us") filter.region = region;
  if (typeof ruleset === "string" && ruleset.length <= 80 && ruleset) filter.ruleset = ruleset;
  const [characters, total, pending, rulesets, worker] = await Promise.all([
    ForeverCharacter.find(filter).select(publicFields).sort({ level: -1, name: 1, _id: 1 }).skip((pageNumber - 1) * 50).limit(50).lean(),
    ForeverCharacter.countDocuments(filter), ForeverCharacter.countDocuments({ status: "tracked", level: { $exists: false }, ...(region === "eu" || region === "us" ? { region } : {}) }),
    ForeverCharacter.distinct("ruleset", { status: "tracked", level: { $gte: 1 } }),
    ForeverWorker.findById("armory").select("lastTickAt lastSuccessAt nextRequestAt errorCode").lean(),
  ]);
  return { characters, total, pending, rulesets, page: pageNumber, pageSize: 50, worker, enabled: process.env.FOREVER_WORKER_ENABLED !== "false" };
}
export async function characterDetail(id: unknown) {
  const character = await ForeverCharacter.findOne({ _id: objectId(id), status: "tracked" }).select(`${publicFields} history`).lean();
  if (!character) throw new ForeverError("not_found", 404);
  return { ...character, armoryUrl: armoryUrl(character as { region: "eu" | "us"; slug: string }) };
}
export async function adminOverview(query: { status?: unknown; characterPage?: unknown; guildPage?: unknown } = {}) {
  const characterPage = Math.min(1000, Math.max(1, Number.parseInt(String(query.characterPage), 10) || 1));
  const guildPage = Math.min(1000, Math.max(1, Number.parseInt(String(query.guildPage), 10) || 1));
  const status = query.status;
  const filter: { status?: "pending" | "tracked" | "paused" | "rejected" } =
    status === "pending" || status === "tracked" || status === "paused" || status === "rejected" ? { status } : {};
  const [characters, guilds, worker, totalCharacters, totalGuilds] = await Promise.all([
    ForeverCharacter.find(filter).select("-history -proposedBy").sort({ createdAt: -1, _id: -1 }).skip((characterPage - 1) * 50).limit(50).lean(),
    ForeverGuild.find().select("-roster").sort({ createdAt: -1, _id: -1 }).skip((guildPage - 1) * 50).limit(50).lean(),
    ForeverWorker.findById("armory").select("-leaseToken").lean(),
    ForeverCharacter.countDocuments(filter), ForeverGuild.countDocuments(),
  ]);
  return { characters, guilds, worker, totalCharacters, totalGuilds, enabled: process.env.FOREVER_WORKER_ENABLED !== "false" };
}
export async function guildDetail(id: unknown) {
  const guild = await ForeverGuild.findById(objectId(id)).lean();
  if (!guild) throw new ForeverError("not_found", 404);
  return guild;
}
