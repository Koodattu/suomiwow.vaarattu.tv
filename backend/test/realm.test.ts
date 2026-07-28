import assert from "node:assert/strict";
import test from "node:test";
import { areEquivalentRealms, createRealmIdentityKey, normalizeRealmSlug, realmNameToSlugCandidate } from "../src/utils/realm";

test("matches Warcraft Logs realm display names to Blizzard-style slugs", () => {
  const aliases = [
    ["Blade's Edge", "blades-edge"],
    ["Lightning's Blade", "lightnings-blade"],
    ["Vek'Nilash", "veknilash"],
    ["Cho’gall", "chogall"],
    ["Aggra (Português)", "aggra-português"],
    ["Azjol-Nerub", "azjolnerub"],
    ["Pozzo dell'Eternità", "pozzo-delleternità"],
  ] as const;

  for (const [displayName, slug] of aliases) {
    assert.equal(areEquivalentRealms(displayName, slug), true, `${displayName} should match ${slug}`);
    assert.equal(createRealmIdentityKey(displayName), createRealmIdentityKey(slug));
  }
});

test("preserves punctuation and diacritics in authoritative realm slugs", () => {
  assert.equal(normalizeRealmSlug(" Pozzo-dellEternità "), "pozzo-delleternità");
  assert.equal(normalizeRealmSlug("Lightning's Blade"), "lightning's-blade");
});

test("creates a clean fallback slug without treating it as authoritative", () => {
  assert.equal(realmNameToSlugCandidate("Blade's Edge"), "blades-edge");
  assert.equal(realmNameToSlugCandidate("Aggra (Português)"), "aggra-português");
  assert.equal(realmNameToSlugCandidate("Azjol-Nerub"), "azjol-nerub");
});
