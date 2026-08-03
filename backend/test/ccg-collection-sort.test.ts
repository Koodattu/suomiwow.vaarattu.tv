/// <reference path="../src/types/express-session.d.ts" />

import assert from "node:assert/strict";
import test from "node:test";
import "express-session";
import { CCG_CUSTOM_FINISHES } from "../src/config/ccg";
import {
  buildCcgCollectionQualityRank,
  buildCcgCollectionSortStages,
  CCG_COLLECTION_SORTS,
  resolveCcgCollectionSort,
} from "../src/services/ccg.service";

const paths = {
  grade: "card.tierGrade",
  name: "card.name",
  realm: "card.realm",
  setNumber: "card.setNumber",
  id: "card._id",
};

const expressions = {
  duplicates: "$duplicates",
  quality: "$quality",
  damage: "$damage",
  mechanics: "$mechanics",
  combined: "$combined",
  mythicPlus: "$mythicPlus",
};

test("collection sort accepts every supported value and ignores unknown values", () => {
  for (const sort of CCG_COLLECTION_SORTS) assert.equal(resolveCcgCollectionSort(sort), sort);
  assert.equal(resolveCcgCollectionSort("newest"), null);
  assert.equal(resolveCcgCollectionSort(undefined), null);
});

test("collection sort directions and stable fallbacks match their labels", () => {
  const rarityDescending = buildCcgCollectionSortStages("rarity_desc", paths, expressions) as any[];
  const duplicatesDescending = buildCcgCollectionSortStages("duplicates_desc", paths, expressions) as any[];
  const qualityAscending = buildCcgCollectionSortStages("quality_asc", paths, expressions) as any[];
  const damageDescending = buildCcgCollectionSortStages("damage_desc", paths, expressions) as any[];
  const alphabetical = buildCcgCollectionSortStages("alphabetical", paths, expressions) as any[];
  const reverseAlphabetical = buildCcgCollectionSortStages("reverse_alphabetical", paths, expressions) as any[];

  assert.deepEqual(rarityDescending[0].$set.sortValue.$indexOfArray[0], ["H", "S", "A", "B", "C", "D", "E", "F"]);
  assert.equal(rarityDescending[2].$sort.sortValue, 1);
  assert.equal(duplicatesDescending[2].$sort.sortValue, -1);
  assert.equal(qualityAscending[2].$sort.sortValue, 1);
  assert.equal(damageDescending[2].$sort.sortValue, -1);
  assert.equal(damageDescending[2].$sort.sortMissing, 1);
  assert.deepEqual(alphabetical, [{
    $sort: {
      "card.name": 1,
      "card.realm": 1,
      "card.setNumber": 1,
      "card._id": 1,
    },
  }]);
  assert.deepEqual(reverseAlphabetical, [{
    $sort: {
      "card.name": -1,
      "card.realm": -1,
      "card.setNumber": 1,
      "card._id": 1,
    },
  }]);
});

test("collection quality sorting gives every custom finish the shared Unique rank", () => {
  const expression = buildCcgCollectionQualityRank("$finish") as any;
  assert.deepEqual(expression.$switch.branches, [
    { case: { $in: ["$finish", [...CCG_CUSTOM_FINISHES]] }, then: 5 },
    { case: { $eq: ["$finish", "negative"] }, then: 6 },
    { case: { $eq: ["$finish", "astral"] }, then: 7 },
  ]);
});
