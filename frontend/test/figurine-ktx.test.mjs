import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

test("the self-hosted KTX2 transcoder matches the installed Three.js decoder", async () => {
  for (const name of ["basis_transcoder.js", "basis_transcoder.wasm"]) {
    const [served, dependency] = await Promise.all([
      fs.readFile(new URL(`../public/figurines/basis/r186/${name}`, import.meta.url)),
      fs.readFile(new URL(`../node_modules/three/examples/jsm/libs/basis/${name}`, import.meta.url)),
    ]);
    assert.deepEqual(served, dependency, `${name}: update the versioned public decoder when upgrading Three.js`);
  }
});
