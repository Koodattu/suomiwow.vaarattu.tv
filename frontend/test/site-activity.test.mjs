import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const code = ts.transpileModule(readFileSync(new URL("../src/components/SiteActivityTracker.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

function browser({ dnt = "0", gpc = false, hidden = false, responses = [] } = {}) {
  const events = [], intervals = new Map(), listeners = new Map(), reference = { current: null };
  let effect, cleanup, pathname = "/forever/leveling", clock = 0, nextTimer = 1;
  const document = { visibilityState: hidden ? "hidden" : "visible", addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  const window = { addEventListener: document.addEventListener, removeEventListener: document.removeEventListener,
    setInterval(fn) { const id = nextTimer++; intervals.set(id, fn); return id; }, clearInterval: id => intervals.delete(id) };
  const exports = {};
  runInNewContext(code, { exports, document, window, navigator: { doNotTrack: dnt, globalPrivacyControl: gpc, webdriver: true }, crypto: { randomUUID }, Date: { now: () => clock }, process: { env: {} },
    fetch: async (_url, options) => { events.push(JSON.parse(options.body)); const response = responses.shift(); if (response instanceof Error) throw response; return { status: response || 204 }; },
    require(name) {
      if (name === "react") return { useEffect: fn => { effect = fn; }, useRef: () => reference };
      if (name === "next/navigation") return { usePathname: () => pathname };
      throw new Error(name);
    },
  });
  return { events, intervals, listeners,
    mount(path = pathname) { cleanup?.(); pathname = path; exports.default(); cleanup = effect(); },
    unmount() { cleanup?.(); },
    tick(minutes = 1) { clock += minutes * 60000; for (const fn of intervals.values()) fn(); },
    visible(value) { document.visibilityState = value ? "visible" : "hidden"; listeners.get("visibilitychange")?.(); },
    interact() { listeners.get("pointerdown")?.(); },
  };
}

test("one view per visible navigation, including StrictMode effect replay", () => {
  const app = browser(); app.mount(); app.mount();
  assert.equal(app.events.length, 1);
  app.tick(); assert.equal(app.events[1].kind, "activity");
  app.visible(false); app.tick(); app.mount("/characters");
  assert.equal(app.events.length, 2);
  app.visible(true); assert.equal(app.events[2].path, "/characters");
  assert.equal(app.events[2].kind, "pageview"); assert.equal(app.events[2].automated, true);
  app.mount("/admin/analytics"); app.tick(); assert.equal(app.events.length, 3);
  app.mount("/ccg/overlay"); app.tick(); assert.equal(app.events.length, 3);
  app.unmount(); assert.equal(app.intervals.size, 0); assert.equal(app.listeners.size, 0);
});

test("inactive tabs stop activity; interaction resumes it without extra page views", () => {
  const app = browser(); app.mount(); app.tick(6); assert.equal(app.events.length, 1);
  app.interact(); app.tick(); assert.equal(app.events.length, 2); assert.equal(app.events[1].kind, "activity");
});

test("hidden initial visits wait for visibility and privacy preferences disable collection", () => {
  for (const options of [{ dnt: "1" }, { gpc: true }]) { const app = browser(options); app.mount(); app.tick(); assert.equal(app.events.length, 0); }
  const app = browser({ hidden: true }); app.mount(); assert.equal(app.events.length, 0);
  app.visible(true); assert.equal(app.events.length, 1);
});

test("transient failures retry the same event ID once; rejected requests do not retry", async () => {
  for (const responses of [[503, 503], [new Error("network"), 204], [403]]) {
    const expected = responses.length, app = browser({ responses }); app.mount();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(app.events.length, expected);
    assert.ok(app.events.every(event => event.eventId === app.events[0].eventId));
  }
});
