import mongoose, { Document, Schema } from "mongoose";
import { CcgMode } from "../config/ccg";

export type CcgPackCreditSource = "duplicate" | "login_conversion" | "admin" | "raid_rollover" | "twitch_reward";

export interface ICcgPackCredit extends Document {
  ownerId: mongoose.Types.ObjectId;
  mode: CcgMode;
  source: CcgPackCreditSource;
  sourceKey: string;
  remaining: number;
  createdAt: Date;
  updatedAt: Date;
}

const CcgPackCreditSchema = new Schema<ICcgPackCredit>(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    mode: { type: String, enum: ["current", "legacy"], required: true, index: true },
    source: { type: String, enum: ["duplicate", "login_conversion", "admin", "raid_rollover", "twitch_reward"], required: true },
    sourceKey: { type: String, required: true },
    remaining: { type: Number, required: true, min: 0 },
  },
  { timestamps: true },
);

CcgPackCreditSchema.index({ ownerId: 1, sourceKey: 1 }, { unique: true });
CcgPackCreditSchema.index({ ownerId: 1, mode: 1, remaining: 1, createdAt: 1 });

export default mongoose.model<ICcgPackCredit>("CcgPackCredit", CcgPackCreditSchema);
