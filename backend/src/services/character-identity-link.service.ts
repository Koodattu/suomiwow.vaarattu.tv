import mongoose from "mongoose";
import Character from "../models/Character";
import CharacterIdentityLink from "../models/CharacterIdentityLink";
import CharacterReportAppearance from "../models/CharacterReportAppearance";
import { CharacterIdentityAlias, createCharacterIdentityAliasKey, createReportRankingSourceIdentityKey } from "../utils/character-identity-link";

const CASE_INSENSITIVE_COLLATION = { locale: "en", strength: 2 } as const;

export type CharacterIdentityLinkPreview = {
  eligible: boolean;
  blockers: string[];
  source: CharacterIdentityAlias;
  target: {
    id: string;
    name: string;
    realm: string;
    region: string;
    classID: number;
    wclCanonicalCharacterId: number;
  };
  impact: {
    appearanceCount: number;
    unresolvedAppearanceCount: number;
    conflictingAppearanceCount: number;
    reportCollisionCount: number;
    raidCount: number;
    guildCount: number;
    firstSeenAt: Date | null;
    lastSeenAt: Date | null;
  };
  existingLink: {
    id: string;
    targetCharacterId: string;
    createdBy: string;
    createdAt: Date;
  } | null;
};

export class CharacterIdentityLinkError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
    public readonly code = "invalid_character_identity_link",
    public readonly preview?: CharacterIdentityLinkPreview,
  ) {
    super(message);
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function exactIdentityMatch(source: CharacterIdentityAlias): Record<string, unknown> {
  return {
    characterName: new RegExp(`^${escapeRegex(source.name)}$`, "i"),
    characterRealm: new RegExp(`^${escapeRegex(source.realm)}$`, "i"),
    characterRegion: new RegExp(`^${escapeRegex(source.region)}$`, "i"),
    classID: source.classID,
  };
}

function normalizeSource(source: CharacterIdentityAlias): CharacterIdentityAlias {
  return {
    name: source.name.trim(),
    realm: source.realm.trim(),
    region: source.region.trim().toLowerCase(),
    classID: Number(source.classID),
  };
}

class CharacterIdentityLinkService {
  async preview(targetCharacterId: string, rawSource: CharacterIdentityAlias): Promise<CharacterIdentityLinkPreview> {
    if (!mongoose.Types.ObjectId.isValid(targetCharacterId)) {
      throw new CharacterIdentityLinkError("Invalid target character ID");
    }

    const source = normalizeSource(rawSource);
    if (source.name.length < 2 || source.name.length > 24 || /\s/.test(source.name)) {
      throw new CharacterIdentityLinkError("Source character name must be 2-24 characters and cannot contain spaces");
    }
    if (source.realm.length < 2 || source.realm.length > 64 || source.region.length < 2 || source.region.length > 8) {
      throw new CharacterIdentityLinkError("Source realm or region is invalid");
    }
    if (!Number.isInteger(source.classID) || source.classID < 1) {
      throw new CharacterIdentityLinkError("Source class is invalid");
    }

    const target = await Character.findById(targetCharacterId)
      .select("name realm region classID wclCanonicalCharacterId")
      .lean();
    if (!target) throw new CharacterIdentityLinkError("Target character not found", 404, "target_character_not_found");
    if (target.classID !== source.classID) {
      throw new CharacterIdentityLinkError("Source and target must have the same class", 409, "character_class_mismatch");
    }

    const identityKey = createCharacterIdentityAliasKey(source);
    const identityMatch = exactIdentityMatch(source);
    const [summaryRows, existingLink, unresolvedReportCodes] = await Promise.all([
      CharacterReportAppearance.aggregate<{
        _id: null;
        appearanceCount: number;
        unresolvedAppearanceCount: number;
        conflictingAppearanceCount: number;
        raids: number[];
        guilds: string[];
        firstSeenAt: Date;
        lastSeenAt: Date;
      }>([
        { $match: identityMatch },
        {
          $group: {
            _id: null,
            appearanceCount: { $sum: 1 },
            unresolvedAppearanceCount: {
              $sum: {
                $cond: [{ $eq: [{ $ifNull: ["$wclCanonicalCharacterId", null] }, null] }, 1, 0],
              },
            },
            conflictingAppearanceCount: {
              $sum: {
                $cond: [
                  {
                    $or: [
                      {
                        $and: [
                          { $ne: [{ $ifNull: ["$characterId", null] }, null] },
                          { $ne: ["$characterId", target._id] },
                        ],
                      },
                      {
                        $and: [
                          { $ne: [{ $ifNull: ["$wclCanonicalCharacterId", null] }, null] },
                          { $ne: ["$wclCanonicalCharacterId", target.wclCanonicalCharacterId] },
                        ],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            raids: { $addToSet: "$reportZoneId" },
            guilds: { $addToSet: { $concat: ["$reportGuildName", "|", "$reportGuildRealm"] } },
            firstSeenAt: { $min: "$reportStartTime" },
            lastSeenAt: { $max: "$reportStartTime" },
          },
        },
      ]).collation(CASE_INSENSITIVE_COLLATION),
      CharacterIdentityLink.findOne({ identityKey }).lean(),
      CharacterReportAppearance.distinct("reportCode", {
        ...identityMatch,
        wclCanonicalCharacterId: null,
      }).collation(CASE_INSENSITIVE_COLLATION),
    ]);

    const summary = summaryRows[0];
    const reportCollisionCount = unresolvedReportCodes.length
      ? await CharacterReportAppearance.countDocuments({
          reportCode: { $in: unresolvedReportCodes },
          wclCanonicalCharacterId: target.wclCanonicalCharacterId,
          classID: target.classID,
          $nor: [identityMatch],
        })
      : 0;
    const blockers: string[] = [];
    const targetIdentityKey = createCharacterIdentityAliasKey({
      name: target.name,
      realm: target.realm,
      region: target.region,
      classID: target.classID,
    });

    if (!summary?.appearanceCount) blockers.push("noAppearances");
    if ((summary?.unresolvedAppearanceCount ?? 0) === 0) blockers.push("alreadyResolved");
    if ((summary?.conflictingAppearanceCount ?? 0) > 0) blockers.push("conflictingCharacter");
    if (reportCollisionCount > 0) blockers.push("reportCollision");
    if (identityKey === targetIdentityKey) blockers.push("sameIdentity");
    if (existingLink) blockers.push("existingLink");

    return {
      eligible: blockers.length === 0,
      blockers,
      source,
      target: {
        id: target._id.toString(),
        name: target.name,
        realm: target.realm,
        region: target.region,
        classID: target.classID,
        wclCanonicalCharacterId: target.wclCanonicalCharacterId,
      },
      impact: {
        appearanceCount: summary?.appearanceCount ?? 0,
        unresolvedAppearanceCount: summary?.unresolvedAppearanceCount ?? 0,
        conflictingAppearanceCount: summary?.conflictingAppearanceCount ?? 0,
        reportCollisionCount,
        raidCount: (summary?.raids ?? []).filter((zoneId) => typeof zoneId === "number").length,
        guildCount: (summary?.guilds ?? []).length,
        firstSeenAt: summary?.firstSeenAt ?? null,
        lastSeenAt: summary?.lastSeenAt ?? null,
      },
      existingLink: existingLink
        ? {
            id: existingLink._id.toString(),
            targetCharacterId: existingLink.targetCharacterId.toString(),
            createdBy: existingLink.createdBy,
            createdAt: existingLink.createdAt,
          }
        : null,
    };
  }

  async create(targetCharacterId: string, source: CharacterIdentityAlias, createdBy: string) {
    const preview = await this.preview(targetCharacterId, source);
    if (!preview.eligible) {
      throw new CharacterIdentityLinkError(preview.blockers.join("; "), 409, "character_identity_link_blocked", preview);
    }

    const link = await CharacterIdentityLink.create({
      identityKey: createCharacterIdentityAliasKey(preview.source),
      sourceName: preview.source.name,
      sourceRealm: preview.source.realm,
      sourceRegion: preview.source.region,
      sourceClassID: preview.source.classID,
      targetCharacterId: new mongoose.Types.ObjectId(targetCharacterId),
      createdBy,
    });

    await CharacterReportAppearance.updateMany(
      {
        ...exactIdentityMatch(preview.source),
        wclCanonicalCharacterId: null,
      },
      {
        $set: {
          characterId: new mongoose.Types.ObjectId(targetCharacterId),
          wclCanonicalCharacterId: preview.target.wclCanonicalCharacterId,
          manualIdentityLinkId: link._id,
        },
      },
      { collation: CASE_INSENSITIVE_COLLATION },
    );

    return { link, preview };
  }

  async remove(targetCharacterId: string, linkId: string): Promise<void> {
    if (!mongoose.Types.ObjectId.isValid(targetCharacterId) || !mongoose.Types.ObjectId.isValid(linkId)) {
      throw new CharacterIdentityLinkError("Invalid character identity link ID");
    }
    const link = await CharacterIdentityLink.findOne({ _id: linkId, targetCharacterId });
    if (!link) throw new CharacterIdentityLinkError("Character identity link not found", 404, "character_identity_link_not_found");

    await CharacterReportAppearance.updateMany(
      { manualIdentityLinkId: link._id },
      {
        $set: {
          characterId: null,
          wclCanonicalCharacterId: null,
          manualIdentityLinkId: null,
          sourceIdentityKey: createReportRankingSourceIdentityKey({
            name: link.sourceName,
            realm: link.sourceRealm,
            region: link.sourceRegion,
            classID: link.sourceClassID,
          }),
        },
      },
    );
    await link.deleteOne();
  }
}

export const characterIdentityLinkService = new CharacterIdentityLinkService();
export default characterIdentityLinkService;
