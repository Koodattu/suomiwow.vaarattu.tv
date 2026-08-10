import { getSpecRole } from "../../../config/classes";
import { MIN_CHARACTER_RAID_MYTHIC_REPORTS_FOR_FUN_ELIGIBILITY } from "../../../config/character-eligibility";
import { TRACKED_RAIDS } from "../../../config/guilds";
import CharacterMythicPlusSeasonScore from "../../../models/CharacterMythicPlusSeasonScore";
import CharacterRaidAchievementSummary from "../../../models/CharacterRaidAchievementSummary";
import CharacterRaidParticipation from "../../../models/CharacterRaidParticipation";
import Guild from "../../../models/Guild";
import Raid from "../../../models/Raid";
import characterService from "../../../services/character.service";
import { funMythicParticipationFilter } from "../fun-game.eligibility";
import type { SuomidleCandidate, SuomidleRound } from "../fun-game.types";
import { canonicalCharacterKey, FunRoundUnavailableError, newRoundBase, randomItem } from "../fun-game.utils";

type ScoreRow = {
  wclCanonicalCharacterId: number;
  name: string;
  realm: string;
  classID: number;
  bestSpecName: string;
  activeSpecRole?: string | null;
  specScores: Array<{ specName?: string | null; role?: string | null }>;
  mythicPlusScore: number;
};

type ParticipationRow = {
  _id: { wclCanonicalCharacterId: number; classID: number };
  firstSeenAt: Date;
  raidId: number;
  guildId: unknown;
  guildName: string;
  guildRealm: string;
};

type AchievementRow = {
  _id: { wclCanonicalCharacterId: number; classID: number };
  cuttingEdgeCount: number;
  aheadOfTheCurveCount: number;
};

const LATEST_SCORE_SEASON_TTL_MS = 5 * 60 * 1000;
let latestScoreSeasonCache: { expiresAt: number; season: string | null } | null = null;
let latestScoreSeasonPromise: Promise<string | null> | null = null;

export async function generateSuomidleRound(): Promise<SuomidleRound> {
  const season = await loadLatestScoreSeason();
  if (!season) throw new FunRoundUnavailableError("No characters have enough Suomidle data");
  const scoreDocuments = await CharacterMythicPlusSeasonScore.find({
    season,
    identityStatus: "current",
    scoreStatus: "available",
    "scores.all": { $gt: 0 },
    bestSpecName: { $type: "string" },
  })
    .sort({ "scores.all": -1 })
    .limit(350)
    .select("wclCanonicalCharacterId name realm classID bestSpecName activeSpecRole specScores scores.all -_id")
    .lean();
  const scoreRows = scoreDocuments.map(toScoreRow);

  if (scoreRows.length === 0) throw new FunRoundUnavailableError("No characters have enough Suomidle data");
  const candidates = await loadSuomidleCandidates(scoreRows);
  if (candidates.length < 20) throw new FunRoundUnavailableError("No characters have a complete Suomidle profile");
  const target = randomItem(candidates);
  return {
    ...newRoundBase(),
    game: "suomidle",
    solution: { target },
  };
}

export async function searchSuomidleCandidates(query: string, limit: number): Promise<SuomidleCandidate[]> {
  const identities = await characterService.searchCharacters(query, Math.min(Math.max(limit * 2, 10), 20), {
    zoneIds: TRACKED_RAIDS,
    minMythicReportCount: MIN_CHARACTER_RAID_MYTHIC_REPORTS_FOR_FUN_ELIGIBILITY,
  });
  const identityPairs = identities.flatMap((identity) => typeof identity.wclCanonicalCharacterId === "number"
    ? [{ wclCanonicalCharacterId: identity.wclCanonicalCharacterId, classID: identity.classID }]
    : []);
  if (identityPairs.length === 0) return [];

  const season = await loadLatestScoreSeason();
  if (!season) return [];
  const scoreDocuments = await CharacterMythicPlusSeasonScore.find({
    season,
    identityStatus: "current",
    scoreStatus: "available",
    "scores.all": { $gt: 0 },
    bestSpecName: { $type: "string" },
    $or: identityPairs,
  })
    .select("wclCanonicalCharacterId name realm classID bestSpecName activeSpecRole specScores scores.all -_id")
    .lean();
  const candidates = await loadSuomidleCandidates(scoreDocuments.map(toScoreRow));
  const candidateByKey = new Map(candidates.map((candidate) => [candidate.key, candidate]));
  return identities
    .flatMap((identity): SuomidleCandidate[] => {
      if (typeof identity.wclCanonicalCharacterId !== "number") return [];
      const candidate = candidateByKey.get(canonicalCharacterKey(identity.wclCanonicalCharacterId, identity.classID));
      return candidate ? [candidate] : [];
    })
    .slice(0, limit);
}

async function loadLatestScoreSeason(): Promise<string | null> {
  if (latestScoreSeasonCache && latestScoreSeasonCache.expiresAt > Date.now()) return latestScoreSeasonCache.season;
  if (latestScoreSeasonPromise) return latestScoreSeasonPromise;
  latestScoreSeasonPromise = CharacterMythicPlusSeasonScore.findOne({ identityStatus: "current", scoreStatus: "available", "scores.all": { $gt: 0 } })
    .sort({ fetchedAt: -1 })
    .select("season -_id")
    .lean()
    .then((latestScore) => {
      const season = latestScore?.season ?? null;
      latestScoreSeasonCache = { expiresAt: Date.now() + LATEST_SCORE_SEASON_TTL_MS, season };
      return season;
    })
    .finally(() => {
      latestScoreSeasonPromise = null;
    });
  return latestScoreSeasonPromise;
}

function toScoreRow(row: {
  wclCanonicalCharacterId: number;
  name: string;
  realm: string;
  classID: number;
  bestSpecName?: string | null;
  activeSpecRole?: string | null;
  specScores: Array<{ specName?: string | null; role?: string | null }>;
  scores: { all: number };
}): ScoreRow {
  return {
    wclCanonicalCharacterId: row.wclCanonicalCharacterId,
    name: row.name,
    realm: row.realm,
    classID: row.classID,
    bestSpecName: row.bestSpecName ?? "",
    activeSpecRole: row.activeSpecRole,
    specScores: row.specScores,
    mythicPlusScore: row.scores.all,
  };
}

async function loadSuomidleCandidates(scoreRows: ScoreRow[]): Promise<SuomidleCandidate[]> {
  if (scoreRows.length === 0) return [];
  const canonicalIds = Array.from(new Set(scoreRows.map((row) => row.wclCanonicalCharacterId)));
  const [participationRows, achievementRows] = await Promise.all([
    CharacterRaidParticipation.aggregate<ParticipationRow>([
      {
        $match: {
          ...funMythicParticipationFilter(),
          wclCanonicalCharacterId: { $in: canonicalIds },
        },
      },
      { $sort: { lastSeenAt: -1 } },
      {
        $group: {
          _id: { wclCanonicalCharacterId: "$wclCanonicalCharacterId", classID: "$classID" },
          firstSeenAt: { $min: "$firstSeenAt" },
          raidId: { $first: "$zoneId" },
          guildId: { $first: "$reportGuildId" },
          guildName: { $first: "$reportGuildName" },
          guildRealm: { $first: "$reportGuildRealm" },
        },
      },
    ]).option({ maxTimeMS: 15_000 }),
    CharacterRaidAchievementSummary.aggregate<AchievementRow>([
      { $match: { wclCanonicalCharacterId: { $in: canonicalIds } } },
      { $sort: { fetchedAt: -1 } },
      {
        $group: {
          _id: { wclCanonicalCharacterId: "$wclCanonicalCharacterId", classID: "$classID" },
          cuttingEdgeCount: { $first: "$cuttingEdgeCount" },
          aheadOfTheCurveCount: { $first: "$aheadOfTheCurveCount" },
        },
      },
    ]).option({ maxTimeMS: 15_000 }),
  ]);

  const participationByKey = new Map(participationRows.map((row) => [canonicalCharacterKey(row._id.wclCanonicalCharacterId, row._id.classID), row]));
  const achievementByKey = new Map(achievementRows.map((row) => [canonicalCharacterKey(row._id.wclCanonicalCharacterId, row._id.classID), row]));
  const raidIds = Array.from(new Set(participationRows.map((row) => row.raidId)));
  const guildIds = Array.from(new Set(participationRows.map((row) => String(row.guildId))));
  const [raids, guildDocuments] = await Promise.all([
    Raid.find({ id: { $in: raidIds } }).select("id name expansion iconUrl -_id").lean(),
    Guild.find({ _id: { $in: guildIds } }).select("_id faction crest").lean(),
  ]);
  const raidById = new Map(raids.map((raid) => [raid.id, raid]));
  const guildDocumentById = new Map(guildDocuments.map((guild) => [String(guild._id), guild]));

  return scoreRows.flatMap((row): SuomidleCandidate[] => {
    const key = canonicalCharacterKey(row.wclCanonicalCharacterId, row.classID);
    const participation = participationByKey.get(key);
    const raid = participation ? raidById.get(participation.raidId) : undefined;
    if (!participation || !raid || !participation.guildName.trim() || !row.bestSpecName.trim()) return [];
    const guildId = String(participation.guildId);
    const guildDocument = guildDocumentById.get(guildId);
    const role = resolveRole(row);
    const achievements = achievementByKey.get(key);
    return [{
      key,
      name: row.name,
      realm: row.realm,
      classID: row.classID,
      specName: row.bestSpecName,
      role,
      guildName: participation.guildName,
      guild: {
        id: guildId,
        name: participation.guildName,
        realm: participation.guildRealm,
        faction: guildDocument?.faction ?? null,
        crest: guildDocument?.crest ?? null,
      },
      raidId: participation.raidId,
      raidName: raid.name,
      raidExpansion: raid.expansion,
      raidIconUrl: raid.iconUrl ?? null,
      mythicPlusScore: Math.round(row.mythicPlusScore),
      achievementCount: (achievements?.cuttingEdgeCount ?? 0) + (achievements?.aheadOfTheCurveCount ?? 0),
      firstSeenAt: participation.firstSeenAt.toISOString(),
    }];
  });
}

function resolveRole(row: ScoreRow): "dps" | "healer" | "tank" {
  if (row.activeSpecRole === "dps" || row.activeSpecRole === "healer" || row.activeSpecRole === "tank") return row.activeSpecRole;
  const spec = row.specScores.find((entry) => entry.specName?.toLocaleLowerCase("en-US") === row.bestSpecName.toLocaleLowerCase("en-US"));
  if (spec?.role === "dps" || spec?.role === "healer" || spec?.role === "tank") return spec.role;
  return getSpecRole(row.classID, row.bestSpecName.replace(/ /g, "-"));
}
