import assert from "node:assert/strict";
import test from "node:test";
import warcraftLogsService from "../src/services/warcraftlogs.service";

test("CombatantInfo parsing preserves each fight's exact player specialization", () => {
  const combatants = warcraftLogsService.parseCombatantInfoByFight(
    {
      combatantInfoEvents: {
        data: [
          { type: "combatantinfo", fight: 10, sourceID: 1, specID: 1473 },
          { type: "combatantinfo", fight: 11, sourceID: 1, specID: 1468 },
          { type: "combatantinfo", fight: 11, sourceID: 2, specID: 263 },
        ],
      },
    },
    [
      { id: 1, name: "Violetcar", server: "Kazzak" },
      { id: 2, name: "Other", server: "Kazzak" },
    ],
  );

  assert.deepEqual(combatants.get(10), [
    { name: "Violetcar", server: "Kazzak", specID: 1473, specName: "augmentation" },
  ]);
  assert.deepEqual(combatants.get(11), [
    { name: "Violetcar", server: "Kazzak", specID: 1468, specName: "preservation" },
    { name: "Other", server: "Kazzak", specID: 263, specName: "enhancement" },
  ]);
});

test("CombatantInfo parsing fails closed for an unknown specialization", () => {
  assert.throws(
    () => warcraftLogsService.parseCombatantInfoByFight(
      { combatantInfoEvents: { data: [{ fight: 1, sourceID: 1, specID: 999_999 }] } },
      [{ id: 1, name: "Futurechar", server: "Kazzak" }],
    ),
    /Unsupported Blizzard specialization ID/,
  );
});
