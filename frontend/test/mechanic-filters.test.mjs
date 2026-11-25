import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_MECHANIC_FILTERS, mechanicFilterParams, mechanicSelection, readMechanicFilters } from "../src/lib/mechanic-filters.ts";

test("a shared mechanics URL restores the exact leaderboard and preserves unrelated parameters", () => {
  const filters = {
    mechanic: "sarkareth-abyssal-breath", guildId: "123", roles: ["healer", "tank"], minPulls: 50,
    sort: "hitsPerPull", order: "asc", search: "Ää & Öö", page: 3,
  };
  const url = new URL("https://example.org/analytics/mechanics?ref=raid#results");
  mechanicFilterParams(filters, url.searchParams);
  const shared = new URL(url.href);
  assert.deepEqual(readMechanicFilters(shared.searchParams), filters);
  assert.equal(shared.searchParams.get("ref"), "raid");
  assert.equal(shared.hash, "#results");
  mechanicFilterParams(DEFAULT_MECHANIC_FILTERS, shared.searchParams);
  assert.equal(shared.searchParams.has("guildId"), false);
  assert.equal(shared.searchParams.has("search"), false);
  assert.deepEqual(readMechanicFilters(shared.searchParams), DEFAULT_MECHANIC_FILTERS);
});

test("no roles survives sharing, while absent or invalid filters get usable defaults", () => {
  const read = (query) => readMechanicFilters(new URLSearchParams(query));
  assert.deepEqual(read("roles=tank,dps,tank,unknown").roles, ["dps", "tank"]);
  assert.deepEqual(readMechanicFilters(mechanicFilterParams({ ...DEFAULT_MECHANIC_FILTERS, roles: [] })).roles, []);
  assert.deepEqual(read(""), DEFAULT_MECHANIC_FILTERS);
  assert.deepEqual(read("roles=unknown&minPulls=99&sort=pulls&order=sideways&page=10001"), DEFAULT_MECHANIC_FILTERS);
});

test("linked guild selections follow boss participation and stale mechanics fall back to the first option", () => {
  const first = { key: "final-boss" }, other = { key: "early-boss" };
  const guild = { id: "both", mechanicKeys: [first.key, other.key] };
  const options = { mechanics: [first, other], guilds: [guild, { id: "early", mechanicKeys: [other.key] }] };
  const resolve = (mechanic, guildId) => mechanicSelection(options, { ...DEFAULT_MECHANIC_FILTERS, mechanic, guildId });
  assert.equal(resolve(other.key, "early").selectedGuild?.id, "early");
  assert.equal(resolve(first.key, "early").selectedGuild, undefined);
  assert.equal(resolve(first.key, "both").selectedGuild, guild);
  assert.equal(resolve("retired", "").selected, first);
});
