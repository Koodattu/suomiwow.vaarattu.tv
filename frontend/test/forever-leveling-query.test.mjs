import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const calls = [], exports = {};
const source = readFileSync(new URL("../src/lib/forever-leveling-query.ts", import.meta.url), "utf8");
runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, {
  exports, URLSearchParams,
  require: name => name === "@tanstack/react-query" ? { queryOptions: options => options } : {
    foreverApi: async (...args) => { calls.push(args); args[3]?.throwIfAborted(); return { characters: [] }; },
  },
});
const { foreverLevelingOptions, emptyForeverFilters, foreverLevelingRefetchInterval } = exports;

test("revisited snapshots refresh before their source data exceeds one minute", () => {
  const now = Date.parse("2026-11-08T12:00:00Z");
  for (const [age, expected] of [[0, 30000], [29000, 30000], [45000, 15000], [59000, 1000], [90000, 1000]]) {
    assert.equal(foreverLevelingRefetchInterval({ generatedAt: new Date(now - age).toISOString() }, now), expected);
  }
  assert.equal(foreverLevelingRefetchInterval(undefined, now), 30000);
});

test("pagination and filter queries use distinct keys, preserve Unicode/literal search, and forward cancellation", async () => {
  const filters = { ...emptyForeverFilters, guild: "Näätä & Co", search: "[Hero]", twitch: "only" };
  const first = foreverLevelingOptions(filters, 1), second = foreverLevelingOptions(filters, 2);
  assert.notDeepEqual(first.queryKey, second.queryKey);
  assert.notDeepEqual(first.queryKey, foreverLevelingOptions(emptyForeverFilters, 1).queryKey);
  const controller = new AbortController();
  await second.queryFn({ signal: controller.signal });
  const [path, method, , signal] = calls.at(-1);
  const params = new URLSearchParams(path.split("?")[1]);
  assert.equal(params.get("page"), "2"); assert.equal(params.get("guild"), "Näätä & Co");
  assert.equal(params.get("search"), "[Hero]"); assert.equal(params.get("twitch"), "only");
  assert.equal(method, "GET"); assert.equal(signal, controller.signal);
  controller.abort();
  await assert.rejects(second.queryFn({ signal: controller.signal }), { name: "AbortError" });
});
