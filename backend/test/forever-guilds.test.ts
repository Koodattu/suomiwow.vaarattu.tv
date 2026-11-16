import assert from "node:assert/strict";
import test from "node:test";
import { Types } from "mongoose";
import { ForeverCharacter, ForeverGuild } from "../src/features/forever/forever.models";
import { publicGuilds, publicGuildDetail } from "../src/features/forever/forever-guilds";

const guildId = new Types.ObjectId();
const roster = ["alpha", "beta", "gamma"].map(slug => ({ region: "eu" as const, slug, name: slug, level: 20, className: "Mage", faction: "Alliance" }));
const guild = { _id: guildId, name: "Test Guild", region: "eu" as const, slug: "test-guild", roster, lastFetchedAt: new Date(),
  proposedBy: "private-user", languageAssessment: { percent: 90 }, failures: 2 };
const characters = roster.map(member => ({ ...member, _id: new Types.ObjectId(), guild: { region: "eu", slug: guild.slug },
  ruleset: "Normal", sourceUpdatedAt: new Date() }));
const query = (value: unknown) => ({ select: () => ({ lean: async () => value }) });

test("public directory requires approved visible guilds and returns only summaries", async t => {
  t.mock.method(ForeverGuild, "find", (filter: unknown) => {
    assert.deepEqual(filter, { status: "approved", hidden: { $ne: true } });
    return query([guild, { ...guild, _id: new Types.ObjectId(), region: "us", roster: [] }]);
  });
  t.mock.method(ForeverCharacter, "find", (filter: unknown) => {
    assert.deepEqual(filter, { status: "tracked", $or: [
      { region: "eu", "guild.region": "eu", "guild.slug": "test-guild" },
      { region: "us", "guild.region": "us", "guild.slug": "test-guild" },
    ] });
    return query(characters);
  });
  const result = await publicGuilds();
  assert.equal(result.guilds.length, 2);
  assert.equal(result.guilds[0].ruleset, "Normal");
  assert.equal(result.guilds[0].faction, "Alliance");
  assert.equal(result.guilds[0].rosterCount, 3);
  assert.equal(result.guilds[1].ruleset, null);
  assert.deepEqual(Object.keys(result.guilds[0]).sort(), ["_id", "name", "region", "slug", "rosterCount", "lastFetchedAt", "faction", "ruleset"].sort());
});

test("guilds without enough profile evidence retain known faction but unknown ruleset", async t => {
  t.mock.method(ForeverGuild, "find", () => query([guild]));
  t.mock.method(ForeverCharacter, "find", () => query(characters.slice(0, 1)));
  const result = await publicGuilds();
  assert.equal(result.guilds[0].faction, "Alliance");
  assert.equal(result.guilds[0].ruleset, null);
});

test("empty directory does not query character profiles", async t => {
  t.mock.method(ForeverGuild, "find", () => query([]));
  t.mock.method(ForeverCharacter, "find", () => { throw new Error("Unexpected profile query"); });
  assert.deepEqual(await publicGuilds(), { guilds: [] });
});

test("public roster includes unfetched and outdated members without exposing admin fields", async t => {
  t.mock.method(ForeverGuild, "findOne", (filter: unknown) => {
    assert.deepEqual(filter, { status: "approved", hidden: { $ne: true }, _id: guildId });
    return query({ ...guild, roster: [...roster, { ...roster[0], slug: "untracked", isOutdated: true }] });
  });
  t.mock.method(ForeverGuild, "find", () => query([])); // Existing character visibility policy.
  t.mock.method(ForeverCharacter, "find", (filter: Record<string, unknown>) => {
    assert.equal(filter.status, "tracked"); assert.equal(filter.region, "eu");
    return query(characters);
  });
  const result = await publicGuildDetail(guildId);
  assert.equal(result.roster.length, 4);
  assert.equal(result.roster[0].characterId, String(characters[0]._id));
  assert.equal(result.roster[3].characterId, null);
  assert.equal(result.roster[3].isOutdated, true);
  assert.equal(result.ruleset, "Normal");
  assert.equal(result.armoryUrl, "https://worldofwarcraft.blizzard.com/en-gb/forever/eu/armory/guild/test-guild");
  assert.equal("proposedBy" in result, false);
  assert.equal("languageAssessment" in result, false);
  assert.equal("failures" in result, false);
});

test("hidden, unapproved and missing guilds cannot be opened directly", async t => {
  t.mock.method(ForeverGuild, "findOne", (filter: Record<string, unknown>) => {
    assert.equal(filter.status, "approved"); assert.deepEqual(filter.hidden, { $ne: true });
    return query(null);
  });
  t.mock.method(ForeverCharacter, "find", () => { throw new Error("Unexpected roster query"); });
  await assert.rejects(publicGuildDetail(guildId), { code: "not_found", status: 404 });
});
