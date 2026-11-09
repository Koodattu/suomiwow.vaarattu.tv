import mongoose, { Schema, Document } from "mongoose";
import { normalizeRealmSlug } from "../utils/realm";

const CASE_INSENSITIVE_COLLATION = { locale: "en", strength: 2 } as const;
const ACCENT_INSENSITIVE_COLLATION = { locale: "en", strength: 1 } as const;

export interface ICharacterRaidParticipation extends Document {
  characterId?: mongoose.Types.ObjectId | null;
  wclCanonicalCharacterId?: number | null;
  zoneId: number;
  reportGuildId: mongoose.Types.ObjectId;
  reportGuildName: string;
  reportGuildRealm: string;
  characterName: string;
  characterRealm: string;
  characterRegion: string;
  classID: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  reportCount: number;
  mythicReportCount: number;
  raidNightCount: number;
  mythicNightCount: number;
  affiliationQualifiedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const CharacterRaidParticipationSchema = new Schema<ICharacterRaidParticipation>(
  {
    characterId: { type: Schema.Types.ObjectId, ref: "Character", default: null, index: true },
    wclCanonicalCharacterId: { type: Number, default: null, index: true },
    zoneId: { type: Number, required: true, index: true },
    reportGuildId: { type: Schema.Types.ObjectId, ref: "Guild", required: true, index: true },
    reportGuildName: { type: String, required: true },
    reportGuildRealm: { type: String, required: true },
    characterName: { type: String, required: true },
    characterRealm: { type: String, required: true, set: normalizeRealmSlug },
    characterRegion: { type: String, required: true },
    classID: { type: Number, required: true },
    firstSeenAt: { type: Date, required: true },
    lastSeenAt: { type: Date, required: true },
    reportCount: { type: Number, required: true, default: 0 },
    mythicReportCount: { type: Number, required: true, default: 0 },
    raidNightCount: { type: Number, default: 0 },
    mythicNightCount: { type: Number, default: 0 },
    affiliationQualifiedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

CharacterRaidParticipationSchema.index({ reportGuildId: 1, zoneId: 1, classID: 1, characterName: 1 });
CharacterRaidParticipationSchema.index({ characterRealm: 1, characterName: 1, classID: 1 });
CharacterRaidParticipationSchema.index({ zoneId: 1, lastSeenAt: -1 });
CharacterRaidParticipationSchema.index({ reportCount: -1, characterId: 1 });
CharacterRaidParticipationSchema.index({ zoneId: 1, mythicReportCount: -1, characterId: 1 });
CharacterRaidParticipationSchema.index({ zoneId: 1, affiliationQualifiedAt: 1, characterId: 1 });
CharacterRaidParticipationSchema.index({ characterRealm: 1, characterName: 1, zoneId: 1, lastSeenAt: -1 }, { collation: CASE_INSENSITIVE_COLLATION });
CharacterRaidParticipationSchema.index({ characterRealm: 1, characterName: 1, reportGuildId: 1, zoneId: 1, classID: 1 }, { collation: CASE_INSENSITIVE_COLLATION });
CharacterRaidParticipationSchema.index({ characterName: 1, lastSeenAt: -1 }, { collation: ACCENT_INSENSITIVE_COLLATION });
CharacterRaidParticipationSchema.index({ wclCanonicalCharacterId: 1, classID: 1, zoneId: 1, firstSeenAt: 1 });
CharacterRaidParticipationSchema.index(
  {
    wclCanonicalCharacterId: 1,
    zoneId: 1,
    reportGuildId: 1,
    classID: 1,
  },
  { unique: true, partialFilterExpression: { wclCanonicalCharacterId: { $type: "number" } } },
);
CharacterRaidParticipationSchema.index(
  {
    characterRealm: 1,
    characterName: 1,
    classID: 1,
    zoneId: 1,
    reportGuildId: 1,
  },
  { unique: true, partialFilterExpression: { wclCanonicalCharacterId: null } },
);

export default mongoose.model<ICharacterRaidParticipation>("CharacterRaidParticipation", CharacterRaidParticipationSchema);
