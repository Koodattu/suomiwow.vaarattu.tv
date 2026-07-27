import assert from "node:assert/strict";
import test from "node:test";
import { isMongoWriteConflict, retryMongoWriteConflict } from "../src/utils/mongo-retry";

test("Mongo write conflicts are recognized by code, name, message, and nested cause", () => {
  assert.equal(isMongoWriteConflict({ code: 112 }), true);
  assert.equal(isMongoWriteConflict({ codeName: "WriteConflict" }), true);
  assert.equal(isMongoWriteConflict(new Error("Write conflict during plan execution")), true);
  assert.equal(isMongoWriteConflict({ cause: { code: 112 } }), true);
  assert.equal(isMongoWriteConflict(new Error("connection closed")), false);
});

test("Mongo write conflicts retry the complete operation until it succeeds", async () => {
  let attempts = 0;
  const failedAttempts: number[] = [];
  const result = await retryMongoWriteConflict(
    async () => {
      attempts += 1;
      if (attempts < 3) throw Object.assign(new Error("write conflict"), { code: 112 });
      return "committed";
    },
    {
      baseDelayMs: 0,
      onRetry: (_error, failedAttempt) => failedAttempts.push(failedAttempt),
    },
  );

  assert.equal(result, "committed");
  assert.equal(attempts, 3);
  assert.deepEqual(failedAttempts, [1, 2]);
});

test("Mongo write-conflict retries are bounded and preserve the final error", async () => {
  const finalError = Object.assign(new Error("still conflicting"), { code: 112 });
  let attempts = 0;

  await assert.rejects(
    retryMongoWriteConflict(
      async () => {
        attempts += 1;
        throw finalError;
      },
      { maxAttempts: 3, baseDelayMs: 0 },
    ),
    (error) => error === finalError,
  );
  assert.equal(attempts, 3);
});

test("non-conflict failures are not retried", async () => {
  let attempts = 0;
  await assert.rejects(
    retryMongoWriteConflict(async () => {
      attempts += 1;
      throw new Error("validation failed");
    }, { baseDelayMs: 0 }),
    /validation failed/,
  );
  assert.equal(attempts, 1);
});
