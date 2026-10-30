import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readModel(model) {
  const bytes = await readFile(new URL(`../public${model}`, import.meta.url));
  return JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)));
}

test("every visible classic cape uses its standalone cloak texture", async () => {
  const capes = [];
  for (const series of ["community-001", "community-002"]) {
    const catalog = JSON.parse(await readFile(new URL(`../src/data/figurines/${series}.json`, import.meta.url)));
    for (const character of catalog.characters) {
      const gltf = await readModel(character.model);
      for (const node of gltf.nodes.filter((node) => /_Cloak\d/.test(node.name))) {
        capes.push(character.id);
        for (const primitive of gltf.meshes[node.mesh].primitives) {
          const material = gltf.materials[primitive.material];
          assert.equal(material.name, "data-2", character.id);
          assert.ok(material.pbrMetallicRoughness.baseColorTexture, character.id);
        }
      }
    }
  }
  assert.deepEqual(capes.sort(), ["yolobolt", "turrilol", "suursmurffi", "ovelakettu", "hirvihotline", "tonza", "jampton", "mightyhuu", "kuurankukka", "violetmw", "rookiheal", "shippyboi"].sort());
});

test("Chipi retains exposed feet alongside her boot collection mesh", async () => {
  const gltf = await readModel("/figurines/community-002/chipi.glb");
  for (const name of ["bloodelffemale_hd_Feet1", "Feet_Item251091_0"]) {
    const node = gltf.nodes.find((node) => node.name === name);
    assert.ok(node, name);
    assert.ok(gltf.meshes[node.mesh].primitives.length, name);
  }
});

test("Morinicar includes only the selected horn decoration, with its own materials", async () => {
  const gltf = await readModel("/figurines/community-002/morinicar.glb");
  const decorations = gltf.nodes.filter((node) => node.name?.startsWith("Slot4375631_Itemnull_"));
  assert.equal(decorations.length, 2);
  const materials = decorations.flatMap((node) => gltf.meshes[node.mesh].primitives.map((primitive) => gltf.materials[primitive.material].name));
  assert.deepEqual(materials.sort(), ["data-20", "data-9"]);
});
