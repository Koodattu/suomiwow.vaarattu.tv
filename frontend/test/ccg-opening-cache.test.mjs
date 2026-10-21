import assert from "node:assert/strict";
import test from "node:test";
import { updateCcgSessionAfterOpening, updateCcgSetsAfterOpening } from "../src/lib/ccg-opening-cache.ts";

test("pack opening updates separate session and set caches without losing balances or unrelated sets", () => {
  const session = { ownerType: "user", recharge: { cap: 10 }, packs: { totalRemaining: 5 }, ownedFinishes: 8,
    customQualityProtection: [{ setSlug: "raid", counter: 4, hardPity: 20 }, { setSlug: "other", counter: 6 }], qualityProtection: [] };
  const sets = [{ id: "a", ownedCards: 3, name: "Raid" }, { id: "b", ownedCards: 7 }];
  const updates = { packs: { totalRemaining: 4 }, qualityProtection: [{ finish: "foil", counter: 2 }],
    customQualityProtection: [{ setSlug: "raid", counter: 0 }], ownedFinishesDelta: 2, ownedCardsBySetDelta: { a: 1 } };
  const next = updateCcgSessionAfterOpening(session, updates);
  assert.equal(next.packs.totalRemaining, 4);
  assert.equal(next.ownedFinishes, 10);
  assert.deepEqual(next.qualityProtection, updates.qualityProtection);
  assert.deepEqual(next.customQualityProtection, [{ setSlug: "raid", counter: 0, hardPity: 20 }, { setSlug: "other", counter: 6 }]);
  assert.deepEqual(next.recharge, session.recharge);
  assert.deepEqual(updateCcgSetsAfterOpening(sets, updates), [{ id: "a", ownedCards: 4, name: "Raid" }, { id: "b", ownedCards: 7 }]);
  assert.equal(session.packs.totalRemaining, 5);
  assert.equal(sets[0].ownedCards, 3);
});
