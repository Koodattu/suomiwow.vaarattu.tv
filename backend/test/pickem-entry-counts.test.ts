import assert from "node:assert/strict";
import test from "node:test";
import User from "../src/models/User";
import pickemService from "../src/services/pickem.service";

test("counts entries with one indexed query per unique pickem", async () => {
  const originalCountDocuments = User.countDocuments;
  const calls: unknown[] = [];

  User.countDocuments = (async (query: unknown) => {
    calls.push(query);
    return calls.length === 1 ? 12 : 4;
  }) as typeof User.countDocuments;

  try {
    const counts = await pickemService.getEntryCounts(["season-two", "season-one", "season-two"]);

    assert.deepEqual([...counts], [
      ["season-two", 12],
      ["season-one", 4],
    ]);
    assert.deepEqual(calls, [
      { "pickems.pickemId": "season-two" },
      { "pickems.pickemId": "season-one" },
    ]);
  } finally {
    User.countDocuments = originalCountDocuments;
  }
});
