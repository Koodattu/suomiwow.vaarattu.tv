import mongoose, { Document, Schema } from "mongoose";
import { CcgMode } from "../config/ccg";
import { CcgOwnerType } from "./CcgOwnership";

export type CcgLedgerAction = "daily_grant" | "pack_open" | "card_acquire" | "duplicate_reward" | "guest_claim" | "login_conversion" | "admin_adjustment" | "redeem_code" | "raid_rollover" | "twitch_reward";

export interface ICcgLedgerEntry extends Document {
  ownerType: CcgOwnerType;
  ownerId: mongoose.Types.ObjectId;
  action: CcgLedgerAction;
  mode?: CcgMode | null;
  idempotencyKey: string;
  amount: number;
  metadata: Record<string, unknown>;
  dateKey?: string | null;
  createdAt: Date;
}

const CcgLedgerEntrySchema = new Schema<ICcgLedgerEntry>(
  {
    ownerType: { type: String, enum: ["user", "guest"], required: true, index: true },
    ownerId: { type: Schema.Types.ObjectId, required: true, index: true },
    action: {
      type: String,
      enum: ["daily_grant", "pack_open", "card_acquire", "duplicate_reward", "guest_claim", "login_conversion", "admin_adjustment", "redeem_code", "raid_rollover", "twitch_reward"],
      required: true,
      index: true,
    },
    mode: { type: String, enum: ["current", "legacy", null], default: null },
    idempotencyKey: { type: String, required: true },
    amount: { type: Number, required: true, default: 0 },
    metadata: { type: Schema.Types.Mixed, default: {} },
    dateKey: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

CcgLedgerEntrySchema.index({ ownerType: 1, ownerId: 1, idempotencyKey: 1 }, { unique: true });
CcgLedgerEntrySchema.index({ ownerType: 1, ownerId: 1, createdAt: -1 });

export default mongoose.model<ICcgLedgerEntry>("CcgLedgerEntry", CcgLedgerEntrySchema);
