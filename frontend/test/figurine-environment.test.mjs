import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import test from "node:test";
import { REVISION } from "three";

test("the baked studio contains a complete finite half-float atlas for this Three.js revision", async () => {
  const manifest = JSON.parse(await readFile(new URL("../src/data/figurines/environment.json", import.meta.url)));
  assert.equal(manifest.version, REVISION, "rebake studio reflections when upgrading Three.js");
  assert.equal(manifest.width, 768); assert.equal(manifest.height, 1024);
  const compressed = await readFile(new URL(`../public${manifest.url}`, import.meta.url));
  assert.ok(manifest.url.includes(createHash("sha256").update(compressed).digest("hex").slice(0, 20)));
  const pixels = gunzipSync(compressed);
  assert.equal(pixels.length, manifest.width * manifest.height * 8);
  let lit = 0;
  for (let offset = 0; offset < pixels.length; offset += 2) {
    const half = pixels.readUInt16LE(offset);
    assert.notEqual(half & 0x7c00, 0x7c00, "no infinite/NaN lighting samples");
    if (half) lit++;
  }
  assert.ok(lit > manifest.width * manifest.height, "the atlas must contain lighting");
});
