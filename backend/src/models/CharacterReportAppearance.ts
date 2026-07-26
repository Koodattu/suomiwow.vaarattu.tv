import mongoose, { Schema, Document } from "mongoose";

const CASE_INSENSITIVE_COLLATION = { locale: "en", strength: 2 } as const;

export interface ICharacterReportGuildSnapshot {
  name: string;
  realm: string;
  region: string;
}

export interface ICharacterReportAppearance extends Document {
  characterId?: mongoose.Types.ObjectId | null;
  wclCanonicalCharacterId?: number | null;
  manualIdentityLinkId?: mongoose.Types.ObjectId | null;
  sourceIdentityKey: string;
  appearanceSource: "rankedCharacters" | "reportRankings";
  reportCode: string;
  reportStartTime: Date;
  reportZoneId?: number;
  reportGuildId: mongoose.Types.ObjectId;
  reportGuildName: string;
  reportGuildRealm: string;
  characterName: string;
  characterRealm: string;
  characterRegion: string;
  classID: number;
  specNames: string[];
  rankingFightIds: number[];
  hidden: boolean;
  wclGuilds: ICharacterReportGuildSnapshot[];
  createdAt: Date;
  updatedAt: Date;
}

const CharacterReportGuildSnapshotSchema = new Schema<ICharacterReportGuildSnapshot>(
  {
    name: { type: String, required: true },
    realm: { type: String, required: true },
    region: { type: String, required: true },
  },
  { _id: false },
);

const CharacterReportAppearanceSchema = new Schema<ICharacterReportAppearance>(
  {
    characterId: { type: Schema.Types.ObjectId, ref: "Character", default: null, index: true },
    wclCanonicalCharacterId: { type: Number, default: null, index: true },
    manualIdentityLinkId: { type: Schema.Types.ObjectId, ref: "CharacterIdentityLink", default: null, index: true },
    sourceIdentityKey: { type: String, required: true },
    appearanceSource: { type: String, enum: ["rankedCharacters", "reportRankings"], required: true, default: "rankedCharacters", index: true },
    reportCode: { type: String, required: true, index: true },
    reportStartTime: { type: Date, required: true, index: true },
    reportZoneId: { type: Number, index: true },
    reportGuildId: { type: Schema.Types.ObjectId, ref: "Guild", required: true, index: true },
    reportGuildName: { type: String, required: true },
    reportGuildRealm: { type: String, required: true },
    characterName: { type: String, required: true },
    characterRealm: { type: String, required: true },
    characterRegion: { type: String, required: true },
    classID: { type: Number, required: true },
    specNames: { type: [String], default: [] },
    rankingFightIds: { type: [Number], default: [] },
    hidden: { type: Boolean, required: true, default: false },
    wclGuilds: { type: [CharacterReportGuildSnapshotSchema], default: [] },
  },
  { timestamps: true },
);

CharacterReportAppearanceSchema.index({ reportCode: 1, sourceIdentityKey: 1 }, { unique: true, partialFilterExpression: { sourceIdentityKey: { $type: "string" } } });
CharacterReportAppearanceSchema.index({ reportCode: 1, wclCanonicalCharacterId: 1, classID: 1 }, { unique: true, partialFilterExpression: { wclCanonicalCharacterId: { $type: "number" } } });
CharacterReportAppearanceSchema.index({ wclCanonicalCharacterId: 1, reportStartTime: 1 }, { partialFilterExpression: { wclCanonicalCharacterId: { $type: "number" } } });
CharacterReportAppearanceSchema.index({ wclCanonicalCharacterId: 1, classID: 1 }, { partialFilterExpression: { wclCanonicalCharacterId: { $type: "number" } } });
CharacterReportAppearanceSchema.index({ reportZoneId: 1, reportStartTime: 1 });
CharacterReportAppearanceSchema.index({ reportZoneId: 1, reportCode: 1 });
CharacterReportAppearanceSchema.index({ reportZoneId: 1, reportGuildId: 1, classID: 1, reportStartTime: 1 });
CharacterReportAppearanceSchema.index({ reportGuildId: 1, reportStartTime: 1 });
CharacterReportAppearanceSchema.index({ characterName: 1, characterRealm: 1, characterRegion: 1, classID: 1 });
CharacterReportAppearanceSchema.index({ characterRealm: 1, characterName: 1, classID: 1, reportStartTime: -1 }, { collation: CASE_INSENSITIVE_COLLATION });
CharacterReportAppearanceSchema.index({ wclCanonicalCharacterId: 1, classID: 1, reportStartTime: -1 }, { partialFilterExpression: { wclCanonicalCharacterId: { $type: "number" } } });

export default mongoose.model<ICharacterReportAppearance>("CharacterReportAppearance", CharacterReportAppearanceSchema);
