import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

test("all collectible and world GLBs use embedded ETC1S with mipmaps and bounded texture payloads", async () => {
  const root = new URL("../public/figurines/", import.meta.url);
  const files = (await fs.readdir(root, { recursive: true })).filter(file => /^(community-|world[\\/])/.test(file) && file.endsWith(".glb"));
  assert.ok(files.length >= 112);
  for (const file of files) {
    const bytes = await fs.readFile(new URL(file.replaceAll("\\", "/"), root)), length = bytes.readUInt32LE(12);
    const doc = JSON.parse(bytes.subarray(20, 20 + length)), bin = bytes.subarray(28 + length);
    assert.ok(doc.extensionsRequired.includes("KHR_texture_basisu"), file);
    let residentBytes = 0;
    for (const image of doc.images) {
      assert.equal(image.mimeType, "image/ktx2", file); assert.equal(image.uri, undefined);
      const view = doc.bufferViews[image.bufferView], data = bin.subarray(view.byteOffset, view.byteOffset + view.byteLength);
      assert.deepEqual([...data.subarray(0, 12)], [171, 75, 84, 88, 32, 50, 48, 187, 13, 10, 26, 10]);
      assert.equal(data.readUInt32LE(44), 1, `${file}: ETC1S BasisLZ supercompression`);
      const width = data.readUInt32LE(20), height = data.readUInt32LE(24), levels = data.readUInt32LE(40);
      assert.equal(width & (width - 1), 0, `${file}: compatible compressed mip width`);
      assert.equal(height & (height - 1), 0, `${file}: compatible compressed mip height`);
      assert.equal(levels, Math.floor(Math.log2(Math.max(width, height))) + 1, file);
      for (let level = 0; level < levels; level++) residentBytes += Math.ceil(Math.max(1, width >> level) / 4) * Math.ceil(Math.max(1, height >> level) / 4) * 16;
    }
    if (file.startsWith("community-")) assert.ok(residentBytes <= 32 * 1024 * 1024, `${file}: 8-bpp GPU texture budget`);
  }
});

test("baked box textures have GPU-compatible dimensions throughout their mip chains", async () => {
  const manifest = JSON.parse(await fs.readFile(new URL("../src/data/figurines/packaging.json", import.meta.url)));
  const files = new Set(Object.values(manifest.designs).flatMap(sizes => Object.values(sizes).flatMap(maps => Object.values(maps))));
  for (const file of files) {
    const bytes = await fs.readFile(new URL(`../public/figurines/packaging/${file}`, import.meta.url));
    const width = bytes.readUInt32LE(20), height = bytes.readUInt32LE(24), levels = bytes.readUInt32LE(40);
    assert.equal(bytes.readUInt32LE(44), 1, `${file}: ETC1S`);
    assert.equal(levels, Math.floor(Math.log2(Math.max(width, height))) + 1, file);
    for (let level = 0; level < levels; level++) {
      for (const dimension of [Math.max(1, width >> level), Math.max(1, height >> level)]) {
        assert.ok(dimension === 1 || dimension === 2 || dimension % 4 === 0, `${file}: mip ${level} has invalid compressed dimension ${dimension}`);
      }
    }
  }
});

test("the self-hosted KTX2 transcoder matches the installed Three.js decoder", async () => {
  for (const name of ["basis_transcoder.js", "basis_transcoder.wasm"]) {
    const [served, dependency] = await Promise.all([
      fs.readFile(new URL(`../public/figurines/basis/r186/${name}`, import.meta.url)),
      fs.readFile(new URL(`../node_modules/three/examples/jsm/libs/basis/${name}`, import.meta.url)),
    ]);
    assert.deepEqual(served, dependency, `${name}: update the versioned public decoder when upgrading Three.js`);
  }
});
