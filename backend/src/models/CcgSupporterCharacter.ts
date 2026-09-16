import mongoose, { Schema } from "mongoose";
import { CCG_CUSTOM_FINISHES, CCG_TIER_GRADES } from "../config/ccg";
import { CharacterRenderFitSchema } from "./CharacterRenderAsset";

const DraftSchema = new Schema({
  specName: { type: String, required: true },
  role: { type: String, enum: ["dps", "healer", "tank"], required: true },
  tierGrade: { type: String, enum: CCG_TIER_GRADES, required: true },
  creatorFinish: { type: String, enum: CCG_CUSTOM_FINISHES, required: true },
  performance: { type: Number, min: 0, max: 100, default: null },
  mechanics: { type: Number, min: 0, max: 100, default: null },
  mythicPlus: { type: Number, min: 0, max: 100_000, default: null },
  renderUrl: { type: String, default: null },
  renderAssetId: { type: Schema.Types.ObjectId, ref: "CharacterRenderAsset", default: null },
  renderFit: { type: CharacterRenderFitSchema, default: null },
  avatarUrl: { type: String, default: null },
  mediaCapturedAt: { type: Date, default: null },
}, { _id: false });

const CcgSupporterCharacterSchema = new Schema({
  creatorId: { type: Schema.Types.ObjectId, ref: "CcgSupporterCreator", required: true, index: true },
  identityKey: { type: String, required: true, unique: true },
  blizzardCharacterId: { type: Number, required: true },
  realmId: { type: Number, required: true },
  region: { type: String, enum: ["eu"], default: "eu", required: true },
  name: { type: String, required: true },
  realm: { type: String, required: true },
  realmSlug: { type: String, required: true },
  classID: { type: Number, required: true },
  collectorKey: { type: String, required: true },
  cardId: { type: Schema.Types.ObjectId, ref: "CcgCard" },
  draft: { type: DraftSchema, default: null },
  lastRender: { type: new Schema({
    renderUrl: String, renderAssetId: Schema.Types.ObjectId, renderFit: CharacterRenderFitSchema,
    avatarUrl: String, mediaCapturedAt: Date,
  }, { _id: false }), default: null },
  creatorFinish: { type: String, enum: CCG_CUSTOM_FINISHES, default: null },
  tierGrade: { type: String, enum: CCG_TIER_GRADES, default: null },
  revision: { type: Number, default: 0, required: true },
  lastAppliedRevision: { type: Number, default: null },
  nextRenderRefreshAt: { type: Date, default: () => new Date(0), required: true },
  renderLeaseToken: { type: String, default: null },
  renderError: { type: Boolean, default: false, required: true },
  renderUnchanged: { type: Boolean, default: false, required: true },
  nextEditAt: { type: Date, default: () => new Date(0), required: true },
  editsFrozen: { type: Boolean, default: false, required: true },
  distributable: { type: Boolean, default: true, required: true },
}, { timestamps: true });

CcgSupporterCharacterSchema.index({ cardId: 1 }, { unique: true, sparse: true });
export default mongoose.model("CcgSupporterCharacter", CcgSupporterCharacterSchema);
