import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { registerHooks } from "node:module";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import { dailyChestAnimation, chestRewardPose, CHEST_REWARD_SECONDS } from "../src/lib/figurine-chest.ts";

registerHooks({ resolve(specifier, context, next) {
  return next(specifier.startsWith("@/") ? new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href : specifier, context);
} });
const { buildFacility } = await import("../src/lib/figurine-facilities.ts");
const { pickFacilityPart } = await import("../src/lib/figurine-picking.ts");

// Exercise the deployed geometry, skeleton and clips without a browser image decoder.
const bytes = await fs.readFile(new URL("../public/figurines/world/models/treasurechest01.glb", import.meta.url));
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
  a.animation.update(1.6);
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

test("the box starts inside the chest and settles above and in front of the lid", () => {
  const start = chestRewardPose(0), halfway = chestRewardPose(CHEST_REWARD_SECONDS / 2), end = chestRewardPose(CHEST_REWARD_SECONDS);
  assert.ok(start.y < 0.5 && start.scale < 0.6);
  assert.ok(halfway.y > start.y && halfway.y < 1.9);
  assert.ok(end.y > 1.5 && end.z > 0.6);
  assert.equal(end.scale, 1); assert.equal(end.settled, true);
  assert.equal(halfway.settled, false);
  assert.deepEqual(chestRewardPose(100), end, "no accumulating transforms after the reveal");
  assert.deepEqual(chestRewardPose(0), start, "reload starts the same flight");
});

test("reduced motion removes the reward spin and hop but preserves its destination", () => {
  const start = chestRewardPose(0, true), mid = chestRewardPose(0.7, true), end = chestRewardPose(CHEST_REWARD_SECONDS, true);
  assert.equal(start.turn, mid.turn); assert.equal(mid.turn, end.turn);
  const normal = chestRewardPose(CHEST_REWARD_SECONDS);
  assert.equal(end.y, normal.y); assert.equal(end.z, normal.z); assert.equal(end.scale, normal.scale);
});

test("chest taps target the model and the reward follows its lid with ordered, single cues", async t => {
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
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.6, 0.3), new THREE.MeshStandardMaterial());
  const facility = buildFacility(root, "crate", { placeProp, envMap: new THREE.Texture(), rewardBox: box });
  await facility.ready;
  facility.setStreak(0, 1);
  root.updateMatrixWorld(true);
  const centre = new THREE.Box3().setFromObject(chest).getCenter(new THREE.Vector3());
  const ray = new THREE.Raycaster(centre.clone().add(new THREE.Vector3(0, 0, 20)), new THREE.Vector3(0, 0, -1));
  ray.camera = new THREE.PerspectiveCamera(); ray.camera.position.copy(ray.ray.origin); ray.camera.updateMatrixWorld();
  assert.equal(pickFacilityPart(ray, root), "chest");
  const cues = []; let finishes = 0;
  facility.act({ kind: "open" }, cue => cues.push(cue), () => finishes++);
  await Promise.resolve();
  assert.deepEqual(cues, ["chestOpen"]);
  facility.update(1, 1);
  assert.deepEqual(cues, ["chestOpen"]); assert.equal(finishes, 0);
  for (let frame = 0; frame < 40; frame++) facility.update(0.05, 1 + frame * 0.05);
  assert.deepEqual(cues, ["chestOpen", "chestLift", "chestReward"]);
  assert.equal(finishes, 1);
  assert.ok(box.parent.position.y > 1.5);
  facility.update(20, 23); assert.equal(finishes, 1);
  facility.setStreak(1, 2);
  assert.ok(box.parent.position.y < 0.5, "next day puts a fresh box back inside");
  facility.dispose();
});
