import mongoose, { ClientSession } from "mongoose";
import { CcgFinish, getCcgPackFinishOrder } from "../config/ccg";
import Account from "../models/CcgDuplicateRewardAccount";
import Progress from "../models/CcgDuplicateRewardProgress";
import CcgOwnership from "../models/CcgOwnership";
import CcgCard from "../models/CcgCard";
import CcgSet from "../models/CcgSet";
import CcgPackCredit from "../models/CcgPackCredit";
import CcgLedgerEntry from "../models/CcgLedgerEntry";
import User from "../models/User";

export const DUPLICATES_PER_PACK = 10;
type Acquisition = { cardId: mongoose.Types.ObjectId; setId: mongoose.Types.ObjectId; characterId: mongoose.Types.ObjectId; finish: CcgFinish };
const key = (row: { setId: unknown; characterId: unknown }) => `${row.setId}:${row.characterId}`;

export function historicalDuplicateCount(rows: Array<{ finish: CcgFinish; quantity: number }>, required: readonly CcgFinish[]): number {
  const finishes = new Set(rows.filter(row => row.quantity > 0).map(row => row.finish));
  return required.every(finish => finishes.has(finish))
    ? Math.max(0, rows.reduce((sum, row) => sum + row.quantity, 0) - finishes.size)
    : 0;
}

class CcgDuplicateRewardsService {
  async ensure(ownerId: mongoose.Types.ObjectId, session?: ClientSession): Promise<void> {
    if (await Account.exists({ ownerId }).session(session ?? null)) return;
    if (!session) {
      const transaction = await mongoose.startSession();
      try { await transaction.withTransaction(() => this.ensure(ownerId, transaction)); }
      finally { await transaction.endSession(); }
      return;
    }
    // The existing user row serializes first initialization, including concurrent empty accounts.
    const user = await User.updateOne({ _id: ownerId }, { $inc: { __v: 1 } }, { session });
    if (!user.matchedCount) throw new Error("Duplicate reward owner not found");
    if (await Account.exists({ ownerId }).session(session)) return;
    const account = new Account({ ownerId, initializedAt: new Date() });
    const breakdown = await this.seed(ownerId, session);
    account.breakdown = breakdown;
    account.historicalPacks = Object.values(breakdown).reduce((sum, count) => sum + count, 0);
    await account.save({ session });
  }

  private async seed(ownerId: mongoose.Types.ObjectId, session: ClientSession) {
    // Match collections: legacy malformed rows are preserved, but cannot earn rewards.
    const rows = await CcgOwnership.find({
      ownerType: "user", ownerId, quantity: { $gt: 0 },
      setId: { $type: "objectId" },
      characterId: { $type: "objectId" },
    }).session(session).lean();
    const sets = await CcgSet.find({ _id: { $in: rows.map(row => row.setId) } }).session(session).lean();
    const setById = new Map(sets.map(set => [String(set._id), set]));
    const supporterIds = sets.filter(set => set.kind === "supporter").map(set => set._id);
    const cards = supporterIds.length ? await CcgCard.find({ setId: { $in: supporterIds } })
      .select("setId characterId creatorFinish").session(session).lean() : [];
    const cardBySeries = new Map(cards.map(card => [key(card), card]));
    const groups = new Map<string, typeof rows>();
    for (const row of rows) { const group = groups.get(key(row)) ?? []; group.push(row); groups.set(key(row), group); }
    const breakdown = { raid: 0, community: 0, supporter: 0 };
    const operations = [];
    for (const [series, owned] of groups) {
      const set = setById.get(String(owned[0].setId));
      if (!set) throw new Error("Duplicate reward set metadata missing");
      const card = cardBySeries.get(series);
      if (set.kind === "supporter" && !card) throw new Error("Duplicate reward supporter metadata missing");
      const required = getCcgPackFinishOrder(set.kind, set.kind === "supporter" ? card?.creatorFinish : set.customFinish?.key);
      const duplicates = historicalDuplicateCount(owned, required);
      breakdown[set.kind] += Math.floor(duplicates / DUPLICATES_PER_PACK);
      if (duplicates) operations.push({ insertOne: { document: { ownerId, setId: owned[0].setId, characterId: owned[0].characterId, duplicates,
        processedMilestones: Math.floor(duplicates / DUPLICATES_PER_PACK) } } });
    }
    if (operations.length) await Progress.bulkWrite(operations, { session });
    return breakdown;
  }

  // Guest collection transfer is restricted by the existing claim flow to an empty account.
  async importGuest(ownerId: mongoose.Types.ObjectId, session: ClientSession) {
    const account = await Account.findOneAndUpdate({ ownerId }, { $inc: { revision: 1 } }, { session, returnDocument: "after" });
    if (!account) { await this.ensure(ownerId, session); return; }
    const breakdown = await this.seed(ownerId, session);
    account.breakdown = breakdown;
    account.historicalPacks = Object.values(breakdown).reduce((sum, count) => sum + count, 0);
    account.claimedAt = null;
    await account.save({ session });
  }

  async acquire(ownerId: mongoose.Types.ObjectId, results: Acquisition[], session: ClientSession) {
    await this.ensure(ownerId, session);
    await Account.updateOne({ ownerId }, { $inc: { revision: 1 } }, { session });
    const pairs = [...new Map(results.map(row => [key(row), { setId: row.setId, characterId: row.characterId }])).values()];
    const owned = pairs.length ? await CcgOwnership.find({ ownerType: "user", ownerId, $or: pairs, quantity: { $gt: 0 } }).session(session).lean() : [];
    const sets = await CcgSet.find({ _id: { $in: pairs.map(pair => pair.setId) } }).session(session).lean();
    const cards = await CcgCard.find({ _id: { $in: results.map(row => row.cardId) } }).select("creatorFinish").session(session).lean();
    const setById = new Map(sets.map(set => [String(set._id), set]));
    const cardById = new Map(cards.map(card => [String(card._id), card]));
    const finishes = new Map<string, Set<CcgFinish>>();
    for (const row of owned) { const values = finishes.get(key(row)) ?? new Set<CcgFinish>(); values.add(row.finish); finishes.set(key(row), values); }
    const rewards: Array<{ packs: number; progress?: number }> = [];
    for (const result of results) {
      const series = key(result);
      const values = finishes.get(series) ?? new Set<CcgFinish>();
      const set = setById.get(String(result.setId));
      if (!set) throw new Error("Duplicate reward set metadata missing");
      const required = getCcgPackFinishOrder(set.kind, set.kind === "supporter" ? cardById.get(String(result.cardId))?.creatorFinish : set.customFinish?.key);
      const eligible = values.has(result.finish) && required.every(finish => values.has(finish));
      values.add(result.finish); finishes.set(series, values);
      if (!eligible) { rewards.push({ packs: 0 }); continue; }
      const progress = await Progress.findOneAndUpdate(
        { ownerId, setId: result.setId, characterId: result.characterId }, { $inc: { duplicates: 1 } },
        { upsert: true, returnDocument: "after", session },
      );
      const remainder = progress.duplicates % DUPLICATES_PER_PACK;
      const milestones = Math.floor(progress.duplicates / DUPLICATES_PER_PACK);
      const packs = milestones - progress.processedMilestones;
      if (packs) {
        // A stable progress ID also survives character identity reconciliation.
        const sourceKey = `duplicate-milestone:${progress._id}:${milestones}`;
        progress.processedMilestones = milestones;
        await progress.save({ session });
        await CcgPackCredit.create([{ ownerId, source: "duplicate_milestone", sourceKey, remaining: packs }], { session });
        await CcgLedgerEntry.create([{ ownerType: "user", ownerId, action: "duplicate_milestone", idempotencyKey: sourceKey,
          amount: packs, metadata: { setId: String(result.setId), characterId: String(result.characterId), cardId: String(result.cardId) } }], { session });
      }
      rewards.push({ packs, progress: remainder });
    }
    return rewards;
  }

  async status(ownerId: mongoose.Types.ObjectId) {
    await this.ensure(ownerId);
    const account = await Account.findOne({ ownerId }).lean();
    return { availablePacks: account?.claimedAt ? 0 : account?.historicalPacks ?? 0, breakdown: account?.breakdown,
      claimedAt: account?.claimedAt ?? null };
  }

  async claim(ownerId: mongoose.Types.ObjectId, session: ClientSession) {
    await this.ensure(ownerId, session);
    const account = await Account.findOneAndUpdate({ ownerId, claimedAt: null, historicalPacks: { $gt: 0 } },
      { $set: { claimedAt: new Date() }, $inc: { revision: 1 } }, { session, returnDocument: "after" });
    if (!account) return 0;
    const sourceKey = "duplicate-backfill:v1";
    await CcgPackCredit.create([{ ownerId, source: "duplicate_backfill", sourceKey, remaining: account.historicalPacks }], { session });
    await CcgLedgerEntry.create([{ ownerType: "user", ownerId, action: "duplicate_backfill", idempotencyKey: sourceKey,
      amount: account.historicalPacks, metadata: { breakdown: account.breakdown } }], { session });
    return account.historicalPacks;
  }
}

export default new CcgDuplicateRewardsService();
