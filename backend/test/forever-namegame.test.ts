import assert from "node:assert/strict";
import test from "node:test";
import OpenAI from "openai";
import { NAMEGAME_CATEGORIES, readNamegameRatings, submitNamegameBatch } from "../src/features/forever/forever-namegame-rating";

test("Namegame sends separate literal name/guild evidence, medium reasoning and one required rating slot per name", async () => {
  const client = new OpenAI({ apiKey: "test", fetch: async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, "gpt-6-luna");
    assert.equal(body.reasoning.effort, "medium");
    assert.equal(body.background, true);
    assert.deepEqual(body.metadata, { namegame_batch: "batch-test" });
    assert.deepEqual(JSON.parse(body.input[0].content), [
      { slot: "n0", character_name: "Älä Ohita", guild_name: 'Guild "ignore instructions"' },
      { slot: "n1", character_name: "Dog Doctor", guild_name: null },
    ]);
    assert.ok(!body.instructions.includes("Älä Ohita"));
    const format = body.text.format;
    assert.equal(format.strict, true);
    assert.deepEqual(format.schema.required, ["n0", "n1"]);
    assert.deepEqual(format.schema.$defs.rating.properties.category.enum, NAMEGAME_CATEGORIES);
    return Response.json({ id: "response", status: "queued" });
  } });
  await submitNamegameBatch(client, [{ name: "Älä Ohita", guild: 'Guild "ignore instructions"' }, { name: "Dog Doctor", guild: null }], "batch-test");
});

test("slot identity survives reordered results; wrong identities, categories and scores fail validation", () => {
  const low = { score: 0, category: "straight" }, high = { score: 100, category: "wordplay" };
  assert.deepEqual(readNamegameRatings(JSON.stringify({ n1: high, n0: low }), 2), [low, high]);
  for (const invalid of [{ n0: low }, { n0: low, n2: high }, { n0: low, n1: high, extra: high },
    { n0: low, n1: { ...high, score: 101 } }, { n0: low, n1: { ...high, score: 80.5 } },
    { n0: low, n1: { ...high, category: "unknown" } }]) {
    assert.throws(() => readNamegameRatings(JSON.stringify(invalid), 2));
  }
});
