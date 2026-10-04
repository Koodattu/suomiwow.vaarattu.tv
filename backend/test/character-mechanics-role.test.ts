import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import service from "../src/services/character-mechanics.service";
import Fight from "../src/models/Fight";
import CharacterMechanicsLeaderboard from "../src/models/CharacterMechanicsLeaderboard";
import CharacterTierListEntry from "../src/models/CharacterTierListEntry";
import characterTierListService from "../src/services/character-tierlist.service";
import { shouldPublishCcgCardSnapshot } from "../src/utils/ccg-card-snapshot";
import { resolveCcgCharacterMechanicsStatus } from "../src/utils/ccg-character-check";

const mechanics = service as any;
const characterId = new mongoose.Types.ObjectId("698cd13057d282dad2e1db28");
const character = {
  characterId, wclCanonicalCharacterId: 17947189, name: "Yolobolt", realm: "kazzak", region: "EU", classID: 10,
};

function parse(encounterId: number, specName: string, rankPercent: number, overrides: Record<string, unknown> = {}) {
  return {
    ...character, encounterId, encounterName: `Boss ${encounterId}`, specName, bestSpecName: specName,
    metric: "dps", role: "dps", rankPercent, medianPercent: rankPercent, bestAmount: 100_000,
    totalKills: 1, partition: 1, ilvl: 280, updatedAt: new Date("2026-09-09T05:32:24Z"), ...overrides,
  };
}

function fights(encounterID: number, specName: string | null, count: number, wipe = false) {
  return Array.from({ length: count }, (_, index) => ({
    reportCode: `report-${encounterID}-${specName}`, fightId: index + 1, encounterID,
    encounterName: `Boss ${encounterID}`, duration: 120_000, isKill: !wipe,
    combatants: [{ name: character.name, server: character.realm, specName }],
    deaths: wipe ? [{ name: character.name, server: character.realm, timestamp: 10_000, deathTime: 10_000 }] : [],
  }));
}

function build(inputFights: any[], parses: any[], classID = 10) {
  const stats = new Map();
  const characters = new Map();
  const specPullsByCharacter = new Map();
  const unknownSpecPullsByCharacter = new Map();
  mechanics.addSurvivalStats(inputFights, [], [{ ...character, classID }],
    new Map(inputFights.map((fight) => [fight.reportCode, "EU"])), stats,
    specPullsByCharacter, unknownSpecPullsByCharacter, characters);
  const survivalBuild = {
    stats, characters, specPullsByCharacter, unknownSpecPullsByCharacter,
    encounters: new Map(inputFights.map((fight) => [fight.encounterID, fight.encounterName])),
    fights: inputFights.length, eligibleFights: inputFights.length, coverage: 1, reports: 6, appearances: 6,
  };
  const { bossEntries: bosses, identities } = mechanics.buildBossEntries(53, parses, survivalBuild, new Map());
  mechanics.normalizeBossSurvivalScores(bosses);
  return { bosses, overall: mechanics.buildOverallEntries(bosses, identities)[0], stats };
}

test("Yolobolt's role includes all 111 pulls and progression changes mechanics without diluting parses", async () => {
  const killedBossFights = [
    ...fights(3379, "demonology", 3), ...fights(3379, "affliction", 11),
    ...fights(3445, "destruction", 33), ...fights(3455, "demonology", 8),
    ...fights(3470, "demonology", 2), ...fights(3497, "destruction", 15),
  ];
  const parses = [
    parse(3379, "demonology", 28.3), parse(3379, "affliction", 8.7),
    parse(3445, "destruction", 19), parse(3455, "demonology", 28.8),
    parse(3470, "demonology", 82.8), parse(3497, "destruction", 86.9),
  ];
  const before = build(killedBossFights, parses);
  const after = build([...killedBossFights, ...fights(3420, "demonology", 39, true)], parses);
  assert.equal(before.overall.specName, "destruction");
  assert.equal(after.overall.specName, "demonology");
  assert.equal(before.overall.pulls, 72);
  assert.equal(after.overall.pulls, 111);
  assert.equal(after.overall.evaluatedPulls, 111);
  assert.equal(after.bosses.length, 6);
  assert.equal(after.bosses.find((boss: any) => boss.encounterId === 3445).specName, "destruction");
  assert.equal(after.overall.parseScore, 49.2);
  assert.equal(after.overall.parseScore, before.overall.parseScore);
  assert.ok(after.overall.survivalScore < before.overall.survivalScore);
  const sszorak = after.bosses.find((boss: any) => boss.encounterId === 3420);
  assert.equal(sszorak.pulls, 39);
  assert.equal(sszorak.deaths, 39);
  assert.equal(sszorak.parseScore, null);
  assert.equal(sszorak.score, null);
  assert.equal(sszorak.rankPercent, null);
  assert.equal(typeof sszorak.survivalScore, "number");
  assert.deepEqual(resolveCcgCharacterMechanicsStatus([after.overall]), { pulls: 111, scoresReady: true, eligible: true });
  await new CharacterMechanicsLeaderboard(sszorak).validate();
  const tierEntry = new CharacterTierListEntry({ bossScores: [sszorak] });
  await (tierEntry.bossScores[0] as any).validate();
});

test("role selection sums specs and never includes tank or healer fights in DPS mechanics", () => {
  const result = build([
    ...fights(1, "balance", 30), ...fights(1, "feral", 30),
    ...fights(1, "guardian", 50, true), ...fights(1, "restoration", 10, true),
  ], [
    parse(1, "balance", 60, { classID: 2 }), parse(1, "feral", 80, { classID: 2 }),
    parse(1, "guardian", 99, { classID: 2, role: "tank" }),
    parse(1, "restoration", 95, { classID: 2, role: "healer", metric: "hps" }),
  ], 2);
  assert.equal(result.overall.role, "dps");
  assert.equal(result.overall.pulls, 60);
  assert.equal(result.overall.deaths, 0);
  assert.equal(result.overall.parseScore, 80);
  assert.equal(result.bosses.length, 1);
});

test("tank mechanics excludes DPS deaths even when both roles use the DPS metric", () => {
  const result = build([
    ...fights(1, "guardian", 50), ...fights(1, "balance", 30, true),
  ], [parse(1, "guardian", 60, { classID: 2, role: "tank" }), parse(1, "balance", 99, { classID: 2 })], 2);
  assert.equal(result.overall.role, "tank");
  assert.equal(result.overall.pulls, 50);
  assert.equal(result.overall.deaths, 0);
  assert.equal(result.overall.parseScore, 60);
});

test("Holy and Discipline share healer mechanics and ignore incompatible damage parses", () => {
  const result = build([...fights(1, "holy", 20), ...fights(1, "discipline", 25), ...fights(2, "holy", 10, true)], [
    parse(1, "holy", 70, { classID: 7, metric: "hps", role: "healer" }),
    parse(1, "discipline", 60, { classID: 7, metric: "hps", role: "healer" }),
    parse(1, "discipline", 99, { classID: 7, metric: "dps", role: "healer" }),
  ], 7);
  assert.equal(result.overall.role, "healer");
  assert.equal(result.overall.metric, "hps");
  assert.equal(result.overall.pulls, 55);
  assert.equal(result.overall.parseScore, 70);
});

test("Dirlandaa's Restoration damage parses fill missing DPS-role boss parses without changing raid identity", () => {
  const result = build([
    ...fights(3470, "enhancement", 6), ...fights(3445, "enhancement", 53),
    ...fights(3455, "enhancement", 7), ...fights(3497, "enhancement", 4),
    ...fights(3420, "enhancement", 62), ...fights(3379, "enhancement", 3),
    ...fights(3445, "restoration", 1, true), ...fights(3455, "restoration", 3, true),
    ...fights(3379, "restoration", 4, true),
  ], [
    parse(3470, "enhancement", 95.3176, { classID: 9 }),
    parse(3445, "enhancement", 54.5558, { classID: 9 }),
    parse(3497, "enhancement", 83.1795, { classID: 9 }),
    parse(3420, "enhancement", 4.81473, { classID: 9 }),
    parse(3445, "restoration", 74.3409, { classID: 9, role: "healer" }),
    parse(3455, "restoration", 99.7474, { classID: 9, role: "healer" }),
    parse(3379, "restoration", 99.55518999542258, { classID: 9, role: "healer" }),
    parse(3455, "restoration", 36.5171, { classID: 9, role: "healer", metric: "hps" }),
    parse(3379, "restoration", 59.896364534108784, { classID: 9, role: "healer", metric: "hps" }),
  ], 9);

  const vashnik = result.bosses.find((boss: any) => boss.encounterId === 3455);
  const nymrissa = result.bosses.find((boss: any) => boss.encounterId === 3379);
  assert.equal(vashnik.parseScore, 99.7);
  assert.equal(vashnik.survivalPercentile, 50);
  assert.equal(vashnik.score, 74.9);
  assert.equal(nymrissa.parseScore, 99.6);
  assert.equal(nymrissa.score, 74.8);
  assert.equal(vashnik.specName, "restoration");
  assert.equal(vashnik.role, "dps");
  assert.equal(vashnik.metric, "dps");
  // Keep the existing role parse even when another spec has a higher percentile.
  assert.equal(result.bosses.find((boss: any) => boss.encounterId === 3445).parseScore, 54.6);
  assert.equal(result.overall.specName, "enhancement");
  assert.equal(result.overall.role, "dps");
  assert.equal(result.overall.metric, "dps");
  assert.equal(result.overall.pulls, 135);
  assert.equal(result.overall.deaths, 0);
  assert.equal(result.overall.parseScore, 72.9);
  assert.equal(result.overall.score, 61.5);
  assert.equal(result.overall.bossScores.length, 6);
  assert.equal(result.overall.bossScores.find((boss: any) => boss.encounterId === 3455).parseScore, 99.7);
  assert.deepEqual(resolveCcgCharacterMechanicsStatus([result.overall]), { pulls: 135, scoresReady: true, eligible: true });

  const entry = (characterTierListService as any).createGeneratedEntry({
    scope: "global", raid: { id: 53, name: "The Venomous Abyss" }, mechanicsRow: result.overall,
    participation: { ...character, classID: 9, characterKey: String(characterId), sourceUpdatedAt: new Date() },
    generatedAt: new Date(),
  });
  assert.equal(entry.parseScore, 72.9);
  assert.equal(entry.score, 61.5);
  assert.equal(entry.specName, "enhancement");
  assert.equal(entry.role, "dps");
  assert.deepEqual(entry.bossScores, result.overall.bossScores);
  assert.equal(entry.scoreVersion, 6);
  const snapshot = { ...entry, tierGrade: "D" as const, mythicPlusScore: null };
  assert.equal(shouldPublishCcgCardSnapshot({ ...snapshot, scoreVersion: 5 }, snapshot), true);
});

test("off-role fallback requires the raid metric and preserves a legitimate zero parse", () => {
  const result = build([
    ...fights(1, "enhancement", 40), ...fights(2, "enhancement", 5), ...fights(3, "enhancement", 5),
  ], [
    parse(1, "enhancement", 60, { classID: 9 }),
    parse(2, "restoration", 99, { classID: 9, role: "healer", metric: "hps" }),
    parse(3, "restoration", 0, { classID: 9, role: "healer" }),
  ], 9);
  assert.equal(result.bosses.find((boss: any) => boss.encounterId === 2).parseScore, null);
  assert.equal(result.bosses.find((boss: any) => boss.encounterId === 2).score, null);
  assert.equal(result.bosses.find((boss: any) => boss.encounterId === 3).parseScore, 0);
  assert.equal(result.bosses.find((boss: any) => boss.encounterId === 3).score, 25);
  assert.equal(result.overall.parseScore, 30);
});

test("a character with only progression wipes has mechanics but cannot fabricate CCG performance", () => {
  const { bosses, overall } = build(fights(3420, "demonology", 40, true), []);
  assert.equal(bosses.length, 1);
  assert.equal(overall.pulls, 40);
  assert.equal(overall.parseScore, null);
  assert.equal(overall.score, null);
  assert.equal(typeof overall.survivalScore, "number");
  assert.equal(typeof overall.survivalPercentile, "number");
  assert.deepEqual(resolveCcgCharacterMechanicsStatus([overall]), { pulls: 40, scoresReady: false, eligible: false });
});

test("unknown hybrid roles are inferred only from unambiguous raid evidence", () => {
  const unknown = fights(2, null, 15, true);
  const parses = [parse(1, "balance", 60, { classID: 2 })];
  const singleRole = build([...fights(1, "balance", 40), ...unknown], parses, 2);
  const mixedRole = build([...fights(1, "balance", 40), ...fights(1, "guardian", 10), ...unknown], parses, 2);
  assert.equal(singleRole.overall.pulls, 55);
  assert.equal(mixedRole.overall.pulls, 40);
});

test("stored role and Blizzard spec ID classify fights when a spec name is missing", () => {
  const input = fights(1, null, 2);
  Object.assign(input[0].combatants[0], { specID: 102 });
  Object.assign(input[1].combatants[0], { role: "dps" });
  const result = build(input, [parse(1, "balance", 60, { classID: 2 })], 2);
  assert.equal(result.overall.role, "dps");
  assert.equal(result.overall.pulls, 2);
});

test("fight loading includes bosses without any global kill parses and preserves coverage checks", async (t) => {
  const input = fights(3420, "demonology", 2, true);
  let eligibleQuery: any;
  let fightQuery: any;
  t.mock.method(Fight, "countDocuments", async (query: any) => { eligibleQuery = query; return 3; });
  t.mock.method(Fight, "find", (query: any) => {
    fightQuery = query;
    const chain: any = { select: () => chain, sort: () => chain, lean: () => chain, cursor: async function* () { yield* input; } };
    return chain;
  });
  t.mock.method(mechanics, "findReportRegions", async () => new Map([[input[0].reportCode, "EU"]]));
  t.mock.method(mechanics, "findReportAppearances", async () => []);
  t.mock.method(mechanics, "findCharacterAliases", async () => [character]);
  const result = await mechanics.buildSurvivalStatsFromFetchedFights(53);
  assert.deepEqual(eligibleQuery.encounterID, { $gt: 0 });
  assert.equal(eligibleQuery.difficulty, 5);
  assert.equal(fightQuery.deathEventsFetchStatus, "fetched");
  assert.equal(fightQuery.$or[0].combatantInfoRosterComplete, true);
  assert.equal(result.fights, 2);
  assert.equal(result.eligibleFights, 3);
  assert.equal(result.coverage, 2 / 3);
  assert.equal(result.stats.get(`${characterId}|3420|dps`).pulls, 2);
});

test("an overall spec filter preserves all role mechanics and combined queries require a score", async (t) => {
  const { overall } = build([
    ...fights(1, "destruction", 20), ...fights(2, "demonology", 40, true),
  ], [parse(1, "destruction", 70)]);
  let query: any;
  t.mock.method(CharacterMechanicsLeaderboard, "countDocuments", async () => 1);
  t.mock.method(CharacterMechanicsLeaderboard, "find", (filter: any) => {
    query = filter;
    const chain: any = { sort: () => chain, skip: () => chain, limit: () => chain, lean: async () => [overall] };
    return chain;
  });
  const result = await service.getMechanicsRankings({ zoneId: 53, specName: "demonology", scoreType: "combined" });
  assert.equal(query.specName, "demonology");
  assert.deepEqual(query.score, { $ne: null });
  assert.equal(result.data[0].stats.mechanics.pulls, 60);
  assert.equal(result.data[0].stats.mechanics.parseScore, 70);
  assert.equal(result.data[0].bossScores.length, 2);
  assert.equal(result.data[0].bossScores[0].specName, "destruction");
  assert.equal(result.data[0].score.value, overall.score);
  await service.getMechanicsRankings({ zoneId: 53, scoreType: "survival" });
  assert.equal(query.score, undefined);
});
