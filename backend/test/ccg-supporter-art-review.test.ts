import assert from "node:assert/strict";
import test from "node:test";
import OpenAI from "openai";
import { reviewSupporterImage, SUPPORTER_ART_MODEL } from "../src/services/ccg-supporter-art-review.service";

function client(value: unknown, status = "completed", refusal = false) {
  return new OpenAI({ apiKey: "test-only", maxRetries: 0, fetch: async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    assert.equal(request.model, SUPPORTER_ART_MODEL);
    assert.equal(request.reasoning.effort, "low");
    assert.equal(request.store, false);
    assert.equal(request.text.format.strict, true);
    assert.ok(request.input[0].content[0].image_url.startsWith("data:image/webp;base64,"));
    return new Response(JSON.stringify({ id: "test-response", object: "response", status, output: [{ type: "message", role: "assistant", content: [
      refusal ? { type: "refusal", refusal: "Cannot review" } : { type: "output_text", text: typeof value === "string" ? value : JSON.stringify(value), annotations: [] },
    ] }] }), { headers: { "content-type": "application/json" } });
  } });
}
const safe = { decision: "safe", safetyConfidence: 98, issues: [], reason: "Ordinary fantasy character." };

test("Luna auto-approves only a safe, high-confidence result without flagged issues", async () => {
  const approved = await reviewSupporterImage(Buffer.from("fixture"), client(safe));
  assert.equal(approved.autoApproved, true);
  assert.equal(approved.responseId, "test-response");
  assert.equal(approved.safetyConfidence, 98);
  for (const value of [
    { ...safe, safetyConfidence: 97.9 }, { ...safe, decision: "review" }, { ...safe, decision: "reject" },
    { ...safe, issues: ["unclear"] }, { ...safe, issues: ["nudity"] },
  ]) {
    const result = await reviewSupporterImage(Buffer.from("fixture"), client(value));
    assert.equal(result.autoApproved, false);
    assert.notEqual(result.decision, "error");
  }
});

test("malformed responses, refusals and incomplete responses fall back to admin review", async () => {
  for (const value of ["invalid JSON", null, {}, { ...safe, safetyConfidence: "100" }, { ...safe, safetyConfidence: 101 },
    { ...safe, issues: null }, { ...safe, reason: "" }, { ...safe, issues: ["unknown"] }]) {
    const result = await reviewSupporterImage(Buffer.from("fixture"), client(value));
    assert.equal(result.autoApproved, false);
    assert.equal(result.decision, "error");
  }
  for (const api of [client(safe, "incomplete"), client(safe, "completed", true)]) {
    assert.equal((await reviewSupporterImage(Buffer.from("fixture"), api)).autoApproved, false);
  }
});

test("provider errors are kept out of persisted reasons and cannot auto-approve", async () => {
  const api = new OpenAI({ apiKey: "test-only", maxRetries: 0, fetch: async () => { throw new Error("private request detail"); } });
  const result = await reviewSupporterImage(Buffer.from("fixture"), api);
  assert.equal(result.decision, "error");
  assert.equal(result.autoApproved, false);
  assert.equal(result.reason, "review_unavailable");
});
