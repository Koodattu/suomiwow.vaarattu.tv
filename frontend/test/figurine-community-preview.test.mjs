import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createCommunityPreview, communityPreviewReducer as reduce, PREVIEW_GIFTS, PREVIEW_FIGURES, previewRankings } from "../src/lib/figurine-community-preview.ts";

test("sample gifts claim once, validate recipients, and cannot send an exhausted figure", () => {
  let state = createCommunityPreview();
  const gift = PREVIEW_GIFTS[0], count = state.inventory[gift.figure];
  state = reduce(state, { type: "claim", id: gift.id });
  assert.equal(state.inventory[gift.figure], count + 1);
  assert.equal(reduce(state, { type: "claim", id: gift.id }), state);
  for (const recipient of ["", "   ", "a".repeat(41)]) assert.equal(reduce(state, { type: "send", figure: 0, recipient, message: "hello" }), state);
  assert.equal(reduce(state, { type: "send", figure: 0, recipient: "Lumi", message: "a".repeat(241) }), state);
  for (let i = 0; i < 3; i++) state = reduce(state, { type: "send", figure: 0, recipient: " Lumi ", message: " Enjoy! " });
  assert.equal(state.inventory[0], 0);
  assert.equal(state.sent.length, 3);
  assert.equal(state.sent[0].recipient, "Lumi");
  assert.equal(state.sent[0].message, "Enjoy!");
  assert.equal(reduce(state, { type: "send", figure: 0, recipient: "Lumi", message: "hello" }), state);
  assert.deepEqual(createCommunityPreview().inventory, [3, 1, 2, 0, 0, 1], "a reload starts a new preview");
});
test("reactions toggle and each ranking sorts by the selected metric", () => {
  const initial = createCommunityPreview(), cheered = reduce(initial, { type: "cheer", id: "pull-1" });
  assert.deepEqual(cheered.cheers, ["pull-1"]);
  assert.deepEqual(reduce(cheered, { type: "cheer", id: "pull-1" }).cheers, []);
  for (const metric of ["unique", "golden", "galaxy", "opened"]) {
    const rows = previewRankings(metric);
    assert.ok(rows.every((row, index) => index === 0 || rows[index - 1][metric] >= row[metric]));
  }
  assert.equal(previewRankings("unique")[0].name, "Lumi");
  assert.equal(previewRankings("galaxy")[0].name, "Naava");
});
test("all sample portraits exist and English and Finnish overlay messages have matching keys", async () => {
  const catalogs = await Promise.all(["community-001", "community-002"].map(async id => JSON.parse(await readFile(new URL(`../src/data/figurines/${id}.json`, import.meta.url)))));
  const keys = catalogs.flatMap(catalog => catalog.characters.map(character => `${catalog.id}:${character.id}`));
  for (const item of PREVIEW_FIGURES) assert.ok(keys.includes(item.key), item.key);
  const messages = await Promise.all(["en", "fi"].map(async locale => JSON.parse(await readFile(new URL(`../messages/${locale}.json`, import.meta.url)))));
  const flatten = (object, path = "") => Object.entries(object).flatMap(([key, value]) => typeof value === "string" ? [path + key] : flatten(value, `${path}${key}.`)).sort();
  assert.deepEqual(flatten(messages[0].figurineLab.world.overlays), flatten(messages[1].figurineLab.world.overlays));
});
