import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const exports = {};
const source = readFileSync(new URL("../src/lib/forever-guilds.ts", import.meta.url), "utf8");
runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, { exports });
const { filterForeverGuilds, filterForeverRoster, emptyGuildFilters } = exports;
const guilds = [
  { _id: "1", name: "Näätä [EU]", rosterCount: 20, ruleset: "Normal", faction: "Alliance" },
  { _id: "2", name: "Alpha", rosterCount: 50, ruleset: "Hardcore", faction: "Horde" },
  { _id: "3", name: "Beta", rosterCount: 50, ruleset: "Normal", faction: "Horde" },
  { _id: "4", name: "Zulu", rosterCount: 0, ruleset: null, faction: null },
];
const ids = values => Array.from(values, value => value._id);

test("guild search is literal, Unicode-normalized and combined with faction/ruleset filters", () => {
  assert.deepEqual(ids(filterForeverGuilds(guilds, { search: "  NA\u0308A\u0308TA\u0308 [eu] ", faction: "Alliance", ruleset: "Normal" }, "sizeDesc", "fi")), ["1"]);
  assert.deepEqual(ids(filterForeverGuilds(guilds, { search: "", faction: "Horde", ruleset: "Normal" }, "sizeDesc", "en")), ["3"]);
  assert.equal(filterForeverGuilds(guilds, { search: "missing", faction: "", ruleset: "" }, "sizeDesc", "en").length, 0);
  assert.deepEqual(ids(filterForeverGuilds(guilds, { search: "", faction: "unknown", ruleset: "unknown" }, "sizeDesc", "en")), ["4"]);
});

test("guild sorting supports both size/name directions with deterministic ties and no mutation", () => {
  for (const [sort, expected] of [["sizeDesc", ["2", "3", "1", "4"]], ["sizeAsc", ["4", "1", "2", "3"]],
    ["nameAsc", ["2", "3", "1", "4"]], ["nameDesc", ["4", "1", "3", "2"]]]) {
    assert.deepEqual(ids(filterForeverGuilds(guilds, emptyGuildFilters, sort, "fi")), expected);
  }
  assert.deepEqual(ids(guilds), ["1", "2", "3", "4"]);
});

test("roster search and level/name sorting retain untracked members and place unknown levels last", () => {
  const roster = [{ name: "Zulu", slug: "z", level: 60 }, { name: "Alpha", slug: "a", level: 12 }, { name: "Beta", slug: "b", level: null }];
  const names = (search, sort) => Array.from(filterForeverRoster(roster, search, sort, "en"), member => member.name);
  assert.deepEqual(names("", "levelDesc"), ["Zulu", "Alpha", "Beta"]);
  assert.deepEqual(names("", "levelAsc"), ["Alpha", "Zulu", "Beta"]);
  assert.deepEqual(names("", "nameAsc"), ["Alpha", "Beta", "Zulu"]);
  assert.deepEqual(names("", "nameDesc"), ["Zulu", "Beta", "Alpha"]);
  assert.deepEqual(names(" ALPHA ", "levelDesc"), ["Alpha"]);
  assert.deepEqual(roster.map(member => member.name), ["Zulu", "Alpha", "Beta"]);
});

test("guild translations cover the same keys in both maintained languages", () => {
  const read = locale => JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), "utf8")).forever.guilds;
  assert.deepEqual(Object.keys(read("en")).sort(), Object.keys(read("fi")).sort());
  assert.deepEqual(Object.keys(read("en").sorts).sort(), Object.keys(read("fi").sorts).sort());
});
