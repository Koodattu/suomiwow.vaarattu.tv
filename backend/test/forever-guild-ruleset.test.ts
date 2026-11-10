import assert from "node:assert/strict";
import test from "node:test";
import { confirmedGuildRuleset } from "../src/features/forever/forever-guild-ruleset";
import type { ForeverMember } from "../src/features/forever/forever-armory";
import { mayFetchProfile, mayRequestRefresh } from "../src/features/forever/forever-policy";

const guild = { region: "eu", slug: "guild" };
const characters = ["one", "two", "three"].map(slug => ({ slug, guild, faction: "Horde", ruleset: "PvP", sourceUpdatedAt: new Date() }));
const roster: ForeverMember[] = [...characters, { slug: "young", faction: "Horde" }].map(c => ({ region: "eu", slug: c.slug,
  faction: c.faction, name: c.slug, className: "Mage", level: c.slug === "young" ? 1 : 20 }));

test("guild rulesets require three agreeing direct profiles and no faction/ruleset conflicts", () => {
  assert.deepEqual(confirmedGuildRuleset(guild, roster, characters), { faction: "Horde", ruleset: "PvP" });
  assert.equal(confirmedGuildRuleset(guild, roster, characters.slice(0, 2)), null);
  for (const patch of [{ ruleset: "Normal" }, { faction: "Alliance" }, { rulesetInferredFromGuild: "guild" },
    { guild: { ...guild, slug: "other" } }, { guild: { ...guild, region: "us" } }, { sourceUpdatedAt: undefined }]) {
    assert.equal(confirmedGuildRuleset(guild, roster, [characters[0], characters[1], { ...characters[2], ...patch }]), null);
  }
  assert.equal(confirmedGuildRuleset(guild, roster.map(m => m.slug === "three" ? { ...m, isOutdated: true } : m), characters), null);
  assert.equal(confirmedGuildRuleset(guild, roster.filter(m => m.slug !== "three"), characters), null);
  assert.equal(confirmedGuildRuleset(guild, roster.map(m => m.slug === "young" ? { ...m, faction: "Alliance" } : m), characters), null);
});

test("unknown levels can be discovered, but all known sub-10 levels reject profile polling and refresh", () => {
  assert.equal(mayFetchProfile(undefined), true); assert.equal(mayFetchProfile(null), true);
  assert.equal(mayFetchProfile(undefined, 5), false);
  assert.equal(mayFetchProfile(20, 5), true, "an outdated low roster cannot overrule a higher accepted level");
  for (let level = 1; level < 10; level++) {
    assert.equal(mayFetchProfile(level), false);
    assert.equal(mayRequestRefresh({ status: "tracked", level, failures: 0, nextFetchAt: new Date(Date.now() + 60000) }), false);
  }
  assert.equal(mayFetchProfile(10), true); assert.equal(mayFetchProfile(60), true);
});
