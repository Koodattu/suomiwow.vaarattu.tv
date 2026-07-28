import mongoose from "mongoose";
import Character from "../models/Character";
import CharacterContinuityLink from "../models/CharacterContinuityLink";
import CharacterLeaderboard from "../models/CharacterLeaderboard";
import CharacterMechanicsLeaderboard from "../models/CharacterMechanicsLeaderboard";
import CharacterReportAppearance from "../models/CharacterReportAppearance";
import Ranking from "../models/Ranking";
import { buildCharacterContinuityGraph, CharacterContinuityGraph } from "../utils/character-continuity";

const CASE_INSENSITIVE_COLLATION = { locale: "en", strength: 2 } as const;

type CharacterSummary = {
  id: string;
  name: string;
  realm: string;
  region: string;
  classID: number;
  wclCanonicalCharacterId: number;
};

export type CharacterContinuityPreview = {
  eligible: boolean;
  blockers: string[];
  source: CharacterSummary;
  target: CharacterSummary;
  sourceCluster: CharacterSummary[];
  targetCluster: CharacterSummary[];
  impact: {
    wclIdentityCount: number;
    appearanceCount: number;
    raidCount: number;
    guildCount: number;
    rankingCount: number;
    leaderboardCount: number;
    mechanicsCount: number;
    sharedReportCount: number;
    firstSeenAt: Date | null;
    lastSeenAt: Date | null;
  };
  existingLink: {
    id: string;
    sourceCharacterId: string;
    targetCharacterId: string;
    createdBy: string;
    createdAt: Date;
  } | null;
};

export class CharacterContinuityError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
    public readonly code = "invalid_character_continuity_link",
    public readonly preview?: CharacterContinuityPreview,
  ) {
    super(message);
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function summarizeCharacter(character: {
  _id: unknown;
  name: string;
  realm: string;
  region: string;
  classID: number;
  wclCanonicalCharacterId: number;
}): CharacterSummary {
  return {
    id: String(character._id),
    name: character.name,
    realm: character.realm,
    region: character.region,
    classID: character.classID,
    wclCanonicalCharacterId: character.wclCanonicalCharacterId,
  };
}

class CharacterContinuityService {
  async getGraph(): Promise<CharacterContinuityGraph> {
    const links = await CharacterContinuityLink.find({}).select("sourceCharacterId targetCharacterId").lean();
    return buildCharacterContinuityGraph(links);
  }

  async getCluster(characterId: unknown): Promise<{ rootCharacterId: string; memberCharacterIds: string[] }> {
    const graph = await this.getGraph();
    return {
      rootCharacterId: graph.resolveRoot(characterId),
      memberCharacterIds: graph.getMemberIds(characterId),
    };
  }

  async preview(targetCharacterId: string, rawSource: { name: unknown; realm: unknown; region: unknown }): Promise<CharacterContinuityPreview> {
    if (!mongoose.Types.ObjectId.isValid(targetCharacterId)) {
      throw new CharacterContinuityError("Invalid target character ID");
    }

    const name = typeof rawSource.name === "string" ? rawSource.name.trim() : "";
    const realm = typeof rawSource.realm === "string" ? rawSource.realm.trim() : "";
    const region = typeof rawSource.region === "string" ? rawSource.region.trim().toLowerCase() : "";
    if (name.length < 2 || name.length > 24 || /\s/.test(name)) {
      throw new CharacterContinuityError("Character name must be 2-24 characters and cannot contain spaces");
    }
    if (realm.length < 2 || realm.length > 64 || region.length < 2 || region.length > 8) {
      throw new CharacterContinuityError("Character realm or region is invalid");
    }

    const [target, sourceMatches, links] = await Promise.all([
      Character.findById(targetCharacterId).select("name realm region classID wclCanonicalCharacterId").lean(),
      Character.find({
        name: new RegExp(`^${escapeRegex(name)}$`, "i"),
        realm: new RegExp(`^${escapeRegex(realm)}$`, "i"),
        region: new RegExp(`^${escapeRegex(region)}$`, "i"),
      })
        .collation(CASE_INSENSITIVE_COLLATION)
        .select("name realm region classID wclCanonicalCharacterId")
        .limit(2)
        .lean(),
      CharacterContinuityLink.find({}).lean(),
    ]);

    if (!target) throw new CharacterContinuityError("Target character not found", 404, "target_character_not_found");
    if (sourceMatches.length === 0) throw new CharacterContinuityError("Historical character not found", 404, "source_character_not_found");
    if (sourceMatches.length > 1) throw new CharacterContinuityError("Historical character identity is ambiguous", 409, "source_character_ambiguous");

    const source = sourceMatches[0];
    if (String(source._id) === String(target._id)) {
      throw new CharacterContinuityError("A character cannot be combined with itself", 409, "same_character");
    }

    const graph = buildCharacterContinuityGraph(links);
    const sourceId = String(source._id);
    const targetRootId = graph.resolveRoot(target._id);
    const sourceRootId = graph.resolveRoot(source._id);
    const sourceMemberIds = graph.getMemberIds(source._id);
    const targetMemberIds = graph.getMemberIds(target._id);
    const allMemberIds = [...new Set([...sourceMemberIds, ...targetMemberIds])];
    const clusterCharacters = await Character.find({ _id: { $in: allMemberIds } })
      .select("name realm region classID wclCanonicalCharacterId")
      .lean();
    const characterById = new Map(clusterCharacters.map((character) => [String(character._id), character]));
    const targetRoot = characterById.get(targetRootId) ?? target;
    const sourceCluster = sourceMemberIds.map((id) => characterById.get(id)).filter((character): character is NonNullable<typeof character> => Boolean(character));
    const targetCluster = targetMemberIds.map((id) => characterById.get(id)).filter((character): character is NonNullable<typeof character> => Boolean(character));
    const sourceCanonicalIds = sourceCluster.map((character) => character.wclCanonicalCharacterId);
    const targetCanonicalIds = targetCluster.map((character) => character.wclCanonicalCharacterId);
    const allCanonicalIds = [...new Set([...sourceCanonicalIds, ...targetCanonicalIds])];

    const [appearanceSummaryRows, rankingCount, leaderboardCount, mechanicsCount, sourceReportCodes, targetReportCodes] = await Promise.all([
      CharacterReportAppearance.aggregate<{
        _id: null;
        appearanceCount: number;
        raids: number[];
        guilds: string[];
        firstSeenAt: Date;
        lastSeenAt: Date;
      }>([
        { $match: { wclCanonicalCharacterId: { $in: allCanonicalIds }, classID: target.classID } },
        {
          $group: {
            _id: null,
            appearanceCount: { $sum: 1 },
            raids: { $addToSet: "$reportZoneId" },
            guilds: { $addToSet: { $concat: ["$reportGuildName", "|", "$reportGuildRealm"] } },
            firstSeenAt: { $min: "$reportStartTime" },
            lastSeenAt: { $max: "$reportStartTime" },
          },
        },
      ]),
      Ranking.countDocuments({ wclCanonicalCharacterId: { $in: allCanonicalIds }, classID: target.classID }),
      CharacterLeaderboard.countDocuments({ wclCanonicalCharacterId: { $in: allCanonicalIds }, classID: target.classID }),
      CharacterMechanicsLeaderboard.countDocuments({ wclCanonicalCharacterId: { $in: allCanonicalIds }, classID: target.classID }),
      CharacterReportAppearance.distinct("reportCode", { wclCanonicalCharacterId: { $in: sourceCanonicalIds }, classID: source.classID }),
      CharacterReportAppearance.distinct("reportCode", { wclCanonicalCharacterId: { $in: targetCanonicalIds }, classID: target.classID }),
    ]);

    const targetReportCodeSet = new Set(targetReportCodes);
    const sharedReportCount = sourceReportCodes.filter((reportCode) => targetReportCodeSet.has(reportCode)).length;
    const existingSourceLink = links.find((link) => String(link.sourceCharacterId) === sourceId) ?? null;
    const blockers: string[] = [];
    if (source.classID !== targetRoot.classID) blockers.push("classMismatch");
    if (sourceRootId === targetRootId) blockers.push("alreadyCombined");
    else if (existingSourceLink) blockers.push("sourceAlreadyCombined");
    if (sharedReportCount > 0) blockers.push("reportCollision");

    const summary = appearanceSummaryRows[0];
    return {
      eligible: blockers.length === 0,
      blockers,
      source: summarizeCharacter(source),
      target: summarizeCharacter(targetRoot),
      sourceCluster: sourceCluster.map(summarizeCharacter),
      targetCluster: targetCluster.map(summarizeCharacter),
      impact: {
        wclIdentityCount: allCanonicalIds.length,
        appearanceCount: summary?.appearanceCount ?? 0,
        raidCount: (summary?.raids ?? []).filter((zoneId) => typeof zoneId === "number").length,
        guildCount: (summary?.guilds ?? []).length,
        rankingCount,
        leaderboardCount,
        mechanicsCount,
        sharedReportCount,
        firstSeenAt: summary?.firstSeenAt ?? null,
        lastSeenAt: summary?.lastSeenAt ?? null,
      },
      existingLink: existingSourceLink
        ? {
            id: String(existingSourceLink._id),
            sourceCharacterId: String(existingSourceLink.sourceCharacterId),
            targetCharacterId: String(existingSourceLink.targetCharacterId),
            createdBy: existingSourceLink.createdBy,
            createdAt: existingSourceLink.createdAt,
          }
        : null,
    };
  }

  async create(targetCharacterId: string, source: { name: unknown; realm: unknown; region: unknown }, createdBy: string) {
    const preview = await this.preview(targetCharacterId, source);
    if (!preview.eligible) {
      throw new CharacterContinuityError(preview.blockers.join("; "), 409, "character_continuity_link_blocked", preview);
    }

    try {
      const link = await CharacterContinuityLink.create({
        sourceCharacterId: new mongoose.Types.ObjectId(preview.source.id),
        targetCharacterId: new mongoose.Types.ObjectId(preview.target.id),
        createdBy,
      });
      return { link, preview };
    } catch (error) {
      if ((error as { code?: number })?.code === 11000) {
        throw new CharacterContinuityError("This historical character is already combined", 409, "character_continuity_link_exists", preview);
      }
      throw error;
    }
  }

  async remove(targetCharacterId: string, linkId: string): Promise<void> {
    if (!mongoose.Types.ObjectId.isValid(targetCharacterId) || !mongoose.Types.ObjectId.isValid(linkId)) {
      throw new CharacterContinuityError("Invalid character continuity link ID");
    }

    const graph = await this.getGraph();
    const targetRootId = graph.resolveRoot(targetCharacterId);
    const link = await CharacterContinuityLink.findById(linkId);
    if (!link || graph.resolveRoot(link.targetCharacterId) !== targetRootId) {
      throw new CharacterContinuityError("Character continuity link not found", 404, "character_continuity_link_not_found");
    }
    await link.deleteOne();
  }
}

export const characterContinuityService = new CharacterContinuityService();
export default characterContinuityService;
