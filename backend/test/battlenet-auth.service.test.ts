import assert from "node:assert/strict";
import test, { TestContext } from "node:test";
import User, { IBattleNetAccount, IWoWCharacter } from "../src/models/User";
import service, { BattleNetSyncError } from "../src/services/battlenet-auth.service";
import logger from "../src/utils/logger";

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

test("connecting an all-level roster accepts neutral characters in the saved user model", async (t) => {
  const neutral: IWoWCharacter = { ...character(1), level: 1, faction: "NEUTRAL" };
  const user = new User({ discord: { id: "discord", username: "Tester", accessToken: "test", refreshToken: "test", tokenExpiresAt: new Date() } });
  t.mock.method(User, "findOne", async () => null as any);
  t.mock.method(User, "findById", async () => user as any);
  t.mock.method(user, "save", async () => { await user.validate(); return user; });
  t.mock.method(globalThis, "fetch", async (url: Parameters<typeof fetch>[0]) =>
    String(url).includes("/profile/user/wow?") ? profileResponse([neutral]) : Response.json({}));
  const roster = await service.getWoWCharacters("test-token", false, 0);
  await service.connectBattleNetAccount(user.id, { sub: "account", id: 1, battletag: "Test#1234" },
    { access_token: "test-token", expires_in: 60000, token_type: "bearer", scope: "wow.profile", sub: "account" }, roster);
  assert.equal(user.battlenet?.characters[0].faction, "NEUTRAL");
  assert.equal((await service.getCharacters(user.id))[0].faction, "NEUTRAL");
  assert.ok(user.battlenet?.rosterSyncedAt);
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
    current.battlenet!.rosterSyncedAt = operation.$set["battlenet.rosterSyncedAt"];
    return structuredClone(current) as any;
  });
  return { find, update, get current() { return current; }, disconnect() { current = {}; } };
}

for (const [status, code] of [
  [401, "BATTLENET_RECONNECT_REQUIRED"], [403, "BATTLENET_PROFILE_ACCESS_DENIED"],
  [404, "BATTLENET_PROFILE_UNAVAILABLE"], [429, "BATTLENET_UNAVAILABLE"],
  [500, "BATTLENET_UNAVAILABLE"], [503, "BATTLENET_UNAVAILABLE"],
] as const) {
  test(`Blizzard HTTP ${status} never clears saved characters or advances sync time`, async (t) => {
    const store = mockStore(t);
    t.mock.method(globalThis, "fetch", async () => new Response(null, { status }));
    await assert.rejects(service.refreshCharacters("user"), (error: unknown) => {
      assert.ok(error instanceof BattleNetSyncError);
      assert.equal(error.code, code);
      return true;
    });
    assert.deepEqual(store.current.battlenet?.characters, [character(1, true)]);
    assert.equal(store.current.battlenet?.lastCharacterSync, null);
    assert.equal(store.update.mock.callCount(), 0);
  });
}

test("authorization detects denied WoW permission without exposing tokens", async (t) => {
  const warn = t.mock.method(logger, "warn", () => logger);
  for (const scope of ["openid", "", [], ["openid"]]) {
    t.mock.method(globalThis, "fetch", async () => Response.json({ access_token: "private-token", scope }));
    await assert.rejects(service.exchangeCode("private-code"), { code: "BATTLENET_PERMISSION_REQUIRED" });
  }
  assert.ok(warn.mock.calls.every((call) => !JSON.stringify(call.arguments).includes("private-")));
});

test("authorization accepts granted WoW scopes and the OAuth omitted-scope response", async (t) => {
  for (const scope of ["openid wow.profile", ["openid", "wow.profile"], undefined]) {
    t.mock.method(globalThis, "fetch", async () => Response.json({ access_token: "test-token", scope }));
    assert.equal((await service.exchangeCode("test-code")).access_token, "test-token");
  }
});

test("profile failures log the HTTP status without logging the response body or token", async (t) => {
  const warn = t.mock.method(logger, "warn", () => logger);
  t.mock.method(globalThis, "fetch", async () => new Response("private-response", { status: 403 }));
  await assert.rejects(service.getWoWCharacters("private-token"), { code: "BATTLENET_PROFILE_ACCESS_DENIED" });
  assert.deepEqual(warn.mock.calls[0].arguments, ["Battle.net EU account profile request failed: HTTP 403"]);
});

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
  initial.rosterSyncedAt = new Date();
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

test("slow guild lookups still check every character with bounded concurrency", async (t) => {
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
  assert.equal(requested.length, 12);
  assert.equal(result.length, 12);
  assert.ok(result.every((character) => character.guildCheckedAt instanceof Date));
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
  assert.deepEqual((await service.refreshCharacters("user"))[0], { ...chars[0], realmId: 1, inactive: undefined, guildCheckedAt: undefined });
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
  t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 503 }));
  const result = await service.connectBattleNetAccount("user", { sub: "account", id: 1, battletag: "Test#1234" },
    { access_token: "new-token", expires_in: 60000, token_type: "bearer", scope: "wow.profile", sub: "account" }, [character(1), character(2)]);
  assert.equal(result.battlenet?.characters[0].selected, true);
  assert.equal(result.battlenet?.characters[0].guild, "Guild");
  assert.equal(result.battlenet?.characters[1].selected, false);
  assert.equal(result.battlenet?.accessToken, "new-token");
  assert.ok(result.battlenet?.rosterSyncedAt instanceof Date);
});

test("saved rosters including empty accounts never expire or need a live token", async (t) => {
  for (const characters of [[], [character(1)]]) {
    const initial = account(characters);
    initial.rosterSyncedAt = new Date(0);
    initial.tokenExpiresAt = new Date(0);
    const store = mockStore(t, initial);
    const fetch = t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected request"); });
    assert.deepEqual(await service.getCharacters("user"), initial.characters);
    assert.deepEqual(await service.getCharacters("user"), initial.characters);
    assert.equal(fetch.mock.callCount(), 0);
    assert.equal(store.update.mock.callCount(), 0);
    t.mock.restoreAll();
  }
});

test("legacy caches refresh once with all levels and persist guilds and realm IDs", async (t) => {
  const initial = account();
  initial.lastCharacterSync = new Date();
  const store = mockStore(t, initial);
  const chars = [{ ...character(1), level: 10 }];
  let summaries = 0;
  const fetch = t.mock.method(globalThis, "fetch", async (url: Parameters<typeof globalThis.fetch>[0]) => {
    if (String(url).includes("/profile/user/wow?")) { summaries++; return profileResponse(chars); }
    return Response.json({ guild: { name: "New Guild", realm: { name: "Ravencrest", slug: "ravencrest" } } });
  });
  const [first, concurrent] = await Promise.all([service.getCharacters("user"), service.getCharacters("user")]);
  assert.deepEqual(concurrent, first);
  assert.equal(first[0].realmId, 1);
  assert.equal(first[0].level, 10);
  assert.equal(first[0].guild, "New Guild");
  assert.equal(first[0].guildRealm, "Ravencrest");
  assert.equal(summaries, 1);
  assert.ok(store.current.battlenet?.rosterSyncedAt instanceof Date);
  assert.deepEqual(await service.getCharacters("user"), first);
  assert.equal(fetch.mock.callCount(), 2);
});

test("connecting caches the supplied roster and guilds without fetching the list again", async (t) => {
  const user: any = { save: async () => {} };
  t.mock.method(User, "findOne", async () => null as any);
  t.mock.method(User, "findById", async () => user);
  const fetch = t.mock.method(globalThis, "fetch", async (url: Parameters<typeof globalThis.fetch>[0]) => {
    assert.ok(String(url).includes("/profile/wow/character/"));
    return Response.json({ guild: { name: "Guild", realm: { name: "Kazzak", slug: "kazzak" } } });
  });
  await service.connectBattleNetAccount("user", { sub: "account", id: 1, battletag: "Test#1234" },
    { access_token: "new-token", expires_in: 60000, token_type: "bearer", scope: "wow.profile", sub: "account" }, [{ ...character(1), realmId: 1 }]);
  assert.equal((await service.getCharacters("user"))[0].guild, "Guild");
  assert.equal(fetch.mock.callCount(), 1);
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
