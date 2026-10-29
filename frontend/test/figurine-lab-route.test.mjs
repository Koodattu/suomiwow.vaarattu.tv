import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/figurine-lab") return { url: new URL("../src/lib/figurine-lab.ts", import.meta.url).href, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
const { GET } = await import("../src/app/api/figurine-lab/character/route.ts");
function setEnv(t, key, value) {
  const previous = process.env[key];
  process.env[key] = value;
  t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
}
const request = (query = "name=R%C3%B6idy&realm=Kazzak") => new Request(`http://localhost/api/figurine-lab/character?${query}`);

test("lab is unavailable in production and invalid input never calls Blizzard", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", () => { throw new Error("Unexpected fetch"); });
  setEnv(t, "NODE_ENV", "production");
  assert.equal((await GET(request())).status, 404);
  process.env.NODE_ENV = "development";
  const response = await GET(request("name=../bad&realm=kazzak"));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "invalidInput" });
  assert.equal(fetch.mock.callCount(), 0);
});

test("lookup returns visible gear and optional media without exposing credentials", async (t) => {
  setEnv(t, "NODE_ENV", "development");
  setEnv(t, "BLIZZARD_CLIENT_ID", "test-client");
  setEnv(t, "BLIZZARD_CLIENT_SECRET", "test-secret");
  let profileStatus = 200;
  const seen = [];
  t.mock.method(globalThis, "fetch", async (input, options) => {
    const url = new URL(input);
    seen.push(url.href);
    if (url.hostname === "oauth.battle.net") {
      assert.equal(options.body, "grant_type=client_credentials");
      return Response.json({ access_token: "test-bearer", expires_in: 3600 });
    }
    assert.equal(url.hostname, "eu.api.blizzard.com");
    assert.equal(url.searchParams.get("namespace"), "profile-eu");
    assert.equal(options.headers.Authorization, "Bearer test-bearer");
    if (url.pathname.endsWith("/character-media")) return new Response(null, { status: 404 });
    if (url.pathname.endsWith("/appearance")) return Response.json({
      character: { name: "Röidy", realm: { slug: "kazzak" } }, customizations: [],
      items: [{ id: 168659, slot: { type: "CHEST" }, item_appearance_modifier_id: 0 }],
    });
    if (url.pathname.endsWith("/equipment")) return Response.json({ equipped_items: [{
      slot: { type: "CHEST", name: "Chest" }, item: { id: 271567 }, name: "Equipped",
      transmog: { item: { id: 168659, name: "Hidden Chestpiece" } },
    }] });
    if (profileStatus !== 200) return new Response("private upstream detail", { status: profileStatus });
    return Response.json({ name: "Röidy", realm: { name: "Kazzak" }, race: { name: "Haranir" }, character_class: { name: "Mage" } });
  });
  const response = await GET(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const body = await response.text();
  for (const secret of ["test-client", "test-secret", "test-bearer"]) assert.ok(!body.includes(secret));
  const result = JSON.parse(body);
  assert.equal(result.name, "Röidy");
  assert.equal(result.renderUrl, null);
  assert.equal(result.equipment[0].visibleId, 168659);
  assert.equal(result.equipment[0].modifier, 0);
  assert.ok(seen.some((url) => url.includes("/kazzak/r%C3%B6idy?")));
  for (const [status, code] of [[404, "notFound"], [429, "rateLimited"], [500, "upstreamFailed"]]) {
    profileStatus = status;
    const failed = await GET(request());
    assert.equal(failed.status, status === 500 ? 502 : status);
    assert.deepEqual(await failed.json(), { error: code });
  }
  assert.equal(seen.filter((url) => url.startsWith("https://oauth.battle.net/")).length, 1);
});
