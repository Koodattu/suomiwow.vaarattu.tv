import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import * as THREE from "three";
import { isVisibleHit } from "../src/lib/figurine-picking.ts";

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
  const paint = new Proxy({}, { get: (_, key) => key === "createLinearGradient" || key === "createRadialGradient" ? () => ({ addColorStop() {} }) : () => {}, set: () => true });
  globalThis.document = { createElement: () => ({ getContext: () => paint }) };
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
