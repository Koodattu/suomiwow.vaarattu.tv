import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCharacterQuery, compareAppearance, resolveModelResource } from "../src/lib/figurine-lab.ts";

test("EU lookup preserves accented character names and accepts realm display names", () => {
  assert.deepEqual(normalizeCharacterQuery(" Ro\u0308idy ", " Kazzak "), { name: "röidy", realm: "kazzak" });
  assert.deepEqual(normalizeCharacterQuery("Example", "Twisting Nether"), { name: "example", realm: "twisting-nether" });
  for (const [name, realm] of [["../secret", "kazzak"], ["Name", "../us"], ["", "kazzak"], ["Name", "https://other.test"], ["Name", "a".repeat(81)]]) assert.equal(normalizeCharacterQuery(name, realm), null);
});

test("appearance keeps hidden transmogs, modifier zero, and independent shoulders", () => {
  const result = compareAppearance([
    { id: 168659, slot: { type: "CHEST" }, item_appearance_modifier_id: 0 },
    { id: 123, slot: { type: "SHOULDER" }, secondary_id: 456, item_appearance_modifier_id: 3 },
  ], [
    { slot: { type: "CHEST", name: "Chest" }, item: { id: 271567 }, name: "Equipped chest", transmog: { item: { id: 168659, name: "Hidden Chestpiece" } } },
    { slot: { type: "SHOULDER", name: "Shoulders" }, item: { id: 999 }, name: "Equipped shoulders", transmog: { item: { id: 123, name: "Visible shoulders" } } },
    { slot: { type: "NECK", name: "Neck" }, item: { id: 88 }, name: "Necklace" },
  ]);
  assert.equal(result[0].visibleName, "Hidden Chestpiece");
  assert.equal(result[0].modifier, 0);
  assert.equal(result[0].transmogged, true);
  assert.equal(result[1].secondaryId, 456);
  assert.equal(result[2].visibleId, 88);
  assert.equal(result[2].transmogged, false);
});

test("model resources resolve selected files, rejecting remote and ambiguous references", () => {
  assert.equal(resolveModelResource("textures/hat%20blue.png", ["export/textures/hat blue.png"]), "export/textures/hat blue.png");
  assert.equal(resolveModelResource("mesh.bin", ["export/mesh.bin"]), "export/mesh.bin");
  assert.equal(resolveModelResource("hat.png", ["one/hat.png", "two/hat.png"]), null);
  assert.equal(resolveModelResource("missing.bin", ["mesh.bin"]), null);
  assert.equal(resolveModelResource("https://untrusted.test/model.bin", ["model.bin"]), null);
  assert.equal(resolveModelResource("//untrusted.test/model.bin", ["model.bin"]), null);
  assert.equal(resolveModelResource("%ZZ", []), null);
});
