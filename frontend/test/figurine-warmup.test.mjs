import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { warmFigurineScene } from "../src/lib/figurine-warmup.ts";

function fixture() {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  const hidden = new THREE.Group(); hidden.visible = false; scene.add(hidden);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()); hidden.add(mesh);
  const target = new THREE.WebGLRenderTarget(1, 1);
  let bound = null;
  const pending = [], calls = [];
  const renderer = {
    getRenderTarget: () => bound,
    setRenderTarget: (value) => { bound = value; },
    compileAsync: () => {
      calls.push(["compile", bound, hidden.visible, mesh.frustumCulled]);
      return new Promise((resolve) => pending.push(resolve));
    },
    render: () => { calls.push(["render", bound, hidden.visible, mesh.frustumCulled]); },
  };
  return { scene, camera, hidden, mesh, target, renderer, pending, calls };
}

test("readiness includes a hidden first draw and canvas shaders, without exposing the model while waiting", async () => {
  const f = fixture();
  let ready = false;
  const loading = warmFigurineScene(f.renderer, f.scene, f.camera, f.target, () => true).then((result) => { ready = result; });
  assert.equal(f.hidden.visible, false);
  assert.equal(f.mesh.frustumCulled, true);
  assert.equal(f.renderer.getRenderTarget(), null);
  assert.equal(ready, false);
  f.pending.shift()();
  await Promise.resolve();
  assert.deepEqual(f.calls, [
    ["compile", f.target, true, false],
    ["render", f.target, true, false],
    ["compile", null, true, false],
  ]);
  assert.equal(f.hidden.visible, false);
  assert.equal(ready, false);
  f.pending.shift()();
  await loading;
  assert.equal(ready, true);
});

test("a replaced or disposed model never renders or becomes ready after compilation", async () => {
  const f = fixture();
  let current = true;
  const loading = warmFigurineScene(f.renderer, f.scene, f.camera, f.target, () => current);
  current = false;
  f.pending.shift()();
  assert.equal(await loading, false);
  assert.equal(f.calls.length, 1);
  assert.equal(f.hidden.visible, false);
});

test("a failed first draw restores scene visibility and the render target", async () => {
  const f = fixture();
  f.renderer.render = () => { throw new Error("draw failed"); };
  const loading = warmFigurineScene(f.renderer, f.scene, f.camera, f.target, () => true);
  f.pending.shift()();
  await assert.rejects(loading, /draw failed/);
  assert.equal(f.renderer.getRenderTarget(), null);
  assert.equal(f.hidden.visible, false);
  assert.equal(f.mesh.frustumCulled, true);
});

test("warming a new figure excludes world geometry while preserving scene lights and visibility", async () => {
  const f = fixture();
  const world = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  const light = new THREE.PointLight();
  const station = new THREE.Group(); station.visible = false; station.add(light, world); f.scene.add(station);
  f.renderer.compileAsync = async (root, camera, scene) => {
    assert.equal(root, f.hidden); assert.equal(scene, f.scene); assert.equal(camera, f.camera);
    assert.equal(world.visible, false); assert.equal(light.visible, true); assert.equal(station.visible, true);
  };
  f.renderer.render = () => { assert.equal(world.visible, false); assert.equal(f.mesh.visible, true); };
  assert.equal(await warmFigurineScene(f.renderer, f.scene, f.camera, f.target, () => true, f.hidden), true);
  assert.equal(world.visible, true); assert.equal(station.visible, false); assert.equal(f.hidden.visible, false);
});
