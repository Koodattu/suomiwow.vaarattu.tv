import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import mongoose from "mongoose";
import type { ForeverProfile } from "../src/features/forever/forever-armory";
import { ForeverCharacter, ForeverGuild, ForeverWorker } from "../src/features/forever/forever.models";
import { ForeverCharacterDetail, ForeverItem } from "../src/features/forever/forever-details.models";
import { ForeverRunner, initializeForever } from "../src/features/forever/forever.worker";
import { ForeverBlizzardRunner } from "../src/features/forever/forever-blizzard.worker";
import { buildForeverRaids, foreverRaidsCache } from "../src/features/forever/forever-raids";
import { foreverRecords, foreverRecordsCache } from "../src/features/forever/forever-records";
import { publicGuildDetail } from "../src/features/forever/forever-guilds";
import { characterDetail } from "../src/features/forever/forever.service";
import { stopForeverLeaderboard } from "../src/features/forever/forever-leaderboard";

const uri = process.env.FOREVER_TEST_MONGODB_URI;

test("profile details, Blizzard statistics, item levels, raids and records (isolated replica-set database)", { skip: !uri }, async t => {
  await mongoose.connect(uri!, { dbName: `forever_test_${randomUUID().replace(/-/g, "")}`, serverSelectionTimeoutMS: 5000 });
  t.after(async () => {
    await Promise.all([foreverRaidsCache.stop(), foreverRecordsCache.stop(), stopForeverLeaderboard()]);
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });
  await initializeForever();
  const future = new Date(Date.now() + 86_400_000);
  const guild = { region: "eu" as const, slug: "kilta", name: "Kilta" };
  const members = ["jasen-yksi", "jasen-kaksi", "jasen-kolme"];
  await ForeverGuild.create({ ...guild, status: "approved", nextFetchAt: future,
    roster: members.map(slug => ({ region: "eu", slug, name: slug, level: 60, className: "Mage" })) });
  const base = { region: "eu", status: "tracked", level: 60, className: "Mage", nextFetchAt: future, lastLevelAt: new Date() };
  await ForeverCharacter.insertMany([
    ...members.map(slug => ({ ...base, slug, name: slug, source: "guild", guild })),
    { ...base, slug: "varuste-sankari", name: "Varuste Sankari", source: "admin", nextFetchAt: new Date(0) },
  ]);

  // The Armory worker stores details beside the character and queues each item once.
  const profile: ForeverProfile = { region: "eu", slug: "varuste-sankari", name: "Varuste Sankari", level: 60, className: "Mage",
    race: "Human", faction: "Alliance", ruleset: "Normal", sourceUpdatedAt: new Date(Date.now() - 60_000), guild: null,
    details: { gear: [
      { slot: "head", id: 100, name: "Known Hood", quality: "EPIC", icon: null, inventoryType: "HEAD", subclass: "Cloth", set: null, requiredLevel: 60, lines: [] },
      { slot: "weapon", id: 200, name: "Known Staff", quality: "RARE", icon: null, inventoryType: "TWOHWEAPON", subclass: "Staff", set: null, requiredLevel: 60, lines: [] },
      { slot: "chest", id: 300, name: "Hidden Robe", quality: "EPIC", icon: null, inventoryType: "CHEST", subclass: "Cloth", set: null, requiredLevel: 60, lines: [] },
    ], specs: [], professions: [], honorableKills: 12, pvpRank: 2, renderUrl: null } };
  await new ForeverRunner({ character: async () => profile, roster: async () => { throw new Error("no roster expected"); } }).tick();
  const saved = await ForeverCharacter.findOne({ slug: "varuste-sankari" }).lean();
  assert.equal(saved?.profileLevel, 60);
  assert.equal("details" in (saved ?? {}), false, "profile sections never land on the character document");
  const details = await ForeverCharacterDetail.findById(saved!._id).lean();
  assert.equal(details?.armory?.gear.length, 3);
  assert.equal(details?.armory?.honorableKills, 12);
  assert.deepEqual((await ForeverItem.find().sort({ _id: 1 }).lean()).map(item => [item._id, item.name, item.nextCheckAt instanceof Date]),
    [[100, "Known Hood", true], [200, "Known Staff", true], [300, "Hidden Robe", true]]);

  // The Blizzard worker resolves items, then reads statistics and achievements per character.
  // Whole seconds, as Blizzard reports them; future times are rejected as invalid.
  const killAt = Math.floor((Date.now() - 10 * 86_400_000) / 1000) * 1000;
  let latestKill = killAt;
  const onyxiaAt = killAt + 3_600_000;
  const names: (string | null | undefined)[] = [];
  const runner = new ForeverBlizzardRunner({
    item: async (id, name) => { names.push(name); return id === 300 ? null : { level: id === 100 ? 66 : 63, name: name ?? null, namespace: "static-forever-eu" }; },
    statistics: async slug => ({ character: { slug }, categories: [{ name: "Dungeons & Raids", sub_categories: [{ name: "Boss Kills", statistics: members.includes(slug) ? [
      { id: 501, name: "Chillhowl kills (Barrow Deeps)", quantity: slug === "jasen-yksi" && latestKill !== killAt ? 2 : 1,
        last_updated_timestamp: slug === "jasen-yksi" ? latestKill : killAt },
    ] : [] }], statistics: [{ id: 1, name: "Equipped epic items in item slots", quantity: slug === "varuste-sankari" ? 2 : 0 }] }] }),
    achievements: async slug => ({ character: { slug }, total_points: 0, achievements: [
      { id: 9, achievement: { name: "Artisan Tailor" }, criteria: { is_completed: true }, completed_timestamp: killAt - 86_400_000 },
      ...members.includes(slug) ? [
        // Elder Tangleclaw has no kill statistic here, only achievement progress.
        { id: 62035, achievement: { name: "Conqueror of the Deeps" }, criteria: { is_completed: false, child_criteria: [{ id: 230801, is_completed: true }] } },
        { id: 684, achievement: { name: "Conqueror of the Lair" }, criteria: { is_completed: true }, completed_timestamp: onyxiaAt },
      ] : [],
    ] }),
  });
  const drain = async () => {
    for (let index = 0; index < 12; index++) {
      await ForeverWorker.updateOne({ _id: "blizzard" }, { $set: { nextRequestAt: new Date(0) } });
      await runner.tick();
    }
  };
  await drain();
  assert.deepEqual(names, ["Known Hood", "Known Staff", "Hidden Robe"], "lookups carry the name Forever shows");
  const items = await ForeverItem.find().sort({ _id: 1 }).lean();
  assert.deepEqual(items.map(item => [item._id, item.level ?? null, item.nextCheckAt instanceof Date]), [[100, 66, false], [200, 63, false], [300, null, true]]);
  assert.ok(items[2].nextCheckAt!.getTime() > Date.now() + 6 * 86_400_000, "unknown items wait a week");
  const checked = await ForeverCharacter.find({ statsNextCheckAt: { $gt: new Date() } }).countDocuments();
  assert.equal(checked, 4);

  const raids = await buildForeverRaids();
  const deeps = raids.raids.find(raid => raid.key === "barrow-deeps")!;
  assert.deepEqual(deeps.guilds.map(row => [row.guild.slug, row.killed, row.approximate, row.bosses.map(entry => [entry.name, entry.approximate])]),
    [["kilta", 2, true, [["Chillhowl", false], ["Elder Tangleclaw", true]]]]);
  assert.deepEqual([deeps.bosses[0].first?.guild.slug, deeps.bosses[0].first?.at, deeps.bosses[0].first?.participants], ["kilta", new Date(killAt).toISOString(), 3]);
  assert.equal(deeps.bosses[1].first?.approximate, true, "criteria-only evidence is marked approximate");
  assert.equal(deeps.bosses[2].first, null);
  const lair = raids.raids.find(raid => raid.key === "onyxias-lair")!;
  assert.deepEqual([lair.bosses[0].first?.guild.slug, lair.bosses[0].first?.approximate, lair.firstClear?.at], ["kilta", false, new Date(onyxiaAt).toISOString()]);
  assert.deepEqual(raids.recent.slice(0, 2).map(kill => [kill.boss, kill.instance, kill.raid, kill.guild?.slug]),
    [["Onyxia", "Onyxia's Lair", true, "kilta"], ["Chillhowl", "Barrow Deeps", true, "kilta"]]);

  const records = await foreverRecords({ board: "itemLevel" });
  // Hood 66 + staff 63 twice over 17 slots, with the hidden robe left out of the average.
  assert.deepEqual(records.rows.map(row => [row.slug, row.values.itemLevel, row.itemLevelUnknown]), [["varuste-sankari", Math.round((66 + 63 * 2) / 16 * 10) / 10, 1]]);
  assert.equal((await foreverRecords({ board: "achievements" })).total, 4);

  const detail = await characterDetail("varuste-sankari");
  assert.deepEqual(detail.profile?.gear.map(item => [item.name, item.itemLevel]), [["Known Hood", 66], ["Known Staff", 63], ["Hidden Robe", null]]);
  assert.equal(detail.profile?.itemLevel?.unknown, 1);
  assert.equal(detail.profile?.achievementCount, 1);

  const guildPage = await publicGuildDetail("kilta");
  assert.equal(guildPage.overview.level60, 3);
  assert.deepEqual(guildPage.overview.raids.map(raid => [raid.instance, raid.killed]), [["Barrow Deeps", 2], ["Hyjal Summit", 0], ["Onyxia's Lair", 1]]);
  const memberDetail = await characterDetail("jasen-kaksi");
  const memberDeeps = memberDetail.profile!.raids[0];
  assert.deepEqual(memberDeeps.bosses.slice(0, 3).map(entry => [entry.name, entry.killed, entry.firstKillAt?.getTime() ?? null, !!entry.seenAt]),
    [["Chillhowl", true, killAt, false], ["Elder Tangleclaw", true, null, true], ["Khalith the Dreadspinner", false, null, false]]);

  // A later kill by one member adds a dated kill without moving the exact first kill.
  latestKill = killAt + 7 * 86_400_000; // A week later, still in the past.
  const member = await ForeverCharacter.findOneAndUpdate({ slug: "jasen-yksi" }, { $set: { statsNextCheckAt: new Date(0) } }).lean();
  await drain();
  const boss = (await ForeverCharacterDetail.findById(member!._id).lean())!.blizzard!.bosses[0];
  assert.deepEqual([boss.count, boss.firstKillAt?.getTime(), boss.kills.map(kill => kill.at.getTime())], [2, killAt, [killAt, latestKill]]);
});
