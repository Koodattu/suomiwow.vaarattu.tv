import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { boxReducer, chooseFigure, initialBox } from "../src/lib/figurine-box.ts";
import { CHARGE_CUES, CHARGE_SECONDS, ENTRANCE_SECONDS, KNOCK_TIMES, LAND_AT, REVEAL_CUES, REVEAL_SECONDS, cuesBetween, figurineCharge, figurineEntrance, figurineReveal } from "../src/lib/figurine-reveal.ts";

test("the reveal bursts the box, lifts the figure, and lands exactly on the disc", () => {
  const burst = figurineReveal(0);
  assert.equal(burst.lift, 0);
  assert.equal(burst.boxOpacity, 1);
  assert.equal(burst.flash, 1);
  assert.equal(burst.silhouette, 1);
  assert.ok(figurineReveal(1.2).lift > 0.7);
  assert.equal(figurineReveal(1).boxOpacity, 0);
  assert.ok(figurineReveal(LAND_AT - 0.01).lift > 0);
  assert.ok(figurineReveal(LAND_AT + 0.05).shake > 0.5);
  const landed = figurineReveal(REVEAL_SECONDS);
  assert.equal(landed.lift, 0);
  assert.equal(landed.spin, 0);
  assert.equal(landed.figureScale, 1);
  assert.equal(landed.silhouette, 0);
  for (const effect of ["flash", "beam", "shake", "plinthGlow", "burstRing", "landRing"]) assert.equal(landed[effect], 0, effect);
  assert.equal(Math.abs(landed.zoom - 1) < 1e-9, true);
  assert.equal(landed.complete, true);
  assert.equal(figurineReveal(REVEAL_SECONDS - 0.01).complete, false);
  assert.deepEqual(figurineReveal(100), landed);
  assert.deepEqual(figurineReveal(0, true), landed);
});

test("the charge builds to the burst and its cues fire once in order", () => {
  assert.equal(figurineCharge(0).build, 0);
  assert.equal(figurineCharge(CHARGE_SECONDS).ready, true);
  assert.equal(figurineCharge(CHARGE_SECONDS - 0.01).ready, false);
  for (const at of KNOCK_TIMES) assert.ok(figurineCharge(at).knock > 0.5);
  assert.ok(figurineCharge(KNOCK_TIMES[3]).knock > figurineCharge(KNOCK_TIMES[0]).knock);
  assert.deepEqual(cuesBetween(CHARGE_CUES, -1, 0).map(({ cue }) => cue), ["rip"]);
  assert.equal(figurineCharge(0.5).rip, 1);
  assert.equal(figurineCharge(1).ripFly, 1);
  let previous = -1; const fired = [];
  for (let time = 0; time <= REVEAL_SECONDS; time += 1 / 60) { fired.push(...cuesBetween(REVEAL_CUES, previous, time).map(({ cue }) => cue)); previous = time; }
  assert.deepEqual(fired, ["burst", "hit", "boom", "whoosh", "rise", "choir", "sparkle", "land", "signature", "fanfare", "quip"]);
  assert.ok(figurineEntrance(0).drop > 3);
  assert.equal(figurineEntrance(ENTRANCE_SECONDS).drop, 0);
  assert.equal(figurineEntrance(ENTRANCE_SECONDS).squash, 0);
  assert.equal(figurineEntrance(0, true).complete, true);
});

test("uniform draw boundaries cover every figure and reject invalid inputs", () => {
  assert.equal(chooseFigure(2, 0), 0);
  assert.equal(chooseFigure(2, 0.49999), 0);
  assert.equal(chooseFigure(2, 0.5), 1);
  assert.equal(chooseFigure(2, 0.99999), 1);
  for (const pair of [[0, 0], [2, 1], [2, -1], [2, NaN], [1.5, 0]]) assert.throws(() => chooseFigure(...pair));
});

test("a draw cannot change during load or reveal, and reset conceals the previous result", () => {
  let state = boxReducer(initialBox, { type: "open", selected: 1 });
  assert.equal(boxReducer(state, { type: "revealed" }), state);
  assert.equal(boxReducer(state, { type: "open", selected: 0 }), state);
  assert.equal(boxReducer(state, { type: "reset" }), state);
  state = boxReducer(state, { type: "loaded" });
  assert.equal(state.phase, "opening");
  assert.equal(boxReducer(state, { type: "open", selected: 0 }), state);
  state = boxReducer(state, { type: "revealed" });
  assert.equal(state.selected, 1);
  assert.deepEqual(boxReducer(state, { type: "reset" }), { ...initialBox, round: 1 });
});

test("failed loading retries the same selected character with a fresh scene", () => {
  let state = boxReducer(initialBox, { type: "open", selected: 0 });
  state = boxReducer(state, { type: "failed" });
  assert.equal(boxReducer(state, { type: "loaded" }), state);
  state = boxReducer(state, { type: "retry" });
  assert.deepEqual(state, { phase: "loading", selected: 0, round: 1 });
});

test("catalog serves complete embedded GLBs below the 2 MB per-character budget", async () => {
  const catalog = JSON.parse(await readFile(new URL("../src/data/figurines/community-001.json", import.meta.url)));
  assert.equal(catalog.characters.length, 16);
  for (const id of ["roidy", "yolobolt", "laku", "chipie", "ovelakettu"]) assert.ok(catalog.characters.some(c => c.id === id));
  assert.equal(new Set(catalog.characters.map(c => c.id)).size, catalog.characters.length);
  for (const entry of catalog.characters) {
    assert.match(entry.model, /^\/figurines\/community-001\/[a-z-]+\.glb$/);
    const bytes = await readFile(new URL(`../public${entry.model}`, import.meta.url));
    assert.ok(bytes.length < 2_000_000);
    assert.equal(bytes.length, entry.bytes);
    assert.equal(bytes.subarray(0, 4).toString(), "glTF");
    assert.equal(bytes.readUInt32LE(8), bytes.length);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), entry.sha256);
    const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)));
    assert.ok(gltf.extensionsRequired.includes("EXT_meshopt_compression"));
    assert.ok(gltf.images.every(image => image.bufferView !== undefined));
    assert.ok(gltf.buffers.every(buffer => !buffer.uri));
    assert.equal(gltf.skins?.length ?? 0, 0);
    assert.ok(Number.isFinite(gltf.scenes[0].extras.wowCharacter.groundY));
    assert.ok(Number.isFinite(gltf.scenes[0].extras.wowCharacter.centerX));
    assert.ok(Number.isFinite(gltf.scenes[0].extras.wowCharacter.centerZ));
    assert.ok(gltf.materials.every(material => material.extras.wowM2.version === 1));
  }
});

test("the series retains the requested poses and weapon placement", async () => {
  const catalog = JSON.parse(await readFile(new URL("../src/data/figurines/community-001.json", import.meta.url)));
  assert.equal(catalog.characters.find(c => c.id === "stablol").weapons, "sheathed");
  for (const [id, animationId, weapons] of [["roidy", 68, "held"], ["yolobolt", 74, "held"], ["laku", 97, "sheathed"], ["suursmurffi", 83, "sheathed"], ["turrilol", 69, "sheathed"], ["ovelakettu", 1260, "sheathed"]]) {
    const figure = catalog.characters.find(c => c.id === id);
    assert.equal(figure.pose.animationId, animationId);
    assert.equal(figure.weapons, weapons);
    assert.ok(figure.pose.timeMs > 0 && figure.pose.timeMs < figure.pose.durationMs);
  }
});

test("every catalog race and class is translated in both maintained locales", async () => {
  const catalog = JSON.parse(await readFile(new URL("../src/data/figurines/community-001.json", import.meta.url)));
  for (const locale of ["en", "fi"]) {
    const messages = JSON.parse(await readFile(new URL(`../messages/${locale}.json`, import.meta.url))).figurineLab;
    for (const figure of catalog.characters) {
      assert.ok(messages.races[figure.raceKey]);
      assert.ok(messages.classes[figure.classKey]);
    }
  }
});

test("a box whose figure was preloaded while sealed opens straight into the reveal", () => {
  assert.deepEqual(boxReducer(initialBox, { type: "open", selected: 3, ready: true }), { phase: "opening", selected: 3, round: 0 });
  assert.equal(boxReducer(initialBox, { type: "open", selected: 3 }).phase, "loading");
});
