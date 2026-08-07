import assert from "node:assert/strict";
import test from "node:test";

test("full rescans queue fight details before report characters", async (t) => {
  process.env.BLIZZARD_CLIENT_ID ||= "test-client";
  process.env.BLIZZARD_CLIENT_SECRET ||= "test-secret";
  process.env.RAIDER_IO_API_KEY ||= "test-key";

  const { default: backgroundGuildProcessor } = await import("../src/services/background-guild-processor.service");
  const processor = backgroundGuildProcessor as any;
  const originalQueueGuild = processor.queueGuild;
  const calls: Array<{ priority: number; jobType: string }> = [];
  const guild = { name: "New Guild", realm: "new-realm" };

  t.after(() => {
    processor.queueGuild = originalQueueGuild;
  });

  processor.queueGuild = async (_guild: unknown, priority: number, jobType: string) => {
    calls.push({ priority, jobType });
    return { status: "pending" };
  };

  await processor.queueFullRescanFollowUps(guild);

  assert.deepEqual(calls, [
    { priority: 15, jobType: "rescan_deaths" },
    { priority: 20, jobType: "backfill_report_characters" },
  ]);
});

test("full rescan follow-up queueing surfaces failures for the parent retry path", async (t) => {
  process.env.BLIZZARD_CLIENT_ID ||= "test-client";
  process.env.BLIZZARD_CLIENT_SECRET ||= "test-secret";
  process.env.RAIDER_IO_API_KEY ||= "test-key";

  const { default: backgroundGuildProcessor } = await import("../src/services/background-guild-processor.service");
  const processor = backgroundGuildProcessor as any;
  const originalQueueGuild = processor.queueGuild;
  const calls: string[] = [];

  t.after(() => {
    processor.queueGuild = originalQueueGuild;
  });

  processor.queueGuild = async (_guild: unknown, _priority: number, jobType: string) => {
    calls.push(jobType);
    throw new Error("queue unavailable");
  };

  await assert.rejects(
    processor.queueFullRescanFollowUps({ name: "New Guild", realm: "new-realm" }),
    /queue unavailable/,
  );
  assert.deepEqual(calls, ["rescan_deaths"]);
});
