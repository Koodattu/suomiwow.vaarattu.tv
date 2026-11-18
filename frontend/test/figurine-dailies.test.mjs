import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import * as THREE from "three";
import { isVisibleHit, pickFacilityPart } from "../src/lib/figurine-picking.ts";

registerHooks({ resolve(specifier, context, next) {
  return next(specifier.startsWith("@/") ? new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href : specifier, context);
} });
const { isShot, tapDestination } = await import("../src/lib/figurine-world.ts");
const { buildFacility } = await import("../src/lib/figurine-facilities.ts");

// Exercise the stage's real picking path with scene geometry, without a WebGL renderer.
const source = await readFile(new URL("../src/app/tools/figurine-lab/FigurineStage.tsx", import.meta.url), "utf8");
const start = source.indexOf("    const pickAt ="), end = source.indexOf("    const samePick =", start);
assert.ok(start >= 0 && end > start);
const pick = new vm.Script(`${ts.transpile(source.slice(start, end))}; pickAt;`);

test("every daily facility can be clicked from either of the other daily facilities", () => {
  const stations = ["crate", "quests", "wheel"];
  const groups = Object.fromEntries(stations.map((station, index) => {
    const root = new THREE.Group(); root.position.x = index * 4;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    if (station === "crate") mesh.userData.part = "chest";
    root.add(mesh); root.updateMatrixWorld(true);
    return [station, root];
  }));
  const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 10, 0), new THREE.Vector3(0, -1, 0));
  const state = { current: { view: "crate", workshopBusy: false } };
  const context = vm.createContext({ state, flight: null, immersive: true, navigable: () => true,
    groups, stationGroups: Object.entries(groups).map(([station, root]) => [root, station]),
    raycaster, pickFacilityPart, isVisibleHit, isShot, tapDestination, scenery: null,
  });
  const pickAt = pick.runInContext(context);
  for (const from of stations) for (const to of stations) {
    state.current.view = from;
    raycaster.ray.origin.x = groups[to].position.x;
    const result = pickAt();
    const expected = from !== to ? { kind: "station", view: to }
      : to === "crate" ? { kind: "part", station: "crate", part: "chest" } : { kind: "back" };
    assert.deepEqual(result && JSON.parse(JSON.stringify(result)), expected, `${from} -> ${to}`);
  }
});

test("quest board exclamation appears only while a reward is claimable", async t => {
  const previous = globalThis.document;
  t.after(() => { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; });
  const paint = new Proxy({}, { get: (_, key) => key === "createRadialGradient" ? () => ({ addColorStop() {} }) : () => {}, set: () => true });
  globalThis.document = { createElement: () => ({ getContext: () => paint }) };
  const root = new THREE.Group();
  const facility = buildFacility(root, "quests", {
    envMap: new THREE.Texture(),
    placeProp(parent) { const group = new THREE.Group(); parent.add(group); return { group, ready: Promise.resolve(group) }; },
  });
  await facility.ready;
  const mark = root.children.find(object => object.children.some(child => child.geometry?.type === "SphereGeometry"));
  assert.ok(mark, "quest board has an exclamation marker");
  assert.equal(mark.visible, false, "no marker before quest state arrives");
  for (const ready of [false, true, false, true, false]) {
    facility.setQuestsReady(ready);
    facility.update(1 / 60, 10);
    assert.equal(mark.visible, ready, "completion, claim and period resets update the marker");
  }
  facility.dispose();
});
