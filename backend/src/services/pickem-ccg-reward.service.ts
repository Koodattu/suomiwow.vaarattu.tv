import mongoose from "mongoose";
import { CCG_FEATURE_ENABLED } from "../config/ccg";
import CcgLedgerEntry from "../models/CcgLedgerEntry";
import CcgPackCredit from "../models/CcgPackCredit";
import Pickem, { IPickem } from "../models/Pickem";
import User from "../models/User";
import pickemService from "./pickem.service";

export interface PickemCcgRewardStatus {
  packs: number;
  eligible: boolean;
  claimed: boolean;
}

export interface PickemCcgRewardClaimResult {
  packs: number;
  claimed: true;
  alreadyClaimed: boolean;
}

export type PickemCcgRewardErrorCode =
  | "CCG_DISABLED"
  | "PICKEM_NOT_FOUND"
  | "REWARD_DISABLED"
  | "NOT_ELIGIBLE"
  | "TRANSACTIONS_UNAVAILABLE";

export class PickemCcgRewardError extends Error {
  constructor(
    public readonly code: PickemCcgRewardErrorCode,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "PickemCcgRewardError";
  }
}

export function getPickemCcgRewardSourceKey(pickemObjectId: mongoose.Types.ObjectId): string {
  return `pickem-reward:${pickemObjectId}`;
}

function isTransactionUnsupported(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Transaction numbers are only allowed") || message.includes("replica set member or mongos");
}

function isDuplicateKeyError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: number }).code === 11000);
}

class PickemCcgRewardService {
  async getStatus(
    pickem: Pick<IPickem, "_id" | "ccgRewardPacks">,
    userId: mongoose.Types.ObjectId | null,
    eligible: boolean,
  ): Promise<PickemCcgRewardStatus | null> {
    const packs = pickem.ccgRewardPacks ?? 0;
    if (!CCG_FEATURE_ENABLED || packs <= 0) return null;

    const claimed = userId
      ? Boolean(await CcgPackCredit.exists({ ownerId: userId, sourceKey: getPickemCcgRewardSourceKey(pickem._id) }))
      : false;

    return { packs, eligible, claimed };
  }

  async claim(userId: mongoose.Types.ObjectId, pickemId: string): Promise<PickemCcgRewardClaimResult> {
    if (!CCG_FEATURE_ENABLED) {
      throw new PickemCcgRewardError("CCG_DISABLED", 404, "SuomiWoW CCG is not available");
    }

    return pickemService.runWithMutationLock(pickemId, async () => {
      const session = await mongoose.startSession();
      let result: PickemCcgRewardClaimResult | null = null;
      let sourceKey: string | null = null;

      try {
        await session.withTransaction(async () => {
          const pickem = await Pickem.findOne({ pickemId, active: true }).session(session);
          if (!pickem) {
            throw new PickemCcgRewardError("PICKEM_NOT_FOUND", 404, "Pickem not found");
          }

          const packs = pickem.ccgRewardPacks ?? 0;
          if (packs <= 0) {
            throw new PickemCcgRewardError("REWARD_DISABLED", 409, "This Pickem does not have a CCG pack reward");
          }

          const participant = await User.exists({ _id: userId, "pickems.pickemId": pickemId }).session(session);
          if (!participant) {
            throw new PickemCcgRewardError("NOT_ELIGIBLE", 409, "Submit predictions before claiming this reward");
          }

          sourceKey = getPickemCcgRewardSourceKey(pickem._id);
          const existing = await CcgPackCredit.exists({ ownerId: userId, sourceKey }).session(session);
          if (existing) {
            result = { packs, claimed: true, alreadyClaimed: true };
            return;
          }

          await CcgPackCredit.create(
            [{ ownerId: userId, source: "pickem_reward", sourceKey, remaining: packs }],
            { session },
          );
          await CcgLedgerEntry.create(
            [{
              ownerType: "user",
              ownerId: userId,
              action: "pickem_reward",
              mode: null,
              idempotencyKey: sourceKey,
              amount: packs,
              metadata: {
                pickemId,
                pickemObjectId: String(pickem._id),
                pickemType: pickem.type,
                packs,
              },
            }],
            { session },
          );

          result = { packs, claimed: true, alreadyClaimed: false };
        });
      } catch (error) {
        if (error instanceof PickemCcgRewardError) throw error;
        if (isTransactionUnsupported(error)) {
          throw new PickemCcgRewardError(
            "TRANSACTIONS_UNAVAILABLE",
            503,
            "Pack claiming is temporarily unavailable while collection storage is starting",
          );
        }
        if (isDuplicateKeyError(error) && sourceKey) {
          const existing = await CcgPackCredit.exists({ ownerId: userId, sourceKey });
          if (existing) {
            const pickem = await Pickem.findOne({ pickemId }).select("ccgRewardPacks").lean();
            return { packs: pickem?.ccgRewardPacks ?? 0, claimed: true, alreadyClaimed: true };
          }
        }
        throw error;
      } finally {
        await session.endSession();
      }

      if (!result) throw new Error("Pickem CCG reward claim did not produce a result");
      return result;
    });
  }
}

export default new PickemCcgRewardService();
