import { createHash, randomBytes } from "crypto";
import { Request, Response } from "express";
import mongoose, { ClientSession } from "mongoose";
import {
  CCG_CARDS_PER_PACK,
  CCG_DAILY_PACKS_PER_MODE,
  CCG_DUPLICATES_PER_BONUS_PACK,
  CCG_FEATURE_ENABLED,
  CCG_GUEST_COOKIE,
  CCG_PACK_RULE_VERSION,
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
import CcgPackCredit from "../models/CcgPackCredit";
import CcgPackOpening, { ICcgPackOpening, ICcgPackResult } from "../models/CcgPackOpening";
import CcgPackPool from "../models/CcgPackPool";
import CcgQualityProgress, { ICcgQualityProgress } from "../models/CcgQualityProgress";
import CcgSet, { ICcgSet } from "../models/CcgSet";
import User from "../models/User";
import { CcgFinishPity, compareFinish, emptyFinishPity, nextFinish, rollProtectedFinish } from "../utils/ccg-random";
import { calculateDuplicateProgress, countGuestClaimPulls, guestClaimIsWithinLimit, planPackSelections } from "../utils/ccg-pack";
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
    const allowance = await this.ensureAllowance(owner);
    const [creditRows, progressRows, qualityProgress, ownershipCount, guestClaim] = await Promise.all([
      owner.ownerType === "user"
        ? CcgPackCredit.aggregate<{ _id: CcgMode; remaining: number }>([
            { $match: { ownerId: owner.ownerId, remaining: { $gt: 0 } } },
            { $group: { _id: "$mode", remaining: { $sum: "$remaining" } } },
          ])
        : [],
      owner.ownerType === "user" ? CcgOwnerProgress.find({ ownerId: owner.ownerId }).lean() : [],
      CcgQualityProgress.findOne({ ownerType: owner.ownerType, ownerId: owner.ownerId }).lean(),
      CcgOwnership.countDocuments({ ownerType: owner.ownerType, ownerId: owner.ownerId }),
      owner.ownerType === "user" ? this.findClaimableGuest(req) : null,
    ]);
    const credits = new Map(creditRows.map((row) => [row._id, row.remaining]));
    const progress = new Map(progressRows.map((row) => [row.mode, row]));
    const resetAt = getNextHelsinkiReset();

    return {
      ownerType: owner.ownerType,
      dateKey: owner.dateKey,
      resetAt,
      claimableGuestCards: guestClaim ? await this.countGuestPulls(guestClaim._id) : { current: 0, legacy: 0 },
      packs: {
        current: {
          dailyRemaining: Math.max(0, allowance.currentGranted - allowance.currentOpened),
          bonusRemaining: credits.get("current") ?? 0,
          totalRemaining: Math.max(0, allowance.currentGranted - allowance.currentOpened) + (credits.get("current") ?? 0),
        },
        legacy: {
          dailyRemaining: Math.max(0, allowance.legacyGranted - allowance.legacyOpened),
          bonusRemaining: credits.get("legacy") ?? 0,
          totalRemaining: Math.max(0, allowance.legacyGranted - allowance.legacyOpened) + (credits.get("legacy") ?? 0),
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
    options: { page?: number; limit?: number; owned?: string; grade?: string; guildId?: string },
  ): Promise<Record<string, unknown>> {
    const set = await CcgSet.findOne({ slug: setSlug, enabledAt: { $ne: null } }).lean();
    if (!set) throw new CcgServiceError(404, "set_not_found", "Card set not found");
    const page = Math.max(1, Math.floor(options.page ?? 1));
    const limit = Math.min(45, Math.max(1, Math.floor(options.limit ?? 9)));
    const grade = CCG_TIER_GRADES.includes(options.grade as CcgTierGrade) ? (options.grade as CcgTierGrade) : null;
    const cardFilter: Record<string, unknown> = { setId: set._id };
    if (grade) cardFilter.tierGrade = grade;
    if (options.guildId) cardFilter.guildId = validateObjectId(options.guildId, "guild ID");

    let ownedIds: mongoose.Types.ObjectId[] | null = null;
    if (options.owned === "owned" || options.owned === "missing") {
      ownedIds = await CcgOwnership.distinct("cardId", { ownerType: owner.ownerType, ownerId: owner.ownerId });
      cardFilter._id = options.owned === "owned" ? { $in: ownedIds } : { $nin: ownedIds };
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
      { $sort: { "set.zoneId": -1, "card.name": 1 } },
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
    if (!req.session.userId) throw new CcgServiceError(401, "authentication_required", "Log in to keep today's cards");
    const userId = validateObjectId(req.session.userId, "user session");
    const idempotencyKey = validateIdempotencyKey(body.idempotencyKey);
    const guest = await this.findClaimableGuest(req, true);
    if (!guest) return { claimed: false, alreadyClaimed: false, cards: { current: 0, legacy: 0 }, conversionPacks: 0 };
    if (guest.claimedByUserId) {
      if (String(guest.claimedByUserId) !== String(userId)) throw new CcgServiceError(409, "guest_already_claimed", "These guest cards were already claimed");
      return { claimed: false, alreadyClaimed: true, cards: await this.countGuestPulls(guest._id), conversionPacks: 0 };
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
        if (!transactionalGuest) throw new CcgServiceError(410, "guest_expired", "Today's guest cards have expired");
        if (transactionalGuest.claimedByUserId) {
          response = { claimed: false, alreadyClaimed: true, cards: await this.countGuestPulls(transactionalGuest._id, session), conversionPacks: 0 };
          return;
        }
        const openings = await CcgPackOpening.find({
          ownerType: "guest",
          ownerId: transactionalGuest._id,
          dateKey: transactionalGuest.dateKey,
          claimedAt: null,
        })
          .sort({ createdAt: 1 })
          .session(session);
        const pulls = countGuestClaimPulls(openings);
        if (!guestClaimIsWithinLimit(pulls)) {
          throw new CcgServiceError(409, "guest_claim_limit", "The guest haul exceeds the daily claim limit");
        }

        const allResults = openings.flatMap((opening) => opening.results.map((result) => ({ ...result, mode: opening.mode })));
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
        const userOwner: CcgOwner = { ownerType: "user", ownerId: userId, dateKey: transactionalGuest.dateKey };
        await this.addOwnership(userOwner, mergedResults, session);
        await this.mergeGuestQualityProgress(transactionalGuest._id, userOwner, session);
        const currentRewards = await this.applyDuplicateProgress(userId, "current", duplicates.current, `claim:${transactionalGuest._id}:current`, session);
        const legacyRewards = await this.applyDuplicateProgress(userId, "legacy", duplicates.legacy, `claim:${transactionalGuest._id}:legacy`, session);

        const conversionResult = await CcgPackCredit.updateOne(
          { ownerId: userId, sourceKey: "login-conversion-v1" },
          { $setOnInsert: { mode: "current", source: "login_conversion", remaining: 5 } },
          { upsert: true, session },
        );
        const conversionPacks = conversionResult.upsertedCount > 0 ? 5 : 0;
        if (conversionPacks > 0) {
          await CcgLedgerEntry.findOneAndUpdate(
            { ownerType: "user", ownerId: userId, idempotencyKey: "login-conversion-v1" },
            {
              $setOnInsert: {
                action: "login_conversion",
                mode: "current",
                amount: conversionPacks,
                metadata: { guestId: String(transactionalGuest._id) },
              },
            },
            { upsert: true, new: true, session },
          );
        }
        await CcgPackOpening.updateMany(
          { _id: { $in: openings.map((opening) => opening._id) } },
          { $set: { claimedByUserId: userId, claimedAt: new Date() } },
          { session },
        );
        await CcgGuest.updateOne(
          { _id: transactionalGuest._id, claimedAt: null },
          { $set: { claimedByUserId: userId, claimedAt: new Date() } },
          { session },
        );
        await CcgOwnership.deleteMany({ ownerType: "guest", ownerId: transactionalGuest._id }, { session });
        await CcgDailyAllowance.deleteMany({ ownerType: "guest", ownerId: transactionalGuest._id }, { session });
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
                pulls,
                duplicates,
                duplicateRewards: { current: currentRewards, legacy: legacyRewards },
                conversionPacks,
              },
            },
          ],
          { session },
        );
        response = { claimed: true, alreadyClaimed: false, cards: pulls, duplicates, duplicateRewards: { current: currentRewards, legacy: legacyRewards }, conversionPacks };
      });
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        return { claimed: false, alreadyClaimed: true, cards: await this.countGuestPulls(guest._id), conversionPacks: 0 };
      }
      if (isTransactionUnsupported(error)) {
        throw new CcgServiceError(503, "transactions_unavailable", "Card claiming is temporarily unavailable while collection storage is starting");
      }
      throw error;
    } finally {
      await session.endSession();
    }
    return response ?? { claimed: false, alreadyClaimed: true, cards: await this.countGuestPulls(guest._id), conversionPacks: 0 };
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
    const [ownership, allowances, openings, ledgers, qualityProgress, guests] = await Promise.all([
      CcgOwnership.deleteMany({ ownerType: "guest", expiresAt: { $lte: now } }),
      CcgDailyAllowance.deleteMany({ ownerType: "guest", expiresAt: { $lte: now } }),
      CcgPackOpening.deleteMany({ ownerType: "guest", expiresAt: { $lte: now } }),
      CcgLedgerEntry.deleteMany({ ownerType: "guest", expiresAt: { $lte: now } }),
      CcgQualityProgress.deleteMany({ ownerType: "guest", expiresAt: { $lte: now } }),
      CcgGuest.deleteMany({ expiresAt: { $lte: now } }),
    ]);
    return {
      ownership: ownership.deletedCount,
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

  private async mergeGuestQualityProgress(guestId: mongoose.Types.ObjectId, userOwner: CcgOwner, session: ClientSession): Promise<void> {
    const guestProgress = await CcgQualityProgress.findOne({ ownerType: "guest", ownerId: guestId }).session(session);
    if (!guestProgress) return;
    const userProgress = await this.ensureQualityProgress(userOwner, session);
    const guestPity = this.readFinishPity(guestProgress);
    const userPity = this.readFinishPity(userProgress);
    this.writeFinishPity(userProgress, {
      foil: Math.max(userPity.foil, guestPity.foil),
      golden: Math.max(userPity.golden, guestPity.golden),
      prismatic: Math.max(userPity.prismatic, guestPity.prismatic),
      holographic: Math.max(userPity.holographic, guestPity.holographic),
      negative: Math.max(userPity.negative, guestPity.negative),
    });
    await userProgress.save({ session });
    await CcgQualityProgress.deleteOne({ _id: guestProgress._id }, { session });
  }

  private async ensureAllowance(owner: CcgOwner, session?: ClientSession) {
    const filter = { ownerType: owner.ownerType, ownerId: owner.ownerId, dateKey: owner.dateKey };
    const allowance = await CcgDailyAllowance.findOneAndUpdate(
      filter,
      {
        $setOnInsert: {
          currentGranted: CCG_DAILY_PACKS_PER_MODE,
          currentOpened: 0,
          legacyGranted: CCG_DAILY_PACKS_PER_MODE,
          legacyOpened: 0,
          expiresAt: owner.ownerType === "guest" ? owner.expiresAt : null,
        },
      },
      { upsert: true, new: true, session },
    );
    await CcgLedgerEntry.findOneAndUpdate(
      { ownerType: owner.ownerType, ownerId: owner.ownerId, idempotencyKey: `daily:${owner.dateKey}` },
      {
        $setOnInsert: {
          action: "daily_grant",
          mode: null,
          amount: CCG_DAILY_PACKS_PER_MODE * 2,
          metadata: { current: CCG_DAILY_PACKS_PER_MODE, legacy: CCG_DAILY_PACKS_PER_MODE },
          dateKey: owner.dateKey,
          expiresAt: owner.ownerType === "guest" ? owner.expiresAt : null,
        },
      },
      { upsert: true, new: true, session },
    );
    return allowance;
  }

  private async reservePack(owner: CcgOwner, mode: CcgMode, session: ClientSession): Promise<{ source: "daily" | "credit"; creditId?: mongoose.Types.ObjectId }> {
    await this.ensureAllowance(owner, session);
    const openedField = mode === "current" ? "currentOpened" : "legacyOpened";
    const grantedField = mode === "current" ? "currentGranted" : "legacyGranted";
    const allowance = await CcgDailyAllowance.findOneAndUpdate(
      {
        ownerType: owner.ownerType,
        ownerId: owner.ownerId,
        dateKey: owner.dateKey,
        $expr: { $lt: [`$${openedField}`, `$${grantedField}`] },
      },
      { $inc: { [openedField]: 1 } },
      { new: true, session },
    );
    if (allowance) return { source: "daily" };
    if (owner.ownerType === "guest") throw new CcgServiceError(409, "no_packs", `No ${mode} packs remain today`);
    const credit = await CcgPackCredit.findOneAndUpdate(
      { ownerId: owner.ownerId, mode, remaining: { $gt: 0 } },
      { $inc: { remaining: -1 } },
      { new: true, sort: { createdAt: 1 }, session },
    );
    if (!credit) throw new CcgServiceError(409, "no_packs", `No ${mode} packs remain`);
    return { source: "credit", creditId: credit._id };
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

  private async countGuestPulls(guestId: mongoose.Types.ObjectId, session?: ClientSession): Promise<{ current: number; legacy: number }> {
    const openings = await CcgPackOpening.find({ ownerType: "guest", ownerId: guestId }).select("mode results").session(session ?? null).lean();
    const result = { current: 0, legacy: 0 };
    for (const opening of openings) result[opening.mode] += opening.results.length;
    return result;
  }
}

export default new CcgService();
