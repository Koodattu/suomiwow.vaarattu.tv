import assert from "node:assert/strict";
import test from "node:test";
import OpenAI from "openai";
import { reviewSupporterImage, SUPPORTER_ART_MODEL, SUPPORTER_ART_POLICY } from "../src/services/ccg-supporter-art-review.service";

function client(value: unknown, status = "completed", refusal = false) {
  return new OpenAI({ apiKey: "test-only", maxRetries: 0, fetch: async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    assert.equal(request.model, SUPPORTER_ART_MODEL);
    assert.equal(request.reasoning.effort, "low");
    assert.equal(request.store, false);
    assert.equal(request.text.format.strict, true);
    const issueTypes = request.text.format.schema.properties.issues.items.enum;
    assert.ok(!issueTypes.includes("unrelated"), "The classifier must not reject harmless non-WoW subjects");
    assert.ok(!issueTypes.includes("advertising"), "Visible branding is not a content safety violation");
    assert.match(request.instructions, /Allow harmless animal photos/);
    assert.match(request.instructions, /not a check of artistic quality or relevance/);
    assert.ok(request.input[0].content[0].image_url.startsWith("data:image/webp;base64,"));
    return new Response(JSON.stringify({ id: "test-response", object: "response", status, output: [{ type: "message", role: "assistant", content: [
      refusal ? { type: "refusal", refusal: "Cannot review" } : { type: "output_text", text: typeof value === "string" ? value : JSON.stringify(value), annotations: [] },
    ] }] }), { headers: { "content-type": "application/json" } });
  } });
}
const safe = { decision: "safe", safetyConfidence: 100, issues: [], reason: "Ordinary fantasy character." };

test("harmless cat artwork can auto-approve under the content-safety policy", async () => {
  const result = await reviewSupporterImage(Buffer.from("fixture"), client({ ...safe, safetyConfidence: 100, reason: "Harmless close-up cat photo." }));
  assert.equal(result.decision, "safe");
  assert.equal(result.autoApproved, true);
  assert.equal(result.policyVersion, SUPPORTER_ART_POLICY);
  assert.equal(result.policyVersion, "supporter-art-v2");
});

test("Luna auto-approves safe results at 75 or above without flagged issues", async () => {
  for (const safetyConfidence of [75, 96, 100]) {
    const approved = await reviewSupporterImage(Buffer.from("fixture"), client({ ...safe, safetyConfidence }));
    assert.equal(approved.autoApproved, true);
    assert.equal(approved.responseId, "test-response");
    assert.equal(approved.safetyConfidence, safetyConfidence);
  }
  for (const value of [
    { ...safe, safetyConfidence: 74.9 }, { ...safe, safetyConfidence: 0 }, { ...safe, decision: "review" }, { ...safe, decision: "reject" },
    ...["unclear", "sexual_content", "nudity", "graphic_violence", "hate", "harassment", "personal_data"].map((issue) => ({ ...safe, issues: [issue] })),
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
