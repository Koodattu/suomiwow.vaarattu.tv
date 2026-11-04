import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

const pointer = await readFile(new URL("../src/lib/figurine-pointer.ts", import.meta.url), "utf8");
const stage = await readFile(new URL("../src/app/tools/figurine-lab/FigurineStage.tsx", import.meta.url), "utf8");

test("leaving the viewport, blurring or hiding clears hover; cleanup removes listeners", () => {
  const document = Object.assign(new EventTarget(), { documentElement: new EventTarget(), hidden: false });
  const window = new EventTarget();
  let clears = 0;
  const context = vm.createContext({ document, window, clear: () => clears++ });
  new vm.Script(ts.transpile(pointer.replace("export function", "function")) + "\nconst stop = onFigurinePointerExit(clear);").runInContext(context);
  document.dispatchEvent(new Event("visibilitychange"));
  assert.equal(clears, 0, "a visible page does not lose keyboard highlights");
  document.documentElement.dispatchEvent(new Event("pointerleave"));
  window.dispatchEvent(new Event("blur"));
  document.hidden = true;
  document.dispatchEvent(new Event("visibilitychange"));
  assert.equal(clears, 3);
  vm.runInContext("stop()", context);
  document.documentElement.dispatchEvent(new Event("pointerleave"));
  window.dispatchEvent(new Event("blur"));
  document.dispatchEvent(new Event("visibilitychange"));
  assert.equal(clears, 3, "unmounted scenes no longer receive exit events");
});

test("canvas exit clears world hover and the corresponding HUD without cancelling a tape drag", () => {
  const source = stage.slice(stage.indexOf("    const clearPartHover ="), stage.indexOf("    const stopPointerExit ="));
  for (const dragging of [false, true]) {
    const calls = [];
    const grab = dragging ? { id: 1 } : null;
    const context = vm.createContext({
      hovering: true, hoverTape: true, press: {}, hoveredSeries: "series", hoveredStation: "pond", hoveredMachine: "slot", hoveredPart: "rod", grab,
      renderer: { domElement: { style: { cursor: dragging ? "grabbing" : "pointer" } } },
      callbacks: { current: {
        onHoverStation: value => calls.push(["station", value]),
        onHoverFigure: value => calls.push(["figure", value]),
        onHoverPart: value => calls.push(["part", value]),
      } },
    });
    new vm.Script(ts.transpile(source) + "\nonPointerLeave();").runInContext(context);
    for (const key of ["hoveredSeries", "hoveredStation", "hoveredMachine", "hoveredPart", "press"]) assert.equal(context[key], null);
    assert.equal(context.hovering, false);
    assert.equal(context.hoverTape, false);
    assert.deepEqual(calls, [["station", null], ["figure", null], ["part", null]]);
    assert.equal(context.grab, grab);
    assert.equal(context.renderer.domElement.style.cursor, dragging ? "grabbing" : "");
  }
});
