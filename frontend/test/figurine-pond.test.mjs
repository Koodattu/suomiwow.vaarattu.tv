import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

registerHooks({ resolve(specifier, context, next) {
  return next(specifier.startsWith("@/") ? new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href : specifier, context);
} });
const { buildFacility } = await import("../src/lib/figurine-facilities.ts");
const { propPlacer } = await import("../src/lib/figurine-props.ts");

async function pondScene(t) {
  const paint = new Proxy({}, { get: (_, key) => /create.*Gradient/.test(key) ? () => ({ addColorStop() {} }) : key === "createImageData" ? (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }) : () => {}, set: () => true });
  const previous = globalThis.document, previousProgress = globalThis.ProgressEvent;
  globalThis.document = { createElement: () => ({ getContext: () => paint }), createElementNS: () => ({ style: {}, addEventListener() {}, removeEventListener() {} }) };
  globalThis.ProgressEvent ??= class {};
  t.after(() => { globalThis.document = previous; globalThis.ProgressEvent = previousProgress; });
  // Keep the actual compressed geometry and node transforms; only GPU textures are omitted.
  t.mock.method(GLTFLoader.prototype, "loadAsync", async function (url) {
    if (!/dock-small|fishing-pole|fish-uldum-|fish-dead-|fish-draenor-|boot-junk|treasuregoblin-coinpile|community-001/.test(url)) return { scene: new THREE.Group(), animations: [] };
    const bytes = await readFile(new URL(`../public${url.split("?")[0]}`, import.meta.url));
    const length = bytes.readUInt32LE(12), json = JSON.parse(bytes.subarray(20, 20 + length));
    json.buffers[0].uri = `data:application/octet-stream;base64,${bytes.subarray(28 + length).toString("base64")}`;
    json.materials = json.materials.map(({ name }) => ({ name }));
    delete json.images; delete json.textures;
    json.extensionsRequired = json.extensionsRequired.filter(name => name !== "KHR_texture_basisu");
    return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(JSON.stringify(json), "");
  });
  const root = new THREE.Group(); root.position.set(6.9, 0, 16.9); root.rotation.y = 0.4;
  const place = propPlacer(), placed = [], figures = [];
  const pond = buildFacility(root, "pond", { envMap: new THREE.Texture(), loadFigure: (url) => {
    const ready = new GLTFLoader().loadAsync(url).then(({ scene }) => scene); figures.push(ready); return ready;
  }, placeProp: (...args) => {
    const result = place(...args); placed.push({ name: args[1], ...result }); return result;
  } });
  await pond.ready;
  t.after(() => pond.dispose());
  return { root, pond, placed, figures };
}

test("the real dock's pilings and click bounds end immediately beneath the ground", async t => {
  const { root, placed } = await pondScene(t);
  const dock = placed.find(prop => prop.name === "dock").group;
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3(), point = new THREE.Vector3();
  dock.traverse(object => {
    if (!object.isMesh || object.userData.outline) return;
    assert.ok(!/sign/i.test(object.material.name), "the dock's old sign is removed");
    const positions = object.geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i); object.localToWorld(point); root.worldToLocal(point); bounds.expandByPoint(point);
    }
  });
  assert.ok(bounds.min.y >= -0.00501, `pilings end at ${bounds.min.y}`);
  assert.ok(bounds.max.y < 0.7 && bounds.max.y > 0.5, "deck and piling tops retain their height");
  assert.ok(bounds.getSize(new THREE.Vector3()).length() < 4, "dock remains local to the bank");
  const origin = root.localToWorld(new THREE.Vector3(0.43, -1, 12));
  const direction = new THREE.Vector3(0, 0, -1).transformDirection(root.matrixWorld);
  assert.equal(new THREE.Raycaster(origin, direction).intersectObject(dock, true).length, 0, "underground rays cannot select the pond through its old pilings");
});

test("small catches are enlarged, spin, and dismiss without repeating the reward or blocking the next cast", async t => {
  const { root, pond, placed } = await pondScene(t);
  const camera = new THREE.PerspectiveCamera(36, 16 / 9, 0.1, 100);
  camera.position.set(6, 4, 27); camera.lookAt(6.9, 0, 16.9);
  pond.present(camera);
  let phase, rewards = 0;
  pond.act({ kind: "cast", catch: { kind: "fish", fish: "smallfish", length: 0.28, quality: "standard" } }, cue => { phase = cue; }, result => { if (result === "caught") rewards++; });
  await placed.at(-1).ready;
  pond.poke("dismiss"); // Dismissal cannot cancel a live cast.
  for (let i = 0; i < 80 && phase !== "bite"; i++) pond.update(0.1, i / 10);
  assert.equal(phase, "bite"); pond.poke("hook");
  for (let i = 0; i < 12; i++) pond.update(0.1, 8 + i / 10);
  pond.present(camera); root.updateMatrixWorld(true);
  const model = placed.at(-1).group, holder = model.parent, show = holder.parent;
  const backdrop = root.getObjectByName("pond-catch-backdrop");
  assert.ok(new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3()).length() > 0.7, "even a small fish gets a substantial reveal");
  assert.ok(backdrop.visible && backdrop.material.map && backdrop.material.opacity > 0 && backdrop.material.opacity <= 0.65);
  const rotation = holder.rotation.y;
  pond.update(0.1, 9); assert.ok(holder.rotation.y > rotation);
  pond.present(camera, true);
  const paused = holder.rotation.y; pond.update(0.1, 9.1); assert.equal(holder.rotation.y, paused, "reduced motion stops the spin");
  pond.present(null); assert.equal(show.parent.visible, false, "leaving the pond hides its presentation");
  pond.present(camera); assert.equal(show.parent.visible, true);
  pond.poke("dismiss");
  for (let i = 0; i < 20; i++) { pond.update(0.1, 10 + i / 10); pond.present(camera); }
  assert.equal(show.visible, false); assert.equal(backdrop.visible, false);
  assert.equal(model.parent, null); assert.equal(rewards, 1, "dismissal neither grants nor revokes a catch");
  pond.act({ kind: "cast", catch: { kind: "coin" } }, cue => { phase = cue; }, () => {});
  for (let i = 0; i < 15; i++) pond.update(0.1, 13 + i / 10);
  assert.equal(phase, "splash", "casting after dismissal works");
});

test("a landed fish stays centred through camera rotation, zoom and a portrait viewport", async t => {
  const { root, pond, placed } = await pondScene(t);
  let phase, result;
  const camera = new THREE.PerspectiveCamera(36, 16 / 9, 0.1, 100);
  camera.position.set(6, 4, 27); camera.lookAt(6.9, 0, 16.9);
  pond.present(camera);
  pond.act({ kind: "cast", catch: { kind: "fish", fish: "mightfish", length: 1, quality: "standard" } }, cue => { phase = cue; }, value => { result = value; });
  await placed.at(-1).ready;
  for (let i = 0; i < 80 && phase !== "bite"; i++) pond.update(0.1, i / 10);
  assert.equal(phase, "bite"); pond.poke("hook");
  for (let i = 0; i < 20; i++) pond.update(0.1, 8 + i / 10);
  assert.equal(result, "caught");
  const catchModel = placed.at(-1).group, show = catchModel.parent.parent;
  assert.ok(show.visible);
  for (const [aspect, x, y, z] of [[16 / 9, 6, 4, 27], [16 / 9, 11, 6, 25], [390 / 844, 8, 3, 23]]) {
    camera.aspect = aspect; camera.updateProjectionMatrix(); camera.position.set(x, y, z); camera.lookAt(6.9, 0, 16.9);
    pond.present(camera); root.updateMatrixWorld(true);
    const centre = new THREE.Box3().setFromObject(catchModel).getCenter(new THREE.Vector3()).project(camera);
    assert.ok(Math.abs(centre.x) < 0.02 && Math.abs(centre.y) < 0.08, `catch is near the viewport centre: ${centre.toArray()}`);
  }
  pond.act({ kind: "cast", catch: { kind: "coin" } }, () => {}, () => {});
  for (let i = 0; i < 8; i++) pond.update(0.1, 11 + i / 10);
  assert.equal(catchModel.parent, null, "casting stows and releases the previous fish");
});

test("the reveal joins its display pose smoothly and dismissal follows a fixed arc into the relocated bucket", async t => {
  const { root, pond, placed } = await pondScene(t);
  assert.equal(placed.some(prop => prop.name === "tacklebox"), false, "the bucket replaces the dock's tackle box");
  const bucket = placed.find(prop => prop.name === "fishBucket").group.parent;
  assert.ok(bucket.position.distanceTo(new THREE.Vector3(0.11, 0.36, 3.86)) < 0.001);
  const camera = new THREE.PerspectiveCamera(36, 16 / 9, 0.1, 100);
  camera.position.set(6, 4, 27); camera.lookAt(6.9, 0, 16.9); pond.present(camera);
  let phase, rewards = 0, time = 0;
  const frame = delta => { time += delta; pond.update(delta, time); pond.present(camera); };
  pond.act({ kind: "cast", catch: { kind: "fish", fish: "smallfish", length: 0.28, quality: "standard" } }, cue => { phase = cue; }, () => { rewards++; });
  await placed.at(-1).ready;
  for (let i = 0; i < 80 && phase !== "bite"; i++) frame(0.1);
  assert.equal(phase, "bite"); pond.poke("hook");
  const model = placed.at(-1).group, holder = model.parent, show = holder.parent;
  for (let i = 0; i < 54; i++) frame(0.02);
  assert.equal(rewards, 0);
  const before = { position: show.position.clone(), rotation: show.quaternion.clone(), scale: show.scale.x };
  frame(0.02); frame(0.02);
  assert.equal(rewards, 1);
  assert.ok(show.position.distanceTo(before.position) < 0.02, "landing does not jump to another position");
  assert.ok(show.quaternion.angleTo(before.rotation) < 0.02, "landing does not switch to a different rotation");
  assert.ok(Math.abs(show.scale.x - before.scale) < 0.002);
  const backdrop = root.getObjectByName("pond-catch-backdrop");
  const fullHeight = 8 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  assert.ok(backdrop.scale.y < fullHeight * 0.8 && backdrop.scale.x < fullHeight * camera.aspect * 0.8, "the soft backdrop is confined to the centre");
  const start = show.position.clone(), rotation = show.quaternion.clone(), spin = holder.rotation.y;
  pond.poke("dismiss");
  assert.ok(show.visible && show.position.equals(start) && show.quaternion.equals(rotation), "dismissal starts at the displayed pose");
  frame(0.01);
  assert.ok(show.position.distanceTo(start) < 0.01 && show.quaternion.angleTo(rotation) < 0.01, "the bucket flight starts without a snap");
  for (let i = 0; i < 3; i++) frame(0.1);
  const midway = show.position.clone();
  assert.ok(show.visible && midway.distanceTo(start) > 0.1 && holder.rotation.y > spin);
  pond.poke("dismiss");
  assert.ok(show.position.equals(midway), "another dismiss cannot restart the flight");
  for (let i = 0; i < 4; i++) frame(0.1);
  const destination = bucket.position.clone().add(new THREE.Vector3(0, 0.2, 0));
  assert.ok(show.position.distanceTo(destination) < 0.001, "the fish lands inside the bucket at its new position");
  assert.equal(show.visible, false); assert.equal(model.parent, null); assert.equal(rewards, 1);
});

// Measure the mesh rather than assuming its exported X/Y/Z axes follow its body.
// Unique vertices prevent UV seams from giving one side extra weight.
function bodyAxes(geometry) {
  const positions = geometry.attributes.position, unique = new Map();
  for (let i = 0; i < positions.count; i++) {
    const point = new THREE.Vector3().fromBufferAttribute(positions, i);
    unique.set(point.toArray().map(value => value.toFixed(5)).join(","), point);
  }
  const points = [...unique.values()], centre = points.reduce((sum, point) => sum.add(point), new THREE.Vector3()).divideScalar(points.length);
  const covariance = Array.from({ length: 3 }, () => [0, 0, 0]);
  for (const point of points) {
    const offset = point.clone().sub(centre).toArray();
    for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) covariance[row][col] += offset[row] * offset[col] / points.length;
  }
  const axes = [];
  for (let axis = 0; axis < 2; axis++) {
    const direction = new THREE.Vector3(1, 0.7, 0.3).normalize();
    const multiply = vector => covariance.map(row => row.reduce((sum, value, col) => sum + value * vector[col], 0));
    for (let i = 0; i < 80; i++) direction.set(...multiply(direction.toArray())).normalize();
    const vector = direction.toArray(), magnitude = direction.dot(new THREE.Vector3(...multiply(vector)));
    axes.push(direction);
    for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) covariance[row][col] -= magnitude * vector[row] * vector[col];
  }
  return axes;
}

test("actual fish bodies stay level and dorsal fins stay upright through a complete spin", async t => {
  const { root, pond, placed } = await pondScene(t);
  const camera = new THREE.PerspectiveCamera(36, 16 / 9, 0.1, 100);
  camera.position.set(6, 4, 27); camera.lookAt(6.9, 0, 16.9);
  let phase, result, time = 0;
  const frame = delta => { time += delta; pond.update(delta, time); pond.present(camera); };
  const fish = ["smallfish", "mudsnapper", "catfish", "blackmouth", "firefin", "deviate", "yellowtail", "eel", "salmon", "mightfish", "boot"];
  const cases = [
    ...fish.map(id => ({ visual: { kind: "fish", fish: id, length: 0.6, quality: id === "firefin" ? "golden" : "standard" }, up: [0, 1, 0] })),
    { visual: { kind: "coin" }, up: [-0.809016994, 0, -0.587785252] },
  ];
  for (const { visual, up } of cases) {
    phase = result = null; pond.present(camera);
    pond.act({ kind: "cast", catch: visual }, cue => { phase = cue; }, value => { result = value; });
    await placed.at(-1).ready;
    for (let i = 0; i < 80 && phase !== "bite"; i++) frame(0.1);
    assert.equal(phase, "bite"); pond.poke("hook");
    for (let i = 0; i < 150 && !result; i++) frame(0.01);
    assert.equal(result, "caught");
    const model = placed.at(-1).group, holder = model.parent, label = visual.fish ?? visual.kind;
    const measured = new Map();
    if (visual.kind === "fish" && label !== "boot") model.traverse(mesh => {
      if (!mesh.isMesh) return;
      const [along, dorsal] = bodyAxes(mesh.geometry);
      if (along.dot(label === "firefin" ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1)) < 0) along.negate();
      if (dorsal.dot(label === "firefin" ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(-1, 0, 0)) < 0) dorsal.negate();
      measured.set(mesh, { along, dorsal });
    });
    assert.equal(holder.rotation.y, 0, `${label}: no display spin leaks into its arrival pose`);
    const assertUpright = () => {
      root.updateMatrixWorld(true);
      const cameraInverse = camera.quaternion.clone().invert();
      model.traverse(mesh => {
        if (!mesh.isMesh) return;
        const axes = measured.get(mesh);
        const screenUp = (axes ? axes.dorsal.clone() : new THREE.Vector3(...up)).transformDirection(mesh.matrixWorld).applyQuaternion(cameraInverse);
        assert.ok(screenUp.distanceTo(new THREE.Vector3(0, 1, 0)) < 0.002, `${label}: its actual dorsal axis must point up, got ${screenUp.toArray()}`);
        if (axes) {
          const body = axes.along.clone().transformDirection(mesh.matrixWorld).applyQuaternion(cameraInverse);
          assert.ok(Math.abs(body.y) < 0.002, `${label}: its actual body must stay level`);
          if (holder.rotation.y === 0) assert.ok(Math.abs(body.x) > 0.999, `${label}: show its flank on arrival`);
        }
      });
    };
    assertUpright();
    camera.position.set(11, 7, 24); camera.lookAt(6.9, 0, 16.9); camera.rotateZ(0.15);
    pond.present(camera); assertUpright();
    for (let i = 0; i < 72; i++) { frame(0.1); assertUpright(); }
    assert.ok(holder.rotation.y > 0.5, `${label}: the upright model still spins`);
    assertUpright();
    pond.poke("dismiss"); for (let i = 0; i < 8; i++) frame(0.1);
  }
});


test("a caught coin faces the camera and flies into the HUD icon at the correct screen position", async t => {
  const { root, pond, placed } = await pondScene(t);
  const camera = new THREE.PerspectiveCamera(36, 9 / 16, 0.1, 100);
  camera.position.set(8, 6, 26); camera.lookAt(6.9, 0, 16.9);
  const target = { x: 0.72, y: 0.86, width: 0.12 };
  let cue, result, time = 0; const cues = [];
  const frame = delta => { time += delta; pond.update(delta, time); pond.present(camera, false, target); };
  pond.act({ kind: "cast", catch: { kind: "coin" } }, value => { cue = value; cues.push(value); }, value => { result = value; });
  await placed.at(-1).ready;
  for (let i = 0; i < 80 && cue !== "bite"; i++) frame(0.1);
  pond.poke("hook"); for (let i = 0; i < 120 && !result; i++) frame(0.01);
  assert.equal(result, "caught");
  const coin = placed.at(-1).group, show = coin.parent.parent;
  assert.equal(cues.includes("coinCollected"), false);
  const descendants = new Set(); coin.traverse(object => descendants.add(object));
  coin.traverse(object => {
    if (object.isSkinnedMesh) assert.ok(object.skeleton.bones.every(bone => descendants.has(bone)), "even without animation clips, the coin must use its own posed skeleton");
  });
  root.updateMatrixWorld(true);
  const face = new THREE.Vector3(0, 1, 0).transformDirection(coin.matrixWorld).applyQuaternion(camera.quaternion.clone().invert());
  assert.ok(face.distanceTo(new THREE.Vector3(0, 0, 1)) < 1e-6, "the coin's face points toward the camera, not edge-on");
  frame(4); assert.equal(show.visible, true, "the coin waits for player dismissal");
  pond.poke("dismiss"); for (let i = 0; i < 7; i++) frame(0.1);
  root.updateMatrixWorld(true);
  const destination = show.getWorldPosition(new THREE.Vector3()).project(camera);
  assert.ok(Math.abs(destination.x - target.x) < 1e-6 && Math.abs(destination.y - target.y) < 1e-6, `HUD destination ${destination.toArray()}`);
  assert.equal(show.visible, false);
  frame(2); assert.equal(cues.filter(cue => cue === "coinCollected").length, 1, "pulse the counter once, on arrival");
});

test("figure catches display the awarded character model and release it on dismissal", async t => {
  const { root, pond, placed, figures } = await pondScene(t);
  const camera = new THREE.PerspectiveCamera(36, 16 / 9, 0.1, 100);
  camera.position.set(6, 4, 27); camera.lookAt(6.9, 0, 16.9);
  let cue, result, time = 0;
  const frame = delta => { time += delta; pond.update(delta, time); pond.present(camera); };
  pond.act({ kind: "cast", catch: { kind: "figure", model: "/figurines/community-001/roidy.glb", quality: "golden" } }, value => { cue = value; }, value => { result = value; });
  const figure = await figures[0]; await Promise.resolve();
  const meshes = []; figure.traverse(object => { if (object.isMesh) meshes.push(object); });
  assert.ok(meshes.length > 3, "the actual character's body and equipment were loaded");
  assert.ok(!placed.some(prop => prop.name === "chest"), "no treasure chest substitutes for the figure");
  for (let i = 0; i < 80 && cue !== "bite"; i++) frame(0.1);
  pond.poke("hook"); for (let i = 0; i < 14; i++) frame(0.1);
  assert.equal(result, "caught");
  root.updateMatrixWorld(true);
  const up = new THREE.Vector3(0, 1, 0).transformDirection(figure.matrixWorld).applyQuaternion(camera.quaternion.clone().invert());
  assert.ok(up.distanceTo(new THREE.Vector3(0, 1, 0)) < 1e-6, "the collectible stays upright");
  const show = figure.parent.parent.parent;
  assert.ok(show.visible);
  let disposed = false; meshes[0].geometry.addEventListener("dispose", () => { disposed = true; });
  const startScale = show.scale.x;
  pond.poke("dismiss"); frame(0.35);
  root.updateMatrixWorld(true);
  const halfway = show.getWorldPosition(new THREE.Vector3()).project(camera);
  assert.ok(halfway.x < -0.5 && halfway.y > 0.5, "the figure flies up and off-screen, away from the lake");
  assert.ok(show.scale.x > startScale * 0.85, "the figure stays substantial during its exit");
  frame(0.35); root.updateMatrixWorld(true);
  const exit = show.getWorldPosition(new THREE.Vector3()).project(camera);
  assert.ok(exit.x < -1 && exit.y > 1, "the figure leaves the viewport before disappearing");
  assert.equal(show.visible, false); assert.ok(disposed, "the catch releases its own model resources");
});
