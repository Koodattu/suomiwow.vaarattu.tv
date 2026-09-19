import assert from "node:assert/strict";
import test from "node:test";
import { getStudioRaidCards, getStudioSlots } from "../src/lib/ccg-studio.ts";

const state = (overrides = {}) => ({
  entitlements: { base: 2, follower: false, subscriber: false },
  allowance: { earned: 2, used: 0, available: 2, drafts: 0, draftLimit: 5 },
  creations: [],
  ...overrides,
});
const creation = (id, published = false) => ({ id, cardId: published ? `card-${id}` : null, draft: published ? null : {} });

test("a fresh account has two usable slots and four specific unlock opportunities", () => {
  const slots = getStudioSlots(state());
  assert.equal(slots.length, 6);
  assert.deepEqual(slots.map((slot) => slot.unlock), [null, null, "follower", "subscriber", "subscriber", "subscriber"]);
});

test("current Twitch status cannot relock earned slots; monthly grants extend capacity", () => {
  const slots = getStudioSlots(state({
    entitlements: { base: 2, follower: true, subscriber: true },
    status: { following: false, subscribed: false }, twitchConnected: false,
    allowance: { earned: 8, used: 0, available: 8 },
  }));
  assert.equal(slots.length, 8);
  assert.ok(slots.every((slot) => slot.unlock === null));
});

test("a subscriber who never followed keeps the follower opportunity locked", () => {
  const slots = getStudioSlots(state({ entitlements: { base: 2, follower: false, subscriber: true }, allowance: { earned: 5, used: 0, available: 5 } }));
  assert.equal(slots.length, 6);
  assert.equal(slots.find((slot) => slot.id === "follower").unlock, "follower");
  assert.equal(slots.filter((slot) => !slot.unlock).length, 5);
});

test("aggregate banked capacity is preserved even without historical grant rows", () => {
  const slots = getStudioSlots(state({ allowance: { earned: 7, used: 0, available: 7 } }));
  assert.equal(slots.filter((slot) => !slot.unlock).length, 7);
});

test("a draft created in the second slot stays selected there through publication", () => {
  const draft = creation("draft");
  const placements = { draft: "base:1" };
  let slots = getStudioSlots(state({ creations: [draft] }), placements);
  assert.equal(slots[0].creation, null);
  assert.equal(slots[1].creation.id, draft.id);
  slots = getStudioSlots(state({ creations: [creation("draft", true)], allowance: { earned: 2, used: 1, available: 1 } }), placements);
  assert.equal(slots[1].creation.id, draft.id);
  assert.equal(slots[1].used, true);
});

test("published cards take precedence over excess drafts without losing saved drafts", () => {
  const data = state({ creations: [creation("a"), creation("b"), creation("c", true)], allowance: { earned: 2, used: 1, available: 1 } });
  const slots = getStudioSlots(data, { a: "base:0", c: "base:0" });
  assert.equal(slots[0].creation.id, "c");
  assert.equal(slots[1].creation.id, "a");
  assert.equal(data.creations.length, 3);
  assert.equal(slots.filter((slot) => slot.used).length, 1);
});

test("a consumed slot does not reopen when its creation is absent from the response", () => {
  const slots = getStudioSlots(state({ creations: [creation("draft")], allowance: { earned: 2, used: 2, available: 0 } }));
  assert.equal(slots.filter((slot) => slot.used).length, 2);
  assert.ok(slots.every((slot) => !slot.creation));
});

test("raid gallery excludes Supporter and Community cards and deduplicates identity matches", () => {
  const raid = { id: "raid", set: { kind: "raid" } };
  const supporter = { id: "supporter", set: { kind: "supporter" } };
  const community = { id: "community", set: { kind: "community" } };
  assert.deepEqual(getStudioRaidCards([{ cards: [raid, supporter, community] }, { cards: [raid] }]), [raid]);
});
