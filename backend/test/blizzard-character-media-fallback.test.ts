import assert from "node:assert/strict";
import test from "node:test";

test("derives and verifies CDN assets when Blizzard's character-media document is missing", async () => {
  const previousClientId = process.env.BLIZZARD_CLIENT_ID;
  const previousClientSecret = process.env.BLIZZARD_CLIENT_SECRET;
  process.env.BLIZZARD_CLIENT_ID = "test-client";
  process.env.BLIZZARD_CLIENT_SECRET = "test-secret";
  const { BlizzardApiClient } = await import("../src/services/blizzard.service");
  const client = new BlizzardApiClient() as any;
  const requestedUrls: string[] = [];
  let verifiedUrl: string | null = null;

  try {
    client.makeAuthenticatedRequest = async (url: string) => {
      requestedUrls.push(url);
      if (url.includes("/character-media?")) {
        throw new Error("Blizzard API request failed: Request failed with status 404: Not Found");
      }
      return {
        id: 173460850,
        name: "Terryadavis",
        realm: { name: "Stormreaver", slug: "stormreaver" },
      };
    };
    client.verifyCharacterRender = async (url: string) => {
      verifiedUrl = url;
    };

    const media = await client.getCharacterMedia("Terryadavis", "stormreaver", "eu");

    assert.deepEqual(media, {
      avatarUrl: "https://render.worldofwarcraft.com/eu/character/stormreaver/114/173460850-avatar.jpg",
      insetUrl: "https://render.worldofwarcraft.com/eu/character/stormreaver/114/173460850-inset.jpg",
      mainRawUrl: "https://render.worldofwarcraft.com/eu/character/stormreaver/114/173460850-main-raw.png",
    });
    assert.equal(verifiedUrl, media.mainRawUrl);
    assert.equal(requestedUrls.length, 2);
    assert.match(requestedUrls[1], /\/profile\/wow\/character\/stormreaver\/terryadavis\?namespace=profile-eu/);
  } finally {
    if (previousClientId === undefined) delete process.env.BLIZZARD_CLIENT_ID;
    else process.env.BLIZZARD_CLIENT_ID = previousClientId;
    if (previousClientSecret === undefined) delete process.env.BLIZZARD_CLIENT_SECRET;
    else process.env.BLIZZARD_CLIENT_SECRET = previousClientSecret;
  }
});

test("preserves not-found handling when the derived main-raw asset is also missing", async () => {
  const previousClientId = process.env.BLIZZARD_CLIENT_ID;
  const previousClientSecret = process.env.BLIZZARD_CLIENT_SECRET;
  process.env.BLIZZARD_CLIENT_ID = "test-client";
  process.env.BLIZZARD_CLIENT_SECRET = "test-secret";
  const { BlizzardApiClient } = await import("../src/services/blizzard.service");
  const client = new BlizzardApiClient() as any;

  try {
    client.makeAuthenticatedRequest = async (url: string) => {
      if (url.includes("/character-media?")) {
        throw new Error("Blizzard API request failed: Request failed with status 404: Not Found");
      }
      return {
        id: 173460850,
        name: "Terryadavis",
        realm: { name: "Stormreaver", slug: "stormreaver" },
      };
    };
    client.verifyCharacterRender = async () => {
      throw new Error("Blizzard character render fallback failed with status 404: Not Found");
    };

    await assert.rejects(
      () => client.getCharacterMedia("Terryadavis", "stormreaver", "eu"),
      /fallback failed with status 404/,
    );
  } finally {
    if (previousClientId === undefined) delete process.env.BLIZZARD_CLIENT_ID;
    else process.env.BLIZZARD_CLIENT_ID = previousClientId;
    if (previousClientSecret === undefined) delete process.env.BLIZZARD_CLIENT_SECRET;
    else process.env.BLIZZARD_CLIENT_SECRET = previousClientSecret;
  }
});
