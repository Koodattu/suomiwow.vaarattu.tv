import mongoose, { Document, Schema } from "mongoose";
import { CcgTierGrade } from "../config/ccg";

export interface ICcgPublicationCandidate extends Document {
  snapshotKey: string;
  setId: mongoose.Types.ObjectId;
  characterId: mongoose.Types.ObjectId;
  payload: Record<string, unknown>;
  tierGrade: CcgTierGrade;
  status: "ready" | "missing_media" | "published" | "unchanged";
  createdAt: Date;
  updatedAt: Date;
}

const CcgPublicationCandidateSchema = new Schema<ICcgPublicationCandidate>(
  {
    snapshotKey: { type: String, required: true, index: true },
    setId: { type: Schema.Types.ObjectId, ref: "CcgSet", required: true, index: true },
    characterId: { type: Schema.Types.ObjectId, ref: "Character", required: true, index: true },
    payload: { type: Schema.Types.Mixed, required: true },
    tierGrade: { type: String, enum: ["S", "A", "B", "C", "D", "E", "F"], required: true },
    status: { type: String, enum: ["ready", "missing_media", "published", "unchanged"], required: true, index: true },
  },
  { timestamps: true },
);

CcgPublicationCandidateSchema.index({ snapshotKey: 1, characterId: 1 }, { unique: true });
CcgPublicationCandidateSchema.index({ setId: 1, status: 1, createdAt: 1 });

export default mongoose.model<ICcgPublicationCandidate>("CcgPublicationCandidate", CcgPublicationCandidateSchema);
