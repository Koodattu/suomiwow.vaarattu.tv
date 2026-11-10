import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { registerHooks } from "node:module";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";

registerHooks({ resolve(specifier, context, next) {
  return next(specifier.startsWith("@/") ? new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href : specifier, context);
} });
const { buildFacility } = await import("../src/lib/figurine-facilities.ts");
const { dailyChestAnimation } = await import("../src/lib/figurine-chest.ts");
const { pickFacilityPart } = await import("../src/lib/figurine-picking.ts");

// Exercise the deployed geometry, skeleton and clips without a browser image decoder.
const bytes = await fs.readFile(new URL("../public/figurines/world/models/chest-uber.glb", import.meta.url));
const jsonLength = bytes.readUInt32LE(12), doc = JSON.parse(bytes.subarray(20, 20 + jsonLength));
doc.materials = doc.materials.map(({ name }) => ({ name }));
delete doc.images; delete doc.textures;
for (const key of ["extensionsUsed", "extensionsRequired"]) doc[key] = doc[key].filter(name => name !== "KHR_texture_basisu");
const json = Buffer.from(JSON.stringify(doc)), padded = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 32)]);
const header = Buffer.from(bytes.subarray(0, 20)), binary = bytes.subarray(20 + jsonLength);
header.writeUInt32LE(20 + padded.length + binary.length, 8); header.writeUInt32LE(padded.length, 12);
const glb = Buffer.concat([header, padded, binary]);
const loaded = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.length), "");
loaded.scene.animations = loaded.animations;
const instance = () => {
  const root = clone(loaded.scene);
  const animation = dailyChestAnimation(root);
  assert.ok(animation, "the deployed asset contains native Open and Close clips");
  return { root, animation };
};
const bones = (root) => {
  root.updateMatrixWorld(true);
  const matrices = [];
  root.traverse(object => { if (object.isBone) matrices.push(...object.matrix.elements); });
  return matrices;
};

test("native lid animation moves independently, holds open, and reveals/completes once", () => {
  const a = instance(), b = instance();
  a.animation.setClaimed(false); b.animation.setClaimed(false);
  const closed = bones(a.root), other = bones(b.root);
  let reveals = 0, finishes = 0;
  a.animation.open(() => reveals++, () => finishes++);
  a.animation.open(() => assert.fail("duplicate action"), () => assert.fail("duplicate completion"));
  a.animation.update(0.6);
  assert.notDeepEqual(bones(a.root), closed);
  assert.deepEqual(bones(b.root), other);
  assert.equal(reveals, 1); assert.equal(finishes, 0);
  a.animation.setClaimed(true); // Record synchronization must not interrupt playback.
  a.animation.update(2);
  const opened = bones(a.root);
  a.animation.update(10);
  assert.deepEqual(bones(a.root), opened);
  assert.equal(reveals, 1); assert.equal(finishes, 1);
  a.animation.dispose(); b.animation.dispose();
});

test("claimed reload restores open pose, next day closes and can open again", () => {
  const { root, animation } = instance();
  animation.setClaimed(false);
  const closed = bones(root);
  animation.setClaimed(true);
  assert.notDeepEqual(bones(root), closed);
  animation.setClaimed(false);
  animation.update(4);
  const restored = bones(root);
  restored.forEach((value, i) => assert.ok(Math.abs(value - closed[i]) < 0.002, `closed bone transform ${i}`));
  let finishes = 0;
  animation.open(() => {}, () => finishes++);
  animation.update(4);
  assert.equal(finishes, 1);
  animation.dispose();
});

test("disposal cancels pending callbacks and missing clips allow a fallback", () => {
  const { animation } = instance();
  animation.open(() => assert.fail("disposed reveal"), () => assert.fail("disposed completion"));
  animation.dispose(); animation.update(10);
  assert.equal(dailyChestAnimation(new THREE.Group()), null);
});

test("chest taps target the model, and each opening hands its reward over once as the lid lifts", async t => {
  const previous = globalThis.document;
  t.after(() => { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; });
  const paint = new Proxy({}, { get: (_, key) => key === "createLinearGradient" || key === "createRadialGradient" ? () => ({ addColorStop() {} }) : () => {}, set: () => true });
  globalThis.document = { createElement: () => ({ getContext: () => paint }) };
  const root = new THREE.Group();
  let chest;
  const placeProp = (parent, name, options) => {
    const group = new THREE.Group(); group.position.set(options.x ?? 0, options.y ?? 0, options.z ?? 0); parent.add(group);
    if (name === "dailyChest") { chest = group; group.add(clone(loaded.scene)); group.animations = loaded.animations; }
    return { group, ready: Promise.resolve(group) };
  };
  const facility = buildFacility(root, "crate", { placeProp, envMap: new THREE.Texture() });
  await facility.ready;
  facility.setStreak(0, 1);
  facility.setChestReady(true);
  root.updateMatrixWorld(true);
  const centre = new THREE.Box3().setFromObject(chest).getCenter(new THREE.Vector3());
  const ray = new THREE.Raycaster(centre.clone().add(new THREE.Vector3(0, 0, 20)), new THREE.Vector3(0, 0, -1));
  ray.camera = new THREE.PerspectiveCamera(); ray.camera.position.copy(ray.ray.origin); ray.camera.updateMatrixWorld();
  assert.equal(pickFacilityPart(ray, root), "chest");
  const cues = []; let finishes = 0;
  facility.act({ kind: "open" }, cue => cues.push(cue), () => finishes++);
  facility.setChestReady(false);
  await new Promise(setImmediate);
  assert.deepEqual(cues, ["chestOpen"]);
  facility.update(0.2, 0.2);
  assert.deepEqual(cues, ["chestOpen"]); assert.equal(finishes, 0);
  for (let frame = 0; frame < 40; frame++) facility.update(0.05, 1 + frame * 0.05);
  assert.deepEqual(cues, ["chestOpen", "chestLift"]);
  assert.equal(finishes, 1);
  assert.equal(root.getObjectByName("chest-reward"), undefined, "the coins are the page's to show");
  facility.update(20, 23); assert.equal(finishes, 1);
  facility.setChestReady(true);
  facility.act({ kind: "open" }, cue => cues.push(cue), () => finishes++);
  facility.setChestReady(false);
  await new Promise(setImmediate);
  for (let frame = 0; frame < 40; frame++) facility.update(0.05, 24 + frame * 0.05);
  assert.equal(finishes, 2, "another opening on the same day completes once");
  assert.deepEqual(cues.slice(2), ["chestOpen", "chestLift"]);
  facility.dispose();
});
