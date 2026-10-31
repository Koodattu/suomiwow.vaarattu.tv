import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { figurineBodyBounds, figurineScale, FIGURE_HEIGHT, FIGURE_WIDTH, figurineGround, figurineSupport, restoreFigurineMaterials } from "../src/lib/figurine-materials.ts";

test("attached weapons and wings do not shrink the character's display height", () => {
  const root = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 0.6)); body.position.y = 1; root.add(body);
  const baseline = figurineScale(figurineBodyBounds(root));
  const item = new THREE.Group(); item.name = "Main-hand_Item123";
  item.add(new THREE.Mesh(new THREE.BoxGeometry(8, 12, 1))); root.add(item);
  root.rotation.y = -Math.PI / 2;
  const bounds = figurineBodyBounds(root);
  assert.equal(figurineScale(bounds), baseline);
  assert.ok(Math.abs(bounds.getSize(new THREE.Vector3()).y * baseline - FIGURE_HEIGHT) < 1e-6);
});

test("wide poses retain their proportions and fit the pedestal width", () => {
  const bounds = new THREE.Box3(new THREE.Vector3(-4, 0, -1), new THREE.Vector3(4, 2, 1));
  const scale = figurineScale(bounds);
  assert.equal(scale * 8, FIGURE_WIDTH);
  assert.ok(scale * 2 < FIGURE_HEIGHT);
  assert.ok(Number.isFinite(figurineScale(new THREE.Box3(new THREE.Vector3(), new THREE.Vector3()))));
});

test("source-tagged glow uses the original additive factors without changing dark armor", () => {
  for (const mode of [3, 4]) {
    const scene = new THREE.Group();
    const map = new THREE.Texture();
    const source = new THREE.MeshStandardMaterial({ map });
    source.userData.wowM2 = { version: 1, blendingMode: mode, flags: 1 };
    const armor = new THREE.MeshStandardMaterial({ color: 0x000000 });
    const first = new THREE.Mesh(new THREE.PlaneGeometry(), [source, armor]);
    const second = new THREE.Mesh(new THREE.PlaneGeometry(), source);
    scene.add(first, second);
    restoreFigurineMaterials(scene);
    const effect = first.material[0];
    assert.ok(effect instanceof THREE.MeshBasicMaterial);
    assert.equal(effect.map, map);
    assert.equal(effect, second.material);
    assert.equal(first.material[1], armor);
    assert.equal(effect.blendSrc, mode === 3 ? THREE.OneFactor : THREE.SrcAlphaFactor);
    assert.equal(effect.blendDst, THREE.OneFactor);
    assert.equal(effect.depthWrite, false);
    assert.equal(effect.blending, THREE.CustomBlending);
    assert.equal(effect.blendSrcAlpha, THREE.ZeroFactor);
    assert.equal(effect.blendDstAlpha, THREE.OneFactor);
  }
});

test("body-ground anchor takes precedence over a weapon's lower bounds", () => {
  assert.equal(figurineGround({ version: 1, groundY: 0.04 }, -0.5), 0.04);
  for (const metadata of [undefined, {}, { version: 2, groundY: 0 }, { version: 1, groundY: NaN }])
    assert.equal(figurineGround(metadata, -0.5), -0.5);
});

test("stance anchor follows the viewer rotation and ignores asymmetric weapon bounds", () => {
  const root = new THREE.Group();
  root.rotation.y = -Math.PI / 2;
  root.userData.wowCharacter = { version: 1, groundY: 0.04, centerX: 2, centerZ: 3 };
  const bounds = new THREE.Box3(new THREE.Vector3(-20, -4, -10), new THREE.Vector3(10, 8, 6));
  const support = figurineSupport(root, bounds);
  assert.ok(support.distanceTo(new THREE.Vector3(-3, 0.04, 2)) < 1e-6);
  root.userData.wowCharacter = { version: 1, groundY: 0.04 };
  assert.deepEqual(figurineSupport(root, bounds).toArray(), [-5, 0.04, -2]);
  delete root.userData.wowCharacter;
  assert.deepEqual(figurineSupport(root, bounds).toArray(), [-5, -4, -2]);
});
