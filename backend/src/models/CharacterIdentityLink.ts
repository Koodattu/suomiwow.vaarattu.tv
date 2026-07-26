import mongoose, { Document, Schema } from "mongoose";

export interface ICharacterIdentityLink extends Document {
  identityKey: string;
  sourceName: string;
  sourceRealm: string;
  sourceRegion: string;
  sourceClassID: number;
  targetCharacterId: mongoose.Types.ObjectId;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const CharacterIdentityLinkSchema = new Schema<ICharacterIdentityLink>(
  {
    identityKey: { type: String, required: true, unique: true, index: true },
    sourceName: { type: String, required: true },
    sourceRealm: { type: String, required: true },
    sourceRegion: { type: String, required: true },
    sourceClassID: { type: Number, required: true },
    targetCharacterId: { type: Schema.Types.ObjectId, ref: "Character", required: true, index: true },
    createdBy: { type: String, required: true },
  },
  { timestamps: true },
);

CharacterIdentityLinkSchema.index({ targetCharacterId: 1, createdAt: -1 });

export default mongoose.model<ICharacterIdentityLink>("CharacterIdentityLink", CharacterIdentityLinkSchema);
