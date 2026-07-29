import mongoose, { Schema, Document } from "mongoose";
import { normalizeRealmSlug } from "../utils/realm";

const CASE_INSENSITIVE_COLLATION = { locale: "en", strength: 2 } as const;

export interface IGuildHistoryEntry {
  guildName: string;
  guildRealm: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

export interface ICharacterBlizzardIdentityOverride {
  name: string;
  realm: string;
  updatedAt: Date;
  updatedBy: string;
}

export interface ICharacter extends Document {
  wclCanonicalCharacterId: number;
  name: string;
  realm: string;
  region: string;
  classID: number;
  guildName?: string;
  guildRealm?: string;
  guildUpdatedAt?: Date;
  guildHistory: IGuildHistoryEntry[];
  wclProfileHidden: boolean;
  blizzardIdentityOverride?: ICharacterBlizzardIdentityOverride | null;

  lastMythicSeenAt?: Date | null;
  firstReportSeenAt?: Date;
  lastReportSeenAt?: Date;
  identityObservedAt?: Date;
  rankingsAvailable: boolean | null;
  nextEligibleRefreshAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}

const GuildHistoryEntrySchema: Schema = new Schema(
  {
    guildName: { type: String, required: true },
    guildRealm: { type: String, required: true },
    firstSeenAt: { type: Date, required: true },
    lastSeenAt: { type: Date, required: true },
  },
  { _id: false },
);

const CharacterBlizzardIdentityOverrideSchema: Schema = new Schema(
  {
    name: { type: String, required: true },
    realm: { type: String, required: true, set: normalizeRealmSlug },
    updatedAt: { type: Date, required: true },
    updatedBy: { type: String, required: true },
  },
  { _id: false },
);

const CharacterSchema: Schema = new Schema(
  {
    wclCanonicalCharacterId: { type: Number, required: true },
    name: { type: String, required: true },
    realm: { type: String, required: true, set: normalizeRealmSlug },
    region: { type: String, required: true },
    classID: { type: Number, required: true },
    guildName: { type: String, required: false, default: null },
    guildRealm: { type: String, required: false, default: null },
    guildUpdatedAt: { type: Date, required: false, default: null },
    guildHistory: { type: [GuildHistoryEntrySchema], default: [] },
    wclProfileHidden: { type: Boolean, required: true, default: false },
    blizzardIdentityOverride: { type: CharacterBlizzardIdentityOverrideSchema, required: false, default: null },

    lastMythicSeenAt: { type: Date, required: false, default: null },
    firstReportSeenAt: { type: Date },
    lastReportSeenAt: { type: Date },
    identityObservedAt: { type: Date },
    rankingsAvailable: { type: Boolean, required: false, default: null },
    nextEligibleRefreshAt: { type: Date, required: false, default: Date.now },
  },
  { timestamps: true },
);

CharacterSchema.index({ wclCanonicalCharacterId: 1, classID: 1 }, { unique: true });
CharacterSchema.index({ name: 1, realm: 1, region: 1 });
CharacterSchema.index({ "blizzardIdentityOverride.name": 1, "blizzardIdentityOverride.realm": 1, region: 1 });
CharacterSchema.index({ realm: 1, name: 1, classID: 1 }, { collation: CASE_INSENSITIVE_COLLATION });
CharacterSchema.index({
  lastMythicSeenAt: -1,
  rankingsAvailable: 1,
  nextEligibleRefreshAt: 1,
});
CharacterSchema.index({ lastReportSeenAt: -1 });

export default mongoose.model<ICharacter>("Character", CharacterSchema);
