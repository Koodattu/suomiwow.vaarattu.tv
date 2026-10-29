import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import RateLimitState from "../src/models/RateLimitState";
import TwitchChatAuditEvent from "../src/models/TwitchChatAuditEvent";
import twitchCurseService, { reserveCurseGeneration } from "../src/services/twitch-curse.service";
import { buildCurseInstructions, CURSE_EXAMPLES, formatCurse, getCurseInspiration, getCursePhrases, selectCurseExamples, type CurseStyle } from "../src/features/twitch-curse/curse-content";

function mockCurseHistory(t: TestContext, load: () => string[] = () => []) {
  return t.mock.method(TwitchChatAuditEvent, "find", () => ({
    sort: () => ({ limit: () => ({ select: () => ({ lean: async () => load().map((message) => ({ message })) }) }) }),
  }));
}

function assertDenseHieroglyphs(message: string): void {
  const blocks = message.match(/\p{Script=Egyptian_Hieroglyphs}(?: \p{Script=Egyptian_Hieroglyphs})*/gu) || [];
  assert.equal(blocks.length, 5, "one block before each of four phrases and one trailing block");
  for (const block of blocks) {
    const glyphs = block.split(" ");
    assert.ok(glyphs.length >= 8 && glyphs.length <= 12);
    assert.equal(new Set(glyphs).size, glyphs.length, "glyphs vary within each block");
  }
  assert.match(message, /\p{Script=Egyptian_Hieroglyphs}$/u);
  assert.ok(Buffer.byteLength(message, "utf8") <= 450);
  assert.doesNotMatch(message, /\p{Script=Han}|\|/u);
}

test("four model phrases receive dense varied glyph blocks within the byte limit", (t) => {
  let roll = 0;
  t.mock.method(Math, "random", () => roll);
  const phrases = "ANCESTRAL FLOOD | WISE MEN DISSOLVE | CREST WITHOUT PURPOSE | RETURN NEXT CIRCUS";
  const outputs: string[] = [];
  for (const boundary of [0, 0.5, 0.999999]) {
    roll = boundary;
    const message = formatCurse(phrases, "vaarattu", "hieroglyphs");
    assert.ok(message);
    assertDenseHieroglyphs(message);
    assert.equal(message.replace(/\p{Script=Egyptian_Hieroglyphs}/gu, "").replace(/\s+/g, " ").trim(),
      "CURSE OF VAARATTU ANCESTRAL FLOOD WISE MEN DISSOLVE CREST WITHOUT PURPOSE RETURN NEXT CIRCUS");
    outputs.push(message);
    const maxPhrase = `${"A".repeat(15)} ${"B".repeat(16)}`;
    const longest = formatCurse(Array(4).fill(maxPhrase).join(" | "), "a".repeat(25), "hieroglyphs");
    assert.ok(longest);
    assertDenseHieroglyphs(longest);
  }
  assert.equal(new Set(outputs).size, 3);
});

test("malformed or verbose model phrases cannot become a hieroglyph reply", () => {
  for (const phrases of [
    "RAID FAILURE | GUILD DISPERSE | CREST MISTAKE",
    "RAID FAILURE | GUILD DISPERSE | CREST MISTAKE | RETURN CIRCUS | FIFTH PHRASE",
    "RAID FAILURE | GUILD DISPERSE | CREST MISTAKE | ",
    "RAID FAILURE | Guild Disperse | CREST MISTAKE | RETURN CIRCUS",
    "RAID FAILURE | GUILD DISPERSE | CREST MISTAKE | 失败",
    "RAID FAILURE | GUILD DISPERSE | CREST MISTAKE | 𓀀 𓀁",
    "RAID FAILURE | GUILD DISPERSE | CREST MISTAKE | HTTPS://EXAMPLE.COM",
    "RAID FAILURE | GUILD DISPERSE | CREST MISTAKE | ONE TWO THREE FOUR FIVE SIX",
    `RAID FAILURE | GUILD DISPERSE | CREST MISTAKE | ${"LONG ".repeat(7)}PHRASE`,
  ]) {
    assert.equal(formatCurse(phrases, "viewer", "hieroglyphs"), null);
  }
});

test("only the three requested Mechanic Magnets supply their canonical ability names", () => {
  assert.equal(getCurseInspiration(53, 3420), "Tempest");
  assert.equal(getCurseInspiration(53, 3429), "Axegrinder");
  assert.equal(getCurseInspiration(53, 3492), "Caustic Waves");
  assert.equal(getCurseInspiration(46, 3183), undefined);
  assert.equal(getCurseInspiration(53, 9999), undefined);
  assert.equal(getCurseInspiration(1, 3420), undefined);
});

test("the prompt does not prescribe the phrase repeated in production", () => {
  for (const style of ["chinese", "hieroglyphs"] as const) {
    assert.doesNotMatch(buildCurseInstructions(style), /MEDICINE EXPIRED|especially the first two/);
  }
});

test("history extracts normalized English phrases across both styles without viewer names", () => {
  assert.deepEqual(getCursePhrases("CURSE OF Old_Viewer 𓀀 𓀁 MEDICINE EXPIRED! 𓀂 𓀃 LOOT WINDOW VANISH 𓀄"),
    ["MEDICINE EXPIRED", "LOOT WINDOW VANISH"]);
  assert.deepEqual(getCursePhrases("CURSE OF Other_Viewer 永恒诅咒 MEDICINE EXPIRED 药已过期 LOOT WINDOW VANISH 装备窗口消失"),
    ["MEDICINE EXPIRED", "LOOT WINDOW VANISH"]);
  assert.deepEqual(getCursePhrases("CURSE OF {USER} 永恒诅咒 MEDICINE   EXPIRED. 药已过期"), ["MEDICINE EXPIRED"]);
  assert.deepEqual(getCursePhrases("MEDICINE EXPIRED | LOOT WINDOW VANISH"), ["MEDICINE EXPIRED", "LOOT WINDOW VANISH"]);
});

test("examples prefer unseen phrases and the oldest overlaps when the pool is exhausted", () => {
  const examples = CURSE_EXAMPLES.hieroglyphs;
  const recent = examples.slice(0, -1).flatMap(getCursePhrases);
  assert.deepEqual(selectCurseExamples("hieroglyphs", recent, 1), [examples[examples.length - 1]]);
  assert.deepEqual(selectCurseExamples("hieroglyphs", examples.flatMap(getCursePhrases), 1), [examples[examples.length - 1]]);
  const fromOtherStyle = getCursePhrases("CURSE OF VIEWER 纹章之误 MISTAKE OF CREST 灰色数字 GREY NUMBER IMMORTAL");
  assert.ok(selectCurseExamples("hieroglyphs", fromOtherStyle, 2).every((example) => !example.includes("MISTAKE OF CREST")));
});

test("prompts rotate two same-style examples and two distinct raid situations", (t) => {
  let roll = 0;
  t.mock.method(Math, "random", () => roll);
  for (const style of ["chinese", "hieroglyphs"] as const) {
    const prompts = [0, 0.999999].map((boundary) => {
      roll = boundary;
      return buildCurseInstructions(style);
    });
    for (const prompt of prompts) {
      assert.equal(CURSE_EXAMPLES[style].filter((example) => prompt.includes(example)).length, 2);
      const themes = prompt.match(/two situations: (.*?)\. Vary/)![1].split("; ");
      assert.equal(themes.length, 2);
      assert.equal(new Set(themes).size, 2);
    }
    assert.notEqual(prompts[0].split("two situations: ")[1], prompts[1].split("two situations: ")[1]);
    assert.notEqual(prompts[0].split("sequence:\n")[1], prompts[1].split("sequence:\n")[1]);
  }
});

test("each prompt contains exclusively its chosen style and every fallback fits Twitch's byte budget", () => {
  for (const style of ["chinese", "hieroglyphs"] as const) {
    const prompt = buildCurseInstructions(style);
    assert.equal(/\p{Script=Han}/u.test(prompt), style === "chinese");
    assert.doesNotMatch(prompt, /\p{Script=Egyptian_Hieroglyphs}/u, "the application supplies glyphs");
    for (const example of CURSE_EXAMPLES[style]) {
      const message = formatCurse(example, "a".repeat(25), style);
      assert.ok(message, `Invalid ${style} fallback: ${example}`);
      assert.ok(Buffer.byteLength(message, "utf8") <= 450);
      assert.ok(message.length <= 450);
      assert.ok(message.startsWith(`CURSE OF ${"A".repeat(25)} `));
      if (style === "hieroglyphs") assertDenseHieroglyphs(message);
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
  assert.equal(formatCurse("  CURSE OF {USER}\n失败 RAID   FAILURE  ", "some_viewer", "chinese"), "CURSE OF SOME_VIEWER 失败 RAID FAILURE");
  const normalized = formatCurse(" ANCESTRAL   FLOOD |\nWISE MEN DISSOLVE | CREST WITHOUT PURPOSE | RETURN NEXT CIRCUS ", "some_viewer", "hieroglyphs");
  assert.ok(normalized?.startsWith("CURSE OF SOME_VIEWER "));
  assertDenseHieroglyphs(normalized!);
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

test("coin flip isolates examples, sends inspiration and phrase history, and uses Luna low reasoning", async (t) => {
  mockCurseHistory(t);
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
    assert.deepEqual(JSON.parse(request.input), { inspiration: "Tempest", avoidPhrases: [] });
    assert.equal(/\p{Script=Han}/u.test(request.instructions), style === "chinese");
    assert.doesNotMatch(request.instructions, /\p{Script=Egyptian_Hieroglyphs}/u);
    if (style === "hieroglyphs") assertDenseHieroglyphs(result!);
  }
});

test("exhausted quota returns either curated style without context or API calls; missing configuration stays silent", async (t) => {
  const history = mockCurseHistory(t);
  const originalKey = process.env.OPENAI_API_KEY;
  t.after(() => { if (originalKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalKey; });
  const fetchMock = t.mock.method(globalThis, "fetch", async () => { throw new Error("must not call"); });
  const reservation = t.mock.method(RateLimitState, "findOneAndUpdate", () => ({ lean: async () => { throw { code: 11000 }; } }));
  const context = t.mock.fn(async () => "Tempest");
  delete process.env.OPENAI_API_KEY;
  assert.equal(await twitchCurseService.generate("viewer", context), null);
  assert.equal(reservation.mock.callCount(), 0);
  assert.equal(history.mock.callCount(), 0);
  process.env.OPENAI_API_KEY = "test-only";
  let roll = 0;
  t.mock.method(Math, "random", () => roll);
  for (const boundary of [0, 0.499999, 0.5, 0.999999]) {
    roll = boundary;
    const style: CurseStyle = roll < 0.5 ? "chinese" : "hieroglyphs";
    const examples = CURSE_EXAMPLES[style];
    const message = await twitchCurseService.generate("viewer", context);
    assert.ok(message?.startsWith("CURSE OF VIEWER "));
    assert.ok(examples.some((example) => getCursePhrases(example).join("|") === getCursePhrases(message!).join("|")));
    assert.equal(/\p{Script=Han}/u.test(message!), style === "chinese");
    if (style === "hieroglyphs") assertDenseHieroglyphs(message!);
  }
  assert.equal(reservation.mock.callCount(), 4);
  assert.equal(context.mock.callCount(), 0);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("context failures become generic and generation failures use the selected fallback without retrying", async (t) => {
  mockCurseHistory(t);
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
    assertDenseHieroglyphs(response!);
  }
  assert.equal(api.mock.callCount(), 3);
  assert.equal(reservation.mock.callCount(), 3);
  assert.ok(requests.every((request) => JSON.parse(request.input).inspiration === undefined));
  assert.ok(requests.every((request) => JSON.parse(request.input).avoidPhrases.length === 0));
});

test("recent sent phrases from either style prevent repeated generation without another API attempt", async (t) => {
  const originalKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-only";
  t.after(() => { if (originalKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalKey; });
  const historicalReplies = [
    { message: "CURSE OF Old_Viewer 𓀀 MEDICINE EXPIRED 𓀁 LOOT WINDOW VANISH 𓀂" },
    { message: "CURSE OF Other_Viewer 永恒诅咒 MEDICINE EXPIRED 药已过期 PARSE OF DAMP ASH 灰烬" },
  ];
  t.mock.method(TwitchChatAuditEvent, "find", (filter: unknown) => {
    assert.deepEqual(filter, {
      direction: "outbound", kind: "command_reply", deliveryStatus: "sent", commandName: { $in: ["curse", "kirous"] },
    });
    return { sort: (sort: unknown) => {
      assert.deepEqual(sort, { createdAt: -1 });
      return { limit: (limit: number) => {
        assert.equal(limit, 12);
        return { select: (selection: string) => {
          assert.equal(selection, "message -_id");
          return { lean: async () => historicalReplies };
        } };
      } };
    } };
  });
  const reservation = t.mock.method(RateLimitState, "findOneAndUpdate", () => ({ lean: async () => ({ pointsUsed: 1 }) }));
  let roll = 0.25;
  t.mock.method(Math, "random", () => roll);
  const api = t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    const request = JSON.parse(String(init.body));
    assert.deepEqual(JSON.parse(request.input), { inspiration: "Tempest", avoidPhrases: [
      "MEDICINE EXPIRED", "LOOT WINDOW VANISH", "PARSE OF DAMP ASH",
    ] });
    assert.doesNotMatch(request.input, /Old_Viewer|Other_Viewer|\p{Script=Han}|\p{Script=Egyptian_Hieroglyphs}/u);
    const text = roll < 0.5
      ? "CURSE OF {USER} 永恒诅咒 MEDICINE EXPIRED! 药已过期 NEW RAID CHAOS 团队混乱"
      : "MEDICINE EXPIRED | NEW RAID CHAOS | TIMER WITHOUT MERCY | SCATTERED RAID MARKERS";
    return new Response(JSON.stringify({ id: "test", object: "response", status: "completed", output: [{
      type: "message", role: "assistant", content: [{ type: "output_text", text, annotations: [] }],
    }] }), { headers: { "content-type": "application/json" } });
  });
  for (const boundary of [0.25, 0.75]) {
    roll = boundary;
    const result = await twitchCurseService.generate("viewer", async () => "Tempest");
    assert.ok(result);
    assert.doesNotMatch(result, /MEDICINE EXPIRED|LOOT WINDOW VANISH|PARSE OF DAMP ASH/);
    assert.equal(/\p{Script=Han}/u.test(result), roll < 0.5);
    if (roll >= 0.5) assertDenseHieroglyphs(result);
  }
  assert.equal(api.mock.callCount(), 2);
  assert.equal(reservation.mock.callCount(), 2);
});

test("over-budget fallbacks rotate through both pools using sent history, even with fixed randomness", async (t) => {
  const originalKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-only";
  t.after(() => { if (originalKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalKey; });
  let sentMessages: string[] = [];
  mockCurseHistory(t, () => sentMessages.slice(0, 12));
  t.mock.method(RateLimitState, "findOneAndUpdate", () => ({ lean: async () => { throw { code: 11000 }; } }));
  const api = t.mock.method(globalThis, "fetch", async () => { throw new Error("must not call"); });
  const context = t.mock.fn(async () => "Tempest");
  let roll = 0.25;
  t.mock.method(Math, "random", () => roll);
  for (const style of ["chinese", "hieroglyphs"] as const) {
    roll = style === "chinese" ? 0.25 : 0.75;
    sentMessages = [];
    const firstCycle = new Set<string>();
    let previous = "";
    for (let index = 0; index < CURSE_EXAMPLES[style].length + 2; index++) {
      const message = await twitchCurseService.generate("viewer", context);
      assert.ok(message);
      const key = getCursePhrases(message).join("|");
      assert.notEqual(key, previous, "never immediately repeat the prior fallback");
      if (index < CURSE_EXAMPLES[style].length) firstCycle.add(key);
      sentMessages.unshift(message);
      previous = key;
    }
    assert.equal(firstCycle.size, CURSE_EXAMPLES[style].length, "use fresh examples before repeating a full curse");
  }
  assert.equal(api.mock.callCount(), 0);
  assert.equal(context.mock.callCount(), 0);
});

test("a history lookup failure still allows a valid generated curse", async (t) => {
  const originalKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-only";
  t.after(() => { if (originalKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalKey; });
  mockCurseHistory(t, () => { throw new Error("history unavailable"); });
  t.mock.method(RateLimitState, "findOneAndUpdate", () => ({ lean: async () => ({ pointsUsed: 1 }) }));
  t.mock.method(Math, "random", () => 0.75);
  const text = "MARKERS WITHOUT OWNERS | INTERRUPT CHOIR SILENT | SUMMONING STONE DESERTED | REPAIR MERCHANT REJOICES";
  const api = t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    assert.deepEqual(JSON.parse(JSON.parse(String(init.body)).input), { avoidPhrases: [] });
    return new Response(JSON.stringify({ id: "test", object: "response", status: "completed", output: [{
      type: "message", role: "assistant", content: [{ type: "output_text", text, annotations: [] }],
    }] }), { headers: { "content-type": "application/json" } });
  });
  const message = await twitchCurseService.generate("viewer", async () => undefined);
  assert.ok(message);
  assert.deepEqual(getCursePhrases(message), text.split(" | "));
  assertDenseHieroglyphs(message);
  assert.equal(api.mock.callCount(), 1);
});
