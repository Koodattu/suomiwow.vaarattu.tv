import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import * as THREE from "three";

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
    THREE, immersive: true, currentView: view, centreShot: null, framing: 1, isStation: view => view !== "opening" && view !== "viewer",
    homeOffset: new THREE.Vector3(), homeTarget: new THREE.Vector3(),
    shotAspect: () => 1, viewPose: () => ({ position: pose.position.clone(), target: pose.target.clone() }),
    look, lookTarget: { ...look }, screen: new THREE.Vector3(), velocity: new THREE.Vector3(), Y_AXIS: new THREE.Vector3(0, 1, 0),
    renderer: { domElement: { clientWidth: width, clientHeight: 800 } }, PANEL_SHEET_WIDTH: 700, panelShare: () => 0.3,
    panelled: view => view !== "opening" && view !== "viewer" && view !== "shop" && view !== "pond",
    camera: new THREE.PerspectiveCamera(36, width / 800), controls: { target: new THREE.Vector3() },
    flight: { from: new THREE.Vector3(0, 3, 9), fromTarget: new THREE.Vector3(0, 1.5, 0), t: 1 },
    FLIGHT_SECONDS: 0.95, ease: t => t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2,
    elapsed: 1 / 60, delta: 1 / 60, idle, reduced,
  });
}

test("facility flight and settled view meet at the same camera pose", () => {
  for (const view of ["shop", "quests", "pond", "forge"]) for (const width of [600, 1200]) for (const idle of [2, 17, 100]) {
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
