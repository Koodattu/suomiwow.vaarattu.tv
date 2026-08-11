import mongoose, { Document, Schema } from "mongoose";

export interface ICcgStyleVote extends Document {
  voterType: "user" | "guest";
  voterId: mongoose.Types.ObjectId;
  dateKey: string;
  theme: string;
  pairKey: string;
  winnerSubmissionId: mongoose.Types.ObjectId;
  loserSubmissionId: mongoose.Types.ObjectId;
  createdAt: Date;
}

const CcgStyleVoteSchema = new Schema<ICcgStyleVote>(
  {
    voterType: { type: String, enum: ["user", "guest"], required: true, index: true },
    voterId: { type: Schema.Types.ObjectId, required: true, index: true },
    dateKey: { type: String, required: true, index: true },
    theme: { type: String, required: true },
    pairKey: { type: String, required: true },
    winnerSubmissionId: { type: Schema.Types.ObjectId, ref: "CcgStyleSubmission", required: true },
    loserSubmissionId: { type: Schema.Types.ObjectId, ref: "CcgStyleSubmission", required: true },
    createdAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: false },
);

CcgStyleVoteSchema.index({ voterType: 1, voterId: 1, dateKey: 1, pairKey: 1 }, { unique: true });
CcgStyleVoteSchema.index({ dateKey: 1, winnerSubmissionId: 1 });

export default mongoose.model<ICcgStyleVote>("CcgStyleVote", CcgStyleVoteSchema);
