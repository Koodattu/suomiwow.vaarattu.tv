import assert from "node:assert/strict";
import test from "node:test";
import characterRankingBackfillService from "../src/services/character-ranking-backfill.service";

test("ranking backfill fetches every class spec even when one spec was already observed", () => {
  const service = characterRankingBackfillService as any;
  const queries = service.buildSpecQueries({
    classID: 13,
    observedSpecNames: ["Augmentation"],
  });

  assert.deepEqual(
    queries.map((query: any) => `${query.specSlug}:${query.metric}`).sort(),
    [
      "augmentation:dps",
      "devastation:dps",
      "preservation:dps",
      "preservation:hps",
    ],
  );
  assert.equal(queries.find((query: any) => query.specSlug === "augmentation")?.source, "observed");
  assert.equal(queries.find((query: any) => query.specSlug === "devastation")?.source, "fallback");
});
