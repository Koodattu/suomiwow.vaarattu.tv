import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { createFigurineFileCache, createFigurineResourceCache, disposeFigurineObject, figurineResourceBytes } from "../src/lib/figurine-cache.ts";

test("preloading and selecting a model share a download and keep its File for later rounds", async (t) => {
  let downloads = 0;
  t.mock.method(globalThis, "fetch", async () => { downloads++; return new Response(new Uint8Array([1, 2, 3])); });
  const cache = createFigurineFileCache(); t.after(() => cache.dispose());
  const preload = cache.get("/figure.glb?v=1", 3);
  assert.equal(cache.get("/figure.glb?v=1", 3), preload);
  const file = await preload;
  assert.equal(file.size, 3);
  assert.equal(await cache.get("/figure.glb?v=1", 3), file);
  assert.equal(downloads, 1);
  await cache.get("/figure.glb?v=2", 3);
  assert.equal(downloads, 2, "content versions must not reuse old assets");
});

test("an incomplete download is not cached as ready and can be retried", async (t) => {
  let downloads = 0;
  t.mock.method(globalThis, "fetch", async () => new Response(new Uint8Array(++downloads === 1 ? 1 : 3)));
  const cache = createFigurineFileCache(); t.after(() => cache.dispose());
  await assert.rejects(cache.get("/figure.glb", 3), /Incomplete model/);
  assert.equal((await cache.get("/figure.glb", 3)).size, 3);
  assert.equal(downloads, 2);
});

test("leaving the page aborts outstanding model downloads", async (t) => {
  t.mock.method(globalThis, "fetch", (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  }));
  const cache = createFigurineFileCache();
  const pending = cache.get("/figure.glb", 3);
  cache.dispose();
  await assert.rejects(pending, { name: "AbortError" });
});

test("prepared resources use LRU eviction, protect the active model, and dispose only once", () => {
  const disposed = [];
  const cache = createFigurineResourceCache(100, (value) => disposed.push(value));
  cache.set("a", "A", 40); cache.set("b", "B", 40);
  assert.equal(cache.get("a"), "A");
  cache.set("c", "C", 40); cache.trim("c");
  assert.equal(cache.get("b"), undefined);
  assert.deepEqual(disposed, ["B"]);
  assert.equal(cache.get("a"), "A");
  cache.set("large", "L", 120); cache.trim("large");
  assert.equal(cache.get("large"), "L", "one oversized active model must remain usable");
  assert.deepEqual(new Set(disposed), new Set(["A", "B", "C"]));
  cache.dispose(); cache.dispose();
  assert.equal(disposed.length, 4);
});

test("the resource budget counts decoded pixels and unique buffers, not GLB transfer size", () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(9), 3));
  const map = new THREE.Texture({ width: 1024, height: 1024 });
  const material = new THREE.MeshStandardMaterial({ map, roughnessMap: map });
  const root = new THREE.Group();
  root.add(new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, material));
  assert.equal(figurineResourceBytes(root), 36 + 1024 * 1024 * 4 * 4 / 3);
});

test("evicting a box preserves the shared reflection texture and frees its own resources once", () => {
  const reflection = new THREE.Texture(), print = new THREE.Texture();
  const geometry = new THREE.BoxGeometry();
  const material = new THREE.MeshStandardMaterial({ map: print, envMap: reflection });
  const root = new THREE.Group(); root.add(new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, material));
  const disposed = [];
  for (const [name, resource] of Object.entries({ reflection, print, geometry, material })) resource.addEventListener("dispose", () => disposed.push(name));
  disposeFigurineObject(root, new Set([reflection]));
  assert.deepEqual(disposed.sort(), ["geometry", "material", "print"]);
});

test("KTX2 budgets use device-transcoded mip payloads and count shared maps once", () => {
  const map = new THREE.CompressedTexture([
    { data: new Uint8Array(64), width: 8, height: 8 },
    { data: new Uint8Array(16), width: 4, height: 4 },
    { data: new Uint8Array(16), width: 2, height: 2 },
    { data: new Uint8Array(16), width: 1, height: 1 },
  ], 8, 8, THREE.RGBA_BPTC_Format);
  const geometry = new THREE.BufferGeometry();
  const material = new THREE.MeshStandardMaterial({ map, emissiveMap: map });
  const root = new THREE.Group(); root.add(new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, material));
  assert.equal(figurineResourceBytes(root), 112);
});

test("uncompressed data textures without generated mipmaps count their actual payload", () => {
  const map = new THREE.DataTexture(new Uint16Array(16), 2, 2, THREE.RGBAFormat, THREE.HalfFloatType);
  const root = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ map }));
  assert.equal(figurineResourceBytes(root), 32);
});
