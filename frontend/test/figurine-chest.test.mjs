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
const { dailyChestAnimation, chestRewardPresentation, CHEST_REWARD_SECONDS, CHEST_COLLECT_SECONDS } = await import("../src/lib/figurine-chest.ts");
const { coinCollectionFlight } = await import("../src/lib/figurine-coin-flight.ts");
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

function rewardScene(aspect = 16 / 9, reduced = false) {
  const root = new THREE.Group(); root.position.set(-3.7, 0, -11.2); root.rotation.y = 0.4;
  const coin = new THREE.Group(), camera = new THREE.PerspectiveCamera(36, aspect, 0.1, 100);
  camera.position.set(-1, 2, -5); camera.lookAt(-3.7, 0.55, -11.2);
  const bursts = [], arrivals = [], target = { x: 0.85, y: 0.8, width: 0.075 };
  const presentation = chestRewardPresentation(root, coin, new THREE.Texture(), position => bursts.push(position), () => arrivals.push(true));
  const reward = root.getObjectByName("chest-reward"), spin = coin.parent;
  const frame = delta => { presentation.update(delta); presentation.present(camera, reduced, target); root.updateMatrixWorld(true); };
  frame(0);
  return { root, coin, camera, target, presentation, reward, spin, bursts, arrivals, frame };
}

test("the coin flips out promptly, arrives at screen centre, spins once and waits for dismissal", () => {
  const { presentation, reward, spin, frame, camera, root } = rewardScene();
  let finishes = 0;
  assert.equal(reward.visible, false);
  presentation.begin(() => finishes++);
  const start = reward.position.clone();
  assert.ok(start.y < 0.5);
  frame(CHEST_REWARD_SECONDS / 2);
  assert.ok(reward.position.distanceTo(start) > 0.5);
  assert.ok(spin.quaternion.angleTo(new THREE.Quaternion()) > 3, "the flight includes a flip");
  assert.equal(finishes, 0);
  frame(CHEST_REWARD_SECONDS / 2);
  assert.equal(finishes, 1);
  const screen = reward.getWorldPosition(new THREE.Vector3()).project(camera);
  assert.ok(Math.abs(screen.x) < 1e-6 && Math.abs(screen.y) < 0.05);
  frame(0.5); assert.ok(spin.quaternion.angleTo(new THREE.Quaternion()) > 0.5);
  frame(1); assert.ok(spin.quaternion.angleTo(new THREE.Quaternion()) < 1e-6, "the spin finishes face-forward");
  frame(30); assert.equal(reward.visible, true); assert.equal(finishes, 1);
  const shade = root.getObjectByName("chest-reward-backdrop");
  assert.ok(shade.visible && shade.material.opacity > 0 && shade.material.opacity < 1);
  presentation.present(null, false, null); assert.equal(reward.parent.visible, false);
});

test("dismissal continues from the current spin to the exact HUD position, including portrait view", () => {
  for (const aspect of [16 / 9, 9 / 16]) {
    const { presentation, reward, spin, frame, camera, target, bursts, arrivals, root } = rewardScene(aspect);
    let finishes = 0;
    presentation.begin(() => finishes++); frame(CHEST_REWARD_SECONDS); frame(0.4);
    camera.position.x += 0.5; camera.lookAt(-3.7, 0.55, -11.2); frame(0);
    const position = reward.position.clone(), rotation = spin.quaternion.clone(), scale = reward.scale.x;
    presentation.dismiss(); frame(0);
    assert.ok(reward.position.equals(position) && spin.quaternion.angleTo(rotation) < 1e-6 && reward.scale.x === scale);
    frame(0.2); const midway = reward.position.clone(); presentation.dismiss(); frame(0);
    assert.equal(arrivals.length, 0, "the counter pulse waits until the coin arrives");
    assert.ok(reward.position.equals(midway), "repeated taps do not restart collection");
    frame(CHEST_COLLECT_SECONDS - 0.2);
    const screen = reward.getWorldPosition(new THREE.Vector3()).project(camera);
    assert.ok(Math.abs(screen.x - target.x) < 1e-6 && Math.abs(screen.y - target.y) < 1e-6);
    assert.equal(reward.visible, false); assert.equal(root.getObjectByName("chest-reward-backdrop").visible, false);
    assert.equal(finishes, 1); assert.equal(bursts.length, 2);
    frame(20); assert.equal(finishes, 1); assert.equal(arrivals.length, 1);
  }
});

test("collection flights vary their curve and spin while preserving both endpoint poses", () => {
  const facing = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, 0.6, 0));
  const starts = new THREE.Vector3(1, 2, 3), mids = [];
  for (const value of [0.1, 0.9]) {
    const flight = coinCollectionFlight(facing, () => value);
    for (const progress of [0, 1]) {
      const position = starts.clone(), rotation = facing.clone(); flight(position, rotation, progress);
      assert.ok(position.equals(starts) && rotation.angleTo(facing) < 1e-6);
    }
    const position = starts.clone(), rotation = facing.clone(); flight(position, rotation, 0.5);
    assert.ok(position.distanceTo(starts) > 0.2 && rotation.angleTo(facing) > 3);
    mids.push(position);
  }
  assert.ok(mids[0].distanceTo(mids[1]) > 0.4, "each chosen flight has a distinct bend");
});

test("reduced motion keeps the destination and collection while removing the flip and spin; reset cancels pending rewards", () => {
  const { presentation, reward, spin, frame } = rewardScene(16 / 9, true);
  presentation.begin(() => assert.fail("reset reward")); frame(0.1); presentation.reset(); frame(2);
  let finishes = 0; presentation.begin(() => finishes++);
  frame(CHEST_REWARD_SECONDS / 2); assert.equal(spin.rotation.x, 0);
  frame(CHEST_REWARD_SECONDS / 2); frame(0.5); assert.equal(spin.rotation.y, 0);
  assert.equal(finishes, 1); presentation.dismiss(); frame(CHEST_COLLECT_SECONDS);
  assert.equal(reward.visible, false);
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
  const facility = buildFacility(root, "crate", { placeProp, envMap: new THREE.Texture() });
  await facility.ready;
  facility.setStreak(0, 1);
  root.updateMatrixWorld(true);
  const centre = new THREE.Box3().setFromObject(chest).getCenter(new THREE.Vector3());
  const ray = new THREE.Raycaster(centre.clone().add(new THREE.Vector3(0, 0, 20)), new THREE.Vector3(0, 0, -1));
  ray.camera = new THREE.PerspectiveCamera(); ray.camera.position.copy(ray.ray.origin); ray.camera.updateMatrixWorld();
  assert.equal(pickFacilityPart(ray, root), "chest");
  const cues = []; let finishes = 0;
  facility.act({ kind: "open" }, cue => cues.push(cue), () => finishes++);
  await new Promise(setImmediate);
  assert.deepEqual(cues, ["chestOpen"]);
  facility.update(0.2, 0.2);
  assert.deepEqual(cues, ["chestOpen"]); assert.equal(finishes, 0);
  for (let frame = 0; frame < 40; frame++) facility.update(0.05, 1 + frame * 0.05);
  assert.deepEqual(cues, ["chestOpen", "chestLift", "chestReward"]);
  assert.equal(finishes, 1);
  assert.ok(root.getObjectByName("chest-reward").visible);
  facility.update(20, 23); assert.equal(finishes, 1);
  facility.setStreak(1, 2);
  assert.equal(root.getObjectByName("chest-reward").visible, false, "next day waits for the chest to open");
  facility.dispose();
});
