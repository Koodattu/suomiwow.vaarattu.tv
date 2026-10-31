import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { applyFinish, releaseFinishes } from "../src/lib/figurine-finish.ts";

test("lab alternatives remain separate from game finishes and restore the source materials", () => {
  const texture = new THREE.Texture();
  const source = new THREE.MeshStandardMaterial({ map: texture, color: 0x6789ab, alphaTest: .5, side: THREE.DoubleSide });
  const glow = new THREE.MeshBasicMaterial({ blending: THREE.AdditiveBlending });
  const root = new THREE.Group(), mesh = new THREE.Mesh(new THREE.BoxGeometry(), [source, glow]);
  root.add(mesh);
  const created = new Set();
  for (const quality of ["golden", "galaxy"]) {
    applyFinish(root, quality);
    const originalFinish = mesh.material;
    applyFinish(root, quality, null, true);
    const alternative = mesh.material;
    assert.notEqual(alternative[0], originalFinish[0]);
    assert.equal(alternative[0].map, texture);
    assert.equal(alternative[0].alphaTest, source.alphaTest);
    assert.equal(alternative[0].side, source.side);
    assert.equal(alternative[1], glow);
    applyFinish(root, quality);
    assert.equal(mesh.material, originalFinish, "default callers still get the original finish");
    applyFinish(root, quality, null, true);
    assert.equal(mesh.material, alternative, "toggling reuses the alternative material");
    created.add(originalFinish[0]); created.add(alternative[0]);
  }
  applyFinish(root, "standard", null, true);
  assert.deepEqual(mesh.material, [source, glow]);
  let disposed = 0, sourceDisposed = 0;
  for (const material of created) material.addEventListener("dispose", () => disposed++);
  for (const resource of [source, glow, texture]) resource.addEventListener("dispose", () => sourceDisposed++);
  releaseFinishes(root);
  assert.equal(disposed, 4);
  assert.equal(sourceDisposed, 0);
  assert.deepEqual(mesh.material, [source, glow]);
});
