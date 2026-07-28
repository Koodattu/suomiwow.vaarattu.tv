import mongoose, { Document, Schema } from "mongoose";

export interface ICharacterContinuityLink extends Document {
  sourceCharacterId: mongoose.Types.ObjectId;
  targetCharacterId: mongoose.Types.ObjectId;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const CharacterContinuityLinkSchema = new Schema<ICharacterContinuityLink>(
  {
    sourceCharacterId: { type: Schema.Types.ObjectId, ref: "Character", required: true, unique: true, index: true },
    targetCharacterId: { type: Schema.Types.ObjectId, ref: "Character", required: true, index: true },
    createdBy: { type: String, required: true },
  },
  { timestamps: true },
);

CharacterContinuityLinkSchema.index({ targetCharacterId: 1, createdAt: 1 });

export default mongoose.model<ICharacterContinuityLink>("CharacterContinuityLink", CharacterContinuityLinkSchema);
