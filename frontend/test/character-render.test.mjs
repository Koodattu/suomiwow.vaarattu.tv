import assert from "node:assert/strict";
import test from "node:test";
import { getCharacterRenderImageUrl, getCharacterRenderProxyUrl } from "../src/lib/character-render.ts";

for (const environment of ["development", "production"]) {
  test(`stored artwork loads directly in ${environment}`, (t) => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = environment;
    t.after(() => {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    });

    for (const url of [
      "blob:http://localhost:3000/local-preview",
      "/api/ccg/media/supporter/6aaab7f5ab5d1701ab43ed51",
      "/api/ccg/media/assets/6aaab7f5ab5d1701ab43ed51",
    ]) {
      assert.equal(getCharacterRenderProxyUrl(url), url);
      assert.equal(getCharacterRenderImageUrl(url), url);
    }

    const blizzard = "https://render.worldofwarcraft.com/eu/character/realm/1/1-main-raw.png";
    const proxy = `/api/ccg/render?url=${encodeURIComponent(blizzard)}`;
    assert.equal(getCharacterRenderProxyUrl(blizzard), proxy);
    const image = getCharacterRenderImageUrl(blizzard);
    if (environment === "production") {
      const optimized = new URL(image, "https://example.com");
      assert.equal(optimized.pathname, "/_next/image");
      assert.equal(optimized.searchParams.get("url"), proxy);
    } else {
      assert.equal(image, proxy);
    }
  });
}
