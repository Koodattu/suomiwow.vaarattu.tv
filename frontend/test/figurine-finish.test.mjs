import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { applyFinish, releaseFinishes } from "../src/lib/figurine-finish.ts";
import { restoreFigurineMaterials } from "../src/lib/figurine-materials.ts";

test("game finishes retain armour maps, cache each quality and restore the source materials", () => {
  const texture = new THREE.Texture();
  const source = new THREE.MeshStandardMaterial({ map: texture, color: 0x6789ab, alphaTest: .5, side: THREE.DoubleSide });
  const glow = new THREE.MeshBasicMaterial({ blending: THREE.AdditiveBlending });
  const root = new THREE.Group(), mesh = new THREE.Mesh(new THREE.BoxGeometry(), [source, glow]);
  root.add(mesh);
  const created = new Set();
  for (const quality of ["golden", "galaxy"]) {
    applyFinish(root, quality);
    const finish = mesh.material;
    assert.notEqual(finish[0], source);
    assert.equal(finish[0].map, texture);
    assert.equal(finish[0].alphaTest, source.alphaTest);
    assert.equal(finish[0].side, source.side);
    assert.equal(finish[1], glow, "untagged blended materials stay unchanged");
    applyFinish(root, "standard");
    assert.deepEqual(mesh.material, [source, glow]);
    applyFinish(root, quality);
    assert.equal(mesh.material, finish, "toggling reuses the finish material");
    created.add(finish[0]);
  }
  applyFinish(root, "standard");
  assert.deepEqual(mesh.material, [source, glow]);
  let disposed = 0, sourceDisposed = 0;
  for (const material of created) material.addEventListener("dispose", () => disposed++);
  for (const resource of [source, glow, texture]) resource.addEventListener("dispose", () => sourceDisposed++);
  releaseFinishes(root);
  assert.equal(disposed, 2);
  assert.equal(sourceDisposed, 0);
  assert.deepEqual(mesh.material, [source, glow]);
});

test("game finishes recolour WoW glows while retaining additive transparency and restoring original effects", () => {
  for (const blendingMode of [3, 4]) {
    const texture = new THREE.Texture();
    const exported = new THREE.MeshStandardMaterial({ map: texture, opacity: .6, side: THREE.DoubleSide });
    exported.userData.wowM2 = { version: 1, blendingMode };
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(), exported);
    restoreFigurineMaterials(mesh);
    const original = mesh.material;
    const finishes = [];
    for (const quality of ["golden", "galaxy"]) {
      applyFinish(mesh, quality);
      const finish = mesh.material;
      assert.notEqual(finish, original);
      assert.ok(finish instanceof THREE.MeshBasicMaterial, "effects remain unlit light cards");
      for (const property of ["map", "opacity", "side", "transparent", "depthWrite", "depthTest", "toneMapped", "blending", "blendSrc", "blendDst", "blendEquation", "blendSrcAlpha", "blendDstAlpha", "blendEquationAlpha"]) {
        assert.equal(finish[property], original[property], property);
      }
      finishes.push(finish);
      applyFinish(mesh, "standard");
      assert.equal(mesh.material, original);
      applyFinish(mesh, quality);
      assert.equal(mesh.material, finish, "toggling reuses the glow material");
    }
    let disposed = 0, originalDisposed = 0;
    finishes.forEach(finish => finish.addEventListener("dispose", () => disposed++));
    original.addEventListener("dispose", () => originalDisposed++);
    texture.addEventListener("dispose", () => originalDisposed++);
    releaseFinishes(mesh);
    assert.equal(mesh.material, original);
    assert.equal(disposed, 2);
    assert.equal(originalDisposed, 0);
  }
});
