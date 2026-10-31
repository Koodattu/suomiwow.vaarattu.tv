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
const { STATIONS, STATION_SPECS, STATUE_SPOTS, LAMP_SPOTS, PLAZA_RADIUS, viewPose } = await import("../src/lib/figurine-world.ts");
const { forestLayout, marketLayout } = await import("../src/lib/figurine-forest.ts");

const PLAZA = PLAZA_RADIUS;
const stations = Object.entries(STATIONS);
// A point inside a station's footprint, with `margin` to spare all round.
const inside = (name, point, margin = 0) => {
  const { position, rotation } = STATIONS[name], spec = STATION_SPECS[name];
  const local = point.clone().sub(position).applyAxisAngle(new THREE.Vector3(0, 1, 0), -rotation);
  return Math.abs(local.x) < spec.width / 2 + margin && local.z > spec.back - margin && local.z < spec.front + margin;
};

test("thirteen stations stand about the pedestal, roughly facing it, with the fishing pond beyond the plaza", () => {
  assert.equal(stations.length, 13);
  for (const [name, { position, rotation }] of stations) {
    const facing = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), rotation);
    assert.ok(facing.dot(position.clone().negate().normalize()) > 0.9, `${name} looks toward the centre`);
    if (name === "pond") assert.ok(position.length() > PLAZA, "the pond lies outside the plaza");
    else assert.ok(position.length() > 9 && position.length() < 20, `${name} stands about the plaza`);
  }
  // Neighbours keep a gap: no station's front corners stand inside another station.
  for (const [a] of stations) for (const [b, { position, rotation }] of stations) if (a !== b) {
    const spec = STATION_SPECS[b];
    for (const x of [-spec.width / 2, spec.width / 2]) for (const z of [spec.back, spec.front]) {
      const corner = new THREE.Vector3(x, 0, z).applyAxisAngle(new THREE.Vector3(0, 1, 0), rotation).add(position);
      assert.ok(!inside(a, corner, 0.3), `${b} crowds ${a}`);
    }
  }
});

test("showcase figures, lamps and market stock stand clear of every station and its shot", () => {
  assert.deepEqual(STATUE_SPOTS.map(({ number }) => number), Array.from({ length: 16 }, (_, index) => index + 1));
  const lamps = LAMP_SPOTS.map(([x, z]) => new THREE.Vector3(x, 0, z));
  const market = marketLayout().map(({ x, z }) => new THREE.Vector3(x, 0, z));
  // The strip in front of a station that its camera looks down.
  const inShot = (name, point) => {
    const { position, rotation } = STATIONS[name], spec = STATION_SPECS[name];
    const local = point.clone().sub(position).applyAxisAngle(new THREE.Vector3(0, 1, 0), -rotation);
    return Math.abs(local.x) < 0.9 && local.z > spec.front && local.z < spec.front + 5;
  };
  for (const [name] of stations) {
    for (const spot of STATUE_SPOTS) { assert.ok(!inside(name, spot.position, 0.6), `figure ${spot.number} stands in ${name}`); assert.ok(!inShot(name, spot.position), `figure ${spot.number} blocks ${name}'s shot`); }
    for (const lamp of lamps) { assert.ok(!inside(name, lamp, 0.4), `a lamp stands in ${name}`); assert.ok(!inShot(name, lamp), `a lamp blocks ${name}'s shot`); }
    for (const prop of market) assert.ok(!inside(name, prop, 0.5), `market stock stands in ${name}`);
  }
  for (const spot of STATUE_SPOTS) {
    for (const prop of [...market, ...lamps]) assert.ok(prop.distanceTo(spot.position) > 1.3, `figure ${spot.number} is crowded`);
    for (const other of STATUE_SPOTS) if (other !== spot) assert.ok(other.position.distanceTo(spot.position) > 2, `figures ${spot.number} and ${other.number} crowd`);
  }
});

test("on a wide screen every station shot stays on its station's side of the pedestal", () => {
  const home = { offset: new THREE.Vector3(0.6, 2.1, 9.6), target: new THREE.Vector3(0, 1.5, 0) };
  for (const [name, { position }] of stations) {
    const { position: camera } = viewPose(name, 1, home, 16 / 9);
    assert.ok(camera.clone().setY(0).dot(position) > 0, `${name}'s shot passes the pedestal`);
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
