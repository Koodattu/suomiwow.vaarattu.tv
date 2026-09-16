import assert from "node:assert/strict";
import test, { TestContext } from "node:test";
import User, { IBattleNetAccount, IWoWCharacter } from "../src/models/User";
import service, { BattleNetSyncError } from "../src/services/battlenet-auth.service";

function character(id: number, selected = false): IWoWCharacter {
  return { id, name: `Character${id}`, realm: "Kazzak", realmSlug: "kazzak", class: "Mage", race: "Orc", level: 80, faction: "HORDE", selected };
}

function account(characters = [character(1, true)]): IBattleNetAccount {
  return {
    id: "account", battletag: "Test#1234", accessToken: "test-token",
    tokenExpiresAt: new Date(Date.now() + 60000), connectedAt: new Date(), lastCharacterSync: null, characters,
  };
}

function profileResponse(characters: IWoWCharacter[]): Response {
  return Response.json({ wow_accounts: [{ characters: characters.map((char) => ({
    ...char, realm: { name: char.realm, slug: char.realmSlug, id: 1 },
    playable_class: { name: char.class }, playable_race: { name: char.race }, faction: { type: char.faction },
  })) }] });
}

test("Studio ownership includes low-level characters and stable realm IDs without changing profile defaults", async (t) => {
  const lowLevel = { ...character(1), level: 10 };
  t.mock.method(globalThis, "fetch", async () => profileResponse([lowLevel]));
  assert.deepEqual(await service.getWoWCharacters("test-token", false), []);
  const roster = await service.getWoWCharacters("test-token", false, 0);
  assert.equal(roster.length, 1);
  assert.equal(roster[0].level, 10);
  assert.equal(roster[0].realmId, 1);
});

// Model snapshots reproduce the separate documents read by simultaneous requests.
function mockStore(t: TestContext, initial = account()) {
  let current: { battlenet?: IBattleNetAccount } = { battlenet: initial };
  const find = t.mock.method(User, "findById", async () => structuredClone(current) as any);
  const update = t.mock.method(User, "findOneAndUpdate", async (filter: any, operation: any) => {
    if (filter["battlenet.accessToken"] !== current.battlenet?.accessToken
      || JSON.stringify(filter["battlenet.characters"]) !== JSON.stringify(current.battlenet?.characters)) return null;
    current.battlenet!.characters = structuredClone(operation.$set["battlenet.characters"]);
    current.battlenet!.lastCharacterSync = operation.$set["battlenet.lastCharacterSync"];
    return structuredClone(current) as any;
  });
  return { find, update, get current() { return current; }, disconnect() { current = {}; } };
}

for (const status of [401, 403, 404, 429, 500, 503]) {
  test(`Blizzard HTTP ${status} never clears saved characters or advances sync time`, async (t) => {
    const store = mockStore(t);
    t.mock.method(globalThis, "fetch", async () => new Response(null, { status }));
    await assert.rejects(service.refreshCharacters("user"), (error: unknown) => {
      assert.ok(error instanceof BattleNetSyncError);
      assert.equal(error.code, [401, 403].includes(status) ? "BATTLENET_RECONNECT_REQUIRED" : "BATTLENET_UNAVAILABLE");
      return true;
    });
    assert.deepEqual(store.current.battlenet?.characters, [character(1, true)]);
    assert.equal(store.current.battlenet?.lastCharacterSync, null);
    assert.equal(store.update.mock.callCount(), 0);
  });
}

test("a failed refresh releases its lock and can be retried", async (t) => {
  const store = mockStore(t);
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw new Error("Network unavailable"); });
  await assert.rejects(service.refreshCharacters("user"), /Network unavailable/);
  fetch.mock.mockImplementation(async () => profileResponse([]) as never);
  assert.deepEqual(await service.refreshCharacters("user"), []);
  assert.deepEqual(store.current.battlenet?.characters, []);
  assert.ok(store.current.battlenet?.lastCharacterSync instanceof Date);
});

test("expired access requests reconnection without calling Blizzard", async (t) => {
  const initial = account();
  initial.tokenExpiresAt = new Date(0);
  initial.lastCharacterSync = new Date();
  const store = mockStore(t, initial);
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected request"); });
  await assert.rejects(service.refreshCharacters("user"), { code: "BATTLENET_RECONNECT_REQUIRED" });
  assert.equal(fetch.mock.callCount(), 0);
  assert.equal(store.update.mock.callCount(), 0);
});

test("a recent successful sync returns saved data without a rate-limit error", async (t) => {
  const initial = account();
  initial.lastCharacterSync = new Date();
  mockStore(t, initial);
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected request"); });
  assert.deepEqual(await service.refreshCharacters("user"), initial.characters);
  assert.equal(fetch.mock.callCount(), 0);
});

test("simultaneous refreshes share bounded parallel lookups and retain selections made during sync", async (t) => {
  const chars = Array.from({ length: 12 }, (_, index) => character(index + 1, index === 0));
  const store = mockStore(t, account(chars));
  let summaryCalls = 0;
  let active = 0;
  let maxActive = 0;
  t.mock.method(globalThis, "fetch", async (url: Parameters<typeof fetch>[0], options?: Parameters<typeof fetch>[1]) => {
    assert.ok(options?.signal, "Every external request has a timeout");
    if (String(url).includes("/profile/user/wow?")) {
      summaryCalls++;
      return profileResponse(chars);
    }
    active++;
    maxActive = Math.max(active, maxActive);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    store.current.battlenet!.characters[0].selected = false;
    store.current.battlenet!.characters[1].selected = true;
    return Response.json({ guild: { name: "Guild", realm: { name: "Kazzak", slug: "kazzak" } } });
  });
  const [first, second] = await Promise.all([service.refreshCharacters("user"), service.refreshCharacters("user")]);
  assert.equal(summaryCalls, 1);
  assert.ok(maxActive > 1 && maxActive <= 5, `Observed ${maxActive} parallel requests`);
  assert.equal(store.update.mock.callCount(), 1);
  assert.deepEqual(first, second);
  assert.equal(first[0].selected, false);
  assert.equal(first[1].selected, true);
  assert.ok(first.every((char) => char.guild === "Guild"));
});

test("a selection changed between reading and writing is re-read instead of overwritten", async (t) => {
  const store = mockStore(t);
  t.mock.method(globalThis, "fetch", async (url: Parameters<typeof fetch>[0]) => String(url).includes("/profile/user/wow?") ? profileResponse([character(1)]) : Response.json({}));
  store.update.mock.mockImplementationOnce(async () => {
    store.current.battlenet!.characters[0].selected = false;
    return null;
  });
  const result = await service.refreshCharacters("user");
  assert.equal(store.update.mock.callCount(), 2);
  assert.equal(result[0].selected, false);
});

test("slow guild lookups stop starting new requests after the budget and prioritize selected characters", async (t) => {
  const chars = Array.from({ length: 12 }, (_, index) => character(index + 1, index === 11));
  mockStore(t, account(chars));
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  const requested: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: Parameters<typeof fetch>[0]) => {
    if (String(url).includes("/profile/user/wow?")) return profileResponse(chars);
    requested.push(String(url));
    now += 11000;
    return Response.json({});
  });
  const result = await service.refreshCharacters("user");
  assert.equal(requested.length, 1);
  assert.ok(requested[0].includes("character12?"));
  assert.equal(result.length, 12, "Optional guild lookups never truncate the character list");
  assert.equal(result[11].selected, true);
});

for (const change of ["disconnect", "reconnect"] as const) {
  test(`an old sync cannot overwrite a concurrent ${change}`, async (t) => {
    const store = mockStore(t);
    t.mock.method(globalThis, "fetch", async (url: Parameters<typeof fetch>[0]) => {
      if (String(url).includes("/profile/user/wow?")) return profileResponse([character(1)]);
      if (change === "disconnect") store.disconnect();
      else store.current.battlenet!.accessToken = "replacement-token";
      return Response.json({});
    });
    await assert.rejects(service.refreshCharacters("user"), { code: "BATTLENET_ACCOUNT_CHANGED" });
    assert.equal(store.update.mock.callCount(), 0);
  });
}

test("optional guild failures preserve cached guild details", async (t) => {
  const chars = [{ ...character(1, true), guild: "Old Guild", guildRealm: "Kazzak", guildRealmSlug: "kazzak" }];
  mockStore(t, account(chars));
  t.mock.method(globalThis, "fetch", async (url: Parameters<typeof fetch>[0]) => String(url).includes("/profile/user/wow?") ? profileResponse(chars) : new Response(null, { status: 503 }));
  assert.deepEqual((await service.refreshCharacters("user"))[0], { ...chars[0], inactive: undefined });
});

test("a successful guildless profile clears stale guild and inactive details", async (t) => {
  const chars = [{ ...character(1, true), guild: "inactive", guildRealm: "Kazzak", guildRealmSlug: "kazzak", inactive: true }];
  mockStore(t, account(chars));
  t.mock.method(globalThis, "fetch", async (url: Parameters<typeof fetch>[0]) => String(url).includes("/profile/user/wow?") ? profileResponse(chars) : Response.json({}));
  const [result] = await service.refreshCharacters("user");
  assert.equal(result.guild, undefined);
  assert.equal(result.guildRealmSlug, undefined);
  assert.equal(result.inactive, false);
  assert.equal(result.selected, true);
});

test("reauthorizing the same account preserves selections and cached guilds", async (t) => {
  const user = { battlenet: account([{ ...character(1, true), guild: "Guild" }]), save: async () => {} };
  t.mock.method(User, "findOne", async () => null as any);
  t.mock.method(User, "findById", async () => user as any);
  const result = await service.connectBattleNetAccount("user", { sub: "account", id: 1, battletag: "Test#1234" },
    { access_token: "new-token", expires_in: 60000, token_type: "bearer", scope: "wow.profile", sub: "account" }, [character(1), character(2)]);
  assert.equal(result.battlenet?.characters[0].selected, true);
  assert.equal(result.battlenet?.characters[0].guild, "Guild");
  assert.equal(result.battlenet?.characters[1].selected, false);
  assert.equal(result.battlenet?.accessToken, "new-token");
});

test("selection saving updates only selection flags on the current connected account", async (t) => {
  const update = t.mock.method(User, "findOneAndUpdate", async () => ({ battlenet: account() }) as any);
  const read = t.mock.method(User, "findById", async () => { throw new Error("Must not read and save a stale document"); });
  await service.updateCharacterSelection("user", [1]);
  assert.equal(read.mock.callCount(), 0);
  const [filter, operation, options] = update.mock.calls[0].arguments as any[];
  assert.deepEqual(filter, { _id: "user", "battlenet.id": { $exists: true } });
  assert.deepEqual(operation.$set, { "battlenet.characters.$[selected].selected": true, "battlenet.characters.$[unselected].selected": false });
  assert.deepEqual(options.arrayFilters, [{ "selected.id": { $in: [1] } }, { "unselected.id": { $nin: [1] } }]);
});
