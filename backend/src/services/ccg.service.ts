import { createHash, randomBytes } from "crypto";
import { Request, Response } from "express";
import mongoose, { ClientSession } from "mongoose";
import {
  CCG_CARDS_PER_PACK,
  CCG_DUPLICATES_PER_BONUS_PACK,
  CCG_FEATURE_ENABLED,
  CCG_FINISH_ORDER,
  CCG_GUEST_COOKIE,
  CCG_INITIAL_PACKS,
  CCG_PACK_BALANCE_VERSION,
  CCG_PACK_RECHARGE_INTERVAL_HOURS,
  CCG_PACK_RULE_VERSION,
  CCG_PACK_STORAGE_CAPS,
  CCG_TIER_GRADES,
  CcgFinish,
  CcgMode,
  CcgTierGrade,
} from "../config/ccg";
import CcgCard, { ICcgCard } from "../models/CcgCard";
import CcgDailyAllowance from "../models/CcgDailyAllowance";
import CcgGuest, { ICcgGuest } from "../models/CcgGuest";
import CcgLedgerEntry from "../models/CcgLedgerEntry";
import CcgOwnerProgress from "../models/CcgOwnerProgress";
import CcgOwnership, { CcgOwnerType } from "../models/CcgOwnership";
import CcgPackBalance, { ICcgPackBalance } from "../models/CcgPackBalance";
import CcgPackCredit from "../models/CcgPackCredit";
import CcgPackOpening, { ICcgPackOpening, ICcgPackResult } from "../models/CcgPackOpening";
import CcgPackPool from "../models/CcgPackPool";
import CcgQualityProgress, { ICcgQualityProgress } from "../models/CcgQualityProgress";
import CcgSet, { ICcgSet } from "../models/CcgSet";
import User from "../models/User";
import { CcgFinishPity, compareFinish, emptyFinishPity, nextFinish, rollProtectedFinish } from "../utils/ccg-random";
import { calculateDuplicateProgress, planPackSelections } from "../utils/ccg-pack";
import { applyPackRecharge, getNextPackRechargeAt, getRechargeHourStart } from "../utils/ccg-recharge";
import { getHelsinkiDateKey, getNextHelsinkiReset } from "../utils/helsinki-time";
import ccgPublisherService from "./ccg-publisher.service";

type CcgOwner = {
  ownerType: CcgOwnerType;
  ownerId: mongoose.Types.ObjectId;
  guest?: ICcgGuest;
  dateKey: string;
  expiresAt?: Date;
};

type SelectedResult = {
  cardId: mongoose.Types.ObjectId;
  setId: mongoose.Types.ObjectId;
  finish: CcgFinish;
  tierGrade: CcgTierGrade;
  isDuplicate: boolean;
};

export class CcgServiceError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CcgServiceError";
  }
}

function requireFeature(): void {
  if (!CCG_FEATURE_ENABLED) throw new CcgServiceError(404, "feature_disabled", "SuomiWoW CCG is not available");
}

function validateObjectId(value: string, label: string): mongoose.Types.ObjectId {
  if (!mongoose.Types.ObjectId.isValid(value)) throw new CcgServiceError(400, "invalid_id", `Invalid ${label}`);
  return new mongoose.Types.ObjectId(value);
}

function validateMode(value: unknown): CcgMode {
  if (value !== "current" && value !== "legacy") throw new CcgServiceError(400, "invalid_mode", "Mode must be current or legacy");
  return value;
}

function validateIdempotencyKey(value: unknown): string {
  if (typeof value !== "string" || value.length < 8 || value.length > 120 || !/^[a-zA-Z0-9:_-]+$/.test(value)) {
    throw new CcgServiceError(400, "invalid_idempotency_key", "A valid idempotency key is required");
  }
  return value;
}

function hashGuestToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function isTransactionUnsupported(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Transaction numbers are only allowed|replica set|does not support retryable writes/i.test(message);
}

class CcgService {
  async getSession(req: Request, res: Response): Promise<Record<string, unknown>> {
    requireFeature();
    await ccgPublisherService.ensureConfiguredSets();
    const owner = await this.resolveOwner(req, res);
    const now = new Date();
    const packBalance = await this.ensurePackBalance(owner, undefined, now);
    const [creditRows, progressRows, qualityProgress, ownershipCount] = await Promise.all([
      owner.ownerType === "user"
        ? CcgPackCredit.aggregate<{ _id: CcgMode; remaining: number }>([
            { $match: { ownerId: owner.ownerId, remaining: { $gt: 0 } } },
            { $group: { _id: "$mode", remaining: { $sum: "$remaining" } } },
          ])
        : [],
      owner.ownerType === "user" ? CcgOwnerProgress.find({ ownerId: owner.ownerId }).lean() : [],
      CcgQualityProgress.findOne({ ownerType: owner.ownerType, ownerId: owner.ownerId }).lean(),
      CcgOwnership.countDocuments({ ownerType: owner.ownerType, ownerId: owner.ownerId }),
    ]);
    const credits = new Map(creditRows.map((row) => [row._id, row.remaining]));
    const progress = new Map(progressRows.map((row) => [row.mode, row]));
    const resetAt = getNextHelsinkiReset();

    return {
      ownerType: owner.ownerType,
      dateKey: owner.dateKey,
      resetAt,
      packs: {
        current: {
          regularRemaining: packBalance.currentRemaining,
          bonusRemaining: credits.get("current") ?? 0,
          totalRemaining: packBalance.currentRemaining + (credits.get("current") ?? 0),
        },
        legacy: {
          regularRemaining: packBalance.legacyRemaining,
          bonusRemaining: credits.get("legacy") ?? 0,
          totalRemaining: packBalance.legacyRemaining + (credits.get("legacy") ?? 0),
        },
      },
      recharge: {
        current: {
          cap: CCG_PACK_STORAGE_CAPS.current,
          intervalHours: CCG_PACK_RECHARGE_INTERVAL_HOURS.current,
          nextAt: getNextPackRechargeAt("current", now).toISOString(),
        },
        legacy: {
          cap: CCG_PACK_STORAGE_CAPS.legacy,
          intervalHours: CCG_PACK_RECHARGE_INTERVAL_HOURS.legacy,
          nextAt: getNextPackRechargeAt("legacy", now).toISOString(),
        },
      },
      duplicates: {
        current: this.serializeProgress(progress.get("current")),
        legacy: this.serializeProgress(progress.get("legacy")),
      },
      qualityProtection: this.readFinishPity(qualityProgress ?? undefined),
      ownedFinishes: ownershipCount,
    };
  }

  async getSets(owner?: CcgOwner): Promise<Record<string, unknown>[]> {
    requireFeature();
    const sets = await ccgPublisherService.ensureConfiguredSets();
    const ownedBySet = new Map<string, number>();
    if (owner) {
      const rows = await CcgOwnership.aggregate<{ _id: mongoose.Types.ObjectId; count: number }>([
        { $match: { ownerType: owner.ownerType, ownerId: owner.ownerId } },
        { $group: { _id: "$cardId" } },
        { $lookup: { from: "ccgcards", localField: "_id", foreignField: "_id", as: "card" } },
        { $unwind: "$card" },
        { $group: { _id: "$card.setId", count: { $sum: 1 } } },
      ]);
      rows.forEach((row) => ownedBySet.set(String(row._id), row.count));
    }
    return sets.filter((set) => set.enabledAt && set.cardCount > 0).map((set) => this.serializeSet(set, ownedBySet.get(String(set._id)) ?? 0));
  }

  async getSetGuilds(owner: CcgOwner, setSlug: string): Promise<Record<string, unknown>> {
    const set = await CcgSet.findOne({ slug: setSlug, enabledAt: { $ne: null } }).select("_id").lean();
    if (!set) throw new CcgServiceError(404, "set_not_found", "Card set not found");

    const guilds = await CcgCard.aggregate<{
      _id: mongoose.Types.ObjectId;
      name: string;
      realm: string;
      cardCount: number;
      collectedCards: number;
    }>([
      { $match: { setId: set._id, guildId: { $type: "objectId" } } },
      {
        $lookup: {
          from: CcgOwnership.collection.collectionName,
          let: { cardId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$cardId", "$$cardId"] },
                    { $eq: ["$ownerType", owner.ownerType] },
                    { $eq: ["$ownerId", owner.ownerId] },
                  ],
                },
              },
            },
            { $limit: 1 },
          ],
          as: "ownership",
        },
      },
      {
        $group: {
          _id: "$guildId",
          name: { $first: "$guildName" },
          realm: { $first: "$guildRealm" },
          cardCount: { $sum: 1 },
          collectedCards: { $sum: { $cond: [{ $gt: [{ $size: "$ownership" }, 0] }, 1, 0] } },
        },
      },
    ]);
    const facets = guilds
      .map((row) => ({
        id: String(row._id),
        name: row.name,
        realm: row.realm,
        cardCount: row.cardCount,
        collectedCards: row.collectedCards,
      }))
      .sort((a, b) => b.collectedCards - a.collectedCards || a.name.localeCompare(b.name) || a.realm.localeCompare(b.realm));

    return { guilds: facets };
  }

  async getCatalog(
    owner: CcgOwner,
    setSlug: string,
    options: { page?: number; limit?: number; owned?: string; grade?: string; finish?: string; guildId?: string },
  ): Promise<Record<string, unknown>> {
    const set = await CcgSet.findOne({ slug: setSlug, enabledAt: { $ne: null } }).lean();
    if (!set) throw new CcgServiceError(404, "set_not_found", "Card set not found");
    const page = Math.max(1, Math.floor(options.page ?? 1));
    const limit = Math.min(45, Math.max(1, Math.floor(options.limit ?? 9)));
    const grade = CCG_TIER_GRADES.includes(options.grade as CcgTierGrade) ? (options.grade as CcgTierGrade) : null;
    const finish = CCG_FINISH_ORDER.includes(options.finish as CcgFinish) ? (options.finish as CcgFinish) : null;
    const cardFilter: Record<string, unknown> = { setId: set._id };
    if (grade) cardFilter.tierGrade = grade;
    if (options.guildId) cardFilter.guildId = validateObjectId(options.guildId, "guild ID");

    let ownedIds: mongoose.Types.ObjectId[] | null = null;
    if (options.owned === "owned" || options.owned === "missing" || finish) {
      ownedIds = await CcgOwnership.distinct("cardId", {
        ownerType: owner.ownerType,
        ownerId: owner.ownerId,
        ...(finish ? { finish } : {}),
      });
    }
    if (options.owned === "owned" || finish) {
      cardFilter._id = { $in: ownedIds ?? [] };
    } else if (options.owned === "missing") {
      cardFilter._id = { $nin: ownedIds ?? [] };
    }
    const [cards, total] = await Promise.all([
      CcgCard.find(cardFilter)
        .sort({ setNumber: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      CcgCard.countDocuments(cardFilter),
    ]);
    const ownership = await CcgOwnership.find({ ownerType: owner.ownerType, ownerId: owner.ownerId, cardId: { $in: cards.map((card) => card._id) } }).lean();
    const ownershipByCard = new Map<string, Array<{ finish: string; quantity: number }>>();
    for (const row of ownership) {
      const list = ownershipByCard.get(String(row.cardId)) ?? [];
      list.push({ finish: row.finish, quantity: row.quantity });
      ownershipByCard.set(String(row.cardId), list);
    }

    return {
      set: this.serializeSet(set, ownedIds?.length ?? 0),
      cards: cards.map((card) => ({ ...this.serializeCard(card, set), ownership: ownershipByCard.get(String(card._id)) ?? [] })),
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    };
  }

  async getCollection(
    owner: CcgOwner,
    options: { page?: number; limit?: number; setSlug?: string; grade?: string; finish?: string; search?: string; guildId?: string },
  ): Promise<Record<string, unknown>> {
    const page = Math.max(1, Math.floor(options.page ?? 1));
    const limit = Math.min(45, Math.max(1, Math.floor(options.limit ?? 18)));
    const match: Record<string, unknown> = { ownerType: owner.ownerType, ownerId: owner.ownerId };
    if (["standard", "foil", "golden", "prismatic", "holographic", "negative"].includes(options.finish ?? "")) match.finish = options.finish;
    const characterMatch: Record<string, unknown> = {};
    const variantMatch: Record<string, unknown> = {};
    if (CCG_TIER_GRADES.includes(options.grade as CcgTierGrade)) variantMatch["card.tierGrade"] = options.grade;
    if (options.search?.trim()) characterMatch.name = { $regex: options.search.trim().slice(0, 60), $options: "i" };
    let setId: mongoose.Types.ObjectId | null = null;
    if (options.setSlug) setId = (await CcgSet.findOne({ slug: options.setSlug, enabledAt: { $ne: null } }).select("_id").lean())?._id ?? null;
    if (options.setSlug && !setId) throw new CcgServiceError(404, "set_not_found", "Card set not found");
    if (setId) variantMatch["card.setId"] = setId;
    if (options.guildId) variantMatch["card.guildId"] = validateObjectId(options.guildId, "guild ID");
    if (Object.keys(variantMatch).length > 0) characterMatch.variants = { $elemMatch: variantMatch };

    const rows = await CcgOwnership.aggregate<{
      _id: mongoose.Types.ObjectId;
      totalQuantity: number;
      finishGroups: Array<Array<{ finish: CcgFinish; quantity: number }>>;
      card: ICcgCard;
      set: ICcgSet;
      variants: Array<{ card: ICcgCard; set: ICcgSet; finishes: Array<{ finish: CcgFinish; quantity: number }>; totalQuantity: number }>;
    }>([
      { $match: match },
      { $lookup: { from: "ccgcards", localField: "cardId", foreignField: "_id", as: "card" } },
      { $unwind: "$card" },
      { $lookup: { from: "ccgsets", localField: "card.setId", foreignField: "_id", as: "set" } },
      { $unwind: "$set" },
      { $match: { "set.enabledAt": { $ne: null } } },
      {
        $group: {
          _id: { characterId: "$card.characterId", cardId: "$card._id" },
          totalQuantity: { $sum: "$quantity" },
          finishes: { $push: { finish: "$finish", quantity: "$quantity" } },
          card: { $first: "$card" },
          set: { $first: "$set" },
        },
      },
      { $sort: { "card.performanceSnapshotAt": -1, "card.publishedAt": -1 } },
      {
        $group: {
          _id: "$_id.characterId",
          totalQuantity: { $sum: "$totalQuantity" },
          finishGroups: { $push: "$finishes" },
          card: { $first: "$card" },
          set: { $first: "$set" },
          variants: { $push: { card: "$card", set: "$set", finishes: "$finishes", totalQuantity: "$totalQuantity" } },
          setIds: { $addToSet: "$card.setId" },
          tierGrades: { $addToSet: "$card.tierGrade" },
          guildIds: { $addToSet: "$card.guildId" },
          name: { $first: "$card.name" },
        },
      },
      ...(Object.keys(characterMatch).length > 0 ? [{ $match: characterMatch }] : []),
      {
        $set: {
          sortCard: setId
            ? {
                $arrayElemAt: [
                  {
                    $map: {
                      input: { $filter: { input: "$variants", as: "variant", cond: { $eq: ["$$variant.card.setId", setId] } } },
                      as: "variant",
                      in: "$$variant.card",
                    },
                  },
                  0,
                ],
              }
            : "$card",
        },
      },
      { $sort: { "sortCard.setNumber": 1, "sortCard.name": 1 } },
      {
        $facet: {
          items: [{ $skip: (page - 1) * limit }, { $limit: limit }],
          count: [{ $count: "total" }],
        },
      },
    ]).then((result) => result[0] as unknown as {
      items: Array<{
        _id: mongoose.Types.ObjectId;
        totalQuantity: number;
        finishGroups: Array<Array<{ finish: CcgFinish; quantity: number }>>;
        card: ICcgCard;
        set: ICcgSet;
        variants: Array<{ card: ICcgCard; set: ICcgSet; finishes: Array<{ finish: CcgFinish; quantity: number }>; totalQuantity: number }>;
      }>;
      count: Array<{ total: number }>;
    });
    const total = rows.count[0]?.total ?? 0;
    return {
      cards: rows.items.map((row) => {
        const representative = (setId ? row.variants.find((variant) => String(variant.card.setId) === String(setId)) : null) ?? row.variants[0];
        const finishTotals = new Map<CcgFinish, number>();
        for (const finishes of row.finishGroups) {
          for (const finish of finishes) finishTotals.set(finish.finish, (finishTotals.get(finish.finish) ?? 0) + finish.quantity);
        }
        return {
          ...this.serializeCard(representative.card, representative.set),
          ownership: Array.from(finishTotals, ([finish, quantity]) => ({ finish, quantity })),
          totalQuantity: row.totalQuantity,
          variants: row.variants.map((variant) => ({
            card: this.serializeCard(variant.card, variant.set),
            ownership: variant.finishes,
            totalQuantity: variant.totalQuantity,
          })),
        };
      }),
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    };
  }

  async getCard(cardId: string, owner?: CcgOwner): Promise<Record<string, unknown>> {
    const id = validateObjectId(cardId, "card ID");
    const card = await CcgCard.findById(id).lean();
    if (!card) throw new CcgServiceError(404, "card_not_found", "Card not found");
    const set = await CcgSet.findOne({ _id: card.setId, enabledAt: { $ne: null } }).lean();
    if (!set) throw new CcgServiceError(404, "card_not_found", "Card not found");
    const ownership = owner
      ? await CcgOwnership.find({ ownerType: owner.ownerType, ownerId: owner.ownerId, cardId: card._id }).select("finish quantity -_id").lean()
      : [];
    return { ...this.serializeCard(card, set), ownership };
  }

  async openPack(req: Request, res: Response, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    requireFeature();
    const owner = await this.resolveOwner(req, res);
    const mode = validateMode(body.mode);
    const targetSetId = body.setId === undefined || body.setId === null || body.setId === ""
      ? null
      : validateObjectId(String(body.setId), "card set ID");
    if (targetSetId && mode !== "legacy") {
      throw new CcgServiceError(400, "invalid_pack_target", "Only Legacy packs can target a specific raid");
    }
    const idempotencyKey = validateIdempotencyKey(body.idempotencyKey);
    const existing = await CcgPackOpening.findOne({ ownerType: owner.ownerType, ownerId: owner.ownerId, idempotencyKey }).lean();
    if (existing) return this.serializeOpening(existing);
    const session = await mongoose.startSession();
    let openingId: mongoose.Types.ObjectId | null = null;

    try {
      await session.withTransaction(async () => {
        const duplicateOpening = await CcgPackOpening.findOne({ ownerType: owner.ownerType, ownerId: owner.ownerId, idempotencyKey }).session(session);
        if (duplicateOpening) {
          openingId = duplicateOpening._id;
          return;
        }
        const allowanceSource = await this.reservePack(owner, mode, session);
        const pool = await this.selectModePackResults(mode, session, targetSetId);
        const selected = pool.results;
        const cards = await CcgCard.find({
          _id: { $in: selected.map((result) => result.cardId) },
          setId: { $in: pool.sourceSetIds },
        }).session(session);
        const cardById = new Map(cards.map((card) => [String(card._id), card]));
        if (cardById.size === 0) throw new CcgServiceError(409, "pool_unavailable", "This card set has no available cards");
        const characterIds = Array.from(new Set(cards.map((card) => String(card.characterId)))).map((id) => new mongoose.Types.ObjectId(id));
        const characterSnapshots = await CcgCard.find({ characterId: { $in: characterIds } }).select("_id characterId").session(session).lean();
        const characterByCardId = new Map(characterSnapshots.map((card) => [String(card._id), String(card.characterId)]));
        const ownershipRows = await CcgOwnership.find({
          ownerType: owner.ownerType,
          ownerId: owner.ownerId,
          cardId: { $in: characterSnapshots.map((card) => card._id) },
        }).session(session);
        const bestFinishByCharacter = new Map<string, CcgFinish>();
        for (const row of ownershipRows) {
          const characterId = characterByCardId.get(String(row.cardId));
          if (!characterId) continue;
          const current = bestFinishByCharacter.get(characterId);
          if (!current || compareFinish(row.finish, current) > 0) bestFinishByCharacter.set(characterId, row.finish);
        }
        const qualityProgress = await this.ensureQualityProgress(owner, session);
        let pity = this.readFinishPity(qualityProgress);
        const results: SelectedResult[] = [];
        for (const result of selected) {
          const card = cardById.get(String(result.cardId));
          if (!card) continue;
          const characterId = String(card.characterId);
          const bestOwnedFinish = bestFinishByCharacter.get(characterId);
          const isDuplicate = Boolean(bestOwnedFinish);
          const rolled = rollProtectedFinish(pity, bestOwnedFinish ? nextFinish(bestOwnedFinish) : "standard");
          const finish = rolled.finish;
          pity = rolled.pity;
          if (!bestOwnedFinish || compareFinish(finish, bestOwnedFinish) > 0) bestFinishByCharacter.set(characterId, finish);
          results.push({ cardId: card._id, setId: card.setId, finish, tierGrade: card.tierGrade, isDuplicate });
        }
        if (results.length !== CCG_CARDS_PER_PACK) throw new CcgServiceError(409, "pool_invalid", "The pack pool is incomplete");

        openingId = new mongoose.Types.ObjectId();
        this.writeFinishPity(qualityProgress, pity);
        await qualityProgress.save({ session });
        await this.addOwnership(owner, results, session);
        const duplicateCount = results.filter((result) => result.isDuplicate).length;
        const duplicateRewards = owner.ownerType === "user" ? await this.applyDuplicateProgress(owner.ownerId, mode, duplicateCount, `opening:${openingId}`, session) : 0;
        await CcgPackOpening.create(
          [
            {
              _id: openingId,
              ownerType: owner.ownerType,
              ownerId: owner.ownerId,
              mode,
              targetSetId,
              sourceSetIds: pool.sourceSetIds,
              allowanceSource: allowanceSource.source,
              creditId: allowanceSource.creditId ?? null,
              idempotencyKey,
              poolVersion: pool.version,
              packRuleVersion: CCG_PACK_RULE_VERSION,
              results,
              duplicateRewards,
              state: "committed",
              dateKey: owner.ownerType === "guest" ? owner.dateKey : null,
              expiresAt: owner.ownerType === "guest" ? owner.expiresAt : null,
            },
          ],
          { session },
        );
        await CcgLedgerEntry.create(
          [
            {
              ownerType: owner.ownerType,
              ownerId: owner.ownerId,
              action: "pack_open",
              mode,
              idempotencyKey: `pack:${idempotencyKey}`,
              amount: -1,
              metadata: {
                openingId: String(openingId),
                targetSetId: targetSetId ? String(targetSetId) : null,
                setIds: Array.from(new Set(results.map((result) => String(result.setId)))),
                allowanceSource: allowanceSource.source,
              },
              dateKey: owner.ownerType === "guest" ? owner.dateKey : null,
              expiresAt: owner.ownerType === "guest" ? owner.expiresAt : null,
            },
          ],
          { session },
        );
      });
    } catch (error) {
      if (isTransactionUnsupported(error)) {
        throw new CcgServiceError(503, "transactions_unavailable", "Pack opening is temporarily unavailable while collection storage is starting");
      }
      throw error;
    } finally {
      await session.endSession();
    }

    if (!openingId) throw new CcgServiceError(500, "opening_failed", "Pack opening did not complete");
    const opening = await CcgPackOpening.findById(openingId).lean();
    if (!opening) throw new CcgServiceError(500, "opening_failed", "Pack opening could not be recovered");
    return this.serializeOpening(opening);
  }

  async getOpening(owner: CcgOwner, openingId: string): Promise<Record<string, unknown>> {
    const id = validateObjectId(openingId, "opening ID");
    const opening = await CcgPackOpening.findOne({ _id: id, ownerType: owner.ownerType, ownerId: owner.ownerId }).lean();
    if (!opening) throw new CcgServiceError(404, "opening_not_found", "Pack opening not found");
    if (owner.ownerType === "guest" && (opening.dateKey !== owner.dateKey || !opening.expiresAt || opening.expiresAt <= new Date())) {
      throw new CcgServiceError(410, "guest_expired", "These guest cards have expired");
    }
    return this.serializeOpening(opening);
  }

  async claimGuest(req: Request, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    requireFeature();
    if (!req.session.userId) throw new CcgServiceError(401, "authentication_required", "Log in to keep this pack");
    const userId = validateObjectId(req.session.userId, "user session");
    const idempotencyKey = validateIdempotencyKey(body.idempotencyKey);
    const openingId = validateObjectId(String(body.openingId ?? ""), "guest pack opening");
    const guest = await this.findClaimableGuest(req, true);
    if (!guest) return { claimed: false, alreadyClaimed: false, cards: { current: 0, legacy: 0 }, startingPacks: 0 };
    if (guest.claimedByUserId) {
      if (String(guest.claimedByUserId) !== String(userId)) throw new CcgServiceError(409, "guest_already_claimed", "These guest cards were already claimed");
      return { claimed: false, alreadyClaimed: true, cards: { current: 0, legacy: 0 }, startingPacks: 0 };
    }
    const session = await mongoose.startSession();
    let response: Record<string, unknown> | null = null;
    try {
      await session.withTransaction(async () => {
        const transactionalGuest = await CcgGuest.findOne({
          _id: guest._id,
          dateKey: getHelsinkiDateKey(),
          expiresAt: { $gt: new Date() },
        }).session(session);
        if (!transactionalGuest) throw new CcgServiceError(410, "guest_expired", "This guest pack has expired");
        if (transactionalGuest.claimedByUserId) {
          response = { claimed: false, alreadyClaimed: true, cards: { current: 0, legacy: 0 }, startingPacks: 0 };
          return;
        }
        const opening = await CcgPackOpening.findOne({
          _id: openingId,
          ownerType: "guest",
          ownerId: transactionalGuest._id,
          dateKey: transactionalGuest.dateKey,
          claimedAt: null,
          state: "committed",
        }).session(session);
        if (!opening || opening.results.length !== CCG_CARDS_PER_PACK) {
          throw new CcgServiceError(404, "guest_opening_not_found", "This guest pack cannot be claimed");
        }

        const userOwner: CcgOwner = { ownerType: "user", ownerId: userId, dateKey: transactionalGuest.dateKey };
        const userBalance = await this.ensurePackBalance(userOwner, session);
        const firstPlay = await CcgPackBalance.findOneAndUpdate(
          { _id: userBalance._id, hasPlayed: { $ne: true } },
          { $set: { hasPlayed: true, firstPlayedAt: new Date() } },
          { new: true, session },
        );
        if (!firstPlay) {
          throw new CcgServiceError(409, "ccg_account_already_started", "This account has already started its CCG collection");
        }

        const allResults = opening.results.map((result) => ({ ...result, mode: opening.mode }));
        const resultCards = await CcgCard.find({ _id: { $in: allResults.map((result) => result.cardId) } }).select("_id characterId").session(session).lean();
        const resultCharacterByCardId = new Map(resultCards.map((card) => [String(card._id), String(card.characterId)]));
        const resultCharacterIds = Array.from(new Set(resultCards.map((card) => String(card.characterId)))).map((id) => new mongoose.Types.ObjectId(id));
        const relatedCards = await CcgCard.find({ characterId: { $in: resultCharacterIds } }).select("_id characterId").session(session).lean();
        const characterByCardId = new Map(relatedCards.map((card) => [String(card._id), String(card.characterId)]));
        const existing = await CcgOwnership.find({
          ownerType: "user",
          ownerId: userId,
          cardId: { $in: relatedCards.map((card) => card._id) },
        }).session(session);
        const ownedCharacters = new Set(existing.map((row) => characterByCardId.get(String(row.cardId))).filter((value): value is string => Boolean(value)));
        const duplicates: Record<CcgMode, number> = { current: 0, legacy: 0 };
        const mergedResults: Array<SelectedResult & { mode: CcgMode }> = [];
        for (const result of allResults) {
          const characterId = resultCharacterByCardId.get(String(result.cardId));
          const isDuplicate = Boolean(characterId && ownedCharacters.has(characterId));
          if (isDuplicate) duplicates[result.mode] += 1;
          if (characterId) ownedCharacters.add(characterId);
          mergedResults.push({ cardId: result.cardId, setId: result.setId, finish: result.finish, tierGrade: result.tierGrade, isDuplicate, mode: result.mode });
        }
        await this.addOwnership(userOwner, mergedResults, session);
        const currentRewards = await this.applyDuplicateProgress(userId, "current", duplicates.current, `claim:${transactionalGuest._id}:current`, session);
        const legacyRewards = await this.applyDuplicateProgress(userId, "legacy", duplicates.legacy, `claim:${transactionalGuest._id}:legacy`, session);

        const pulls = {
          current: opening.mode === "current" ? opening.results.length : 0,
          legacy: opening.mode === "legacy" ? opening.results.length : 0,
        };
        await CcgPackOpening.updateOne(
          { _id: opening._id },
          { $set: { claimedByUserId: userId, claimedAt: new Date() } },
          { session },
        );
        await CcgGuest.updateOne(
          { _id: transactionalGuest._id, claimedAt: null },
          { $set: { claimedByUserId: userId, claimedAt: new Date() } },
          { session },
        );
        await CcgOwnership.deleteMany({ ownerType: "guest", ownerId: transactionalGuest._id }, { session });
        await CcgPackBalance.deleteMany({ ownerType: "guest", ownerId: transactionalGuest._id }, { session });
        await CcgDailyAllowance.deleteMany({ ownerType: "guest", ownerId: transactionalGuest._id }, { session });
        await CcgQualityProgress.deleteMany({ ownerType: "guest", ownerId: transactionalGuest._id }, { session });
        await CcgLedgerEntry.create(
          [
            {
              ownerType: "user",
              ownerId: userId,
              action: "guest_claim",
              idempotencyKey: `guest-claim:${transactionalGuest._id}`,
              amount: allResults.length,
              metadata: {
                requestIdempotencyKey: idempotencyKey,
                guestId: String(transactionalGuest._id),
                openingId: String(opening._id),
                pulls,
                duplicates,
                duplicateRewards: { current: currentRewards, legacy: legacyRewards },
                startingPacks: CCG_INITIAL_PACKS.user,
              },
            },
          ],
          { session },
        );
        response = {
          claimed: true,
          alreadyClaimed: false,
          cards: pulls,
          duplicates,
          duplicateRewards: { current: currentRewards, legacy: legacyRewards },
          startingPacks: CCG_INITIAL_PACKS.user.current,
        };
      });
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        throw new CcgServiceError(409, "ccg_account_already_started", "This account has already started its CCG collection");
      }
      if (isTransactionUnsupported(error)) {
        throw new CcgServiceError(503, "transactions_unavailable", "Card claiming is temporarily unavailable while collection storage is starting");
      }
      throw error;
    } finally {
      await session.endSession();
    }
    return response ?? { claimed: false, alreadyClaimed: true, cards: { current: 0, legacy: 0 }, startingPacks: 0 };
  }

  async resolveOwner(req: Request, res: Response): Promise<CcgOwner> {
    requireFeature();
    const dateKey = getHelsinkiDateKey();
    if (req.session.userId && mongoose.Types.ObjectId.isValid(req.session.userId)) {
      const userId = new mongoose.Types.ObjectId(req.session.userId);
      if (await User.exists({ _id: userId })) return { ownerType: "user", ownerId: userId, dateKey };
    }
    const expiresAt = getNextHelsinkiReset();
    const rawCookie = typeof req.cookies?.[CCG_GUEST_COOKIE] === "string" ? req.cookies[CCG_GUEST_COOKIE] : null;
    if (rawCookie) {
      const existing = await CcgGuest.findOne({ tokenHash: hashGuestToken(rawCookie), dateKey, expiresAt: { $gt: new Date() }, claimedAt: null });
      if (existing) {
        existing.lastSeenAt = new Date();
        await existing.save();
        return { ownerType: "guest", ownerId: existing._id, guest: existing, dateKey, expiresAt: existing.expiresAt };
      }
    }
    const token = randomBytes(32).toString("base64url");
    const guest = await CcgGuest.create({
      tokenHash: hashGuestToken(token),
      dateKey,
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
      expiresAt,
    });
    res.cookie(CCG_GUEST_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/ccg",
      expires: expiresAt,
    });
    return { ownerType: "guest", ownerId: guest._id, guest, dateKey, expiresAt };
  }

  async cleanupExpiredGuestData(): Promise<Record<string, number>> {
    const now = new Date();
    const [ownership, balances, allowances, openings, ledgers, qualityProgress, guests] = await Promise.all([
      CcgOwnership.deleteMany({ ownerType: "guest", expiresAt: { $lte: now } }),
      CcgPackBalance.deleteMany({ ownerType: "guest", expiresAt: { $lte: now } }),
      CcgDailyAllowance.deleteMany({ ownerType: "guest", expiresAt: { $lte: now } }),
      CcgPackOpening.deleteMany({ ownerType: "guest", expiresAt: { $lte: now } }),
      CcgLedgerEntry.deleteMany({ ownerType: "guest", expiresAt: { $lte: now } }),
      CcgQualityProgress.deleteMany({ ownerType: "guest", expiresAt: { $lte: now } }),
      CcgGuest.deleteMany({ expiresAt: { $lte: now } }),
    ]);
    return {
      ownership: ownership.deletedCount,
      balances: balances.deletedCount,
      allowances: allowances.deletedCount,
      openings: openings.deletedCount,
      ledgers: ledgers.deletedCount,
      qualityProgress: qualityProgress.deletedCount,
      guests: guests.deletedCount,
    };
  }

  private serializeProgress(row?: { duplicateRemainder: number; totalDuplicatePulls: number; bonusPacksEarned: number }): Record<string, number> {
    return {
      remainder: row?.duplicateRemainder ?? 0,
      needed: CCG_DUPLICATES_PER_BONUS_PACK,
      total: row?.totalDuplicatePulls ?? 0,
      bonusPacksEarned: row?.bonusPacksEarned ?? 0,
    };
  }

  private readFinishPity(row?: Partial<ICcgQualityProgress> | null): CcgFinishPity {
    return {
      foil: row?.foil ?? 0,
      golden: row?.golden ?? 0,
      prismatic: row?.prismatic ?? 0,
      holographic: row?.holographic ?? 0,
      negative: row?.negative ?? 0,
    };
  }

  private writeFinishPity(row: ICcgQualityProgress, pity: CcgFinishPity): void {
    row.foil = pity.foil;
    row.golden = pity.golden;
    row.prismatic = pity.prismatic;
    row.holographic = pity.holographic;
    row.negative = pity.negative;
  }

  private async ensureQualityProgress(owner: CcgOwner, session: ClientSession): Promise<ICcgQualityProgress> {
    return CcgQualityProgress.findOneAndUpdate(
      { ownerType: owner.ownerType, ownerId: owner.ownerId },
      {
        $setOnInsert: {
          ...emptyFinishPity(),
          expiresAt: owner.ownerType === "guest" ? owner.expiresAt : null,
        },
      },
      { upsert: true, new: true, session },
    );
  }

  private async ensurePackBalance(owner: CcgOwner, session?: ClientSession, date: Date = new Date()): Promise<ICcgPackBalance> {
    const filter = { ownerType: owner.ownerType, ownerId: owner.ownerId };
    let balance = await CcgPackBalance.findOne(filter).session(session ?? null);
    if (!balance) {
      const hasPlayed = await this.hasCcgActivity(owner, session);
      const initial = hasPlayed ? { current: 0, legacy: 0 } : CCG_INITIAL_PACKS[owner.ownerType];
      balance = await CcgPackBalance.findOneAndUpdate(
        filter,
        {
          $setOnInsert: {
            currentRemaining: initial.current,
            legacyRemaining: initial.legacy,
            lastRechargeAt: getRechargeHourStart(date),
            grantVersion: CCG_PACK_BALANCE_VERSION,
            hasPlayed,
            firstPlayedAt: hasPlayed ? date : null,
            expiresAt: owner.ownerType === "guest" ? owner.expiresAt : null,
          },
        },
        { upsert: true, new: true, session },
      );
    }
    if (!balance) throw new CcgServiceError(500, "pack_balance_unavailable", "Pack balance could not be initialized");

    if (balance.grantVersion !== CCG_PACK_BALANCE_VERSION || typeof balance.hasPlayed !== "boolean") {
      const hasPlayed = balance.hasPlayed === true || await this.hasCcgActivity(owner, session);
      const initial = CCG_INITIAL_PACKS[owner.ownerType];
      const migrated = await CcgPackBalance.findOneAndUpdate(
        {
          _id: balance._id,
          $or: [
            { grantVersion: { $ne: CCG_PACK_BALANCE_VERSION } },
            { hasPlayed: { $exists: false } },
          ],
        },
        {
          $set: {
            currentRemaining: hasPlayed ? Math.min(balance.currentRemaining, CCG_PACK_STORAGE_CAPS.current) : initial.current,
            legacyRemaining: hasPlayed ? Math.min(balance.legacyRemaining, CCG_PACK_STORAGE_CAPS.legacy) : initial.legacy,
            grantVersion: CCG_PACK_BALANCE_VERSION,
            hasPlayed,
            firstPlayedAt: hasPlayed ? (balance.firstPlayedAt ?? date) : null,
          },
        },
        { new: true, session },
      );
      if (migrated) balance = migrated;
      else {
        const refreshed = await CcgPackBalance.findById(balance._id).session(session ?? null);
        if (!refreshed) throw new CcgServiceError(500, "pack_balance_unavailable", "Pack balance could not be migrated");
        balance = refreshed;
      }
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const recharge = applyPackRecharge(
        { current: balance.currentRemaining, legacy: balance.legacyRemaining },
        balance.lastRechargeAt,
        date,
      );
      if (
        recharge.lastRechargeAt.getTime() === balance.lastRechargeAt.getTime()
        && recharge.balances.current === balance.currentRemaining
        && recharge.balances.legacy === balance.legacyRemaining
      ) {
        return balance;
      }
      const updated = await CcgPackBalance.findOneAndUpdate(
        {
          _id: balance._id,
          lastRechargeAt: balance.lastRechargeAt,
          currentRemaining: balance.currentRemaining,
          legacyRemaining: balance.legacyRemaining,
        },
        {
          $set: {
            currentRemaining: recharge.balances.current,
            legacyRemaining: recharge.balances.legacy,
            lastRechargeAt: recharge.lastRechargeAt,
          },
        },
        { new: true, session },
      );
      if (updated) return updated;
      const refreshed = await CcgPackBalance.findById(balance._id).session(session ?? null);
      if (!refreshed) throw new CcgServiceError(500, "pack_balance_unavailable", "Pack balance could not be refreshed");
      balance = refreshed;
    }
    throw new CcgServiceError(409, "pack_balance_busy", "Pack balance is being updated. Try again");
  }

  private async reservePack(owner: CcgOwner, mode: CcgMode, session: ClientSession): Promise<{ source: "recharge" | "credit"; creditId?: mongoose.Types.ObjectId }> {
    const balance = await this.ensurePackBalance(owner, session);
    const remainingField = mode === "current" ? "currentRemaining" : "legacyRemaining";
    const now = new Date();
    const reserved = await CcgPackBalance.findOneAndUpdate(
      { _id: balance._id, [remainingField]: { $gt: 0 } },
      {
        $inc: { [remainingField]: -1 },
        $set: {
          hasPlayed: true,
          firstPlayedAt: balance.firstPlayedAt ?? now,
        },
      },
      { new: true, session },
    );
    if (reserved) return { source: "recharge" };
    if (owner.ownerType === "guest") throw new CcgServiceError(409, "no_packs", `No ${mode} packs are charged`);
    const credit = await CcgPackCredit.findOneAndUpdate(
      { ownerId: owner.ownerId, mode, remaining: { $gt: 0 } },
      { $inc: { remaining: -1 } },
      { new: true, sort: { createdAt: 1 }, session },
    );
    if (!credit) throw new CcgServiceError(409, "no_packs", `No ${mode} packs remain`);
    await CcgPackBalance.updateOne(
      { _id: balance._id },
      {
        $set: {
          hasPlayed: true,
          firstPlayedAt: balance.firstPlayedAt ?? now,
        },
      },
      { session },
    );
    return { source: "credit", creditId: credit._id };
  }

  private async hasCcgActivity(owner: CcgOwner, session?: ClientSession): Promise<boolean> {
    const ownership = await CcgOwnership.exists({ ownerType: owner.ownerType, ownerId: owner.ownerId }).session(session ?? null);
    if (ownership) return true;
    const opening = await CcgPackOpening.exists({ ownerType: owner.ownerType, ownerId: owner.ownerId, state: "committed" }).session(session ?? null);
    return Boolean(opening);
  }

  private async selectModePackResults(
    mode: CcgMode,
    session: ClientSession,
    targetSetId: mongoose.Types.ObjectId | null = null,
  ): Promise<{
    results: Array<{ cardId: mongoose.Types.ObjectId; setId: mongoose.Types.ObjectId; tierGrade: CcgTierGrade }>;
    sourceSetIds: mongoose.Types.ObjectId[];
    version: string;
  }> {
    const setFilter: Record<string, unknown> = { state: mode, enabledAt: { $ne: null }, cardCount: { $gt: 0 } };
    if (targetSetId) setFilter._id = targetSetId;
    const sets = await CcgSet.find(setFilter)
      .select("_id")
      .sort({ zoneId: 1 })
      .session(session)
      .lean();
    if (sets.length === 0) {
      if (targetSetId) throw new CcgServiceError(409, "target_set_unavailable", "That Legacy raid is not available for pack opening");
      throw new CcgServiceError(409, `${mode}_unavailable`, `The ${mode === "current" ? "Current" : "Legacy"} card pool is still being prepared`);
    }
    const sourceSetIds = sets.map((set) => set._id);
    const summaries = await CcgPackPool.aggregate<{
      _id: mongoose.Types.ObjectId;
      setId: mongoose.Types.ObjectId;
      version: string;
      counts: Array<{ grade: CcgTierGrade; count: number }>;
    }>([
      { $match: { setId: { $in: sourceSetIds }, active: true, totalCards: { $gt: 0 } } },
      {
        $project: {
          setId: 1,
          version: 1,
          counts: {
            $map: {
              input: "$buckets",
              as: "bucket",
              in: { grade: "$$bucket.grade", count: { $size: "$$bucket.cardIds" } },
            },
          },
        },
      },
      { $sort: { setId: 1, updatedAt: -1 } },
    ]).session(session);
    const poolSetIds = new Set(summaries.map((pool) => String(pool.setId)));
    if (summaries.length !== sets.length || sourceSetIds.some((setId) => !poolSetIds.has(String(setId)))) {
      throw new CcgServiceError(409, "pool_unavailable", `The ${mode === "current" ? "Current" : "Legacy"} card pool is incomplete`);
    }

    const plan = planPackSelections(
      summaries.map((pool) => ({
        poolId: String(pool._id),
        setId: String(pool.setId),
        version: pool.version,
        counts: pool.counts,
      })),
    );
    const selectedPoolIds = Array.from(new Set(plan.map((row) => row.poolId))).map((id) => new mongoose.Types.ObjectId(id));
    const selectedGrades = Array.from(new Set(plan.map((row) => row.tierGrade)));
    const bucketRows = await CcgPackPool.aggregate<{
      _id: mongoose.Types.ObjectId;
      buckets: Array<{ grade: CcgTierGrade; cardIds: mongoose.Types.ObjectId[] }>;
    }>([
      { $match: { _id: { $in: selectedPoolIds }, active: true } },
      {
        $project: {
          buckets: {
            $filter: {
              input: "$buckets",
              as: "bucket",
              cond: { $in: ["$$bucket.grade", selectedGrades] },
            },
          },
        },
      },
    ]).session(session);
    const cardsByBucket = new Map<string, mongoose.Types.ObjectId[]>();
    for (const row of bucketRows) {
      for (const bucket of row.buckets) cardsByBucket.set(`${row._id}:${bucket.grade}`, bucket.cardIds);
    }
    const results = plan.map((row) => {
      const cardIds = cardsByBucket.get(`${row.poolId}:${row.tierGrade}`);
      const cardId = cardIds?.[row.bucketOffset];
      if (!cardId) throw new CcgServiceError(409, "pool_invalid", "The pack pool changed while this pack was opening");
      return { cardId, setId: new mongoose.Types.ObjectId(row.setId), tierGrade: row.tierGrade };
    });
    const versionSeed = summaries
      .map((pool) => `${pool.setId}:${pool.version}`)
      .sort()
      .join("|");
    return {
      results,
      sourceSetIds,
      version: `${mode}:${targetSetId ? String(targetSetId) : "random"}:${createHash("sha256").update(versionSeed).digest("hex").slice(0, 20)}`,
    };
  }

  private async addOwnership(owner: CcgOwner, results: Array<Pick<SelectedResult, "cardId" | "finish">>, session: ClientSession): Promise<void> {
    const quantities = new Map<string, { cardId: mongoose.Types.ObjectId; finish: CcgFinish; quantity: number }>();
    for (const result of results) {
      const key = `${result.cardId}:${result.finish}`;
      const current = quantities.get(key);
      if (current) current.quantity += 1;
      else quantities.set(key, { cardId: result.cardId, finish: result.finish, quantity: 1 });
    }
    const now = new Date();
    await CcgOwnership.bulkWrite(
      Array.from(quantities.values()).map((row) => ({
        updateOne: {
          filter: { ownerType: owner.ownerType, ownerId: owner.ownerId, cardId: row.cardId, finish: row.finish },
          update: {
            $inc: { quantity: row.quantity },
            $set: { lastAcquiredAt: now },
            $setOnInsert: {
              firstAcquiredAt: now,
              dateKey: owner.ownerType === "guest" ? owner.dateKey : null,
              expiresAt: owner.ownerType === "guest" ? owner.expiresAt : null,
            },
          },
          upsert: true,
        },
      })),
      { session, ordered: true },
    );
  }

  private async applyDuplicateProgress(ownerId: mongoose.Types.ObjectId, mode: CcgMode, duplicates: number, sourceKey: string, session: ClientSession): Promise<number> {
    if (duplicates <= 0) return 0;
    const progress = await CcgOwnerProgress.findOneAndUpdate(
      { ownerId, mode },
      { $setOnInsert: { duplicateRemainder: 0, totalDuplicatePulls: 0, bonusPacksEarned: 0 } },
      { upsert: true, new: true, session },
    );
    const next = calculateDuplicateProgress(progress.duplicateRemainder, duplicates);
    const earned = next.earned;
    progress.duplicateRemainder = next.remainder;
    progress.totalDuplicatePulls += duplicates;
    progress.bonusPacksEarned += earned;
    await progress.save({ session });
    if (earned > 0) {
      await CcgPackCredit.findOneAndUpdate(
        { ownerId, sourceKey },
        { $setOnInsert: { mode, source: "duplicate", remaining: earned } },
        { upsert: true, session },
      );
      await CcgLedgerEntry.findOneAndUpdate(
        { ownerType: "user", ownerId, idempotencyKey: `duplicate-reward:${sourceKey}` },
        {
          $setOnInsert: {
            action: "duplicate_reward",
            mode,
            amount: earned,
            metadata: { duplicates, sourceKey },
          },
        },
        { upsert: true, new: true, session },
      );
    }
    return earned;
  }

  private async serializeOpening(opening: ICcgPackOpening | Record<string, any>): Promise<Record<string, unknown>> {
    const results = opening.results as ICcgPackResult[];
    const cards = await CcgCard.find({ _id: { $in: results.map((result) => result.cardId) } }).lean();
    const sets = await CcgSet.find({ _id: { $in: Array.from(new Set(cards.map((card) => String(card.setId)))) } }).lean();
    const cardById = new Map(cards.map((card) => [String(card._id), card]));
    const setById = new Map(sets.map((set) => [String(set._id), set]));
    return {
      id: String(opening._id),
      mode: opening.mode,
      targetSetId: opening.targetSetId ? String(opening.targetSetId) : null,
      sets: sets.map((set) => this.serializeSet(set)),
      allowanceSource: opening.allowanceSource,
      duplicateRewards: opening.duplicateRewards,
      createdAt: opening.createdAt,
      results: results.map((result, index) => {
        const card = cardById.get(String(result.cardId));
        const set = card ? setById.get(String(card.setId)) : null;
        return {
          position: index + 1,
          finish: result.finish,
          isDuplicate: result.isDuplicate,
          card: card && set ? this.serializeCard(card, set) : null,
        };
      }),
    };
  }

  private serializeSet(set: ICcgSet | Record<string, any>, ownedCards = 0): Record<string, unknown> {
    return {
      id: String(set._id),
      slug: set.slug,
      zoneId: set.zoneId,
      raidName: set.raidName,
      expansionName: set.expansionName,
      state: set.state,
      enabledAt: set.enabledAt ?? null,
      themeKey: set.themeKey,
      theme: set.theme,
      backgroundPath: set.backgroundPath,
      cardCount: set.cardCount,
      ownedCards,
      publicationWave: set.publicationWave,
      lastPublishedAt: set.lastPublishedAt ?? null,
    };
  }

  private serializeCard(card: ICcgCard | Record<string, any>, set: ICcgSet | Record<string, any>): Record<string, unknown> {
    return {
      id: String(card._id),
      characterId: String(card.characterId),
      setNumber: card.setNumber,
      name: card.name,
      realm: card.realm,
      region: card.region,
      guildId: card.guildId ? String(card.guildId) : null,
      guildName: card.guildName ?? null,
      guildRealm: card.guildRealm ?? null,
      classID: card.classID,
      specName: card.specName,
      role: card.role,
      metric: card.metric,
      itemLevel: card.itemLevel,
      scores: {
        performance: card.parseScore,
        mechanics: card.survivalScore,
        combined: card.combinedScore,
        mythicPlus: card.mythicPlusScore ?? null,
      },
      tierGrade: card.tierGrade,
      avatarUrl: card.avatarUrl ?? null,
      renderUrl: card.renderUrl ?? null,
      backgroundCrop: card.backgroundCrop,
      performanceSnapshotAt: card.performanceSnapshotAt,
      mediaCapturedAt: card.mediaCapturedAt ?? null,
      publicationWave: card.publicationWave,
      publishedAt: card.publishedAt,
      set: this.serializeSet(set),
    };
  }

  private async findClaimableGuest(req: Request, includeClaimed = false): Promise<ICcgGuest | null> {
    const raw = typeof req.cookies?.[CCG_GUEST_COOKIE] === "string" ? req.cookies[CCG_GUEST_COOKIE] : null;
    if (!raw) return null;
    const filter: Record<string, unknown> = {
      tokenHash: hashGuestToken(raw),
      dateKey: getHelsinkiDateKey(),
      expiresAt: { $gt: new Date() },
    };
    if (!includeClaimed) filter.claimedAt = null;
    return CcgGuest.findOne(filter);
  }

}

export default new CcgService();
