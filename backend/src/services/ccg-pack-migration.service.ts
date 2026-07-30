import mongoose, { ClientSession } from "mongoose";
import { CCG_PACK_BALANCE_VERSION } from "../config/ccg";
import CcgMigration from "../models/CcgMigration";
import CcgOwnership from "../models/CcgOwnership";
import CcgPackBalance from "../models/CcgPackBalance";
import CcgPackCredit from "../models/CcgPackCredit";
import CcgPackOpening from "../models/CcgPackOpening";
import CcgRedeemCode from "../models/CcgRedeemCode";
import CcgRollover from "../models/CcgRollover";
import CcgSeriesOwnership from "../models/CcgSeriesOwnership";
import { getRechargeTickStart } from "../utils/ccg-recharge";

export const CCG_UNIFIED_PACKS_MIGRATION_KEY = "ccg-unified-packs-v1";
export const CCG_UNIFIED_PACK_CREDIT_INDEX = "ownerId_1_remaining_1_createdAt_1";

const LEGACY_CAP = 50;
const LEGACY_TICK_MS = 30 * 60 * 1000;
const LEGACY_CURRENT_INTERVAL_MS = 60 * 60 * 1000;
const LEGACY_GUEST_INITIAL = 20;
const LEGACY_PREVIOUS_GUEST_INITIAL = 5;

type LegacyMode = "current" | "legacy";

type LegacyBalance = {
  _id: mongoose.Types.ObjectId;
  ownerType: "user" | "guest";
  ownerId: mongoose.Types.ObjectId;
  currentRemaining?: number;
  legacyRemaining?: number;
  remaining?: number;
  lastRechargeAt: Date;
  lastRolloverSequence?: number;
  grantVersion?: number;
  hasPlayed?: boolean;
  firstPlayedAt?: Date | null;
};

type LegacyCreditBalance = {
  _id: mongoose.Types.ObjectId;
  current: number;
  legacy: number;
};

type LegacyRollover = {
  sequence: number;
  effectiveAt: Date;
  userCurrentPacks: number;
  guestCurrentPacks: number;
};

export type CcgUnifiedPackMigrationPlan = {
  cutoverAt: Date;
  balances: number;
  regularPacksBefore: number;
  elapsedRechargePacks: number;
  rolloverPacks: number;
  regularPacksAfter: number;
  bonusPacks: number;
  totalPacksAfter: number;
  redeemCodes: number;
  redeemCodePacks: number;
};

function legacyTickStart(date: Date): Date {
  return new Date(Math.floor(date.getTime() / LEGACY_TICK_MS) * LEGACY_TICK_MS);
}

function countLegacyRecharge(mode: LegacyMode, lastRechargeAt: Date, date: Date): number {
  const interval = mode === "current" ? LEGACY_CURRENT_INTERVAL_MS : LEGACY_TICK_MS;
  const lastTick = legacyTickStart(lastRechargeAt).getTime();
  const currentTick = legacyTickStart(date).getTime();
  if (currentTick <= lastTick) return 0;
  return Math.min(LEGACY_CAP, Math.floor(currentTick / interval) - Math.floor(lastTick / interval));
}

function applyLegacyRecharge(
  balances: Record<LegacyMode, number>,
  credits: Record<LegacyMode, number>,
  lastRechargeAt: Date,
  date: Date,
): { balances: Record<LegacyMode, number>; lastRechargeAt: Date; granted: number } {
  const currentGrant = Math.min(
    countLegacyRecharge("current", lastRechargeAt, date),
    Math.max(0, LEGACY_CAP - balances.current - credits.current),
  );
  const legacyGrant = Math.min(
    countLegacyRecharge("legacy", lastRechargeAt, date),
    Math.max(0, LEGACY_CAP - balances.legacy - credits.legacy),
  );
  return {
    balances: {
      current: balances.current + currentGrant,
      legacy: balances.legacy + legacyGrant,
    },
    lastRechargeAt: legacyTickStart(date),
    granted: currentGrant + legacyGrant,
  };
}

function normalizeLegacyBalance(balance: LegacyBalance, hasActivity: boolean): {
  balances: Record<LegacyMode, number>;
  hasPlayed: boolean;
} {
  const hasPlayed = balance.hasPlayed === true || hasActivity;
  const current = Math.max(0, Math.floor(balance.currentRemaining ?? 0));
  const legacy = Math.max(0, Math.floor(balance.legacyRemaining ?? 0));
  if (balance.grantVersion === 3 && typeof balance.hasPlayed === "boolean") {
    return { balances: { current, legacy }, hasPlayed };
  }
  if (!hasPlayed) {
    return { balances: { current: LEGACY_GUEST_INITIAL, legacy: LEGACY_GUEST_INITIAL }, hasPlayed };
  }
  if (balance.ownerType === "guest" && balance.grantVersion === 2) {
    const upgrade = (remaining: number) => Math.min(
      LEGACY_CAP,
      remaining + LEGACY_GUEST_INITIAL - LEGACY_PREVIOUS_GUEST_INITIAL,
    );
    return { balances: { current: upgrade(current), legacy: upgrade(legacy) }, hasPlayed };
  }
  return { balances: { current, legacy }, hasPlayed };
}

export function simulateLegacyBalance(
  balance: LegacyBalance,
  creditBalance: Record<LegacyMode, number>,
  rollovers: readonly LegacyRollover[],
  cutoverAt: Date,
  hasActivity = false,
): { remaining: number; elapsedRechargePacks: number; rolloverPacks: number; regularBefore: number; hasPlayed: boolean } {
  const normalized = normalizeLegacyBalance(balance, hasActivity);
  let balances = normalized.balances;
  let credits = { ...creditBalance };
  let lastRechargeAt = balance.lastRechargeAt;
  let elapsedRechargePacks = 0;
  let rolloverPacks = 0;
  let carriedRegular = 0;
  let expectedSequence = balance.lastRolloverSequence ?? 0;

  for (const rollover of rollovers) {
    if (rollover.sequence <= expectedSequence) continue;
    if (rollover.sequence !== expectedSequence + 1) {
      throw new Error(`CCG rollover history is incomplete for ${balance.ownerType}:${balance.ownerId}`);
    }
    if (rollover.effectiveAt.getTime() > lastRechargeAt.getTime()) {
      const recharged = applyLegacyRecharge(balances, credits, lastRechargeAt, rollover.effectiveAt);
      balances = recharged.balances;
      lastRechargeAt = recharged.lastRechargeAt;
      elapsedRechargePacks += recharged.granted;
    }
    if (balance.ownerType === "user") {
      carriedRegular += balances.current;
      credits = { current: 0, legacy: credits.legacy + credits.current + balances.current };
    } else {
      balances.legacy += balances.current;
    }
    const newCurrent = balance.ownerType === "user" ? rollover.userCurrentPacks : rollover.guestCurrentPacks;
    balances.current = newCurrent;
    rolloverPacks += newCurrent;
    expectedSequence = rollover.sequence;
  }

  const recharged = applyLegacyRecharge(balances, credits, lastRechargeAt, cutoverAt);
  elapsedRechargePacks += recharged.granted;
  return {
    remaining: recharged.balances.current + recharged.balances.legacy + carriedRegular,
    elapsedRechargePacks,
    rolloverPacks,
    regularBefore: normalized.balances.current + normalized.balances.legacy,
    hasPlayed: normalized.hasPlayed,
  };
}

async function hasLegacyCcgActivity(balance: LegacyBalance, session?: ClientSession): Promise<boolean> {
  const owner = { ownerType: balance.ownerType, ownerId: balance.ownerId };
  const ownershipQuery = CcgOwnership.exists({
    ...owner,
    setId: { $type: "objectId" },
    characterId: { $type: "objectId" },
  });
  if (session) ownershipQuery.session(session);
  if (await ownershipQuery) return true;

  const seriesQuery = CcgSeriesOwnership.exists(owner);
  if (session) seriesQuery.session(session);
  if (await seriesQuery) return true;

  const openingQuery = CcgPackOpening.exists({ ...owner, state: "committed" });
  if (session) openingQuery.session(session);
  return Boolean(await openingQuery);
}

async function loadPlan(cutoverAt: Date, session?: ClientSession): Promise<{
  plan: CcgUnifiedPackMigrationPlan;
  updates: Array<{ id: mongoose.Types.ObjectId; remaining: number; hasPlayed: boolean; firstPlayedAt: Date | null }>;
  codeUpdates: Array<{ id: mongoose.Types.ObjectId; packs: number }>;
}> {
  const balanceQuery = CcgPackBalance.collection.find(
    {},
    session ? { session } : undefined,
  ) as unknown as AsyncIterable<LegacyBalance>;
  const creditAggregate = CcgPackCredit.aggregate<LegacyCreditBalance>([
    { $match: { remaining: { $gt: 0 } } },
    {
      $group: {
        _id: "$ownerId",
        current: { $sum: { $cond: [{ $eq: ["$mode", "current"] }, "$remaining", 0] } },
        legacy: { $sum: { $cond: [{ $eq: ["$mode", "legacy"] }, "$remaining", 0] } },
      },
    },
  ]);
  if (session) creditAggregate.session(session);
  const rolloverQuery = CcgRollover.find({}).sort({ sequence: 1 }).lean<LegacyRollover[]>();
  if (session) rolloverQuery.session(session);
  const codeQuery = CcgRedeemCode.collection.find(
    { rewardType: "packs" },
    { projection: { packs: 1, currentPacks: 1, legacyPacks: 1 }, ...(session ? { session } : {}) },
  ) as unknown as AsyncIterable<{ _id: mongoose.Types.ObjectId; packs?: number; currentPacks?: number; legacyPacks?: number }>;

  const creditRows = await creditAggregate;
  const rollovers = await rolloverQuery;
  const creditsByOwner = new Map(creditRows.map((row) => [String(row._id), { current: row.current, legacy: row.legacy }]));
  const updates: Array<{ id: mongoose.Types.ObjectId; remaining: number; hasPlayed: boolean; firstPlayedAt: Date | null }> = [];
  let regularPacksBefore = 0;
  let elapsedRechargePacks = 0;
  let rolloverPacks = 0;
  let regularPacksAfter = 0;

  for await (const balance of balanceQuery) {
    if (balance.grantVersion === CCG_PACK_BALANCE_VERSION && Number.isFinite(balance.remaining)) {
      updates.push({
        id: balance._id,
        remaining: Math.max(0, Math.floor(balance.remaining ?? 0)),
        hasPlayed: balance.hasPlayed === true,
        firstPlayedAt: balance.firstPlayedAt ?? null,
      });
      regularPacksBefore += balance.remaining ?? 0;
      regularPacksAfter += balance.remaining ?? 0;
      continue;
    }
    const legacyMetadataNeedsUpgrade = balance.grantVersion !== 3 || typeof balance.hasPlayed !== "boolean";
    const hasActivity = legacyMetadataNeedsUpgrade
      ? balance.hasPlayed === true || await hasLegacyCcgActivity(balance, session)
      : false;
    const simulated = simulateLegacyBalance(
      balance,
      creditsByOwner.get(String(balance.ownerId)) ?? { current: 0, legacy: 0 },
      rollovers,
      cutoverAt,
      hasActivity,
    );
    regularPacksBefore += simulated.regularBefore;
    elapsedRechargePacks += simulated.elapsedRechargePacks;
    rolloverPacks += simulated.rolloverPacks;
    regularPacksAfter += simulated.remaining;
    updates.push({
      id: balance._id,
      remaining: simulated.remaining,
      hasPlayed: simulated.hasPlayed,
      firstPlayedAt: simulated.hasPlayed ? (balance.firstPlayedAt ?? cutoverAt) : null,
    });
  }

  const codeUpdates: Array<{ id: mongoose.Types.ObjectId; packs: number }> = [];
  for await (const code of codeQuery) {
    const packs = code.packs ?? Math.max(0, Math.floor(code.currentPacks ?? 0)) + Math.max(0, Math.floor(code.legacyPacks ?? 0));
    codeUpdates.push({ id: code._id, packs });
  }
  const bonusPacks = creditRows.reduce((total, row) => total + row.current + row.legacy, 0);
  return {
    plan: {
      cutoverAt,
      balances: updates.length,
      regularPacksBefore,
      elapsedRechargePacks,
      rolloverPacks,
      regularPacksAfter,
      bonusPacks,
      totalPacksAfter: regularPacksAfter + bonusPacks,
      redeemCodes: codeUpdates.length,
      redeemCodePacks: codeUpdates.reduce((total, code) => total + code.packs, 0),
    },
    updates,
    codeUpdates,
  };
}

async function ensureCreditIndex(): Promise<void> {
  await CcgPackCredit.collection.createIndex(
    { ownerId: 1, remaining: 1, createdAt: 1 },
    { name: CCG_UNIFIED_PACK_CREDIT_INDEX },
  );
}

export async function planCcgUnifiedPackMigration(cutoverAt = new Date()): Promise<CcgUnifiedPackMigrationPlan> {
  return (await loadPlan(cutoverAt)).plan;
}

export async function migrateCcgUnifiedPacks(cutoverAt = new Date()): Promise<CcgUnifiedPackMigrationPlan> {
  const existing = await CcgMigration.findOne({ key: CCG_UNIFIED_PACKS_MIGRATION_KEY }).lean();
  if (existing) {
    await assertCcgUnifiedPacksReady();
    return existing.details as unknown as CcgUnifiedPackMigrationPlan;
  }

  const session = await mongoose.startSession();
  let completedPlan: CcgUnifiedPackMigrationPlan | null = null;
  try {
    await session.withTransaction(async () => {
      const duplicate = await CcgMigration.findOne({ key: CCG_UNIFIED_PACKS_MIGRATION_KEY }).session(session).lean();
      if (duplicate) {
        completedPlan = duplicate.details as unknown as CcgUnifiedPackMigrationPlan;
        return;
      }
      const { plan, updates, codeUpdates } = await loadPlan(cutoverAt, session);
      if (updates.length > 0) {
        await CcgPackBalance.collection.bulkWrite(updates.map((update) => ({
          updateOne: {
            filter: { _id: update.id },
            update: {
              $set: {
                remaining: update.remaining,
                lastRechargeAt: getRechargeTickStart(cutoverAt),
                grantVersion: CCG_PACK_BALANCE_VERSION,
                hasPlayed: update.hasPlayed,
                firstPlayedAt: update.firstPlayedAt,
              },
            },
          },
        })), { ordered: true, session });
      }
      if (codeUpdates.length > 0) {
        await CcgRedeemCode.collection.bulkWrite(codeUpdates.map((update) => ({
          updateOne: { filter: { _id: update.id }, update: { $set: { packs: update.packs } } },
        })), { ordered: true, session });
      }
      await CcgMigration.create([{
        key: CCG_UNIFIED_PACKS_MIGRATION_KEY,
        completedAt: cutoverAt,
        details: plan,
      }], { session });
      completedPlan = plan;
    });
  } finally {
    await session.endSession();
  }
  await ensureCreditIndex();
  await assertCcgUnifiedPacksReady();
  if (!completedPlan) throw new Error("CCG unified pack migration did not complete");
  return completedPlan;
}

export async function assertCcgUnifiedPacksReady(): Promise<void> {
  const marker = await CcgMigration.exists({ key: CCG_UNIFIED_PACKS_MIGRATION_KEY });
  if (!marker) {
    const [legacyBalance, legacyCode] = await Promise.all([
      CcgPackBalance.collection.findOne({
        $or: [
          { currentRemaining: { $exists: true } },
          { legacyRemaining: { $exists: true } },
          { grantVersion: { $ne: CCG_PACK_BALANCE_VERSION } },
        ],
      }),
      CcgRedeemCode.collection.findOne({ rewardType: "packs", packs: { $exists: false } }),
    ]);
    if (legacyBalance || legacyCode) {
      throw new Error("CCG unified packs migration is required; run npm run migrate:ccg-unified-packs before starting services");
    }
    await ensureCreditIndex();
    await CcgMigration.updateOne(
      { key: CCG_UNIFIED_PACKS_MIGRATION_KEY },
      { $setOnInsert: { completedAt: new Date(), details: { freshDatabase: true } } },
      { upsert: true },
    );
    return;
  }

  const [invalidBalance, invalidCode] = await Promise.all([
    CcgPackBalance.collection.findOne({
      $or: [
        { remaining: { $not: { $type: "number" } } },
        { remaining: { $lt: 0 } },
        { grantVersion: { $ne: CCG_PACK_BALANCE_VERSION } },
      ],
    }),
    CcgRedeemCode.collection.findOne({ rewardType: "packs", packs: { $not: { $type: "number" } } }),
  ]);
  if (invalidBalance || invalidCode) {
    throw new Error("CCG unified packs migration marker exists but migrated data is incomplete");
  }
  await ensureCreditIndex();
}
