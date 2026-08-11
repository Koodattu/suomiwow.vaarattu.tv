import mongoose, { Document, Schema } from "mongoose";

export interface ICcgRaceEntry extends Document {
  ownerType: "user" | "guest";
  ownerId: mongoose.Types.ObjectId;
  weeklyKey: string;
  idempotencyKey: string;
  status: "queued" | "matched";
  rosterCost: number;
  result: Record<string, unknown>;
  opponentEntryId?: mongoose.Types.ObjectId | null;
  outcome?: "win" | "loss" | "draw" | null;
  createdAt: Date;
  updatedAt: Date;
}

const CcgRaceEntrySchema = new Schema<ICcgRaceEntry>(
  {
    ownerType: { type: String, enum: ["user", "guest"], required: true, index: true },
    ownerId: { type: Schema.Types.ObjectId, required: true, index: true },
    weeklyKey: { type: String, required: true, index: true },
    idempotencyKey: { type: String, required: true },
    status: { type: String, enum: ["queued", "matched"], required: true, default: "queued", index: true },
    rosterCost: { type: Number, required: true },
    result: { type: Schema.Types.Mixed, required: true },
    opponentEntryId: { type: Schema.Types.ObjectId, ref: "CcgRaceEntry", default: null },
    outcome: { type: String, enum: ["win", "loss", "draw", null], default: null },
  },
  { timestamps: true },
);

CcgRaceEntrySchema.index({ ownerType: 1, ownerId: 1, idempotencyKey: 1 }, { unique: true });
CcgRaceEntrySchema.index({ weeklyKey: 1, status: 1, createdAt: 1 });

export default mongoose.model<ICcgRaceEntry>("CcgRaceEntry", CcgRaceEntrySchema);
