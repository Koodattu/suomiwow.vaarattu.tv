import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = ts.transpileModule(readFileSync(new URL("../src/components/admin/ForeverAdminPanel.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function panelSession() {
  const states = [], queries = [];
  let cursor = 0;
  const guilds = [
    { _id: "new", name: "New decision", status: "approved", autoReview: { action: "rejected", reviewedAt: "2026-11-17T10:00:00Z" } },
    { _id: "old", name: "Old decision", status: "approved", autoReview: { action: "approved", reviewedAt: "2026-11-16T10:00:00Z" } },
  ];
  const shared = new Proxy({}, { get: (_, key) => key });
  const exports = {};
  runInNewContext(source, { exports, URLSearchParams, require: name => {
    if (name === "react") return { useState: initial => {
      const index = cursor++;
      if (!(index in states)) states[index] = initial;
      return [states[index], value => { states[index] = value; }];
    } };
    if (name === "@tanstack/react-query") return {
      useQueryClient: () => ({}),
      useQuery: options => {
        queries.push(options);
        return { data: options.queryKey[2] === "guild" ? undefined : {
          characters: [], characterCounts: {}, guilds, guildCounts: { approved: 60 }, totalGuilds: 60,
        } };
      },
    };
    if (name === "next-intl") return { useTranslations: () => key => key };
    if (name === "next/link") return { default: "Link" };
    if (name.startsWith("@/")) return shared;
    return require(name);
  } });
  return () => {
    cursor = 0; queries.length = 0;
    const tree = exports.default();
    const nodes = [];
    const visit = node => {
      if (Array.isArray(node)) node.forEach(visit);
      else if (node && typeof node === "object" && node.props) { nodes.push(node); visit(node.props.children); }
    };
    visit(tree);
    return { nodes, params: new URLSearchParams(queries[0].queryKey[2]), detailId: queries[1].queryKey[3] };
  };
}

test("selecting each LLM history filter requests newest first and resets pagination and selection", () => {
  const render = panelSession();
  render().nodes.find(node => node.type === "button" && node.props.children?.[0] === "discoveredGuilds").props.onClick();
  for (const filter of ["auto-reviewed", "auto-approved", "auto-rejected"]) {
    let panel = render();
    panel.nodes.find(node => node.type === "select" && node.props.children.some(option => option.props.value === "name"))
      .props.onChange({ target: { value: "structured-desc" } });
    panel.nodes.find(node => node.props.total === 60).props.onChange(2);
    panel.nodes.find(node => node.type === "button" && node.key === "old").props.onClick();
    panel = render();
    assert.equal(panel.params.get("guildPage"), "2");
    assert.equal(panel.detailId, "old");
    panel.nodes.find(node => node.type === "select" && node.props.children.some(option => option.props.value === "auto-reviewed"))
      .props.onChange({ target: { value: filter } });
    panel = render();
    assert.equal(panel.params.get("guildStatus"), filter);
    assert.equal(panel.params.get("guildSort"), "reviewed-desc");
    assert.equal(panel.params.get("guildPage"), "1");
    assert.equal(panel.detailId, "new");
    assert.ok(panel.nodes.some(node => node.type === "ForeverDate" && node.props.value === "2026-11-17T10:00:00Z"));
  }
});

test("admin history and sorting translations are present in both maintained locales", () => {
  const read = locale => JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), "utf8")).forever.admin;
  for (const group of ["guildSort", "language"]) assert.deepEqual(Object.keys(read("en")[group]).sort(), Object.keys(read("fi")[group]).sort());
  for (const locale of ["en", "fi"]) {
    assert.ok(read(locale).guildSort["reviewed-desc"]);
    assert.ok(read(locale).language["auto-reviewed"]);
  }
});
