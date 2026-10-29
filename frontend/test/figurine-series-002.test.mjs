import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("upcoming box 2 contains 16 distinct characters and intact posed models at the approved texture quality", async () => {
  const readCatalog = async (id) => JSON.parse(await readFile(new URL(`../src/data/figurines/${id}.json`, import.meta.url)));
  const series = await readCatalog("community-002");
  const first = await readCatalog("community-001");
  assert.equal(series.releaseState, "upcoming");
  assert.equal(series.compression.maxTextureSize, 2048);
  assert.equal(series.compression.quality, 89);
  assert.equal(series.characters.length, 16);
  assert.equal(new Set(series.characters.map((c) => `${c.name}/${c.realm}`)).size, 16);
  for (const id of ["ajotettu", "eppugrip", "zetabeach", "np", "zetacmi", "hirvihotline", "tonza", "thrusbard", "jampton", "morinicar", "mightyhuu"]) {
    assert.ok(series.characters.some((c) => c.id === id), id);
  }
  assert.ok(first.characters.some((c) => c.id === "chipie" && c.characterClass === "Priest"));
  assert.ok(![...first.characters, ...series.characters].some((c) => c.id === "chipiepew"));
  assert.ok(series.characters.every((c) => !first.characters.some((a) => a.id === c.id)));
  assert.deepEqual(new Set(series.characters.map((c) => c.weapons)), new Set(["held", "sheathed"]));
  assert.ok(new Set(series.characters.map((c) => c.pose.animationId)).size >= 8);
  const cat = series.characters.find((c) => c.id === "zetabeach");
  assert.equal(cat.form.type, "cat");
  assert.equal(cat.form.choiceId, 10088);
  assert.equal(cat.form.displayId, 66783);
  assert.equal(cat.pose.animationId, 69);
  assert.equal(cat.pose.timeMs, cat.pose.durationMs / 2);

  for (const entry of series.characters) {
    assert.match(entry.model, /^\/figurines\/community-002\/[a-z-]+\.glb$/);
    assert.ok(entry.pose.timeMs > 0 && entry.pose.timeMs < entry.pose.durationMs, entry.id);
    const bytes = await readFile(new URL(`../public${entry.model}`, import.meta.url));
    // Box 2 deliberately retains full texture quality, including larger Dracthyr.
    assert.ok(bytes.length > 0, entry.id);
    assert.equal(bytes.length, entry.bytes, entry.id);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), entry.sha256, entry.id);
    assert.equal(bytes.subarray(0, 4).toString(), "glTF");
    assert.equal(bytes.readUInt32LE(8), bytes.length);
    const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
    assert.ok(gltf.extensionsRequired.includes("EXT_meshopt_compression"));
    assert.ok(gltf.images.every((image) => image.bufferView !== undefined && !image.uri));
    assert.ok(gltf.buffers.every((buffer) => !buffer.uri));
    const anchor = gltf.scenes[gltf.scene ?? 0].extras.wowCharacter;
    for (const key of ["groundY", "centerX", "centerZ"]) assert.ok(Number.isFinite(anchor[key]), `${entry.id}: ${key}`);
    assert.ok(gltf.materials.every((material) => material.extras.wowM2.version === 1));
    assert.equal(entry.validationWarnings, 0, entry.id);
  }
});

test("Abiw's mop and slippers use equipment textures rather than the character skin atlas", async () => {
  const bytes = await readFile(new URL("../public/figurines/community-001/abiw.glb", import.meta.url));
  const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  for (const item of [171338, 233815]) {
    const nodes = gltf.nodes.filter((node) => node.name?.includes(`Item${item}_`));
    assert.ok(nodes.length, `Missing equipment ${item}`);
    for (const node of nodes) for (const primitive of gltf.meshes[node.mesh].primitives) {
      const material = gltf.materials[primitive.material];
      assert.notEqual(material.name, "data-1");
      assert.ok(material.pbrMetallicRoughness.baseColorTexture);
    }
  }
});
