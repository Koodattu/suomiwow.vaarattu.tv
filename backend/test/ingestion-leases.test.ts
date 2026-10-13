import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import mongoose from "mongoose";
import { IngestionLeaseService, IngestionLeaseLostError, INGESTION_LEASE_MS, INGESTION_HEARTBEAT_MS } from "../src/services/ingestion-lease.service";
import policy, { ReportOverrideError } from "../src/services/report-override-policy.service";

test("heartbeats keep a healthy long import alive without changing its owner", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000_000 });
  const manager = new IngestionLeaseService();
  let expiry = Date.now() + INGESTION_LEASE_MS;
  let renewals = 0;
  const model: any = { collection: { updateOne: async (filter: any, update: any) => {
    assert.equal(filter.lockToken, "owner");
    if (update.$unset) return { matchedCount: 1 };
    assert.ok(expiry > filter.expiresAt.$gt.getTime(), "an expired lease must not be resurrected");
    expiry = update.$set.expiresAt.getTime();
    renewals++;
    return { matchedCount: 1 };
  } } };
  manager.track({ model, filter: { code: "report" }, token: "owner", tokenField: "lockToken", timeField: "lockedAt", expiryField: "expiresAt" });
  for (let i = 0; i < 6; i++) {
    t.mock.timers.tick(INGESTION_HEARTBEAT_MS);
    await setImmediate();
    assert.equal(expiry, Date.now() + INGESTION_LEASE_MS);
  }
  assert.equal(renewals, 6);
  await manager.release("owner");
  t.mock.timers.tick(INGESTION_LEASE_MS);
  await setImmediate();
  assert.equal(renewals, 6, "release must stop heartbeat timers");
});

test("a failed renewal blocks subsequent writes and stops renewing", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000_000 });
  const manager = new IngestionLeaseService();
  let renewals = 0;
  const model: any = { collection: { updateOne: async (_filter: any, update: any) => {
    if (update.$unset) return { matchedCount: 1 };
    renewals++;
    throw new Error("database unavailable");
  } } };
  manager.track({ model, filter: { code: "report" }, token: "owner", tokenField: "lockToken", timeField: "lockedAt", expiryField: "expiresAt" });
  t.mock.timers.tick(INGESTION_HEARTBEAT_MS);
  await setImmediate();
  t.mock.method(mongoose.connection, "transaction", async (work: (session: any) => Promise<any>) => work({}));
  await assert.rejects(manager.writeFor("owner", async () => { assert.fail("lost owners must not write"); }), IngestionLeaseLostError);
  t.mock.timers.tick(INGESTION_LEASE_MS);
  await setImmediate();
  assert.equal(renewals, 1);
  await manager.release("owner");
});

test("cleanup attempts every owned lock even if one release fails", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const manager = new IngestionLeaseService();
  const released: string[] = [];
  const model: any = { collection: { updateOne: async (filter: any) => {
    released.push(filter.code);
    if (filter.code === "first") throw new Error("release failed");
    return { matchedCount: 1 };
  } } };
  for (const code of ["first", "second"]) manager.track({ model, filter: { code }, token: "owner", tokenField: "lockToken", timeField: "lockedAt", expiryField: "expiresAt" });
  await assert.rejects(manager.release("owner"), /release failed/);
  assert.deepEqual(released, ["first", "second"]);
  assert.equal(await manager.drain(0), true);
});

test("shutdown includes an acquisition already in flight", async () => {
  const manager = new IngestionLeaseService();
  let finish!: () => void;
  const pending = manager.acquiringLease(() => new Promise<void>((resolve) => { finish = resolve; }));
  assert.equal(await manager.drain(0), false);
  await assert.rejects(manager.acquiringLease(async () => undefined), /shutting down/);
  finish();
  await pending;
  assert.equal(await manager.drain(0), true);
});

test("polling skips contention but manual and paged imports keep a retryable busy error", async (t) => {
  t.mock.method(policy, "allowed", async () => true);
  t.mock.method(policy, "acquire", async () => { throw new ReportOverrideError(409, "report_busy", "busy"); });
  assert.equal(await policy.acquireForIngestion("busy", "guild", true), null);
  await assert.rejects(policy.acquireForIngestion("busy", "guild"), (error: any) => error.code === "report_busy");
  t.mock.method(policy, "acquire", async () => { throw new Error("database unavailable"); });
  await assert.rejects(policy.acquireForIngestion("busy", "guild", true), /database unavailable/);
});
