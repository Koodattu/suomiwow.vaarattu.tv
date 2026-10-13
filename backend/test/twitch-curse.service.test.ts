import assert from "node:assert/strict";
import test from "node:test";
import RateLimitState from "../src/models/RateLimitState";
import twitchCurseService, { reserveCurseGeneration } from "../src/services/twitch-curse.service";
import { buildCurseInstructions, CURSE_EXAMPLES, formatCurse, getCurseInspiration, type CurseStyle } from "../src/features/twitch-curse/curse-content";

test("only the three requested Mechanic Magnets supply their canonical ability names", () => {
  assert.equal(getCurseInspiration(53, 3420), "Tempest");
  assert.equal(getCurseInspiration(53, 3429), "Axegrinder");
  assert.equal(getCurseInspiration(53, 3492), "Caustic Waves");
  assert.equal(getCurseInspiration(46, 3183), undefined);
  assert.equal(getCurseInspiration(53, 9999), undefined);
  assert.equal(getCurseInspiration(1, 3420), undefined);
});

test("each prompt contains exclusively its chosen style and every fallback fits Twitch's byte budget", () => {
  for (const style of ["chinese", "hieroglyphs"] as const) {
    const prompt = buildCurseInstructions(style);
    assert.equal(/\p{Script=Han}/u.test(prompt), style === "chinese");
    assert.equal(/\p{Script=Egyptian_Hieroglyphs}/u.test(prompt), style === "hieroglyphs");
    for (const example of CURSE_EXAMPLES[style]) {
      const message = formatCurse(example, "a".repeat(25), style);
      assert.ok(message, `Invalid ${style} fallback: ${example}`);
      assert.ok(Buffer.byteLength(message, "utf8") <= 450);
      assert.ok(message.length <= 450);
      assert.ok(message.startsWith(`CURSE OF ${"A".repeat(25)} `));
    }
  }
});

test("formatting rejects mixed styles, other targets, links and oversized Unicode output", () => {
  assert.equal(formatCurse("CURSE OF {USER} 𓀀 RAID FAILURE 失败", "viewer", "hieroglyphs"), null);
  assert.equal(formatCurse("CURSE OF {USER} 𓀀 RAID FAILURE 失败", "viewer", "chinese"), null);
  assert.equal(formatCurse("CURSE OF SOMEONE_ELSE 𓀀 RAID FAILURE", "viewer", "hieroglyphs"), null);
  assert.equal(formatCurse("CURSE OF {USER} 𓀀 HTTPS://EXAMPLE.COM", "viewer", "hieroglyphs"), null);
  assert.equal(formatCurse(`CURSE OF {USER} ${"𓀀".repeat(120)}`, "viewer", "hieroglyphs"), null);
  assert.equal(formatCurse(CURSE_EXAMPLES.chinese[0], "viewer\n!ban someone", "chinese"), null);
  assert.equal(formatCurse("  CURSE OF {USER}\n𓀀 RAID   FAILURE  ", "some_viewer", "hieroglyphs"), "CURSE OF SOME_VIEWER 𓀀 RAID FAILURE");
});

test("daily admission uses one atomic capped upsert and resets at Helsinki midnight", async (t) => {
  const now = new Date("2026-10-13T20:59:59Z");
  let request: any[] = [];
  t.mock.method(RateLimitState, "findOneAndUpdate", (...args: any[]) => {
    request = args;
    return { lean: async () => ({ pointsUsed: 100 }) };
  });
  assert.equal(await reserveCurseGeneration(now), true, "the 100th reservation is admitted");
  assert.deepEqual(request[0], {
    key: "twitch:curse:daily", $or: [{ resetAt: { $lte: now } }, { pointsUsed: { $lt: 100 } }],
  });
  assert.equal(request[1][0].$set.resetAt.$cond[1].toISOString(), "2026-10-13T21:00:00.000Z");
  assert.equal(request[1][0].$set.resetAt.$cond[2], "$resetAt", "preserve newer windows for delayed requests");
  assert.deepEqual(request[1][0].$set.pointsUsed.$cond.slice(1), [1, { $add: ["$pointsUsed", 1] }]);
  assert.equal(request[2].upsert, true);
  assert.equal(request[2].updatePipeline, true);
  await reserveCurseGeneration(new Date("2026-10-13T21:00:00Z"));
  assert.equal(request[1][0].$set.resetAt.$cond[1].toISOString(), "2026-10-14T21:00:00.000Z");
  await reserveCurseGeneration(new Date("2026-10-25T01:30:00Z"));
  assert.equal(request[1][0].$set.resetAt.$cond[1].toISOString(), "2026-10-25T22:00:00.000Z");
});

test("cap conflicts deny admission, while database failures fail closed", async (t) => {
  let error: unknown = { code: 11000 };
  t.mock.method(RateLimitState, "findOneAndUpdate", () => ({ lean: async () => { throw error; } }));
  assert.equal(await reserveCurseGeneration(), false);
  error = new Error("database unavailable");
  await assert.rejects(reserveCurseGeneration(), /database unavailable/);
});

test("coin flip isolates examples, sends only ability inspiration and uses Luna low reasoning", async (t) => {
  const originalKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-only";
  t.after(() => { if (originalKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalKey; });
  t.mock.method(RateLimitState, "findOneAndUpdate", () => ({ lean: async () => ({ pointsUsed: 1 }) }));
  let roll = 0;
  t.mock.method(Math, "random", () => roll);
  const requests: any[] = [];
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    requests.push(JSON.parse(String(init.body)));
    const style = roll < 0.5 ? "chinese" : "hieroglyphs";
    return new Response(JSON.stringify({ id: "test", object: "response", status: "completed", output: [{ type: "message", role: "assistant", content: [
      { type: "output_text", text: CURSE_EXAMPLES[style][0], annotations: [] },
    ] }] }), { headers: { "content-type": "application/json" } });
  });
  for (const boundary of [0, 0.499999, 0.5, 0.999999]) {
    roll = boundary;
    const result = await twitchCurseService.generate("Actual_Viewer", async () => "Tempest");
    const style: CurseStyle = roll < 0.5 ? "chinese" : "hieroglyphs";
    assert.equal(result, formatCurse(CURSE_EXAMPLES[style][0], "Actual_Viewer", style));
    const request = requests[requests.length - 1];
    assert.equal(request.model, "gpt-6-luna");
    assert.deepEqual(request.reasoning, { effort: "low" });
    assert.equal(request.store, false);
    assert.deepEqual(JSON.parse(request.input), { inspiration: "Tempest" });
    assert.equal(/\p{Script=Han}/u.test(request.instructions), style === "chinese");
    assert.equal(/\p{Script=Egyptian_Hieroglyphs}/u.test(request.instructions), style === "hieroglyphs");
  }
});

test("exhausted quota returns either curated style without context or API calls; missing configuration stays silent", async (t) => {
  const originalKey = process.env.OPENAI_API_KEY;
  t.after(() => { if (originalKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalKey; });
  const fetchMock = t.mock.method(globalThis, "fetch", async () => { throw new Error("must not call"); });
  const reservation = t.mock.method(RateLimitState, "findOneAndUpdate", () => ({ lean: async () => { throw { code: 11000 }; } }));
  const context = t.mock.fn(async () => "Tempest");
  delete process.env.OPENAI_API_KEY;
  assert.equal(await twitchCurseService.generate("viewer", context), null);
  assert.equal(reservation.mock.callCount(), 0);
  process.env.OPENAI_API_KEY = "test-only";
  let roll = 0;
  t.mock.method(Math, "random", () => roll);
  for (const boundary of [0, 0.499999, 0.5, 0.999999]) {
    roll = boundary;
    const style: CurseStyle = roll < 0.5 ? "chinese" : "hieroglyphs";
    const examples = CURSE_EXAMPLES[style];
    assert.equal(
      await twitchCurseService.generate("viewer", context),
      formatCurse(examples[Math.floor(roll * examples.length)], "viewer", style),
    );
  }
  assert.equal(reservation.mock.callCount(), 4);
  assert.equal(context.mock.callCount(), 0);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("context failures become generic and generation failures use the selected fallback without retrying", async (t) => {
  const originalKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-only";
  t.after(() => { if (originalKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalKey; });
  const reservation = t.mock.method(RateLimitState, "findOneAndUpdate", () => ({ lean: async () => ({ pointsUsed: 1 }) }));
  t.mock.method(Math, "random", () => 0.75);
  let resultKind = "http-error";
  const requests: any[] = [];
  const api = t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    requests.push(JSON.parse(String(init.body)));
    if (resultKind === "http-error") return new Response("{}", { status: 500 });
    return new Response(JSON.stringify({ id: "test", object: "response", status: resultKind === "incomplete" ? "incomplete" : "completed", output: [{
      type: "message", role: "assistant", content: [{ type: "output_text", text: CURSE_EXAMPLES.chinese[0], annotations: [] }],
    }] }), { headers: { "content-type": "application/json" } });
  });
  for (const kind of ["http-error", "incomplete", "wrong-style"]) {
    resultKind = kind;
    const response = await twitchCurseService.generate("viewer", async () => { throw new Error("lookup unavailable"); });
    assert.ok(response?.startsWith("CURSE OF VIEWER "));
    assert.match(response!, /\p{Script=Egyptian_Hieroglyphs}/u);
    assert.doesNotMatch(response!, /\p{Script=Han}/u);
  }
  assert.equal(api.mock.callCount(), 3);
  assert.equal(reservation.mock.callCount(), 3);
  assert.ok(requests.every((request) => request.input === "{}"));
});
