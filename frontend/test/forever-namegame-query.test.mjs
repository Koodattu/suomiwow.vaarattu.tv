import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const calls = [], exports = {};
const source = readFileSync(new URL("../src/lib/forever-namegame-query.ts", import.meta.url), "utf8");
runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, {
  exports, URLSearchParams,
  require: name => name === "@tanstack/react-query" ? { queryOptions: options => options } : {
    foreverApi: async (...args) => { calls.push(args); args[3]?.throwIfAborted(); return { names: [] }; },
  },
});

test("Namegame caches each page/search/category/order separately and forwards cancellation", async () => {
  const filters = { category: "wordplay", search: "Ää & [Öö]", sort: "name" };
  const first = exports.namegameOptions(filters, 1);
  for (const other of [exports.namegameOptions(filters, 2), ...Object.keys(filters).map(key => exports.namegameOptions({ ...filters, [key]: "" }, 1))]) {
    assert.notDeepEqual(first.queryKey, other.queryKey);
  }
  const controller = new AbortController();
  await first.queryFn({ signal: controller.signal });
  const [path, method, , signal] = calls.at(-1);
  const params = new URLSearchParams(path.split("?")[1]);
  assert.deepEqual(Object.fromEntries(params), { ...filters, page: "1" });
  assert.equal(method, "GET"); assert.equal(signal, controller.signal);
  controller.abort();
  await assert.rejects(first.queryFn({ signal: controller.signal }), { name: "AbortError" });
  assert.equal(first.staleTime, 15_000);
  assert.equal(first.refetchInterval, 30_000);
  assert.equal(first.refetchOnWindowFocus, true);
});

test("Namegame overview has one shared query for all previews and forwards cancellation", async () => {
  const overview = exports.namegameOverviewOptions();
  assert.notDeepEqual(overview.queryKey, exports.namegameOptions({ category: "", search: "", sort: "score-desc" }, 1).queryKey);
  const controller = new AbortController();
  await overview.queryFn({ signal: controller.signal });
  assert.equal(calls.at(-1)[0], "forever/namegame/overview");
  assert.equal(calls.at(-1)[3], controller.signal);
});
