import assert from "node:assert/strict";
import test from "node:test";
import { competitiveWorldRank, isMainEncounter, mainRaidBosses, RAID_ENCOUNTERS } from "../src/config/raid-encounters";
import { getFinalBossSummary } from "../src/utils/horse-race";

process.env.RAIDER_IO_API_KEY ||= "test";
process.env.BLIZZARD_CLIENT_ID ||= "test";
process.env.BLIZZARD_CLIENT_SECRET ||= "test";

const definition = RAID_ENCOUNTERS[53];
const metadata = [...definition.main, ...definition.lairs.map(lair => lair.id)].map(id => ({ id, name: String(id), slug: String(id) }));

test("source order and newly appended encounters cannot change main membership or order", () => {
  const source = [...metadata].reverse().concat({ id: 9999, name: "Future extra", slug: "future" });
  assert.deepEqual(mainRaidBosses(53, source).map(boss => boss.id), definition.main);
  assert.equal(isMainEncounter(53, 3379), false);
  assert.equal(isMainEncounter(53, 3513), false);
  assert.equal(isMainEncounter(53, 9999), false);
  assert.equal(source.length, 11);
  assert.deepEqual(mainRaidBosses(50, source), source);
});

test("zone-wide WCL ranks cannot break main-raid ties", () => {
  assert.equal(competitiveWorldRank({ raidId: 53, worldRank: 1, rioWorldRank: 400 }), 400);
  assert.equal(competitiveWorldRank({ raidId: 53, worldRank: 1 }), undefined);
  assert.equal(competitiveWorldRank({ raidId: 50, worldRank: 1, rioWorldRank: 400 }), 1);
});

test("the final race requires the seven main predecessors or actual Ula'tek pulls", () => {
  const kills = definition.main.slice(0, 6).map(bossId => ({ bossId, kills: 1, pullCount: 1, bestPercent: 0 }));
  const lairs = definition.lairs.map(lair => ({ bossId: lair.id, kills: 1, pullCount: 1, bestPercent: 0 }));
  assert.equal(getFinalBossSummary(53, metadata, [...kills, ...lairs])?.eligible, false);
  const result = getFinalBossSummary(53, metadata, [...kills, { bossId: 3492, kills: 0, pullCount: 12, bestPercent: 33 }]);
  assert.equal(result?.bossId, 3492);
  assert.equal(result?.eligible, true);
  assert.equal(result?.bestPercent, 33);
});

test("RIO-only lair kills remain visible without manufacturing main progress", async () => {
  const { default: Guild } = await import("../src/models/Guild");
  const { default: service } = await import("../src/services/guild.service");
  const guild = new Guild({ name: "Fixture", realm: "test", region: "eu", progress: [] });
  const raid: any = { id: 53, name: "The Venomous Abyss", slug: "the-venomous-abyss", bosses: metadata };
  service.reconcileRaidOfficialProgress(guild, raid, {
    "the-unbinding-of-kithix": { summary: "1/1 M", total_bosses: 1, normal_bosses_killed: 1, heroic_bosses_killed: 1, mythic_bosses_killed: 1 },
  });
  assert.equal(guild.progress.length, 0);
  assert.equal(guild.lairProgress.find(p => p.lairEncounterId === 3513 && p.difficulty === "mythic")?.bossesDefeated, 1);
  assert.equal(guild.lairProgress.length, 4);
});

test("main standings are invariant when only lair results and whole-zone ranks change", async () => {
  const { default: Guild } = await import("../src/models/Guild");
  const { default: Raid } = await import("../src/models/Raid");
  const { default: service } = await import("../src/services/guild.service");
  const original = Raid.findOne;
  (Raid as any).findOne = () => ({ lean: async () => ({ id: 53, slug: "the-venomous-abyss", bosses: metadata }) });
  try {
    const guilds = ["Alpha", "Beta"].map((name, index) => new Guild({ name, realm: "test", region: "eu", progress: [{ raidId: 53, raidName: "VA", difficulty: "mythic", bossesDefeated: 1, totalBosses: 8, rioWorldRank: 100 + index, worldRank: 100 + index, totalTimeSpent: 1, bosses: [{ bossId: 3470, bossName: "First", kills: 1, pullCount: 1, bestPercent: 0, totalTimeSpent: 1 }] }] }));
    await service.calculateGuildRankingsForRaid(53, guilds);
    const ranks = guilds.map(guild => guild.progress[0].guildRank);
    guilds[1].progress[0].worldRank = 1;
    guilds[1].progress[0].wclWorldRank = 1;
    guilds[1].lairProgress = [{ raidId: 53, lairEncounterId: 3513, raidName: "Kith'ix", difficulty: "mythic", bossesDefeated: 1, totalBosses: 1, bosses: [], totalTimeSpent: 1 } as any];
    await service.calculateGuildRankingsForRaid(53, guilds);
    assert.deepEqual(guilds.map(guild => guild.progress[0].guildRank), ranks);
    assert.deepEqual(ranks, [1, 2]);
  } finally { Raid.findOne = original; }
});


test("lair recovery requires exact source evidence and preserves original report ownership", async () => {
  const { buildLairRecoveryFights } = await import("../src/utils/raid-encounter-recovery");
  const stored = { code: "fixture", startTime: 1000, guildId: "owner", fightSequence: [{ fightId: 3, encounterID: 3513, difficulty: 4 }] };
  const captured = { code: "fixture", startTime: 1000, endTime: 7000, fights: [{ id: 3, encounterID: 3513, difficulty: 4, kill: true, name: "Kith'ix", startTime: 100, endTime: 6100 }] };
  const [fight] = buildLairRecoveryFights(53, stored, captured, [3]);
  assert.equal(fight.guildId, "owner");
  assert.equal(fight.zoneId, 53);
  assert.equal(fight.isKill, true);
  assert.equal(fight.duration, 6000);
  assert.equal(fight.timestamp.getTime(), 1100);
  assert.throws(() => buildLairRecoveryFights(53, stored, { ...captured, code: "other" }, [3]));
  assert.throws(() => buildLairRecoveryFights(53, stored, { ...captured, fights: [] }, [3]));
  assert.throws(() => buildLairRecoveryFights(53, stored, { ...captured, fights: [{ ...captured.fights[0], encounterID: 3492 }] }, [3]));
});


test("Pick'em inputs remain identical when only a guild's lair progress changes", async () => {
  const { buildRankingsFromCachedProgress } = await import("../src/routes/pickems");
  const guilds: any[] = [{ name: "Alpha", realm: "test", progress: [{ raidId: 53, difficulty: "mythic", bossesDefeated: 3, totalBosses: 8, guildRank: 1 }] }];
  const before = await buildRankingsFromCachedProgress(new Map([[53, guilds]]), [53]);
  guilds[0].lairProgress = [{ raidId: 53, lairEncounterId: 3513, difficulty: "mythic", bossesDefeated: 1, totalBosses: 1, worldRank: 1 }];
  assert.deepEqual(await buildRankingsFromCachedProgress(new Map([[53, guilds]]), [53]), before);
});
