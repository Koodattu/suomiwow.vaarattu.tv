import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { isOverlayStation } from "../src/lib/figurine-facility-views.ts";

// Exercise the stage's actual director without starting React or a WebGL renderer.
const source = await readFile(new URL("../src/app/tools/figurine-lab/FigurineStage.tsx", import.meta.url), "utf8");
const start = source.indexOf('      for (const key of ["yaw", "pitch", "zoom", "panX", "panY"]');
const end = source.indexOf("      const introducing =", start);
assert.ok(start >= 0 && end > start);
const step = new vm.Script(`{${ts.transpile(source.slice(start, end))}}`);

function cameraState(view, idle, reduced = false, width = 1200) {
  const pose = { position: new THREE.Vector3(8, 4, 12), target: new THREE.Vector3(8, 1, 3) };
  const look = { yaw: 0, pitch: 0, zoom: 1, panX: 0, panY: 0 };
  return vm.createContext({
    state: { current: {} },
    THREE, isOverlayStation, active: false, orbitOffset: null, build: { zoom: 1 }, immersive: true, currentView: view, centreShot: null, overviewShot: null, framing: 1, isStation: view => view !== "overview" && view !== "opening" && view !== "viewer", isShot: view => view !== "overview" && view !== "opening" && view !== "viewer",
    homeOffset: new THREE.Vector3(0.6, 2.1, 9.6), homeTarget: new THREE.Vector3(0, 1.5, 0),
    OVERVIEW_DISTANCE: { min: 13, initial: 17, max: 19 },
    shotAspect: () => 1, viewPose: () => ({ position: pose.position.clone(), target: pose.target.clone() }),
    look, lookTarget: { ...look }, screen: new THREE.Vector3(), velocity: new THREE.Vector3(), Y_AXIS: new THREE.Vector3(0, 1, 0),
    renderer: { domElement: { clientWidth: width, clientHeight: 800 } }, PANEL_SHEET_WIDTH: 700, panelShare: () => 0.3,
    panelled: view => view === "gallery",
    camera: new THREE.PerspectiveCamera(36, width / 800), controls: { target: new THREE.Vector3() },
    flightFrom: new THREE.Spherical(), flightTo: new THREE.Spherical(),
    flight: { from: new THREE.Vector3(0, 3, 9), fromTarget: new THREE.Vector3(0, 1.5, 0), t: 1 },
    FLIGHT_SECONDS: Number(source.match(/const FLIGHT_SECONDS = ([\d.]+)/)[1]), ease: t => t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2,
    elapsed: 1 / 60, delta: 1 / 60, idle, reduced,
  });
}

test("facility flight and settled view meet at the same camera pose", () => {
  for (const view of ["shop", "gallery", "recycler", "forge", "crate", "wheel", "mail", "quests", "feed", "fame", "leaderboard", "trading", "merchant", "pond"]) for (const width of [600, 1200]) for (const idle of [2, 17, 100]) {
    const state = cameraState(view, idle, false, width);
    step.runInContext(state);
    assert.equal(state.flight, null);
    const arrival = state.camera.position.clone(), target = state.controls.target.clone();
    step.runInContext(state);
    assert.ok(arrival.distanceTo(state.camera.position) < 1e-9, `${view}: arrival must match held pose at time ${idle}`);
    assert.ok(target.distanceTo(state.controls.target) < 1e-9);
    state.idle += 1 / 60;
    step.runInContext(state);
    assert.ok(arrival.distanceTo(state.camera.position) < 0.001, `${view}: next frame should only advance gentle sway`);
  }
});

test("reduced motion holds a stationary facility shot after arrival", () => {
  const state = cameraState("quests", 2, true);
  step.runInContext(state);
  const arrival = state.camera.position.clone();
  state.idle = 100;
  step.runInContext(state);
  assert.ok(arrival.distanceTo(state.camera.position) < 1e-9);
});

test("overview returns to the saved orbit and leaves manual rotation and zoom untouched", () => {
  const state = cameraState("overview", 2);
  state.overviewShot = { position: new THREE.Vector3(-32, 28, -24), target: new THREE.Vector3(0, -4.5, 2) };
  step.runInContext(state);
  assert.ok(state.camera.position.distanceTo(state.overviewShot.position) < 1e-9);
  state.camera.position.set(20, 30, -40);
  const moved = state.camera.position.clone();
  step.runInContext(state);
  assert.ok(state.camera.position.equals(moved), "the director does not reset the overview camera each frame");
});

test("overview introduction descends from above without moving out into the trees", () => {
  const from = source.indexOf("      const introducing ="), to = source.indexOf("      // Cinematic camera:", from);
  const introduce = new vm.Script(`{${ts.transpile(source.slice(from, to))}}`);
  const state = cameraState("overview", 0);
  const target = new THREE.Vector3(0, 1.5, 0), offset = state.homeOffset.clone().setLength(17);
  Object.assign(state, { flight: null, introClock: 0, INTRO_SECONDS: 3, introNotified: false, current: { ready: true }, callbacks: { current: {} }, destination: { position: offset.clone().add(target), target } });
  introduce.runInContext(state);
  const startDistance = state.camera.position.distanceTo(state.controls.target);
  assert.ok(state.camera.position.y > state.destination.position.y + 15, "entrance starts above the clearing");
  let previousHeight = state.camera.position.y;
  for (let i = 0; i < 190; i++) {
    introduce.runInContext(state);
    assert.ok(Math.hypot(state.camera.position.x - target.x, state.camera.position.z - target.z) < 17, "the whole approach stays inside the clearing");
    assert.ok(state.camera.position.y <= previousHeight + 1e-9, "the camera descends smoothly");
    previousHeight = state.camera.position.y;
  }
  assert.ok(startDistance > state.camera.position.distanceTo(state.controls.target) * 1.3);
  assert.ok(Math.abs(state.camera.position.distanceTo(state.controls.target) - state.destination.position.distanceTo(state.destination.target)) < 1e-6);
});

test("overview enables orbit and zoom, pauses automatic rotation after input, and respects reduced motion", () => {
  const from = source.indexOf("      const orbiting ="), to = source.indexOf("      // Timed by the frame delta", from);
  const orbit = new vm.Script(`{${ts.transpile(source.slice(from, to))}}`);
  const state = cameraState("overview", 0);
  Object.assign(state, { flight: null, introducing: false, active: false, finished: false, current: { rotate: true }, hovering: false, grab: null, shake: null, userOrbit: { holding: false, released: -Infinity }, now: 5000, AUTO_ROTATE_DELAY: 2.5, AUTO_ROTATE_SPEED: 0.6, autoRotate: 0 });
  orbit.runInContext(state);
  assert.equal(state.controls.enabled, true);
  assert.equal(state.controls.autoRotate, true);
  assert.equal(state.controls.minDistance, 13);
  assert.equal(state.controls.maxDistance, 19);
  state.framing = 1.6; orbit.runInContext(state);
  assert.equal(state.controls.maxDistance, 19, "portrait framing cannot push the orbit into the trees");
  assert.ok(state.controls.maxPolarAngle >= Math.acos(state.homeOffset.y / state.homeOffset.length()), "orbit limits allow the opening camera's angle");
  state.userOrbit.released = state.now;
  orbit.runInContext(state);
  assert.equal(state.controls.autoRotate, false);
  state.userOrbit.released = -Infinity; state.reduced = true;
  orbit.runInContext(state);
  assert.equal(state.controls.autoRotate, false);
  assert.equal(state.controls.enabled, true, "manual camera controls remain available with reduced motion");
});

test("pond look-around clamps both axes while keeping the camera above the water", () => {
  const from = source.indexOf("    const lookLimits ="), to = source.indexOf("    controls.mouseButtons.MIDDLE", from);
  const steer = new vm.Script(`${ts.transpile(source.slice(from, to))}\nsteer(dx, dy, { yaw: 0, pitch: 0 });`);
  for (const direction of [-1, 1]) {
    const state = cameraState("pond", 0, true);
    Object.assign(state, { state: { current: { view: "pond" } }, panning: () => false, dx: direction * 10000, dy: direction * 10000 });
    steer.runInContext(state);
    assert.equal(Math.abs(state.lookTarget.yaw), 0.55);
    assert.equal(Math.abs(state.lookTarget.pitch), 0.22);
    for (let i = 0; i < 120; i++) step.runInContext(state);
    assert.ok(state.camera.position.y > state.controls.target.y, "the lowest pond angle remains above its target");
  }
});

test("dragging the pond and returning to the starting point does not cast on release", () => {
  const from = source.indexOf("    const onPointerMove ="), to = source.indexOf("    const clearPartHover =", from);
  const handlers = new vm.Script(`${ts.transpile(source.slice(from, to))}\nonPointerMove({ buttons: 1, clientX: 120, clientY: 50 });\nonPointerMove({ buttons: 1, clientX: 50, clientY: 50 });\nletGo({ type: 'pointerup', clientX: 50, clientY: 50 });`);
  let casts = 0, turns = 0;
  handlers.runInNewContext({
    aim() {}, grab: null, shake: null, looking: null, immersive: true,
    press: { x: 50, y: 50, moved: false, pick: { kind: "part", station: "pond", part: "water" } },
    panning: () => false, directed: () => true, state: { current: { view: "pond" } },
    steer: () => { turns++; }, pickAt: () => ({ kind: "part", station: "pond", part: "water" }), samePick: () => true,
    unlockFigurineAudio() {}, callbacks: { current: { onFacilityPart: () => { casts++; } } },
  });
  assert.equal(turns, 2); assert.equal(casts, 0);
});

// Include the real orbit update: testing the director alone misses constraints applied afterwards.
const orbitStart = source.indexOf("      const orbiting =");
const orbitEnd = source.indexOf("      if (scenery)", orbitStart);
const finishCamera = new vm.Script(`{${ts.transpile(source.slice(orbitStart, orbitEnd))}}`);
function withOrbit(state) {
  state.controls = new OrbitControls(state.camera, null);
  Object.assign(state, { introducing: false, active: false, finished: false, current: { rotate: false }, hovering: false, grab: null, shake: null, userOrbit: { holding: false, released: -Infinity }, now: 5000, AUTO_ROTATE_DELAY: 2.5, AUTO_ROTATE_SPEED: 0.6, autoRotate: 0, mixer: null });
  return state;
}

test("return from a close chest shot never jumps to the overview's minimum orbit distance", () => {
  const state = withOrbit(cameraState("overview", 0, true));
  state.reduced = false;
  state.overviewShot = { position: new THREE.Vector3(0, 5, 16), target: new THREE.Vector3(0, 1.5, 0) };
  state.flight = { from: new THREE.Vector3(-3, 2, -5), fromTarget: new THREE.Vector3(-3, 1, -11), t: 0 };
  state.camera.position.copy(state.flight.from); state.controls.target.copy(state.flight.fromTarget);
  let previous = state.camera.position.clone();
  for (let frame = 0; frame < Math.ceil(state.FLIGHT_SECONDS * 60) + 5; frame++) {
    step.runInContext(state); finishCamera.runInContext(state);
    assert.ok(state.camera.position.distanceTo(previous) < 0.9, `no single-frame jump at frame ${frame}`);
    if (frame === 0) assert.ok(state.camera.position.distanceTo(state.controls.target) < 6.1, "departure retains the close-up distance");
    previous.copy(state.camera.position);
  }
  assert.ok(state.camera.position.distanceTo(state.overviewShot.position) < 1e-9);
});

test("opposite-side flights preserve viewing distance and turn smoothly instead of crossing the focus", () => {
  const state = withOrbit(cameraState("overview", 0, true));
  state.reduced = false;
  state.overviewShot = { position: new THREE.Vector3(0, 3, 16), target: new THREE.Vector3() };
  state.flight = { from: new THREE.Vector3(0, 3, -16), fromTarget: new THREE.Vector3(), t: 0 };
  state.camera.position.copy(state.flight.from); state.camera.lookAt(state.flight.fromTarget);
  let previous = state.camera.quaternion.clone();
  for (let frame = 0; frame < Math.ceil(state.FLIGHT_SECONDS * 60) + 5; frame++) {
    step.runInContext(state); finishCamera.runInContext(state);
    assert.ok(state.camera.position.distanceTo(state.controls.target) >= 16, "the view never collapses onto the focus");
    assert.ok(previous.angleTo(state.camera.quaternion) < 0.18, "rotation stays continuous through the halfway point");
    previous.copy(state.camera.quaternion);
  }
});

test("within a district the camera leans quietly, with no arc and no whoosh", () => {
  const from = source.indexOf('      if (immersive && current.view !== currentView)');
  const navigate = new vm.Script(`{${ts.transpile(source.slice(from, source.indexOf('      if (current.arrival !== seenArrival)', from)))}}`);
  for (const lean of [true, false]) {
    const cues = [], state = withOrbit(cameraState("yard", 0));
    Object.assign(state, { sameDistrict: () => lean, centre: () => false, current: { view: "forge" }, orbitOffset: null, introClock: 3, INTRO_SECONDS: 3, displayClock: 0, press: null, looking: null, heldTarget: new THREE.Vector2(), peelSound: null, grab: null, shake: null, autoRotate: 1, clearPartHover() {}, reducedMotion: { matches: false }, playFigurineCue: (cue) => cues.push(cue) });
    state.flight = null;
    navigate.runInContext(state);
    assert.equal(state.flight.lean, lean);
    assert.deepEqual(cues, lean ? [] : ["whoosh"]);
  }
  const height = (lean) => {
    const state = cameraState("forge", 2);
    Object.assign(state, { LEAN_SECONDS: 0.8 });
    state.flight.lean = lean; state.flight.t = 0.4;
    step.runInContext(state);
    return state.camera.position.y;
  };
  assert.ok(height(false) - height(true) > 0.5, "a lean does not rise over the arc of a flight");
});

test("interrupting a return flight preserves the saved overview and clears orbit inertia", () => {
  const from = source.indexOf('      if (immersive && current.view !== currentView)');
  const to = source.indexOf('      if (current.arrival !== seenArrival)', from);
  const navigate = new vm.Script(`{${ts.transpile(source.slice(from, to))}}`);
  const state = withOrbit(cameraState("overview", 0));
  const saved = { position: new THREE.Vector3(0, 5, 16), target: new THREE.Vector3(0, 1.5, 0) };
  Object.assign(state, { sameDistrict: () => false, overviewShot: saved, current: { view: "crate" }, orbitOffset: null, introClock: 3, INTRO_SECONDS: 3, displayClock: 0, press: null, looking: null, heldTarget: new THREE.Vector2(), peelSound: null, clearPartHover() {}, reducedMotion: { matches: true } });
  state.flight.t = 0.4;
  state.camera.position.set(3, 4, 5); state.controls.target.set(1, 1, 1);
  const departure = state.camera.position.clone();
  navigate.runInContext(state);
  assert.equal(state.overviewShot, saved, "a partial return must not overwrite the user's overview orbit");
  assert.ok(state.flight.from.equals(departure));
  assert.ok(state.camera.position.equals(departure));
  assert.equal(state.autoRotate, 0);
});

test("destination sway across the opposite-angle seam never reverses an ongoing turn", () => {
  const state = withOrbit(cameraState("overview", 0));
  state.overviewShot = { position: new THREE.Vector3(0.002, 3, -16), target: new THREE.Vector3() };
  state.flight = { from: new THREE.Vector3(0, 3, 16), fromTarget: new THREE.Vector3(), t: 0 };
  state.camera.position.copy(state.flight.from); state.camera.lookAt(state.flight.fromTarget);
  let previous = state.camera.quaternion.clone();
  for (let frame = 0; frame < Math.ceil(state.FLIGHT_SECONDS * 60); frame++) {
    state.overviewShot.position.x = frame % 2 ? -0.002 : 0.002;
    step.runInContext(state); finishCamera.runInContext(state);
    assert.ok(previous.angleTo(state.camera.quaternion) < 0.18, `no reversed turn at frame ${frame}`);
    previous.copy(state.camera.quaternion);
  }
});

test("overview tape opening meets the charging camera without a zoom jump", () => {
  const state = cameraState("opening", 0);
  Object.assign(state, { active: true, finished: false, bursting: false, build: { zoom: 0.94 }, current: { boxMode: true, open: true }, centreShot: { position: new THREE.Vector3(-7, 4, -7), target: new THREE.Vector3(0, 1.5, 0) } });
  const from = source.indexOf("      const cinematic ="), to = source.indexOf("      const orbiting =", from);
  const cinematic = new vm.Script(`{${ts.transpile(source.slice(from, to))}}`);
  step.runInContext(state);
  const arrival = state.camera.position.clone();
  cinematic.runInContext(state);
  assert.ok(arrival.distanceTo(state.camera.position) < 1e-9, "arrival already matches the live charge zoom");
  step.runInContext(state); cinematic.runInContext(state);
  assert.ok(arrival.distanceTo(state.camera.position) < 1e-9, "the following cinematic frame does not double-zoom");
  assert.ok(Math.abs(state.camera.position.distanceTo(state.controls.target) / state.centreShot.position.distanceTo(state.centreShot.target) - 0.94) < 1e-9);
});
