import assert from "node:assert/strict";
import test from "node:test";
import { RAIDER_IO_SPEC_SLOTS_BY_BLIZZARD_CLASS_ID } from "../src/config/raiderio-specs";
import { orderSpecializationsForRaiderIo, PlayableSpecialization } from "../src/scripts/fetch-blizzard-raiderio-spec-map";
import mythicPlusService from "../src/services/mythic-plus.service";

const blizzardMonkSpecializations: PlayableSpecialization[] = [
  { id: 268, name: "Brewmaster", href: null },
  { id: 269, name: "Windwalker", href: null },
  { id: 270, name: "Mistweaver", href: null },
];

test("Raider.IO Monk slots use Brewmaster, Mistweaver, Windwalker order", () => {
  const monk = RAIDER_IO_SPEC_SLOTS_BY_BLIZZARD_CLASS_ID[10];

  assert.deepEqual(
    [monk.specs.spec_0, monk.specs.spec_1, monk.specs.spec_2].map((spec) => ({ id: spec?.blizzardSpecId, slug: spec?.specSlug })),
    [
      { id: 268, slug: "brewmaster" },
      { id: 270, slug: "mistweaver" },
      { id: 269, slug: "windwalker" },
    ],
  );
});

test("mapping generation corrects Blizzard's Monk specialization response order", () => {
  assert.deepEqual(
    orderSpecializationsForRaiderIo(10, blizzardMonkSpecializations).map((spec) => spec.id),
    [268, 270, 269],
  );
});

test("Monk score buckets receive the correct names and roles", () => {
  const scores = {
    all: 3200,
    dps: 900,
    healer: 3200,
    tank: 0,
    spec_0: 0,
    spec_1: 3200,
    spec_2: 900,
    spec_3: 0,
  };

  assert.deepEqual(
    mythicPlusService.mapSpecScores(5, scores, {}).map(({ field, specSlug, role, score }) => ({ field, specSlug, role, score })),
    [
      { field: "spec_0", specSlug: "brewmaster", role: "tank", score: 0 },
      { field: "spec_1", specSlug: "mistweaver", role: "healer", score: 3200 },
      { field: "spec_2", specSlug: "windwalker", role: "dps", score: 900 },
    ],
  );
});
