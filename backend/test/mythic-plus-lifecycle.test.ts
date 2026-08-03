import assert from "node:assert/strict";
import test from "node:test";
import CharacterMythicPlusFetchJob from "../src/models/CharacterMythicPlusFetchJob";
import mythicPlusService from "../src/services/mythic-plus.service";

test("Mythic+ recovery starts the processor when queued work exists", async (t) => {
  const jobModel = CharacterMythicPlusFetchJob as any;
  const service = mythicPlusService as any;
  const originalCountDocuments = jobModel.countDocuments;
  const originalStartProcessing = service.startProcessing;
  let recoveryFilter: Record<string, unknown> | null = null;

  t.after(() => {
    jobModel.countDocuments = originalCountDocuments;
    service.startProcessing = originalStartProcessing;
    service.isRunning = false;
    service.isCheckingRecovery = false;
  });

  jobModel.countDocuments = async (filter: Record<string, unknown>) => {
    recoveryFilter = filter;
    return 83_573;
  };
  service.startProcessing = () => true;
  service.isRunning = false;
  service.isCheckingRecovery = false;

  assert.equal(await mythicPlusService.resumeInterruptedCrawl(), true);
  assert.deepEqual(recoveryFilter, {
    status: { $in: ["pending", "in_progress", "rate_limited"] },
  });
});

test("Mythic+ recovery stays idle when the queue is empty", async (t) => {
  const jobModel = CharacterMythicPlusFetchJob as any;
  const service = mythicPlusService as any;
  const originalCountDocuments = jobModel.countDocuments;
  const originalStartProcessing = service.startProcessing;
  let startCalls = 0;

  t.after(() => {
    jobModel.countDocuments = originalCountDocuments;
    service.startProcessing = originalStartProcessing;
    service.isRunning = false;
    service.isCheckingRecovery = false;
  });

  jobModel.countDocuments = async () => 0;
  service.startProcessing = () => {
    startCalls += 1;
    return true;
  };
  service.isRunning = false;
  service.isCheckingRecovery = false;

  assert.equal(await mythicPlusService.resumeInterruptedCrawl(), false);
  assert.equal(startCalls, 0);
});
