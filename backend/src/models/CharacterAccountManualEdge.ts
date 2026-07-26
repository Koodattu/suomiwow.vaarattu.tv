import mongoose, { Document, Schema } from "mongoose";

export interface ICharacterAccountManualEdge extends Document {
  pairKey: string;
  characterAId: mongoose.Types.ObjectId;
  characterBId: mongoose.Types.ObjectId;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const CharacterAccountManualEdgeSchema = new Schema<ICharacterAccountManualEdge>(
  {
    pairKey: { type: String, required: true, unique: true, index: true },
    characterAId: { type: Schema.Types.ObjectId, ref: "Character", required: true, index: true },
    characterBId: { type: Schema.Types.ObjectId, ref: "Character", required: true, index: true },
    createdBy: { type: String, required: true },
  },
  { timestamps: true },
);

export default mongoose.model<ICharacterAccountManualEdge>("CharacterAccountManualEdge", CharacterAccountManualEdgeSchema);
