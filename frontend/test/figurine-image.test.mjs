import assert from "node:assert/strict";
import test from "node:test";
import { loadFigurineImage } from "../src/lib/figurine-image.ts";

function fixture(t) {
  const original = globalThis.Image, images = [];
  globalThis.Image = class { src = ""; constructor() { images.push(this); } };
  t.after(() => { if (original === undefined) delete globalThis.Image; else globalThis.Image = original; });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  return images;
}
test("a stalled decorative image settles at its deadline and cannot repaint later", async (t) => {
  const images = fixture(t), pending = loadFigurineImage("/clouds.jpg", undefined, 8000);
  const lateLoad = images[0].onload;
  t.mock.timers.tick(8000);
  assert.equal(await pending, null);
  assert.equal(images[0].src, "");
  lateLoad();
  assert.equal(images[0].onload, null);
});
test("successful images cancel their deadline; failures and disposal settle immediately", async (t) => {
  const images = fixture(t), controller = new AbortController();
  const loaded = loadFigurineImage("/grass.png"); images[0].onload();
  assert.equal(await loaded, images[0]); t.mock.timers.tick(8000); assert.equal(images[0].src, "/grass.png");
  const failed = loadFigurineImage("/missing.png"); images[1].onerror(); assert.equal(await failed, null);
  const aborted = loadFigurineImage("/plaza.png", controller.signal); controller.abort(); assert.equal(await aborted, null);
  assert.equal(await loadFigurineImage("/unused.png", controller.signal), null);
  assert.equal(images.length, 3);
});
