import assert from "node:assert/strict";
import test from "node:test";
import { Texture } from "three";
import { createBoxPrints, PACKAGING_FALLBACK, PACKAGING_THEMES } from "../src/lib/figurine-packaging.ts";

// Record the real print renderer's source rectangles without requiring WebGL.
function canvas() {
  const calls = [];
  const context = new Proxy({
    calls,
    drawImage: (...args) => calls.push(args),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
  }, { get: (target, key) => target[key] ?? (() => {}) });
  return { getContext: () => context };
}

test("close-up box artwork keeps its detail while finish masks have a smaller memory budget", (t) => {
  const previous = globalThis.document;
  t.after(() => { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; });
  globalThis.document = { createElement: canvas };
  const design = { labels: { ...PACKAGING_FALLBACK, title: "Archive", subtitle: "Series" }, lineup: [], theme: PACKAGING_THEMES.amethyst };
  const prints = createBoxPrints(design, new Texture());
  assert.deepEqual([prints.front.map.image.width, prints.front.map.image.height], [1025, 1375]);
  assert.deepEqual([prints.front.roughnessMap.image.width, prints.front.roughnessMap.image.height], [513, 688]);
  assert.equal(prints.front.roughnessMap, prints.front.metalnessMap);
  assert.equal(prints.front.roughnessMap, prints.front.bumpMap);
  const shelf = createBoxPrints(design, new Texture(), 150);
  assert.deepEqual([shelf.front.map.image.width, shelf.front.roughnessMap.image.width], [308, 308]);
});

test("packaging readiness waits for the final silhouette repaint", async (t) => {
  const previous = { document: globalThis.document, Image: globalThis.Image };
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  });
  globalThis.document = { createElement: canvas };
  let decode;
  globalThis.Image = class {
    naturalWidth = 2240; naturalHeight = 720;
    decode() { return new Promise((resolve) => { decode = resolve; }); }
  };
  const prints = createBoxPrints({ labels: PACKAGING_FALLBACK, lineup: Array(16).fill("Figure"), theme: PACKAGING_THEMES.amethyst, silhouettes: "/atlas.png" }, new Texture());
  let ready = false;
  void prints.ready.then(() => { ready = true; });
  await Promise.resolve();
  assert.equal(ready, false);
  assert.equal(prints.back.map.image.getContext("2d").calls.length, 0);
  decode(); await prints.ready;
  assert.equal(ready, true);
  assert.equal(prints.back.map.image.getContext("2d").calls.length, 16);
});

for (const [width, height] of [[1600, 720], [2240, 720], [1120, 360]]) {
  test(`box prints isolate all 16 figures from a ${width}×${height} atlas`, async (t) => {
    const previous = { document: globalThis.document, Image: globalThis.Image };
    t.after(() => {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
      }
    });
    globalThis.document = { createElement: canvas };
    globalThis.Image = class {
      naturalWidth = width;
      naturalHeight = height;
      decode() { return Promise.resolve(); }
    };
    const prints = createBoxPrints({
      labels: { ...PACKAGING_FALLBACK, title: "Guild Archive", subtitle: "Series 002" },
      lineup: Array.from({ length: 16 }, (_, i) => `Figure ${i}`),
      theme: PACKAGING_THEMES.verdigris,
      silhouettes: "/atlas.png",
    }, new Texture());
    await Promise.resolve();
    const calls = (face) => prints[face].map.image.getContext("2d").calls;
    assert.equal(calls("back").length, 16);
    for (const [index, [, x, y, w, h, , , dw, dh]] of calls("back").entries()) {
      assert.deepEqual([x, y, w, h], [index % 8 * width / 8, Math.floor(index / 8) * height / 2, width / 8, height / 2]);
      assert.ok(Math.abs(dw / dh - w / h) < 1e-9, "preserve the silhouette's aspect ratio");
    }
    // Side panels and front previews must use the same complete, isolated cells.
    for (const face of ["front", "left", "right"]) for (const [, x, y, w, h] of calls(face)) {
      assert.equal(w, width / 8);
      assert.equal(h, height / 2);
      assert.ok(x >= 0 && y >= 0 && x + w <= width && y + h <= height);
    }
    assert.equal(calls("left").length + calls("right").length, 16);
    prints.stop();
    for (const material of Object.values(prints)) if (material?.isMaterial) material.dispose();
  });
}
