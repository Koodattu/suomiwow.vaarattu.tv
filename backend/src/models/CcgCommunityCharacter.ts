import mongoose, { Document, Schema } from "mongoose";
import { CcgTierGrade } from "../config/ccg";
import { CharacterRenderFit, CharacterRenderFitSchema } from "./CharacterRenderAsset";

export interface ICcgCommunityCharacter extends Document {
  identityKey: string;
  collectorKey: string;
  blizzardCharacterId: number;
  linkedCharacterId?: mongoose.Types.ObjectId | null;
  cardId?: mongoose.Types.ObjectId | null;
  name: string;
  realm: string;
  realmSlug: string;
  region: string;
  classID: number;
  specName: string;
  role: "dps" | "healer" | "tank";
  guildId?: mongoose.Types.ObjectId | null;
  guildName?: string | null;
  guildRealm?: string | null;
  tierGrade: CcgTierGrade;
  avatarUrl?: string | null;
  renderUrl?: string | null;
  renderAssetId?: mongoose.Types.ObjectId | null;
  renderAssetExpiresAt?: Date | null;
  renderFit?: CharacterRenderFit | null;
  active: boolean;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const CcgCommunityCharacterSchema = new Schema<ICcgCommunityCharacter>(
  {
    identityKey: { type: String, required: true, unique: true, index: true },
    collectorKey: { type: String, required: true, index: true },
    blizzardCharacterId: { type: Number, required: true, index: true },
    linkedCharacterId: { type: Schema.Types.ObjectId, ref: "Character", default: null, index: true },
    cardId: { type: Schema.Types.ObjectId, ref: "CcgCard", default: null, unique: true, sparse: true },
    name: { type: String, required: true },
    realm: { type: String, required: true },
    realmSlug: { type: String, required: true },
    region: { type: String, required: true },
    classID: { type: Number, required: true },
    specName: { type: String, required: true },
    role: { type: String, enum: ["dps", "healer", "tank"], required: true },
    guildId: { type: Schema.Types.ObjectId, ref: "Guild", default: null },
    guildName: { type: String, default: null },
    guildRealm: { type: String, default: null },
    tierGrade: { type: String, enum: ["H", "S", "A", "B", "C", "D", "E", "F"], required: true },
    avatarUrl: { type: String, default: null },
    renderUrl: { type: String, default: null },
    renderAssetId: { type: Schema.Types.ObjectId, ref: "CharacterRenderAsset", default: null, index: true },
    renderAssetExpiresAt: { type: Date, default: null, index: true },
    renderFit: { type: CharacterRenderFitSchema, default: null },
    active: { type: Boolean, required: true, default: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

export default mongoose.model<ICcgCommunityCharacter>("CcgCommunityCharacter", CcgCommunityCharacterSchema);
