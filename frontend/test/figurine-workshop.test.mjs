import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { readFile } from "node:fs/promises";
import { machineOutcome, machineChanges, MACHINE_SLOTS, spare } from "../src/lib/figurine-collection.ts";

// Exercise the callbacks used by both the overlay buttons and the world machines.
const source = await readFile(new URL("../src/app/collectibles/FigurineWorld.tsx", import.meta.url), "utf8");
const callbacks = ts.transpile(source.slice(source.indexOf("  function pickCard("), source.indexOf("  const qualityName =")));
test("a machine run locks both control surfaces until its animation completes", () => {
  for (const kind of ["forge", "recycler"]) {
    const item = { key: "community-001:roidy", quality: "standard" }, collection = { [item.key]: { standard: 6 } };
    const slots = { [kind]: [item, item, item] }, outcome = machineOutcome(kind, slots[kind], collection);
    const state = vm.createContext({ MACHINE_SLOTS, spare, collection, slots, outcomes: { [kind]: outcome },
      machineLocks: { current: new Set() }, running: { [kind]: false }, machineRuns: { [kind]: { run: 0 } }, changes: [],
      unlockFigurineAudio() {}, recordPull() {}, recordRecycle() {}, grantReward(reward) { state.coins = (state.coins ?? 0) + reward.coins; },
      dismissRecycledCoin() { state.dismissed = true; }, setRecycledCoin() {},
      machineChanges, changeCollection(changes) { state.changes.push(changes); return true; },
      loadSlots(machine, next) { slots[machine] = next; },
      setRunningMachines(update) { state.running = update(state.running); },
      setMachineRuns(update) { state.machineRuns = update(state.machineRuns); },
      viewRef: { current: "overview" }, pickSeries() { assert.fail("should not navigate after leaving a machine"); },
      inspect() { assert.fail("should not navigate after leaving a machine"); }, setUpgraded() {},
    });
    vm.runInContext(callbacks, state);
    state.operateMachine(kind, { kind: "trigger" });
    assert.equal(state.running[kind], true);
    assert.equal(state.machineRuns[kind].run, 1);
    assert.equal(state.changes.length, 1);
    assert.equal(state.coins, kind === "recycler" ? 1 : undefined, "only the recycler pays a coin");
    state.operateMachine(kind, { kind: "trigger" });
    state.pickCard(kind, item);
    state.operateMachine(kind, { kind: "slot", index: 0 });
    assert.equal(state.changes.length, 1, "rapid clicks cannot consume a second recipe");
    assert.equal(slots[kind].length, 0, "running machines cannot be reloaded");
    state.machineDone(kind);
    assert.equal(state.dismissed, kind === "recycler" ? true : undefined, "a coin earned while away still reaches the wallet");
    assert.equal(state.running[kind], false);
    assert.equal(state.machineLocks.current.size, 0);
    state.pickCard(kind, item);
    assert.equal(slots[kind].length, kind === "forge" ? 3 : 1);
  }
});
