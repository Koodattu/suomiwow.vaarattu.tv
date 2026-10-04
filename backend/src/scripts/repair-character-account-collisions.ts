import dotenv from "dotenv";
import mongoose from "mongoose";
import { CHARACTER_ACCOUNT_SIGNAL_VERSION } from "../config/achievement-signals";
import Character from "../models/Character";
import CharacterAccountGroup from "../models/CharacterAccountGroup";
import CharacterAccountMatch from "../models/CharacterAccountMatch";
import CharacterAccountManualEdge from "../models/CharacterAccountManualEdge";
import CharacterContinuityLink from "../models/CharacterContinuityLink";
import CharacterAchievementFetchQueue from "../models/CharacterAchievementFetchQueue";
import CharacterAchievementFingerprint, { ICharacterAchievementFingerprint } from "../models/CharacterAchievementFingerprint";
import CharacterAchievementToken from "../models/CharacterAchievementToken";
import CharacterRaidAchievementSummary, { CHARACTER_RAID_ACHIEVEMENT_SUMMARY_VERSION } from "../models/CharacterRaidAchievementSummary";
import characterAchievementService, { buildCharacterAchievementSnapshotKey } from "../services/character-achievement.service";
import { getWclClassIdFromBlizzardClassId } from "../utils/blizzard-character-class";
import { normalizeRealmSlug } from "../utils/realm";

type Identity = { name: string; realm: string; region: string; classID: number };
type Fingerprint = Pick<ICharacterAchievementFingerprint, "_id" | "characterId" | "wclCanonicalCharacterId" | "signalTokens" | "fetchedAt"> & Identity;

export function achievementIdentityRoute(identity: Omit<Identity, "classID">): string {
  return [identity.region.toLowerCase(), normalizeRealmSlug(identity.realm), identity.name.toLowerCase()].join(":");
}

export function hasCopiedAchievementFingerprint(candidate: Fingerprint, peers: Fingerprint[], currentClassID: number): boolean {
  // A present-day class mismatch alone cannot disprove a valid older snapshot.
  // Require substantial, identical saved evidence from the current class too.
  const tokens = new Set(candidate.signalTokens);
  return candidate.classID !== currentClassID && tokens.size >= 50 && peers.some((peer) => {
    if (peer.classID !== currentClassID || achievementIdentityRoute(peer) !== achievementIdentityRoute(candidate)) return false;
    const peerTokens = new Set(peer.signalTokens);
    return peerTokens.size === tokens.size && [...tokens].every((token) => peerTokens.has(token));
  });
}

export async function auditCharacterAccountCollisions() {
  const [fingerprints, characters] = await Promise.all([
    CharacterAchievementFingerprint.find({ signalVersion: CHARACTER_ACCOUNT_SIGNAL_VERSION })
      .select("_id characterId wclCanonicalCharacterId name realm region classID fetchedAt")
      .lean(),
    Character.find({}).select("name realm region classID").lean(),
  ]);
  const classesByRoute = new Map<string, Set<number>>();
  for (const row of [...characters, ...fingerprints]) {
    const route = achievementIdentityRoute(row);
    const classes = classesByRoute.get(route) ?? new Set<number>();
    classes.add(row.classID);
    classesByRoute.set(route, classes);
  }
  const candidateIds = fingerprints.filter((row) => (classesByRoute.get(achievementIdentityRoute(row))?.size ?? 0) > 1).map((row) => row._id);
  const candidates = await CharacterAchievementFingerprint.find({ _id: { $in: candidateIds } })
    .select("_id characterId wclCanonicalCharacterId name realm region classID signalTokens fetchedAt")
    .lean<Fingerprint[]>();
  const byRoute = new Map<string, Fingerprint[]>();
  for (const row of candidates) {
    const route = achievementIdentityRoute(row);
    const rows = byRoute.get(route) ?? [];
    rows.push(row);
    byRoute.set(route, rows);
  }

  const repairs: Fingerprint[] = [];
  const review: Array<{ route: string; characterId?: string; classID?: number; currentClassID?: number; reason: string }> = [];
  let mismatchedFingerprints = 0;
  let checkedRoutes = 0;
  for (const [route, rows] of byRoute) {
    const identity = rows[0];
    let profile;
    try {
      profile = await characterAchievementService.fetchCharacterProfile(identity.region, identity.realm, identity.name);
    } catch (error) {
      if ((error as { status?: number }).status !== 404) throw error;
      review.push({ route, reason: "profile_not_found" });
      continue;
    }
    const currentClassID = getWclClassIdFromBlizzardClassId(profile.character_class?.id);
    if (currentClassID === null) {
      review.push({ route, reason: "unrecognized_profile_class" });
      continue;
    }
    checkedRoutes += 1;
    for (const row of rows) {
      if (row.classID === currentClassID) continue;
      mismatchedFingerprints += 1;
      if (hasCopiedAchievementFingerprint(row, rows, currentClassID)) {
        repairs.push(row);
      } else {
        review.push({ route, characterId: String(row.characterId), classID: row.classID, currentClassID, reason: "no_identical_current_class_fingerprint" });
      }
    }
  }

  const ids = repairs.map((row) => row.characterId);
  const [groups, matches, raidSummaries] = await Promise.all([
    CharacterAccountGroup.find({ signalVersion: CHARACTER_ACCOUNT_SIGNAL_VERSION, characterIds: { $in: ids } })
      .select("slug characterIds").lean(),
    CharacterAccountMatch.countDocuments({ signalVersion: CHARACTER_ACCOUNT_SIGNAL_VERSION, $or: [{ characterAId: { $in: ids } }, { characterBId: { $in: ids } }] }),
    CharacterRaidAchievementSummary.countDocuments({ version: CHARACTER_RAID_ACHIEVEMENT_SUMMARY_VERSION, characterId: { $in: ids } }),
  ]);
  const groupedIds = new Set(groups.flatMap((group) => group.characterIds.map(String)));
  return {
    repairs,
    analysis: {
      fingerprints: fingerprints.length,
      candidateRoutes: byRoute.size,
      checkedRoutes,
      mismatchedFingerprints,
      copiedFingerprints: repairs.length,
      affectedGroupedCharacters: ids.filter((id) => groupedIds.has(String(id))).length,
      affectedGroups: groups.length,
      automaticMatchesToRemove: matches,
      raidSummariesToRemove: raidSummaries,
      affectedAccountSlugs: groups.map((group) => group.slug),
      repairCharacters: repairs.map((row) => ({ characterId: String(row.characterId), route: achievementIdentityRoute(row), classID: row.classID, signalCount: row.signalTokens.length })),
      review,
    },
  };
}

export async function applyCharacterAccountCollisionRepair(repairs: Fingerprint[]) {
  const ids = repairs.map((row) => row.characterId);
  if (ids.length > 0) {
    // Both application processes must be stopped before applying. Recheck each
    // snapshot inside the transaction so a changed plan cannot delete new data.
    await mongoose.connection.transaction(async (session) => {
      const deleted = await CharacterAchievementFingerprint.deleteMany({
        signalVersion: CHARACTER_ACCOUNT_SIGNAL_VERSION,
        $or: repairs.map((row) => ({ _id: row._id, fetchedAt: row.fetchedAt })),
      }, { session });
      if (deleted.deletedCount !== repairs.length) throw new Error("Fingerprints changed since the audit; no repair was applied. Run the audit again.");
      await CharacterAchievementToken.updateMany(
        { signalVersion: CHARACTER_ACCOUNT_SIGNAL_VERSION, characterIds: { $in: ids } },
        [
          { $set: { characterIds: { $setDifference: ["$characterIds", ids] } } },
          { $set: { characterCount: { $size: "$characterIds" } } },
        ],
        { session, updatePipeline: true },
      );
      await CharacterAchievementToken.deleteMany({
        signalVersion: CHARACTER_ACCOUNT_SIGNAL_VERSION,
        token: { $in: [...new Set(repairs.flatMap((row) => row.signalTokens))] },
        characterCount: 0,
      }, { session });
      await CharacterAccountMatch.deleteMany({
        signalVersion: CHARACTER_ACCOUNT_SIGNAL_VERSION,
        $or: [{ characterAId: { $in: ids } }, { characterBId: { $in: ids } }],
      }, { session });
      await CharacterRaidAchievementSummary.deleteMany({
        version: CHARACTER_RAID_ACHIEVEMENT_SUMMARY_VERSION, characterId: { $in: ids },
      }, { session });
      await CharacterAchievementFetchQueue.updateMany({
        signalVersion: CHARACTER_ACCOUNT_SIGNAL_VERSION,
        $or: repairs.map((row) => ({ characterId: row.characterId, snapshotKey: buildCharacterAchievementSnapshotKey(row) })),
      }, { $set: {
        status: "skipped", errorCode: "character_class_mismatch", httpStatus: 200, isPermanentError: true,
        completionReason: "Removed copied achievements from a different class using the same name and realm",
        completedAt: new Date(), lastActivityAt: new Date(),
      } }, { session });

      // Keep the existing account document and URL when removing copied members
      // leaves the rest together. The normal rebuild recomputes membership and
      // scores, and still removes this document if the component splits/dissolves.
      const groups = await CharacterAccountGroup.find({ signalVersion: CHARACTER_ACCOUNT_SIGNAL_VERSION, characterIds: { $in: ids } })
        .select("_id characterIds").session(session).lean();
      const manualEdges = await CharacterAccountManualEdge.find({ $or: [{ characterAId: { $in: ids } }, { characterBId: { $in: ids } }] })
        .select("characterAId characterBId").session(session).lean();
      const continuityLinks = await CharacterContinuityLink.find({ $or: [{ sourceCharacterId: { $in: ids } }, { targetCharacterId: { $in: ids } }] })
        .select("sourceCharacterId targetCharacterId").session(session).lean();
      const protectedIds = new Set([
        ...manualEdges.flatMap((edge) => [String(edge.characterAId), String(edge.characterBId)]),
        ...continuityLinks.flatMap((link) => [String(link.sourceCharacterId), String(link.targetCharacterId)]),
      ]);
      const removedIds = new Set(ids.map(String).filter((id) => !protectedIds.has(id)));
      for (const group of groups) {
        const remainingIds = group.characterIds.map(String).filter((id) => !removedIds.has(id));
        if (remainingIds.length < 2) continue;
        await CharacterAccountGroup.updateOne({ _id: group._id }, {
          $set: { groupKey: remainingIds.sort().join(":") },
        }, { session });
      }
    });
  }
  // Also run on an empty plan, so a rerun recovers if rebuilding failed after
  // the transaction committed. Manual account edges remain authoritative.
  return characterAchievementService.rebuildAccountGroups();
}

async function main(): Promise<void> {
  (dotenv.config as (options: { quiet: boolean }) => void)({ quiet: true });
  const apply = process.argv.includes("--apply");
  await mongoose.connect(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/wow_guild_tracker", { autoIndex: false, autoCreate: false });
  try {
    const { repairs, analysis } = await auditCharacterAccountCollisions();
    console.log(JSON.stringify({ database: mongoose.connection.name, mode: apply ? "apply" : "dry-run", analysis }, null, 2));
    if (apply) console.log(JSON.stringify({ applied: await applyCharacterAccountCollisionRepair(repairs) }, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
