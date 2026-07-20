import assert from "node:assert/strict";
import test from "node:test";
import Pickem from "../src/models/Pickem";
import User from "../src/models/User";
import pickemService from "../src/services/pickem.service";

test("deletes a pickem and pulls all matching user submissions", async () => {
  const originalDeleteOne = Pickem.deleteOne;
  const originalUpdateOne = Pickem.updateOne;
  const originalUpdateMany = User.updateMany;
  const deleteCalls: unknown[][] = [];
  const pickemUpdateCalls: unknown[][] = [];
  const updateCalls: unknown[][] = [];

  Pickem.updateOne = (async (...args: unknown[]) => {
    pickemUpdateCalls.push(args);
    return { modifiedCount: 1 };
  }) as typeof Pickem.updateOne;
  Pickem.deleteOne = (async (...args: unknown[]) => {
    deleteCalls.push(args);
    return { deletedCount: 1 };
  }) as typeof Pickem.deleteOne;
  User.updateMany = (async (...args: unknown[]) => {
    updateCalls.push(args);
    return { modifiedCount: 3 };
  }) as typeof User.updateMany;

  try {
    const result = await pickemService.deletePickem("season-one");

    assert.deepEqual(result, {
      pickemDeleted: true,
      affectedUsers: 3,
    });
    assert.deepEqual(pickemUpdateCalls, [[{ pickemId: "season-one" }, { $set: { active: false } }]]);
    assert.deepEqual(deleteCalls, [[{ pickemId: "season-one" }]]);
    assert.deepEqual(updateCalls, [[{ "pickems.pickemId": "season-one" }, { $pull: { pickems: { pickemId: "season-one" } } }]]);
  } finally {
    Pickem.updateOne = originalUpdateOne;
    Pickem.deleteOne = originalDeleteOne;
    User.updateMany = originalUpdateMany;
  }
});

test("cleans up orphaned submissions when the pickem document is already absent", async () => {
  const originalDeleteOne = Pickem.deleteOne;
  const originalUpdateOne = Pickem.updateOne;
  const originalUpdateMany = User.updateMany;

  Pickem.updateOne = (async () => ({ modifiedCount: 0 })) as unknown as typeof Pickem.updateOne;
  Pickem.deleteOne = (async () => ({ deletedCount: 0 })) as unknown as typeof Pickem.deleteOne;
  User.updateMany = (async () => ({ modifiedCount: 2 })) as unknown as typeof User.updateMany;

  try {
    assert.deepEqual(await pickemService.deletePickem("orphaned-pickem"), {
      pickemDeleted: false,
      affectedUsers: 2,
    });
  } finally {
    Pickem.updateOne = originalUpdateOne;
    Pickem.deleteOne = originalDeleteOne;
    User.updateMany = originalUpdateMany;
  }
});

test("keeps the pickem inactive and does not delete it when submission cleanup fails", async () => {
  const originalDeleteOne = Pickem.deleteOne;
  const originalUpdateOne = Pickem.updateOne;
  const originalUpdateMany = User.updateMany;
  let deleteCalled = false;

  Pickem.updateOne = (async () => ({ modifiedCount: 1 })) as unknown as typeof Pickem.updateOne;
  Pickem.deleteOne = (async () => {
    deleteCalled = true;
    return { deletedCount: 1 };
  }) as unknown as typeof Pickem.deleteOne;
  User.updateMany = (async () => {
    throw new Error("cleanup failed");
  }) as unknown as typeof User.updateMany;

  try {
    await assert.rejects(() => pickemService.deletePickem("season-one"), /cleanup failed/);
    assert.equal(deleteCalled, false);
  } finally {
    Pickem.updateOne = originalUpdateOne;
    Pickem.deleteOne = originalDeleteOne;
    User.updateMany = originalUpdateMany;
  }
});

test("waits for an in-flight submission mutation before deleting", async () => {
  const originalDeleteOne = Pickem.deleteOne;
  const originalUpdateOne = Pickem.updateOne;
  const originalUpdateMany = User.updateMany;
  let releaseSubmission: () => void = () => undefined;
  let signalSubmissionStarted: () => void = () => undefined;
  const submissionStarted = new Promise<void>((resolve) => {
    signalSubmissionStarted = resolve;
  });
  const submissionGate = new Promise<void>((resolve) => {
    releaseSubmission = resolve;
  });
  const operations: string[] = [];

  Pickem.updateOne = (async () => {
    operations.push("deactivate");
    return { modifiedCount: 1 };
  }) as unknown as typeof Pickem.updateOne;
  User.updateMany = (async () => {
    operations.push("cleanup");
    return { modifiedCount: 1 };
  }) as unknown as typeof User.updateMany;
  Pickem.deleteOne = (async () => {
    operations.push("delete");
    return { deletedCount: 1 };
  }) as unknown as typeof Pickem.deleteOne;

  try {
    const submission = pickemService.runWithMutationLock("season-one", async () => {
      operations.push("submission-start");
      signalSubmissionStarted();
      await submissionGate;
      operations.push("submission-end");
    });
    await submissionStarted;

    const deletion = pickemService.deletePickem("season-one");
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(operations, ["submission-start"]);

    releaseSubmission();
    await Promise.all([submission, deletion]);
    assert.deepEqual(operations, ["submission-start", "submission-end", "deactivate", "cleanup", "delete"]);
  } finally {
    Pickem.updateOne = originalUpdateOne;
    Pickem.deleteOne = originalDeleteOne;
    User.updateMany = originalUpdateMany;
  }
});
