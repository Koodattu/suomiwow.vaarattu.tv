import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}${specifier.endsWith(".json") ? "" : ".ts"}`, import.meta.url).href, context);
    return next(specifier, context);
  },
});
const { DISTRICT_FLOORS, STATIONS, STATION_SPECS, STATUE_SPOTS, LAMP_SPOTS, PLAZA_RADIUS, COBBLE_RADIUS, PATHS, FOREST_CLEARINGS, viewPose, isStation } = await import("../src/lib/figurine-world.ts");
const { buildForest, forestLayout, groveLayout, marketLayout, POND, SECRET_BARREL } = await import("../src/lib/figurine-forest.ts");
const { DISTRICT_DRESSING } = await import("../src/lib/figurine-districts.ts");

const PLAZA = PLAZA_RADIUS;
const stations = Object.entries(STATIONS);
test("overlay facilities use elevated shots while the fishing camera is unchanged", () => {
  const home = { offset: new THREE.Vector3(0, 2, 9), target: new THREE.Vector3(0, 1.5, 0) };
  for (const view of ["recycler", "forge", "crate", "merchant", "quests", "wheel", "trading", "mail", "feed", "fame", "leaderboard"]) {
    const shot = viewPose(view, 1, home), offset = shot.position.clone().sub(shot.target);
    const angle = Math.atan2(offset.y, Math.hypot(offset.x, offset.z));
    assert.ok(angle > 0.4 && angle < 0.6, `${view} should look gently down at its facility`);
  }
  const pond = viewPose("pond", 1, home), offset = pond.position.clone().sub(pond.target);
  assert.ok(Math.abs(offset.y / Math.hypot(offset.x, offset.z) - 0.36) < 1e-9);
});
test("camera travel keeps scenery instances and facility visibility stable", async t => {
  const stage = await readFile(new URL("../src/app/tools/figurine-lab/FigurineStage.tsx", import.meta.url), "utf8");
  const facilitiesStart = stage.indexOf("        // Viewer: the chosen figure");
  const sceneryStart = stage.indexOf("      if (scenery)", stage.indexOf("      const orbiting ="));
  const update = new vm.Script(ts.transpile(
    stage.slice(facilitiesStart, stage.indexOf("        shop?.update", facilitiesStart)) +
    stage.slice(sceneryStart, stage.indexOf("      if (scene.fog", sceneryStart)),
  ));
  t.mock.method(GLTFLoader.prototype, "loadAsync", async () => {
    const scene = new THREE.Group(), tree = new THREE.Mesh(new THREE.BoxGeometry(8, 10, 8), new THREE.MeshStandardMaterial());
    tree.position.y = 5; scene.add(tree); return { scene };
  });
  const root = new THREE.Group(); root.position.set(4, 0, 2); root.rotation.y = 0.2;
  const forest = buildForest(root, [
    { model: "tree", x: 0, z: 20, yaw: 0, size: 0.5 },
    { model: "tree", x: 0, z: -20, yaw: 0, size: 0.5 },
    { model: "tree", x: 30, z: 15, yaw: 0, size: 0.5 },
  ]);
  await forest.ready; root.updateMatrixWorld(true);
  const mesh = forest.group.children[0], matrix = new THREE.Matrix4();
  const original = [0, 1, 2].map(i => { mesh.getMatrixAt(i, matrix); return matrix.clone(); });
  const station = new THREE.Group(), camera = new THREE.PerspectiveCamera();
  const controls = { target: root.localToWorld(new THREE.Vector3(0, 1.5, 0)) };
  const state = vm.createContext({
    THREE, STATION_SPECS, camera, controls, screen: new THREE.Vector3(),
    scenery: { ...forest, sky: new THREE.Object3D() }, stationGroups: [[station, "crate"]],
  });
  for (const view of ["overview", ...stations.map(([name]) => name), "opening", "overview"]) {
    for (const flying of [true, false]) for (const height of [8, 80, 8]) {
      camera.position.copy(root.localToWorld(new THREE.Vector3(0, height, 30)));
      // Put a facility around the camera to exercise the old whole-facility hiding rule too.
      station.position.copy(camera.position); station.updateMatrixWorld(true);
      Object.assign(state, { current: { view }, currentView: view, flight: flying ? { t: 0.5 } : null });
      update.runInContext(state);
      assert.equal(station.visible, true, `${view}: facilities must not toggle during camera travel`);
      for (let i = 0; i < 3; i++) {
        mesh.getMatrixAt(i, matrix);
        assert.ok(matrix.equals(original[i]), `${view}: foreground, background and side trees retain their transforms`);
        assert.ok(matrix.determinant() > 0, "scenery must never shrink to zero");
      }
    }
  }
});
test("overview pulls straight back from the opening camera while keeping the pedestal centered", () => {
  assert.equal(isStation("overview"), false);
  const home = { offset: new THREE.Vector3(0.6, 2.1, 9.6), target: new THREE.Vector3(0, 1.5, 0) };
  for (const aspect of [16 / 9, 390 / 844]) {
    const camera = new THREE.PerspectiveCamera(36, aspect, 0.4, 140);
    const framing = THREE.MathUtils.clamp(0.85 / aspect, 1, 1.6);
    const opening = viewPose("opening", framing, home, aspect);
    const pose = viewPose("overview", framing, home, aspect);
    camera.position.copy(pose.position); camera.lookAt(pose.target); camera.updateMatrixWorld();
    assert.ok(pose.target.equals(opening.target), "both views orbit the same pedestal target");
    const closeOffset = opening.position.clone().sub(opening.target), wideOffset = pose.position.clone().sub(pose.target);
    assert.ok(Math.abs(wideOffset.length() - 17) < 1e-9, "overview starts inside the clearing at every aspect ratio");
    assert.ok(wideOffset.normalize().distanceTo(closeOffset.normalize()) < 1e-9, "zooming out keeps the opening angle");
    const center = home.target.clone().project(camera);
    assert.ok(Math.abs(center.x) < 1e-9 && Math.abs(center.y) < 1e-9, "the pedestal target projects to the exact screen center");
  }
});
// A point inside a station's footprint, with `margin` to spare all round.
const inside = (name, point, margin = 0) => {
  const { position, rotation } = STATIONS[name], spec = STATION_SPECS[name];
  const local = point.clone().sub(position).applyAxisAngle(new THREE.Vector3(0, 1, 0), -rotation);
  return Math.abs(local.x) < spec.width / 2 + margin && local.z > spec.back - margin && local.z < spec.front + margin;
};

test("all facilities stay within a few steps of the plaza in neighbouring groups", () => {
  assert.equal(stations.length, 14);
  assert.deepEqual(STATION_SPECS.shop.at, [-8.8, -8.2], "the shop remains an anchor");
  for (const [name, { position }] of stations) {
    assert.ok(position.length() - COBBLE_RADIUS < (name === "pond" ? 8 : 4.8), `${name} is too far from the plaza edge`);
  }
  // Clockwise from the shop, with each group together and open ground between the groups.
  const bearing = (name) => { const { x, z } = STATIONS[name].position; return (Math.atan2(x, -z) - Math.atan2(STATIONS.shop.position.x, -STATIONS.shop.position.z) + Math.PI * 2) % (Math.PI * 2); };
  const groups = [["crate", "quests", "wheel"], ["gallery"], ["feed", "fame", "leaderboard"], ["pond"], ["forge", "recycler"], ["trading", "mail", "merchant"]];
  const ring = groups.flat();
  ring.slice(1).forEach((name, index) => assert.ok(bearing(name) > bearing(ring[index]), `${name} should follow ${ring[index]} clockwise`));
  for (const group of groups) for (let index = 1; index < group.length; index++) {
    assert.ok(STATIONS[group[index]].position.distanceTo(STATIONS[group[index - 1]].position) < 5.6, `${group[index - 1]} and ${group[index]} should stand together`);
  }
  // The edge of each station facing its neighbour, along the ring.
  const gap = (a, b) => STATIONS[a].position.distanceTo(STATIONS[b].position) - (STATION_SPECS[a].width + STATION_SPECS[b].width) / 2;
  for (const [a, b] of [["shop", "crate"], ["wheel", "gallery"], ["gallery", "feed"], ["recycler", "trading"], ["merchant", "shop"]]) assert.ok(gap(a, b) > 1.6, `${a} and ${b} should have open ground between them`);
  // The pond keeps its banks to itself.
  for (const [name, { position }] of stations) if (name !== "pond") assert.ok(position.distanceTo(STATIONS.pond.position) > POND.radius + 6, `${name} crowds the pond`);
  for (const [name, { position, rotation }] of stations) {
    const facing = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), rotation);
    assert.ok(facing.dot(position.clone().negate().normalize()) > 0.3, `${name} turns its back on the square`);
    assert.ok(position.length() > 10.5 && position.length() < PLAZA + 4, `${name} stands about the square`);
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

test("figures occupy inner and outer edges, with an open centre and a dry pond bank", () => {
  const inner = STATUE_SPOTS.filter(({ position }) => position.length() < 12);
  assert.ok(inner.length >= 6 && inner.length <= 10, "showcase should have both inner and outer layers");
  for (const { number, position } of STATUE_SPOTS) {
    assert.ok(position.length() > 8.5 && position.length() < 21, `figure ${number} should be near the facilities, outside the plaza centre`);
    assert.ok(position.distanceTo(STATIONS.pond.position) > POND.radius + 1, `figure ${number} stands in the pond or its reeds`);
    assert.ok(stations.some(([, station]) => station.position.distanceTo(position) < 7), `figure ${number} is isolated from the facilities`);
  }
  assert.deepEqual(STATION_SPECS.pond.at, [POND.x, POND.z], "water and forest exclusion must move together");
  assert.deepEqual(STATION_SPECS.pond.at, [6.9, 16.9], "the pond stays put while the other facilities move inward");
  const barrelDistance = Math.hypot(SECRET_BARREL.x - POND.x, SECRET_BARREL.z - POND.z);
  assert.ok(barrelDistance > POND.radius + 5, "secret barrel stays clear of the pond and its tackle targets");
});

test("paths leave through gaps and stay open through the generated woods", () => {
  const scenery = forestLayout(PLAZA, 11, marketLayout(), LAMP_SPOTS, FOREST_CLEARINGS);
  const obstacles = [
    ...scenery.map(({ model, x, z }) => ({ name: model, position: new THREE.Vector3(x, 0, z) })),
    ...STATUE_SPOTS.map(({ number, position }) => ({ name: `figure ${number}`, position })),
  ];
  for (const path of PATHS) for (let index = 1; index < path.length; index++) {
    const [x, z] = path[index], [px, pz] = path[index - 1];
    const steps = Math.ceil(Math.hypot(x - px, z - pz) / 0.5);
    for (let step = 0; step <= steps; step++) {
      const point = new THREE.Vector3(px + (x - px) * step / steps, 0, pz + (z - pz) * step / steps);
      for (const [name] of stations) assert.ok(!inside(name, point, 0.3), `path crosses ${name}`);
      for (const obstacle of obstacles) assert.ok(point.distanceTo(obstacle.position) > 1.2, `${obstacle.name} blocks the path near ${point.x.toFixed(1)},${point.z.toFixed(1)}`);
    }
  }
});

test("nothing tall stands in the line from a station's camera to it", () => {
  const home = { offset: new THREE.Vector3(0.6, 2.1, 9.6), target: new THREE.Vector3(0, 1.5, 0) };
  // Lamps, figures and trees, with how far from the line each must keep.
  const tall = [
    ...LAMP_SPOTS.map(([x, z]) => ({ what: `the lamp at ${x},${z}`, point: new THREE.Vector3(x, 0, z), clear: 0.5 })),
    ...STATUE_SPOTS.map(({ number, position }) => ({ what: `figure ${number}`, point: position, clear: 0.7 })),
    ...groveLayout().filter(({ model }) => model === "tree" || model === "bareTree").map(({ x, z }) => ({ what: `the tree at ${x},${z}`, point: new THREE.Vector3(x, 0, z), clear: 1.2 })),
  ];
  for (const [aspect, framing] of [[16 / 9, 1], [9 / 19.5, 1.5]]) for (const [name, { position }] of stations) {
    const camera = viewPose(name, framing, home, aspect).position.setY(0), length = camera.distanceTo(position), layout = aspect < 1 ? "phone" : "wide";
    for (let step = 1; step < 40; step++) {
      const point = position.clone().lerp(camera, step / 40);
      if (point.distanceTo(position) <= STATION_SPECS[name].front + 0.5) continue;
      for (const [other] of stations) if (other !== name) assert.ok(!inside(other, point, 0.2), `${other} blocks ${name}'s shot (${layout}, ${(step / 40 * length).toFixed(1)} out)`);
      for (const { what, point: at, clear } of tall) assert.ok(at.distanceTo(point) > clear, `${what} blocks ${name}'s shot (${layout}, ${(step / 40 * length).toFixed(1)} out)`);
    }
  }
});

test("showcase figures, lamps and market stock stand clear of every station and its shot", () => {
  assert.deepEqual(STATUE_SPOTS.map(({ number }) => number), Array.from({ length: 16 }, (_, index) => index + 1));
  const lamps = LAMP_SPOTS.map(([x, z]) => new THREE.Vector3(x, 0, z));
  const market = marketLayout().map(({ x, z }) => new THREE.Vector3(x, 0, z));
  const grove = groveLayout().map(({ x, z, model }) => ({ model, point: new THREE.Vector3(x, 0, z) }));
  // The strip in front of a station that its camera looks down; a phone's shot backs off far.
  const inShot = (name, point, width = 0.9, depth = 5) => {
    const { position, rotation } = STATIONS[name], spec = STATION_SPECS[name];
    const local = point.clone().sub(position).applyAxisAngle(new THREE.Vector3(0, 1, 0), -rotation);
    return Math.abs(local.x) < width && local.z > spec.front && local.z < spec.front + depth;
  };
  for (const [name] of stations) {
    for (const spot of STATUE_SPOTS) { assert.ok(!inside(name, spot.position, 0.6), `figure ${spot.number} stands in ${name}`); assert.ok(!inShot(name, spot.position, 1.6, 10), `figure ${spot.number} blocks ${name}'s shot`); }
    for (const lamp of lamps) { assert.ok(!inside(name, lamp, 0.4), `a lamp stands in ${name}`); assert.ok(!inShot(name, lamp), `a lamp blocks ${name}'s shot`); }
    for (const prop of market) assert.ok(!inside(name, prop, 0.5), `market stock stands in ${name}`);
    for (const { model, point } of grove) {
      assert.ok(!inside(name, point, model === "tree" || model === "bareTree" ? 1.6 : 0.5), `a ${model} grows in ${name}`);
      assert.ok(!inShot(name, point), `a ${model} blocks ${name}'s shot`);
    }
  }
  for (const spot of STATUE_SPOTS) {
    for (const prop of [...market, ...lamps]) assert.ok(prop.distanceTo(spot.position) > 1.3, `figure ${spot.number} is crowded`);
    for (const other of STATUE_SPOTS) if (other !== spot) assert.ok(other.position.distanceTo(spot.position) > 2, `figures ${spot.number} and ${other.number} crowd`);
  }
});

test("each district's dressing stays off the stations, the paths and the pond's banks", () => {
  const dressing = Object.values(DISTRICT_DRESSING).flat();
  // Each district dresses itself from its own props, and only lightly.
  const owners = Object.values(DISTRICT_DRESSING).map((pieces) => new Set(pieces.map(({ prop }) => prop)));
  owners.forEach((props, index) => owners.slice(index + 1).forEach((other) => assert.ok([...props].every((prop) => !other.has(prop)), "the districts look different from one another")));
  assert.ok(dressing.length <= 12, "dressing frames the districts without crowding them");
  const walked = PATHS.flatMap((path) => path.slice(1).flatMap(([x, z], index) => {
    const [px, pz] = path[index], steps = Math.ceil(Math.hypot(x - px, z - pz) / 0.5);
    return Array.from({ length: steps + 1 }, (_, step) => new THREE.Vector3(px + (x - px) * step / steps, 0, pz + (z - pz) * step / steps));
  }));
  for (const { prop, at: [x, z], y = 0 } of dressing) {
    const point = new THREE.Vector3(x, 0, z);
    for (const [name] of stations) assert.ok(!inside(name, point, 0.1), `${prop} at ${x},${z} stands in ${name}`);
    if (y < 2) for (const step of walked) assert.ok(step.distanceTo(point) > 0.8, `${prop} at ${x},${z} blocks a path`);
    assert.ok(point.distanceTo(STATIONS.pond.position) > POND.radius + 4, `${prop} at ${x},${z} crowds the pond`);
  }
});

test("each district's paving runs under its stations and its dressing", () => {
  const floors = { trading: 0, fair: 1, honours: 2, yard: 3 };
  const paved = (district, x, z) => DISTRICT_FLOORS[floors[district]].blobs.some(([bx, bz, radius]) => Math.hypot(x - bx, z - bz) < radius);
  for (const [district, pieces] of Object.entries(DISTRICT_DRESSING)) for (const { prop, at: [x, z] } of pieces) assert.ok(paved(district, x, z), `${prop} at ${x},${z} stands off the ${district} paving`);
  const members = { trading: ["trading", "mail", "merchant"], fair: ["crate", "quests", "wheel"], honours: ["feed", "fame", "leaderboard"], yard: ["forge", "recycler"] };
  for (const [district, names] of Object.entries(members)) for (const name of names) {
    const { position, rotation } = STATIONS[name], { back, width } = STATION_SPECS[name];
    // Its back corners too, or the floor stops short of what stands behind it.
    for (const side of [-1, 1]) {
      const corner = new THREE.Vector3(side * width / 2 * 0.75, 0, back).applyAxisAngle(new THREE.Vector3(0, 1, 0), rotation).add(position);
      assert.ok(paved(district, corner.x, corner.z), `${name}'s back corner stands off the ${district} paving`);
    }
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
