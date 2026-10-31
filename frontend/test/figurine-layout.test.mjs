import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import * as THREE from "three";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}${specifier.endsWith(".json") ? "" : ".ts"}`, import.meta.url).href, context);
    return next(specifier, context);
  },
});
const { STATIONS, STATION_RADIUS, viewPose } = await import("../src/lib/figurine-world.ts");
const { LAMP_ANGLES, forestLayout, marketLayout } = await import("../src/lib/figurine-forest.ts");

const PLAZA = 14.5;
const stations = Object.entries(STATIONS);

test("six stations stand round the pedestal, clear of each other, the lamps and the market", () => {
  assert.deepEqual(Object.keys(STATIONS).sort(), ["fame", "forge", "gallery", "recycler", "shop", "trading"]);
  for (const [name, { position }] of stations) assert.ok(Math.abs(position.length() - STATION_RADIUS) < 1e-9, name);
  for (const [a, first] of stations) for (const [b, second] of stations) if (a < b) assert.ok(first.position.distanceTo(second.position) > 9, `${a} and ${b} overlap`);
  const lamps = LAMP_ANGLES.map((angle) => new THREE.Vector3(Math.sin(angle) * (PLAZA - 0.8), 0, Math.cos(angle) * (PLAZA - 0.8)));
  const market = marketLayout().map(({ x, z }) => new THREE.Vector3(x, 0, z));
  for (const [name, { position }] of stations) {
    for (const lamp of lamps) assert.ok(lamp.distanceTo(position) > 4, `a lamp stands in ${name}`);
    for (const prop of market) assert.ok(prop.distanceTo(position) > 3.6, `market stock stands in ${name}`);
  }
});

test("each station's shot passes beside the pedestal, even backed off for a phone", () => {
  const home = { offset: new THREE.Vector3(0.6, 2.1, 9.6), target: new THREE.Vector3(0, 1.5, 0) };
  for (const view of ["shop", "gallery", "recycler", "forge"]) {
    const { position, target } = viewPose(view, 1, home, 375 / 812);
    // The pedestal stands at the origin: its distance from the line of sight, where that line passes it.
    const sight = new THREE.Line3(position.clone().setY(0), target.clone().setY(0)), nearest = new THREE.Vector3();
    sight.closestPointToPoint(new THREE.Vector3(), true, nearest);
    assert.ok(nearest.length() > 2.5, `${view} looks through the pedestal`);
  }
});

test("the woods close round the plaza, leaving only the opening shot's lane and the path", () => {
  const trees = forestLayout(PLAZA, 11, marketLayout()).filter(({ model }) => model === "tree" || model === "bareTree");
  const angle = ({ x, z }) => Math.atan2(x, z);
  // Every 30° sector of the near woods has trees, except where the opening shot flies in.
  for (let sector = -6; sector < 6; sector++) {
    const from = sector * Math.PI / 6, to = from + Math.PI / 6;
    if (from >= -0.15 && to <= 0.6) continue;
    assert.ok(trees.some((tree) => angle(tree) >= from && angle(tree) < to && Math.hypot(tree.x, tree.z) < PLAZA + 25), `no trees between ${Math.round(from * 180 / Math.PI)}° and ${Math.round(to * 180 / Math.PI)}°`);
  }
  for (const tree of trees) if (Math.hypot(tree.x, tree.z) < 29) assert.ok(!(angle(tree) > -0.15 && angle(tree) < 0.6), "a tree stands in the opening shot's lane");
});
