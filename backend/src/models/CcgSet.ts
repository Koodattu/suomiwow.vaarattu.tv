import mongoose, { Document, Schema } from "mongoose";
import { CCG_CUSTOM_FINISHES, CcgCustomFinishConfig, CcgSetKind, CcgSetState } from "../config/ccg";

export interface ICcgSet extends Document {
  slug: string;
  zoneId: number;
  raidName: string;
  expansionName: string;
  mythicPlusSeason: string;
  state: CcgSetState;
  kind: CcgSetKind;
  enabledAt?: Date | null;
  enabledBy?: mongoose.Types.ObjectId | null;
  opensAt?: Date | null;
  closesAt?: Date | null;
  lockedAt?: Date | null;
  themeKey: string;
  themeVersion: string;
  theme: { mark: string; accent: string; glow: string };
  customFinish?: CcgCustomFinishConfig | null;
  backgroundPath: string;
  packArtOffsetX: number;
  backgroundSafeCrop: { x: number; y: number; scale: number; xJitter: number; yJitter: number };
  eligibilityVersion: string;
  gradingVersion: string;
  packRuleVersion: string;
  publicationWave: number;
  cardCount: number;
  lastSnapshotAt?: Date | null;
  lastPublishedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const CustomFinishSchema = new Schema(
  {
    key: { type: String, enum: CCG_CUSTOM_FINISHES, required: true },
    hardPity: { type: Number, required: true, min: 2 },
  },
  { _id: false },
);

const CcgSetSchema = new Schema<ICcgSet>(
  {
    slug: { type: String, required: true, unique: true, index: true },
    zoneId: { type: Number, required: true, unique: true, index: true },
    raidName: { type: String, required: true },
    expansionName: { type: String, required: true },
    mythicPlusSeason: { type: String, required: true },
    state: { type: String, enum: ["draft", "current", "legacy", "locked"], required: true, index: true },
    kind: { type: String, enum: ["raid", "community"], required: true, default: "raid", index: true },
    enabledAt: { type: Date, default: null, index: true },
    enabledBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    opensAt: { type: Date, default: null },
    closesAt: { type: Date, default: null },
    lockedAt: { type: Date, default: null },
    themeKey: { type: String, required: true },
    themeVersion: { type: String, required: true },
    theme: {
      mark: { type: String, required: true },
      accent: { type: String, required: true },
      glow: { type: String, required: true },
    },
    customFinish: { type: CustomFinishSchema, default: null },
    backgroundPath: { type: String, required: true },
    packArtOffsetX: { type: Number, required: true, default: 50, min: 0, max: 100 },
    backgroundSafeCrop: {
      x: { type: Number, required: true },
      y: { type: Number, required: true },
      scale: { type: Number, required: true },
      xJitter: { type: Number, required: true },
      yJitter: { type: Number, required: true },
    },
    eligibilityVersion: { type: String, required: true },
    gradingVersion: { type: String, required: true },
    packRuleVersion: { type: String, required: true },
    publicationWave: { type: Number, required: true, default: 0 },
    cardCount: { type: Number, required: true, default: 0 },
    lastSnapshotAt: { type: Date, default: null },
    lastPublishedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

CcgSetSchema.index({ state: 1, opensAt: -1 });

export default mongoose.model<ICcgSet>("CcgSet", CcgSetSchema);
