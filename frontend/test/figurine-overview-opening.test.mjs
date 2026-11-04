import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

const stage = await readFile(new URL("../src/app/tools/figurine-lab/FigurineStage.tsx", import.meta.url), "utf8");
const world = await readFile(new URL("../src/app/collectibles/FigurineWorld.tsx", import.meta.url), "utf8");
const eligibility = stage.slice(stage.indexOf("    const tappable ="), stage.indexOf("    // The world is the interface:"));
const release = stage.slice(stage.indexOf("    const letGo ="), stage.indexOf("    const clearPartHover ="));
const gesture = new vm.Script(ts.transpile(`${eligibility}\n${release}\nletGo(event);`));
const opening = new vm.Script(ts.transpile(world.slice(world.indexOf("  function open()"), world.indexOf("  function revealed()")) + "\nopen(); open();"));

test("overview and close-up accept complete tape pulls, but partial, cancelled and locked pulls do not open", () => {
  for (const view of ["overview", "opening", "pond"]) for (const type of ["pointerup", "pointercancel"]) for (const locked of [false, true]) for (const progress of [0.4, 1]) {
    let opens = 0;
    const state = vm.createContext({
      immersive: true, state: { current: { view, interactive: true, locked } }, flight: null,
      press: null, looking: null, shake: null, grab: { id: 1, moved: true }, peelTarget: progress, peel: progress, released: 0, peelSound: null,
      event: { type, pointerId: 1 }, renderer: { domElement: { style: {} } }, callbacks: { current: { onBoxTap() { opens++; } } },
    });
    gesture.runInContext(state);
    const expected = view !== "pond" && type === "pointerup" && !locked && progress === 1;
    assert.equal(opens, Number(expected), `${view}, ${type}, locked=${locked}, progress=${progress}`);
    assert.equal(state.grab, null);
    if (expected) assert.equal(state.released, progress, "retain the pulled tape for the opening animation");
    else assert.equal(state.peelTarget, 0, "incomplete pulls stick back down");
  }
});

test("opening from overview pays once and enters the opening view before starting the reveal", () => {
  for (const affordable of [false, true]) {
    const events = [], paidOpening = { current: false };
    opening.runInNewContext({
      view: "overview", series: { id: "test", characters: [{ id: "figure", classKey: "mage" }] }, state: { phase: "sealed" }, paidOpening,
      spendCoin: () => { if (affordable) events.push("coin"); return affordable; }, navigate: view => events.push(view),
      unlockFigurineAudio() {}, sealedDraw: 0, model: "ready", filesFor: "figure.glb", wanted: { model: "figure.glb" },
      preloadFigurineSignature() {}, figureQuip: () => null, figureKey: () => "test:figure", dispatch: event => events.push({ ...event }),
    });
    assert.deepEqual(events, affordable ? ["coin", "opening", { type: "open", selected: 0, ready: true }] : []);
    assert.equal(paidOpening.current, affordable);
  }
});

test("the world enables sealed-box interaction in overview and close-up only", () => {
  const from = world.indexOf("interactive={") + "interactive={".length;
  const expression = new vm.Script(world.slice(from, world.indexOf("} locked=", from)));
  for (const view of ["overview", "opening", "pond"]) for (const phase of ["sealed", "loading", "opening", "revealed"]) {
    assert.equal(expression.runInNewContext({ revealedWorld: true, view, state: { phase }, webglUnavailable: false }),
      (view === "overview" || view === "opening") && phase === "sealed");
  }
});
