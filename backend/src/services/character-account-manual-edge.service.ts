import mongoose from "mongoose";
import { CHARACTER_ACCOUNT_SIGNAL_VERSION } from "../config/achievement-signals";
import Character from "../models/Character";
import CharacterAccountGroup from "../models/CharacterAccountGroup";
import CharacterAccountManualEdge from "../models/CharacterAccountManualEdge";
import { createCharacterAccountPairKey, orderCharacterAccountPairIds } from "../utils/character-account-manual-edge";

type CharacterSummary = {
  id: string;
  name: string;
  realm: string;
  region: string;
  classID: number;
};

export type CharacterAccountManualEdgePreview = {
  eligible: boolean;
  blockers: string[];
  target: CharacterSummary;
  other: CharacterSummary;
  impact: {
    alreadyGrouped: boolean;
    currentGroupCount: number;
    mergedCharacterCount: number;
    members: CharacterSummary[];
  };
  existingEdge: {
    id: string;
    createdBy: string;
    createdAt: Date;
  } | null;
};

export class CharacterAccountManualEdgeError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
    public readonly code = "invalid_character_account_manual_edge",
    public readonly preview?: CharacterAccountManualEdgePreview,
  ) {
    super(message);
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function summarizeCharacter(character: { _id: unknown; name: string; realm: string; region: string; classID: number }): CharacterSummary {
  return {
    id: String(character._id),
    name: character.name,
    realm: character.realm,
    region: character.region,
    classID: character.classID,
  };
}

class CharacterAccountManualEdgeService {
  async preview(
    targetCharacterId: string,
    rawOther: { name: unknown; realm: unknown; region: unknown },
  ): Promise<CharacterAccountManualEdgePreview> {
    if (!mongoose.Types.ObjectId.isValid(targetCharacterId)) {
      throw new CharacterAccountManualEdgeError("Invalid target character ID");
    }

    const name = typeof rawOther.name === "string" ? rawOther.name.trim() : "";
    const realm = typeof rawOther.realm === "string" ? rawOther.realm.trim() : "";
    const region = typeof rawOther.region === "string" ? rawOther.region.trim().toLowerCase() : "";
    if (name.length < 2 || name.length > 24 || /\s/.test(name)) {
      throw new CharacterAccountManualEdgeError("Character name must be 2-24 characters and cannot contain spaces");
    }
    if (realm.length < 2 || realm.length > 64 || region.length < 2 || region.length > 8) {
      throw new CharacterAccountManualEdgeError("Character realm or region is invalid");
    }

    const [target, otherMatches] = await Promise.all([
      Character.findById(targetCharacterId).select("name realm region classID").lean(),
      Character.find({
        name: new RegExp(`^${escapeRegex(name)}$`, "i"),
        realm: new RegExp(`^${escapeRegex(realm)}$`, "i"),
        region: new RegExp(`^${escapeRegex(region)}$`, "i"),
      })
        .select("name realm region classID")
        .limit(2)
        .lean(),
    ]);
    if (!target) throw new CharacterAccountManualEdgeError("Target character not found", 404, "target_character_not_found");
    if (otherMatches.length === 0) throw new CharacterAccountManualEdgeError("Other character not found", 404, "other_character_not_found");
    if (otherMatches.length > 1) throw new CharacterAccountManualEdgeError("Other character identity is ambiguous", 409, "other_character_ambiguous");

    const other = otherMatches[0];
    const targetId = String(target._id);
    const otherId = String(other._id);
    if (targetId === otherId) throw new CharacterAccountManualEdgeError("A character cannot be linked to itself", 409, "same_character");

    const pairKey = createCharacterAccountPairKey(targetId, otherId);
    const [groups, existingEdge] = await Promise.all([
      CharacterAccountGroup.find({
        signalVersion: CHARACTER_ACCOUNT_SIGNAL_VERSION,
        characterIds: { $in: [target._id, other._id] },
      })
        .select("characterIds members")
        .lean(),
      CharacterAccountManualEdge.findOne({ pairKey }).lean(),
    ]);

    const targetGroup = groups.find((group) => group.characterIds.some((id) => String(id) === targetId));
    const otherGroup = groups.find((group) => group.characterIds.some((id) => String(id) === otherId));
    const alreadyGrouped = Boolean(targetGroup && otherGroup && String(targetGroup._id) === String(otherGroup._id));
    const currentGroups = new Map<string, CharacterSummary[]>();

    const addGroup = (character: typeof target, group: (typeof groups)[number] | undefined) => {
      if (group) {
        currentGroups.set(
          String(group._id),
          group.members.map((member) => summarizeCharacter({ _id: member.characterId, ...member })),
        );
      } else {
        currentGroups.set(`character:${String(character._id)}`, [summarizeCharacter(character)]);
      }
    };
    addGroup(target, targetGroup);
    addGroup(other, otherGroup);

    const membersById = new Map<string, CharacterSummary>();
    for (const members of currentGroups.values()) {
      for (const member of members) membersById.set(member.id, member);
    }

    const blockers = existingEdge ? ["existingEdge"] : [];
    return {
      eligible: blockers.length === 0,
      blockers,
      target: summarizeCharacter(target),
      other: summarizeCharacter(other),
      impact: {
        alreadyGrouped,
        currentGroupCount: currentGroups.size,
        mergedCharacterCount: membersById.size,
        members: [...membersById.values()].sort((a, b) => a.name.localeCompare(b.name) || a.realm.localeCompare(b.realm)),
      },
      existingEdge: existingEdge
        ? { id: String(existingEdge._id), createdBy: existingEdge.createdBy, createdAt: existingEdge.createdAt }
        : null,
    };
  }

  async create(targetCharacterId: string, rawOther: { name: unknown; realm: unknown; region: unknown }, createdBy: string) {
    const preview = await this.preview(targetCharacterId, rawOther);
    if (!preview.eligible) {
      throw new CharacterAccountManualEdgeError(preview.blockers.join("; "), 409, "character_account_manual_edge_blocked", preview);
    }

    const [characterAId, characterBId] = orderCharacterAccountPairIds(preview.target.id, preview.other.id);
    let edge;
    try {
      edge = await CharacterAccountManualEdge.create({
        pairKey: createCharacterAccountPairKey(characterAId, characterBId),
        characterAId: new mongoose.Types.ObjectId(characterAId),
        characterBId: new mongoose.Types.ObjectId(characterBId),
        createdBy,
      });
    } catch (error) {
      if ((error as { code?: number })?.code === 11000) {
        throw new CharacterAccountManualEdgeError("These characters already have a direct manual player link", 409, "character_account_manual_edge_exists", preview);
      }
      throw error;
    }
    return { edge, preview };
  }

  async remove(characterId: string, edgeId: string): Promise<void> {
    if (!mongoose.Types.ObjectId.isValid(characterId) || !mongoose.Types.ObjectId.isValid(edgeId)) {
      throw new CharacterAccountManualEdgeError("Invalid character account link ID");
    }
    const edge = await CharacterAccountManualEdge.findOne({
      _id: edgeId,
      $or: [{ characterAId: characterId }, { characterBId: characterId }],
    });
    if (!edge) throw new CharacterAccountManualEdgeError("Character account link not found", 404, "character_account_manual_edge_not_found");
    await edge.deleteOne();
  }
}

export const characterAccountManualEdgeService = new CharacterAccountManualEdgeService();
export default characterAccountManualEdgeService;
