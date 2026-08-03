import assert from "node:assert/strict";
import test from "node:test";
import RateLimitState from "../src/models/RateLimitState";
import { RateLimitService, resolveWclRateLimitBucket } from "../src/services/rate-limit.service";
import { parseRetryAfterMs } from "../src/services/warcraftlogs.service";

test("WCL endpoints share a bucket only when they use the same OAuth client", () => {
  const sharedEnvironment = { WCL_CLIENT_ID: "public-client" };
  const distinctEnvironment = { WCL_CLIENT_ID: "public-client", WCL_OAUTH_CLIENT_ID: "private-client" };

  assert.equal(resolveWclRateLimitBucket("client", sharedEnvironment).persistentKey, "warcraftlogs:shared");
  assert.equal(resolveWclRateLimitBucket("user", sharedEnvironment).persistentKey, "warcraftlogs:shared");
  assert.equal(resolveWclRateLimitBucket("client", distinctEnvironment).persistentKey, "warcraftlogs:client");
  assert.equal(resolveWclRateLimitBucket("user", distinctEnvironment).persistentKey, "warcraftlogs:user");
});

test("Retry-After supports both seconds and HTTP dates", () => {
  const now = Date.parse("2026-08-03T12:00:00Z");

  assert.equal(parseRetryAfterMs("3326", now), 3_326_000);
  assert.equal(parseRetryAfterMs("Mon, 03 Aug 2026 12:01:30 GMT", now), 90_000);
  assert.equal(parseRetryAfterMs("invalid", now), 60_000);
  assert.equal(parseRetryAfterMs(null, now), 60_000);
});

test("a WCL 429 becomes authoritative local state and suppresses estimates until retry", async () => {
  const originalFindOneAndUpdate = RateLimitState.findOneAndUpdate;
  let writes = 0;
  (RateLimitState as any).findOneAndUpdate = (..._args: unknown[]) => {
    writes += 1;
    return { lean: async () => null };
  };

  try {
    const service = new RateLimitService();
    const limited = await service.recordRateLimited("client", 3_326_000);

    assert.equal(limited.source, "rate_limited");
    assert.equal(limited.isHardLimited, true);
    assert.equal(limited.isPaused, true);
    assert.equal(limited.pointsRemaining, 0);
    assert.ok(limited.resetInSeconds >= 3_325);

    await service.recordEstimatedUsage(100, "client");
    assert.equal(writes, 1);
    assert.equal(service.getStatus("client").source, "rate_limited");
  } finally {
    (RateLimitState as any).findOneAndUpdate = originalFindOneAndUpdate;
  }
});

test("estimated usage is retained when a same-window observation is lower", async () => {
  const originalFindOneAndUpdate = RateLimitState.findOneAndUpdate;
  const updates: unknown[] = [];
  (RateLimitState as any).findOneAndUpdate = (_filter: unknown, update: unknown) => {
    updates.push(update);
    return { lean: async () => null };
  };

  try {
    const service = new RateLimitService();
    await service.updateFromResponse(
      { limitPerHour: 18_000, pointsSpentThisHour: 100, pointsResetIn: 600 },
      "client",
      1,
    );
    await service.recordEstimatedUsage(25, "client");
    await service.updateFromResponse(
      { limitPerHour: 18_000, pointsSpentThisHour: 110, pointsResetIn: 600 },
      "client",
      1,
    );

    const status = service.getStatus("client");
    assert.equal(status.pointsUsed, 126);
    assert.equal(status.source, "estimated");
    assert.equal(updates.length, 3);
    assert.match(JSON.stringify(updates[1]), /\$add/);
  } finally {
    (RateLimitState as any).findOneAndUpdate = originalFindOneAndUpdate;
  }
});
