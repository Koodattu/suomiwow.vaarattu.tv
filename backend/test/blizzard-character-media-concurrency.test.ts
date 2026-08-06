import assert from "node:assert/strict";
import test from "node:test";

test("Blizzard character-media lookups respect their configured concurrency", async () => {
  const previousClientId = process.env.BLIZZARD_CLIENT_ID;
  const previousClientSecret = process.env.BLIZZARD_CLIENT_SECRET;
  const previousConcurrency = process.env.CCG_MEDIA_API_CONCURRENCY;
  process.env.BLIZZARD_CLIENT_ID = "test-client";
  process.env.BLIZZARD_CLIENT_SECRET = "test-secret";
  process.env.CCG_MEDIA_API_CONCURRENCY = "1";
  const { BlizzardApiClient } = await import("../src/services/blizzard.service");
  const client = new BlizzardApiClient() as any;
  let active = 0;
  let maximumActive = 0;

  try {
    client.makeAuthenticatedRequest = async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return { assets: [{ key: "main-raw", value: "https://render.worldofwarcraft.com/eu/render.png" }] };
    };

    await Promise.all([
      client.getCharacterMedia("One", "draenor", "eu"),
      client.getCharacterMedia("Two", "draenor", "eu"),
      client.getCharacterMedia("Three", "draenor", "eu"),
    ]);

    assert.equal(maximumActive, 1);
  } finally {
    if (previousClientId === undefined) delete process.env.BLIZZARD_CLIENT_ID;
    else process.env.BLIZZARD_CLIENT_ID = previousClientId;
    if (previousClientSecret === undefined) delete process.env.BLIZZARD_CLIENT_SECRET;
    else process.env.BLIZZARD_CLIENT_SECRET = previousClientSecret;
    if (previousConcurrency === undefined) delete process.env.CCG_MEDIA_API_CONCURRENCY;
    else process.env.CCG_MEDIA_API_CONCURRENCY = previousConcurrency;
  }
});
