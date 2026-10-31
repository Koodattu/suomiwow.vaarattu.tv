import assert from "node:assert/strict";
import test from "node:test";
import { access, readFile } from "node:fs/promises";
import { addToCollection, bestQuality, changeCollection, copiesOf, machineChanges, machineOutcome, parseCollection, readCollection, rollQuality, spare, trayGroups } from "../src/lib/figurine-collection.ts";

const memoryStore = () => { const data = new Map(); return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)) }; };
const plain = (value) => JSON.parse(JSON.stringify(value));

test("the session collection counts copies per figure and quality and ignores malformed storage", () => {
  const store = memoryStore();
  assert.deepEqual(readCollection(store), {});
  assert.equal(addToCollection("community-002:ajotettu", "standard", store), 1);
  assert.equal(addToCollection("community-002:ajotettu", "standard", store), 2);
  assert.equal(addToCollection("community-002:ajotettu", "golden", store), 1);
  assert.equal(addToCollection("community-001:roidy", "standard", store), 1);
  assert.deepEqual(plain(readCollection(store)), { "community-002:ajotettu": { standard: 2, golden: 1 }, "community-001:roidy": { standard: 1 } });
  assert.equal(copiesOf(readCollection(store)["community-002:ajotettu"]), 3);
  assert.equal(bestQuality(readCollection(store)["community-002:ajotettu"]), "golden");
  assert.equal(bestQuality(undefined), null);
  for (const raw of ["not json", "[1,2]", "null", '{"bad key":1}', '{"a:b":0}', '{"a:b":1.5}', '{"a:b":{"shiny":2}}', '{"a:b":{"golden":-1}}']) assert.deepEqual({ ...parseCollection(raw) }, {});
  // The first prototype stored bare counts: they carry over as standard copies.
  assert.deepEqual(plain(parseCollection('{"a:b":3,"x":1,"c:d":{"galaxy":1,"bogus":4}}')), { "a:b": { standard: 3 }, "c:d": { galaxy: 1 } });
  const legacy = memoryStore(); legacy.setItem("suomiwow-figurine-collection-v1", '{"a:b":2}');
  assert.deepEqual(plain(readCollection(legacy)), { "a:b": { standard: 2 } });
  // A change set applies whole or not at all.
  assert.equal(changeCollection([{ key: "community-001:roidy", quality: "standard", delta: -1 }, { key: "community-001:roidy", quality: "golden", delta: -1 }], store), false);
  assert.equal(readCollection(store)["community-001:roidy"].standard, 1);
  assert.equal(changeCollection([{ key: "community-001:roidy", quality: "standard", delta: -1 }], store), true);
  assert.equal(readCollection(store)["community-001:roidy"], undefined);
  // Blocked storage still works for the page's lifetime instead of throwing.
  assert.equal(addToCollection("community-001:laku", "standard", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } }), 1);
});

test("each box rolls 1% galaxy, 10% golden and 89% standard", () => {
  assert.equal(rollQuality(0), "galaxy");
  assert.equal(rollQuality(0.009999), "galaxy");
  assert.equal(rollQuality(0.01), "golden");
  assert.equal(rollQuality(0.05), "golden");
  assert.equal(rollQuality(0.109999), "golden");
  assert.equal(rollQuality(0.11), "standard");
  assert.equal(rollQuality(0.5), "standard");
  assert.equal(rollQuality(0.9999), "standard");
  const counts = { standard: 0, golden: 0, galaxy: 0 };
  // Evenly spaced rolls verify the full distribution without a flaky random sample.
  for (let i = 0; i < 10000; i++) counts[rollQuality((i + 0.5) / 10000)]++;
  assert.deepEqual(counts, { standard: 8900, golden: 1000, galaxy: 100 });
  for (const bad of [-0.1, 1, Number.NaN]) assert.throws(() => rollQuality(bad));
});

test("the recycler makes a box from three spare copies, trades three of a kind up, and never takes a last copy", () => {
  const collection = parseCollection(JSON.stringify({ "s1:a": { standard: 4 }, "s1:b": { standard: 1, golden: 1 }, "s2:c": { standard: 2 }, "s2:d": { galaxy: 3 }, "s1:e": { standard: 1 } }));
  // The board lists every quality of each figure owned more than once, in catalog order.
  assert.deepEqual(trayGroups(collection, ["s1:a", "s1:b", "s2:c", "s2:d", "s1:e"]).map(({ key, quality, count }) => `${key}/${quality}/${count}`), ["s1:a/standard/4", "s1:b/standard/1", "s1:b/golden/1", "s2:c/standard/2", "s2:d/galaxy/3"]);
  assert.equal(spare(collection, [{ key: "s1:a", quality: "standard" }], { key: "s1:a", quality: "standard" }), 3);
  assert.deepEqual(machineOutcome([{ key: "s1:a", quality: "standard" }], collection), { kind: "incomplete" });
  const three = Array.from({ length: 3 }, () => ({ key: "s1:a", quality: "standard" }));
  const upgrade = machineOutcome(three, collection);
  assert.deepEqual(upgrade, { kind: "upgrade", key: "s1:a", from: "standard", quality: "golden" });
  assert.deepEqual(machineChanges(three, upgrade), [...three.map(({ key, quality }) => ({ key, quality, delta: -1 })), { key: "s1:a", quality: "golden", delta: 1 }]);
  // Galaxy is the top: three galaxies just recycle, which here would give away the last of them.
  assert.deepEqual(machineOutcome(Array.from({ length: 3 }, () => ({ key: "s2:d", quality: "galaxy" })), collection), { kind: "keep", key: "s2:d" });
  // Mixed copies make a box of the series most of them came from.
  const mixed = [{ key: "s2:c", quality: "standard" }, { key: "s1:a", quality: "standard" }, { key: "s1:a", quality: "standard" }];
  assert.deepEqual(machineOutcome(mixed, collection), { kind: "box", series: "s1" });
  assert.deepEqual(machineChanges(mixed, { kind: "box", series: "s1" }), mixed.map(({ key, quality }) => ({ key, quality, delta: -1 })));
  // Both of s1:b's copies would leave none.
  assert.deepEqual(machineOutcome([{ key: "s1:b", quality: "standard" }, { key: "s1:b", quality: "golden" }, { key: "s1:a", quality: "standard" }], collection), { kind: "keep", key: "s1:b" });
  assert.deepEqual(machineChanges(three, { kind: "keep", key: "s1:a" }), []);
});

test("both series have unique figures, translations, silhouettes and class sounds, and the world textures exist", async () => {
  const catalogs = await Promise.all(["community-001", "community-002"].map(async (id) => JSON.parse(await readFile(new URL(`../src/data/figurines/${id}.json`, import.meta.url)))));
  const keys = catalogs.flatMap((catalog) => catalog.characters.map((character) => `${catalog.id}:${character.id}`));
  assert.equal(keys.length, 32);
  assert.equal(new Set(keys).size, 32);
  const characters = catalogs.flatMap((catalog) => catalog.characters);
  for (const removed of ["rhagy", "preazhy", "mullinmallin", "manfromsand", "melice", "boxx"]) {
    assert.ok(!characters.some((character) => character.id === removed), removed);
  }
  for (const [id, name, realm, characterClass, race] of [
    ["violetmw", "Violetmw", "Kazzak", "Monk", "Dwarf"],
    ["rookiheal", "Röökiheal", "Kazzak", "Priest", "Night Elf"],
    ["galardodric", "Galardodric", "Outland", "Warlock", "Void Elf"],
    ["kahvishock", "Kahvishock", "Kazzak", "Shaman", "Orc"],
    ["jannu", "Jannu", "Kazzak", "Rogue", "Blood Elf"],
    ["shippyboi", "Shippyboi", "Outland", "Shaman", "Dark Iron Dwarf"],
  ]) {
    const character = characters.find((entry) => entry.id === id);
    assert.ok(character, id);
    assert.deepEqual([character.name, character.realm, character.characterClass, character.race], [name, realm, characterClass, race]);
  }
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
  // Every station prop is on disk and has its game source recorded.
  const props = await readFile(new URL("../src/lib/figurine-props.ts", import.meta.url), "utf8");
  const recorded = new Set(JSON.parse(await readFile(new URL("../public/figurines/world/source-models.json", import.meta.url), "utf8")).stations.models.map(({ name }) => name));
  for (const [, name] of props.matchAll(/"\/figurines\/world\/models\/([a-z0-9-]+)\.glb"/g)) {
    await access(new URL(`../public/figurines/world/models/${name}.glb`, import.meta.url));
    assert.ok(recorded.has(name), name);
  }
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

test("announced series fill the shop to twenty, each in its own print colour", async () => {
  const source = await readFile(new URL("../src/lib/figurine-series.ts", import.meta.url), "utf8");
  const hues = JSON.parse(source.match(/const UPCOMING_HUES = (\[[^\]]+\])/)[1]);
  assert.equal(2 + hues.length, 20);
  // No two series print within 10° of each other on the colour wheel.
  const all = [254, 173, ...hues]; // amethyst and verdigris glows first
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    const gap = Math.abs(all[i] - all[j]) % 360;
    assert.ok(Math.min(gap, 360 - gap) >= 10, `${all[i]} vs ${all[j]}`);
  }
});
