import assert from "node:assert/strict";
import test from "node:test";
import { access, readFile } from "node:fs/promises";
import { addToCollection, parseCollection, readCollection } from "../src/lib/figurine-collection.ts";

const memoryStore = () => { const data = new Map(); return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)) }; };

test("the session collection counts openings per figure and ignores malformed storage", () => {
  const store = memoryStore();
  assert.deepEqual(readCollection(store), {});
  assert.equal(addToCollection("community-002:ajotettu", store), 1);
  assert.equal(addToCollection("community-002:ajotettu", store), 2);
  assert.equal(addToCollection("community-001:roidy", store), 1);
  assert.deepEqual(readCollection(store), { "community-002:ajotettu": 2, "community-001:roidy": 1 });
  for (const raw of ["not json", "[1,2]", "null", '{"bad key":1}', '{"a:b":0}', '{"a:b":1.5}']) assert.deepEqual({ ...parseCollection(raw) }, {});
  assert.deepEqual({ ...parseCollection('{"a:b":3,"x":1}') }, { "a:b": 3 });
  // Blocked storage still works for the page's lifetime instead of throwing.
  assert.equal(addToCollection("community-001:laku", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } }), 1);
});

test("both series have unique figures, translations, silhouettes and class sounds, and the world textures exist", async () => {
  const catalogs = await Promise.all(["community-001", "community-002"].map(async (id) => JSON.parse(await readFile(new URL(`../src/data/figurines/${id}.json`, import.meta.url)))));
  const keys = catalogs.flatMap((catalog) => catalog.characters.map((character) => `${catalog.id}:${character.id}`));
  assert.equal(keys.length, 32);
  assert.equal(new Set(keys).size, 32);
  for (const locale of ["en", "fi"]) {
    const messages = JSON.parse(await readFile(new URL(`../messages/${locale}.json`, import.meta.url))).figurineLab;
    for (const character of catalogs.flatMap((catalog) => catalog.characters)) {
      assert.ok(messages.races[character.raceKey], `${locale} race ${character.raceKey}`);
      assert.ok(messages.classes[character.classKey], `${locale} class ${character.classKey}`);
    }
  }
  // Class and race names are game terms and stay in English in every locale.
  const [en, fi] = await Promise.all(["en", "fi"].map(async (locale) => JSON.parse(await readFile(new URL(`../messages/${locale}.json`, import.meta.url))).figurineLab));
  assert.deepEqual(fi.classes, en.classes);
  assert.deepEqual(fi.races, en.races);
  for (const catalog of catalogs) {
    await access(new URL(`../public/figurines/${catalog.id}/silhouettes.png`, import.meta.url));
    for (const { classKey } of catalog.characters) for (const variant of ["a", "b"]) await access(new URL(`../public/figurines/audio/class-${classKey}-${variant}.mp3`, import.meta.url));
  }
  for (const file of ["floor-cobble.png", "grass.png", "dirt.png", "clouds.jpg", "source.json", "source-models.json"]) await access(new URL(`../public/figurines/world/${file}`, import.meta.url));
  // Every scenery model the forest and market place is on disk.
  const forest = await readFile(new URL("../src/lib/figurine-forest.ts", import.meta.url), "utf8");
  const models = [...forest.matchAll(/"(\/figurines\/world\/models\/[a-z0-9-]+\.glb)"/g)].map((match) => match[1]);
  assert.ok(models.length >= 15);
  for (const model of models) await access(new URL(`../public${model}`, import.meta.url));
});

test("every mapped CCG quip names a figure in a series and a clip in the CCG quip folder", async () => {
  const { quips } = JSON.parse(await readFile(new URL("../src/data/figurines/quips.json", import.meta.url), "utf8"));
  const figures = new Set();
  for (const file of ["community-001", "community-002"]) {
    const catalog = JSON.parse(await readFile(new URL(`../src/data/figurines/${file}.json`, import.meta.url), "utf8"));
    catalog.characters.forEach((character) => figures.add(`${catalog.id}:${character.id}`));
  }
  for (const [key, { file, gain }] of Object.entries(quips)) {
    assert.ok(figures.has(key), key);
    assert.ok(Number.isFinite(gain) && Math.abs(gain) <= 12, key);
    await access(new URL(`../public/ccg/audio/quips/${file}`, import.meta.url));
  }
});

test("every sound cue has variants on disk; the landing thud and the shaken-box thunks vary most", async () => {
  const { FIGURINE_SOUNDS } = await import("../src/lib/figurine-audio.ts");
  for (const [cue, { files }] of Object.entries(FIGURINE_SOUNDS)) {
    // Class signatures and quips are chosen per figure at play time.
    if (cue !== "signature" && cue !== "quip") assert.ok(files.length >= 1, cue);
    for (const file of files) await access(new URL(`../public/figurines/audio/${file}.mp3`, import.meta.url));
  }
  assert.ok(FIGURINE_SOUNDS.land.files.length >= 3);
  assert.ok(FIGURINE_SOUNDS.rattle.files.length >= 3);
});
