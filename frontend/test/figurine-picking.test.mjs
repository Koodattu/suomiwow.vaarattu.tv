import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import * as THREE from "three";
import { isVisibleHit, pickFacilityPart } from "../src/lib/figurine-picking.ts";

registerHooks({ resolve(specifier, context, next) {
  return next(specifier.startsWith("@/") ? new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href : specifier, context);
} });
const { buildFacility } = await import("../src/lib/figurine-facilities.ts");
const ray = new THREE.Raycaster(new THREE.Vector3(0, 10, 0), new THREE.Vector3(0, -1, 0));

test("hidden objects and ancestors do not steal hits from visible objects behind them", () => {
  const root = new THREE.Group(), hidden = new THREE.Group(), nested = new THREE.Group();
  const front = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  const back = front.clone(); front.position.y = 3;
  nested.add(front); hidden.add(nested); root.add(hidden, back); root.updateMatrixWorld(true);
  const pick = () => ray.intersectObject(root, true).find(isVisibleHit)?.object;
  assert.equal(pick(), front);
  for (const object of [front, nested, hidden]) {
    object.visible = false;
    assert.equal(pick(), back);
    object.visible = true;
    assert.equal(pick(), front);
  }
  // Direct machine/shop target lists also need to check ancestors outside that list.
  hidden.visible = false;
  assert.equal(ray.intersectObjects([front], false).find(isVisibleHit), undefined);
});

test("intentional invisible control targets remain clickable", () => {
  for (const material of [new THREE.MeshBasicMaterial({ visible: false }), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false })]) {
    const target = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
    target.updateMatrixWorld(true);
    assert.equal(ray.intersectObject(target).find(isVisibleHit)?.object, target);
  }
});

test("pond ripples never intercept clicks and stop growing after fading, including after reuse", async t => {
  const previous = globalThis.document;
  t.after(() => { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; });
  const paint = new Proxy({}, { get: (_, key) => key === "createLinearGradient" || key === "createRadialGradient" ? () => ({ addColorStop() {} }) : key === "createImageData" ? (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }) : () => {}, set: () => true });
  // Canvases for painted textures, and an image element for the textures the pond loads.
  globalThis.document = { createElement: () => ({ getContext: () => paint }), createElementNS: () => ({ style: {}, addEventListener() {}, removeEventListener() {} }) };
  const root = new THREE.Group();
  const placeProp = (parent, name, options) => {
    const group = new THREE.Group(); group.position.set(options.x ?? 0, options.y ?? 0, options.z ?? 0); parent.add(group);
    return { group, ready: Promise.resolve(group) };
  };
  const pond = buildFacility(root, "pond", { placeProp, envMap: new THREE.Texture() });
  await pond.ready;
  const rings = root.children.filter(object => object.geometry?.type === "RingGeometry" && object.geometry.parameters.outerRadius < 1);
  assert.equal(rings.length, 4);
  pond.update(60, 0);
  assert.ok(rings.every(ring => !ring.visible && ring.scale.x === 1));
  // Match the original failure: transparent rings used to catch rays 41.5 units away.
  root.updateMatrixWorld(true);
  const outside = new THREE.Raycaster(new THREE.Vector3(41.5, 10, 0), new THREE.Vector3(0, -1, 0));
  assert.equal(outside.intersectObjects(rings).length, 0);
  for (let cast = 0; cast < 5; cast++) {
    pond.act({ kind: "cast", catch: { kind: "box" } }, () => {}, () => {});
    for (let frame = 0; frame < 15; frame++) pond.update(0.1, 0);
    const active = rings.find(ring => ring.visible);
    assert.ok(active, "casting still creates a visible splash");
    root.updateMatrixWorld(true);
    const probe = new THREE.Raycaster(active.position.clone().add(new THREE.Vector3(0.1 * active.scale.x, 10, 0)), new THREE.Vector3(0, -1, 0));
    assert.equal(probe.intersectObject(active).length, 0, "visible ripples are decorative too");
    pond.update(60, 0);
    assert.ok(rings.every(ring => !ring.visible && ring.scale.x < 20));
    const scales = rings.map(ring => ring.scale.x);
    pond.update(60, 0);
    assert.deepEqual(rings.map(ring => ring.scale.x), scales, "expired ripples stop updating");
  }
});

test("only the pond's tackle takes taps, its glint follows the prizes left and hover outlines do not move props", async t => {
  const previous = globalThis.document;
  t.after(() => { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; });
  const paint = new Proxy({}, { get: (_, key) => key === "createLinearGradient" || key === "createRadialGradient" ? () => ({ addColorStop() {} }) : key === "createImageData" ? (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }) : () => {}, set: () => true });
  globalThis.document = { createElement: () => ({ getContext: () => paint }), createElementNS: () => ({ style: {}, addEventListener() {}, removeEventListener() {} }) };
  const root = new THREE.Group();
  const placeProp = (parent, name, options) => {
    const group = new THREE.Group(); group.position.set(options.x ?? 0, options.y ?? 0, options.z ?? 0); parent.add(group);
    if (["fishBucket", "fishingRod", "fishBig"].includes(name)) group.add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), new THREE.MeshStandardMaterial()));
    return { group, ready: Promise.resolve(group) };
  };
  const pond = buildFacility(root, "pond", { placeProp, envMap: new THREE.Texture() });
  await pond.ready;
  const parts = new Map();
  root.traverse(object => { if (object.userData.part) parts.set(object.userData.part, object); });
  assert.deepEqual([...parts.keys()].sort(), ["board", "bobber", "bucket", "rod"]);
  // A ray straight down on open water finds the water but no part above it, so a stray tap never casts.
  root.updateMatrixWorld(true);
  const partOf = (hit) => { for (let object = hit.object; object; object = object.parent) if (object.userData.part) return object.userData.part; return null; };
  const down = new THREE.Raycaster(new THREE.Vector3(2.2, 10, -1.2), new THREE.Vector3(0, -1, 0));
  // Sprites (glows, the bite mark) measure against a camera.
  down.camera = new THREE.PerspectiveCamera(); down.camera.position.set(0, 10, 0); down.camera.updateMatrixWorld();
  const water = down.intersectObject(root, true).filter(isVisibleHit);
  assert.ok(water.length > 0 && water.every(hit => partOf(hit) === null));
  // The glint shows while prize catches remain and fades once none do.
  const glows = () => root.children.filter(object => object.geometry?.type === "PlaneGeometry" && object.material.map);
  pond.setPrizes(3); pond.update(5, 1);
  assert.ok(glows().length === 2 && glows().every(glow => glow.visible));
  pond.setPrizes(0); for (let frame = 0; frame < 30; frame++) pond.update(0.2, 1 + frame);
  assert.ok(glows().every(glow => !glow.visible));
  assert.equal(pickFacilityPart(down, root), null);
  for (const name of ["rod", "bucket", "board"]) {
    const part = parts.get(name), rest = part.position.clone(), rotation = part.quaternion.clone(), shells = [];
    part.traverse(object => { if (object.userData.outline) shells.push(object); });
    assert.ok(shells.length, `${name} has a visible-model outline`);
    pond.hover(name); pond.update(1, 40);
    assert.ok(shells.every(shell => shell.visible), `${name} glows on hover`);
    assert.ok(part.position.equals(rest) && part.quaternion.angleTo(rotation) < 1e-6, `${name} stays in place`);
    pond.hover(null); pond.update(1, 41);
    assert.ok(shells.every(shell => !shell.visible), `${name} glow clears`);
  }
  pond.dispose();
  let shells = 0; root.traverse(object => { if (object.userData.outline) shells++; });
  assert.equal(shells, 0, "outline shells are released with the scene");
});

test("a rod target behind decoration is clickable, but hidden controls and open water are not", () => {
  const root = new THREE.Group(), rod = new THREE.Group(); rod.userData.part = "rod";
  const target = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 2.8), new THREE.MeshBasicMaterial({ visible: false }));
  rod.add(target); root.add(rod);
  const decoration = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)); decoration.position.y = 2; root.add(decoration);
  root.updateMatrixWorld(true);
  assert.equal(pickFacilityPart(ray, root), "rod");
  rod.visible = false;
  assert.equal(pickFacilityPart(ray, root), null);
});
