import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}${specifier.endsWith(".json") ? "" : ".ts"}`, import.meta.url).href, context);
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.endsWith(".png")) return { format: "module", source: `export default { src: ${JSON.stringify(url)} };`, shortCircuit: true };
    if (url.endsWith(".json")) return next(url, { ...context, importAttributes: { type: "json" } });
    return next(url, context);
  },
});
const { FIGURINE_SERIES, UPCOMING_SERIES, SECRET_SERIES, RELEASED_SERIES, findFigure, TOTAL_FIGURES } = await import("../src/lib/figurine-series.ts");
const { buildForest, marketLayout } = await import("../src/lib/figurine-forest.ts");
const { collectionShelves, parseCollection } = await import("../src/lib/figurine-collection.ts");
const { buildCase } = await import("../src/lib/figurine-case.ts");

test("a first secret figure unlocks the top shelf and normal shelves keep their order", () => {
  const secret = { id: "community-000", number: "000", hidden: true, released: true, keys: ["community-000:roiza", "community-000:tonzidan"] };
  const regular = Array.from({ length: 7 }, (_, i) => ({ id: `s${i + 1}`, number: String(i + 1), released: i < 2, keys: [`s${i + 1}:a`] }));
  const series = [...regular, secret]; // Its position in the input must not determine shelf order.
  const ids = (collection, entries = series) => collectionShelves(entries, collection).map(({ id }) => id);
  assert.deepEqual(ids({}), ["s1", "s2", "s3", "s4", "s5"]);
  assert.deepEqual(ids({ "s1:a": { standard: 1 } }), ids({}));
  assert.deepEqual(ids({ "community-000:unknown": { standard: 1 } }), ids({}));
  assert.deepEqual(ids({ "community-000:roiza": { standard: 0 } }), ids({}));
  for (const quality of ["standard", "golden", "galaxy"]) {
    const restored = parseCollection(JSON.stringify({ "community-000:roiza": { [quality]: 1 } }));
    assert.deepEqual(ids(restored), ["community-000", "s1", "s2", "s3", "s4"]);
    assert.deepEqual(ids(restored, [...regular, { ...secret, released: false }]), ids({}));
  }
  const many = regular.map((entry, i) => ({ ...entry, released: i < 5 }));
  assert.deepEqual(ids({ "community-000:tonzidan": { standard: 1 } }, [...many, secret]), ["community-000", "s1", "s2", "s3", "s4", "s5", "s6", "s7"]);
});

test("replacing a cabinet frees its resources without disposing shared box prints or portraits", (t) => {
  const previous = globalThis.document;
  t.after(() => { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; });
  const context = new Proxy({ createLinearGradient: () => ({ addColorStop() {} }), createRadialGradient: () => ({ addColorStop() {} }) }, { get: (target, key) => target[key] ?? (() => {}) });
  globalThis.document = { createElement: () => ({ getContext: () => context }) };
  const root = new THREE.Group(), envMap = new THREE.Texture(), portrait = new THREE.Texture();
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.3, 0.2), new THREE.MeshStandardMaterial());
  let borrowedDisposed = 0, ownedDisposed = 0;
  for (const resource of [envMap, portrait, box.geometry, box.material]) resource.addEventListener("dispose", () => borrowedDisposed++);
  const cabinet = buildCase(root, { series: [{ id: "s1", number: "001", accent: "#ffffff", released: true, keys: ["s1:a"], box }], envMap, labels: { series: (n) => n, collected: (got, total) => `${got}/${total}`, comingSoon: "Soon" } });
  cabinet.frame[0].geometry.addEventListener("dispose", () => ownedDisposed++);
  cabinet.setSlot("s1:a", { state: "owned", portrait, quality: "standard", count: 2 });
  cabinet.dispose();
  assert.equal(borrowedDisposed, 0);
  assert.equal(ownedDisposed, 1);
  assert.equal(root.children.length, 0);
});

test("Series 000 is drawable and inspectable with verified assets but absent from the public shop", async () => {
  const draft = JSON.parse(await readFile(new URL("../src/data/figurines/community-000.json", import.meta.url)));
  const names = ["Röiza", "Tonzidan", "Valopallo", "Pajatso", "Syöpä", "Valoja", "Rmxqa", "Röi", "Öitä", "Valotettu", "Syttyykö", "Jousivakio", "Tahto", "Muoto", "Dalarian", "Taivaallinen"];
  assert.deepEqual(draft.characters.map(({ name }) => name), names);
  assert.deepEqual(draft.characters.map(({ realm }) => realm), names.map((_, i) => i < 9 ? "Kazzak" : "Outland"));
  assert.equal(new Set(draft.characters.map(({ id }) => id)).size, 16);
  assert.equal(draft.releaseState, "released");
  assert.equal(SECRET_SERIES.hidden, true);
  assert.equal(SECRET_SERIES.hue, 36);
  assert.equal(SECRET_SERIES.characters.length, 16);
  assert.ok(RELEASED_SERIES.includes(SECRET_SERIES));
  for (const entry of draft.characters) {
    const bytes = await readFile(new URL(`../public${entry.model}`, import.meta.url));
    assert.equal(bytes.length, entry.bytes);
    assert.equal(bytes.toString("ascii", 0, 4), "glTF");
    assert.equal(createHash("sha256").update(bytes).digest("hex"), entry.sha256);
    assert.equal(findFigure(`community-000:${entry.id}`)?.character.name, entry.name);
  }
  for (const locale of ["en", "fi"]) {
    const messages = JSON.parse(await readFile(new URL(`../messages/${locale}.json`, import.meta.url))).figurineLab;
    for (const entry of RELEASED_SERIES.flatMap(series => series.characters)) {
      assert.ok(messages.races[entry.raceKey], `${locale}: ${entry.raceKey}`);
      assert.ok(messages.classes[entry.classKey], `${locale}: ${entry.classKey}`);
    }
  }
  const atlas = await readFile(new URL("../public/figurines/community-000/silhouettes.png", import.meta.url));
  assert.deepEqual([atlas.readUInt32BE(16), atlas.readUInt32BE(20)], [2240, 720]);
  assert.ok(![...FIGURINE_SERIES, ...UPCOMING_SERIES].some(({ id }) => id === draft.id));
  assert.equal(TOTAL_FIGURES, 32);
});

test("only the marked barrel instance reveals Series 000 and foreground props block it", async (t) => {
  const original = GLTFLoader.prototype.loadAsync;
  t.after(() => { GLTFLoader.prototype.loadAsync = original; });
  GLTFLoader.prototype.loadAsync = async () => ({ scene: new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()) });
  const spots = marketLayout().filter(({ model }) => model === "barrel");
  assert.equal(spots.filter(({ secretSeries }) => secretSeries).length, 1);
  const secret = spots.find(({ secretSeries }) => secretSeries);
  assert.deepEqual([secret.x, secret.z, secret.secretSeries], [11.9, -6.4, "community-000"]);
  const scene = new THREE.Scene(), forest = buildForest(scene, spots);
  await forest.ready;
  scene.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  const aim = (spot) => ray.set(new THREE.Vector3(spot.x, 5, spot.z), new THREE.Vector3(0, -1, 0));
  for (const spot of spots) {
    aim(spot);
    assert.equal(forest.pickSecret(ray)?.id ?? null, spot.secretSeries ?? null);
  }
  const box = new THREE.Mesh(new THREE.BoxGeometry(.49, .66, .43), new THREE.MeshBasicMaterial());
  await forest.mountSecretBox(secret.secretSeries, box);
  assert.equal(box.parent, forest.group);
  assert.ok(Math.hypot(box.position.x - secret.x, box.position.z - secret.z) < .15);
  assert.ok(box.position.y - .33 * box.scale.y > 0 && box.position.y + .33 * box.scale.y < 1.075);
  // The exposed box itself is a valid target too, not only the instanced wood.
  box.position.y = 1.2; scene.updateMatrixWorld(true); aim(secret);
  assert.equal(ray.intersectObject(forest.group, true)[0].object, box);
  assert.equal(forest.pickSecret(ray)?.id, secret.secretSeries);
  const blocker = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 2), new THREE.MeshBasicMaterial());
  blocker.position.set(secret.x, 3, secret.z); forest.group.add(blocker); scene.updateMatrixWorld(true);
  aim(secret);
  assert.equal(forest.pickSecret(ray), null);
  aim({ x: 100, z: 100 });
  assert.equal(forest.pickSecret(ray), null);
});

test("the concealed box uses the measured cavity rather than bounds skewed by fallen staves", async (t) => {
  const original = GLTFLoader.prototype.loadAsync;
  t.after(() => { GLTFLoader.prototype.loadAsync = original; });
  GLTFLoader.prototype.loadAsync = async () => ({ scene: new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1).translate(-0.25, 0.5, -0.6), new THREE.MeshBasicMaterial(),
  ) });
  const spot = marketLayout().find(({ secretSeries }) => secretSeries);
  const forest = buildForest(new THREE.Scene(), [spot]), box = new THREE.Object3D();
  await forest.mountSecretBox(spot.secretSeries, box);
  const expected = new THREE.Vector3(-0.022 * 1.075, 0.296 * 1.075 - .02, -0.088 * 1.075)
    .applyAxisAngle(new THREE.Vector3(0, 1, 0), spot.yaw).add(new THREE.Vector3(spot.x, 0, spot.z));
  assert.ok(box.position.distanceTo(expected) < 1e-6);
  assert.equal(box.scale.x, .65);
  assert.ok(box.position.y + 0.33 * box.scale.y < 0.6, "box lid stays well below the tall rim");
  const opening = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), spot.yaw);
  assert.ok(opening.dot(new THREE.Vector3(spot.x, 0, spot.z).normalize()) > 0.99);
});
