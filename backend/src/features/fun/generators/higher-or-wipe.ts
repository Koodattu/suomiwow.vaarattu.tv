import { TRACKED_RAIDS } from "../../../config/guilds";
import CharacterMythicPlusSeasonScore from "../../../models/CharacterMythicPlusSeasonScore";
import CharacterRaidAchievementSummary from "../../../models/CharacterRaidAchievementSummary";
import CharacterRaidParticipation from "../../../models/CharacterRaidParticipation";
import Guild from "../../../models/Guild";
import Raid from "../../../models/Raid";
import { funMythicParticipationFilter, funMythicProgressMatch, loadFunEligibleCanonicalCharacterIds } from "../fun-game.eligibility";
import type { FunGuild, HigherOrWipeOption, HigherOrWipeQuestion, HigherOrWipeRound } from "../fun-game.types";
import { bossKey, FunRoundUnavailableError, newRoundBase, shuffle } from "../fun-game.utils";

type BossGuildRow = {
  guildId: unknown;
  guildName: string;
  guildRealm: string;
  raidId: number;
  bossId: number;
  bossName: string;
  pullCount: number;
  timeSpent: number;
};

type CharacterMetricRow = {
  _id: { wclCanonicalCharacterId: number; classID: number };
  name: string;
  realm: string;
  value: number;
};

type GuildStartedRow = {
  _id: unknown;
  name: string;
  realm: string;
  firstSeenAt: Date;
};

type NumericEntry = HigherOrWipeOption;

export async function generateHigherOrWipeRound(): Promise<HigherOrWipeRound> {
  const eligibleCanonicalIds = await loadFunEligibleCanonicalCharacterIds();
  const [bossGuildRows, cuttingEdgeRows, mythicPlusRows, guildStartedRows, raids] = await Promise.all([
    Guild.aggregate<BossGuildRow>([
      { $unwind: "$progress" },
      { $match: funMythicProgressMatch() },
      { $unwind: "$progress.bosses" },
      {
        $match: {
          "progress.bosses.kills": { $gte: 1 },
          "progress.bosses.pullCount": { $gt: 0 },
          "progress.bosses.timeSpent": { $gt: 0 },
        },
      },
      {
        $project: {
          _id: 0,
          guildId: "$_id",
          guildName: "$name",
          guildRealm: "$realm",
          raidId: "$progress.raidId",
          bossId: "$progress.bosses.bossId",
          bossName: "$progress.bosses.bossName",
          pullCount: "$progress.bosses.pullCount",
          timeSpent: "$progress.bosses.timeSpent",
        },
      },
    ]).option({ maxTimeMS: 15_000 }),
    CharacterRaidAchievementSummary.aggregate<CharacterMetricRow>([
      { $match: { wclCanonicalCharacterId: { $in: eligibleCanonicalIds } } },
      { $sort: { fetchedAt: -1 } },
      {
        $group: {
          _id: { wclCanonicalCharacterId: "$wclCanonicalCharacterId", classID: "$classID" },
          name: { $first: "$name" },
          realm: { $first: "$realm" },
          value: { $first: "$cuttingEdgeCount" },
        },
      },
      { $match: { value: { $gt: 0 } } },
      { $limit: 300 },
    ]).option({ maxTimeMS: 15_000 }),
    CharacterMythicPlusSeasonScore.aggregate<CharacterMetricRow>([
      { $match: { wclCanonicalCharacterId: { $in: eligibleCanonicalIds }, identityStatus: "current", scoreStatus: "available", "scores.all": { $gt: 0 } } },
      { $sort: { fetchedAt: -1 } },
      {
        $group: {
          _id: { wclCanonicalCharacterId: "$wclCanonicalCharacterId", classID: "$classID" },
          name: { $first: "$name" },
          realm: { $first: "$realm" },
          value: { $first: "$scores.all" },
        },
      },
      { $limit: 300 },
    ]).option({ maxTimeMS: 15_000 }),
    CharacterRaidParticipation.aggregate<GuildStartedRow>([
      { $match: funMythicParticipationFilter() },
      {
        $group: {
          _id: "$reportGuildId",
          name: { $first: "$reportGuildName" },
          realm: { $first: "$reportGuildRealm" },
          firstSeenAt: { $min: "$firstSeenAt" },
        },
      },
    ]).option({ maxTimeMS: 15_000 }),
    Raid.find({ id: { $in: TRACKED_RAIDS } }).select("id name expansion iconUrl bosses.id bosses.name bosses.iconUrl -_id").lean(),
  ]);

  const raidById = new Map(raids.map((raid) => [raid.id, raid]));
  const bossIconByKey = new Map(raids.flatMap((raid) => raid.bosses.map((boss) => [bossKey(raid.id, boss.id), boss.iconUrl ?? null] as const)));
  const guildIds = Array.from(new Set([
    ...bossGuildRows.map((row) => String(row.guildId)),
    ...guildStartedRows.map((row) => String(row._id)),
  ]));
  const guildDocuments = await Guild.find({ _id: { $in: guildIds } })
    .select("_id name realm faction crest")
    .lean();
  const guildDocumentById = new Map(guildDocuments.map((guild) => [String(guild._id), guild]));
  const toFunGuild = (id: unknown, name: string, realm: string): FunGuild => {
    const guild = guildDocumentById.get(String(id));
    return {
      id: String(id),
      name: guild?.name ?? name,
      realm: guild?.realm ?? realm,
      faction: guild?.faction ?? null,
      crest: guild?.crest ?? null,
    };
  };
  const questions: HigherOrWipeQuestion[] = [];
  const rowsByBoss = new Map<string, BossGuildRow[]>();
  for (const row of bossGuildRows) {
    const key = bossKey(row.raidId, row.bossId);
    const entries = rowsByBoss.get(key) ?? [];
    entries.push(row);
    rowsByBoss.set(key, entries);
  }

  for (const rows of shuffle(Array.from(rowsByBoss.values()))) {
    const pair = distinctPair(rows.flatMap((row): NumericEntry[] => {
      const raid = raidById.get(row.raidId);
      if (!raid) return [];
      return [{
        id: String(row.guildId),
        label: row.guildName,
        detail: `${row.bossName} · ${raid.name}`,
        value: row.pullCount,
        guild: toFunGuild(row.guildId, row.guildName, row.guildRealm),
        boss: { id: row.bossId, name: row.bossName, iconUrl: bossIconByKey.get(bossKey(row.raidId, row.bossId)) ?? null },
        raid: { id: raid.id, name: raid.name, expansion: raid.expansion, iconUrl: raid.iconUrl ?? null },
      }];
    }));
    if (pair) questions.push(makeQuestion("guild-pulls", "pulls", pair, "higher", questions.length));
    if (questions.filter((question) => question.kind === "guild-pulls").length >= 3) break;
  }

  questions.push(...buildQuestions(
    "cutting-edge",
    "achievements",
    cuttingEdgeRows.map((row) => ({ id: `${row._id.wclCanonicalCharacterId}:${row._id.classID}`, label: row.name, detail: row.realm, value: row.value, classID: row._id.classID })),
    3,
    "higher",
  ));
  questions.push(...buildQuestions(
    "mythic-plus",
    "score",
    mythicPlusRows.map((row) => ({ id: `${row._id.wclCanonicalCharacterId}:${row._id.classID}`, label: row.name, detail: row.realm, value: Math.round(row.value), classID: row._id.classID })),
    3,
    "higher",
  ));

  const bossMedianEntries = Array.from(rowsByBoss.entries()).flatMap(([key, rows]): NumericEntry[] => {
    if (rows.length < 3) return [];
    const [raidIdText, bossIdText] = key.split(":");
    const values = rows.map((row) => row.timeSpent).sort((left, right) => left - right);
    const medianSeconds = median(values);
    const first = rows[0];
    const raid = raidById.get(first.raidId);
    if (!raid) return [];
    return [{
      id: `${raidIdText}:${bossIdText}`,
      label: first.bossName,
      detail: raid.name,
      boss: { id: first.bossId, name: first.bossName, iconUrl: bossIconByKey.get(key) ?? null },
      raid: { id: raid.id, name: raid.name, expansion: raid.expansion, iconUrl: raid.iconUrl ?? null },
      value: Math.round(medianSeconds / 60),
    }];
  });
  questions.push(...buildQuestions("boss-progress-time", "minutes", bossMedianEntries, 3, "higher"));
  questions.push(...buildQuestions(
    "guild-started",
    "year",
    guildStartedRows.map((row) => ({ id: String(row._id), label: row.name, detail: row.realm, value: row.firstSeenAt.getFullYear(), guild: toFunGuild(row._id, row.name, row.realm) })),
    3,
    "lower",
  ));

  const selectedQuestions = shuffle(questions).slice(0, 12).map((question, index) => ({ ...question, id: `${question.kind}:${index}` }));
  if (selectedQuestions.length < 6) throw new FunRoundUnavailableError("Not enough comparable records for Higher or Wipe");
  return { ...newRoundBase(), game: "higher-or-wipe", questions: selectedQuestions };
}

function buildQuestions(
  kind: HigherOrWipeQuestion["kind"],
  unit: HigherOrWipeQuestion["unit"],
  entries: NumericEntry[],
  count: number,
  winner: "higher" | "lower",
): HigherOrWipeQuestion[] {
  const questions: HigherOrWipeQuestion[] = [];
  const pool = shuffle(entries);
  for (let index = 0; index < pool.length && questions.length < count; index += 1) {
    const pair = distinctPair([pool[index], ...shuffle(pool.filter((entry) => entry.id !== pool[index].id))]);
    if (!pair) continue;
    questions.push(makeQuestion(kind, unit, pair, winner, questions.length));
  }
  return questions;
}

function distinctPair(entries: NumericEntry[]): [NumericEntry, NumericEntry] | null {
  const [left, ...rest] = shuffle(entries);
  if (!left) return null;
  const right = rest.find((entry) => entry.id !== left.id && entry.value !== left.value);
  return right ? [left, right] : null;
}

function makeQuestion(
  kind: HigherOrWipeQuestion["kind"],
  unit: HigherOrWipeQuestion["unit"],
  pair: [NumericEntry, NumericEntry],
  winner: "higher" | "lower",
  index: number,
): HigherOrWipeQuestion {
  const [left, right] = pair;
  const leftWins = winner === "higher" ? left.value > right.value : left.value < right.value;
  return { id: `${kind}:${index}`, kind, unit, left, right, correctSide: leftWins ? "left" : "right" };
}

function median(values: number[]): number {
  const middle = Math.floor(values.length / 2);
  return values.length % 2 === 0 ? (values[middle - 1] + values[middle]) / 2 : values[middle];
}
