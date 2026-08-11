import mongoose, { Document, Schema } from "mongoose";

export type CcgGameMode = "expedition" | "raid" | "race";

export interface ICcgGameRun extends Document {
  ownerType: "user" | "guest";
  ownerId: mongoose.Types.ObjectId;
  mode: CcgGameMode;
  idempotencyKey: string;
  weeklyKey: string;
  encounterId: string;
  seed: string;
  rosterCardIds: string[];
  activeCardIds: string[];
  assignments: Record<string, unknown>;
  result: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const CcgGameRunSchema = new Schema<ICcgGameRun>(
  {
    ownerType: { type: String, enum: ["user", "guest"], required: true, index: true },
    ownerId: { type: Schema.Types.ObjectId, required: true, index: true },
    mode: { type: String, enum: ["expedition", "raid", "race"], required: true, index: true },
    idempotencyKey: { type: String, required: true },
    weeklyKey: { type: String, required: true, index: true },
    encounterId: { type: String, required: true },
    seed: { type: String, required: true },
    rosterCardIds: { type: [String], required: true },
    activeCardIds: { type: [String], required: true },
    assignments: { type: Schema.Types.Mixed, required: true },
    result: { type: Schema.Types.Mixed, required: true },
  },
  { timestamps: true },
);

CcgGameRunSchema.index({ ownerType: 1, ownerId: 1, mode: 1, idempotencyKey: 1 }, { unique: true });
CcgGameRunSchema.index({ mode: 1, weeklyKey: 1, "result.score": -1, createdAt: 1 });

export default mongoose.model<ICcgGameRun>("CcgGameRun", CcgGameRunSchema);
