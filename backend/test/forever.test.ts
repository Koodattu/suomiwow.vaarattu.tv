import assert from "node:assert/strict";
import test from "node:test";
import { ArmoryError, armoryUrl, parseArmoryInput, parseArmoryUrl, parseAvatarUrl, parseCharacterHtml, parseRosterResponse, retryAfter } from "../src/features/forever/forever-armory";
import { armoryQueueHealth, failureDelay, mayRequestRefresh, MINUTE, nextRosterFetchAt, profileComparison, refreshDelay, ROSTER_INTERVAL, validateProgress } from "../src/features/forever/forever-policy";

const identity = { region: "eu" as const, slug: "test-hero" };
const character = { ...identity, name: "Test", surname: "Hero", level: 12, class: { name: "Paladin" }, race: { name: "Human" },
  faction: { name: "Alliance" }, ruleset: { name: "Normal" }, lastUpdatedTimestamp: { epoch: 1_790_000_000_000 },
  url: "/forever/eu/armory/character/test-hero/", guild: { region: "eu", slug: "test-guild", name: "Test Guild" } };
const html = (value: unknown) => `<script>var characterProfileInitialState = ${JSON.stringify({ character: value })};</script>`;

test("name or link inputs preserve Unicode and keep guild and character identities separate", () => {
  assert.deepEqual(parseArmoryInput("  Gerthald   Näätä  "), { region: "eu", slug: "gerthald-näätä" });
  assert.deepEqual(parseArmoryInput("Fel", "guild"), { region: "eu", slug: "fel" });
  assert.deepEqual(parseArmoryInput("High Order", "guild"), { region: "eu", slug: "high-order" });
  assert.deepEqual(parseArmoryInput(armoryUrl(identity)), identity);
  assert.deepEqual(parseArmoryInput(armoryUrl(identity, "guild"), "guild"), identity);
  for (const value of ["Single", "", "https://example.com/First-Last", "first/last name", "javascript: bad", { name: "Test Hero" }]) assert.throws(() => parseArmoryInput(value), ArmoryError);
  assert.throws(() => parseArmoryInput(armoryUrl(identity, "guild")), ArmoryError);
  assert.throws(() => parseArmoryInput(armoryUrl(identity), "guild"), ArmoryError);
});

test("Forever URL parsing canonicalizes Unicode and rejects retail, arbitrary hosts and malformed identities", () => {
  assert.deepEqual(parseArmoryUrl(armoryUrl(identity)), identity);
  assert.deepEqual(parseArmoryUrl("https://worldofwarcraft.blizzard.com/en-gb/forever/eu/armory/character/Ääni-Tuuli/?ignored=1"), { region: "eu", slug: "ääni-tuuli" });
  for (const url of ["https://example.org/en-gb/forever/eu/armory/character/test-hero", "http://worldofwarcraft.blizzard.com/en-gb/forever/eu/armory/character/test-hero", "https://worldofwarcraft.blizzard.com/en-gb/character/eu/realm/test", "https://worldofwarcraft.blizzard.com/en-gb/forever/eu/armory/character/a%2Fb", "https://worldofwarcraft.blizzard.com/en-gb/forever/eu/armory/character/a.b", "https://user@worldofwarcraft.blizzard.com/en-gb/forever/eu/armory/character/test-hero"]) {
    assert.throws(() => parseArmoryUrl(url), ArmoryError);
  }
});
test("character parser accepts the observed Armory contract and stores only profile fields", () => {
  const result = parseCharacterHtml(html(character), identity);
  assert.equal(result.name, "Test Hero"); assert.equal(result.level, 12); assert.equal(result.guild?.slug, "test-guild");
  assert.equal(result.sourceUpdatedAt.getTime(), 1_790_000_000_000);
  assert.equal(parseCharacterHtml(html({ ...character, guild: null }), identity).guild, null);
  assert.equal("gear" in result, false);
});
test("character identity accepts Blizzard's encoded Unicode path without accepting a different identity", () => {
  const accented = { region: "eu" as const, slug: "gerthald-näätä" };
  const value = { ...character, ...accented, name: "Gerthald", surname: "Näätä", url: "/forever/eu/armory/character/gerthald-n%C3%A4%C3%A4t%C3%A4/" };
  assert.equal(parseCharacterHtml(html(value), accented).name, "Gerthald Näätä");
  for (const url of ["/forever/eu/armory/character/gerthald-other/", "/forever/eu/armory/character/gerthald%2Fn%C3%A4%C3%A4t%C3%A4/", "/forever/eu/armory/character/%invalid/"]) {
    assert.throws(() => parseCharacterHtml(html({ ...value, url }), accented), ArmoryError);
  }
});
test("portraits accept only the matching Forever region on Blizzard's render host", () => {
  const avatarUrl = "https://render.worldofwarcraft.com/forever-eu/character/233/6972649-avatar.jpg";
  assert.equal(parseAvatarUrl(avatarUrl, "eu"), avatarUrl);
  assert.equal(parseCharacterHtml(html({ ...character, avatar: { url: avatarUrl } }), identity).avatarUrl, avatarUrl);
  for (const url of [undefined, "javascript:alert(1)", avatarUrl.replace("forever-eu", "eu"), avatarUrl.replace("forever-eu", "forever-us"),
    avatarUrl.replace("render.worldofwarcraft.com", "example.org"), `${avatarUrl}?tracking=1`]) {
    assert.equal(parseAvatarUrl(url, "eu"), null);
  }
  assert.equal(parseCharacterHtml(html(character), identity).avatarUrl, null);
});
test("upstream errors, retail responses, mismatches and stale flags are never accepted as character data", () => {
  for (const invalid of [{ ...character, region: "us" }, { ...character, url: "/worldsoul/eu/armory/character/test-hero/" },
    { ...character, slug: "another-hero" }, { ...character, level: 90 }, { ...character, level: 0 }, { ...character, level: "12" },
    { ...character, isOutdated: true }, { ...character, surname: null }, { ...character, lastUpdatedTimestamp: {} }]) {
    assert.throws(() => parseCharacterHtml(html(invalid), identity), ArmoryError);
  }
  assert.throws(() => parseCharacterHtml("<html>Maintenance</html>", identity), ArmoryError);
  assert.throws(() => parseCharacterHtml('<script>var characterProfileInitialState = (()=>{throw 1})();</script>', identity), ArmoryError);
});
test("guild parser rejects retail context and partial errors, preserving only validated members", () => {
  const guild = { region: "eu" as const, slug: "test-guild" };
  const member = { character: { _id: "eu-test-hero", region: "eu", name: "Test", surname: "Hero", level: 12, realm: null,
    class: { name: "Paladin" }, race: { name: "Human" }, faction: { name: "Alliance" }, isOutdated: false } };
  const response = { data: { GameConstants: { maxLevel: 60 }, Guild: { _id: "eu-none-test-guild", roster: [member, member] } } };
  assert.equal(parseRosterResponse(response, guild).length, 1);
  assert.deepEqual(parseRosterResponse(response, guild)[0], { region: "eu", slug: "test-hero", name: "Test Hero", level: 12,
    className: "Paladin", race: "Human", faction: "Alliance", isOutdated: false });
  member.character.isOutdated = true;
  assert.equal(parseRosterResponse(response, guild)[0].isOutdated, true);
  assert.throws(() => parseRosterResponse({ ...response, errors: [{ message: "upstream unavailable" }] }, guild), ArmoryError);
  assert.throws(() => parseRosterResponse({ data: { GameConstants: { maxLevel: 60 } }, errors: [{ message: "Internal Server Error", extensions: { code: "INTERNAL_SERVER_ERROR" } }] }, guild),
    (error: unknown) => error instanceof ArmoryError && error.code === "upstream_error" && error.status === 500);
  assert.throws(() => parseRosterResponse({ data: { ...response.data, GameConstants: { maxLevel: 90 } } }, guild), ArmoryError);
  assert.throws(() => parseRosterResponse(response, { ...guild, slug: "other-guild" }), ArmoryError);
  member.character.realm = { slug: "retail-realm" } as any;
  assert.throws(() => parseRosterResponse(response, guild), ArmoryError);
});

test("guild slots spread refreshes across fifteen minutes and remain stable after restarts", () => {
  const now = Date.parse("2026-11-08T10:00:00Z");
  const slots = Array.from({ length: 79 }, (_, index) => nextRosterFetchAt({ region: "eu", slug: `guild-${index}` }, now).getTime());
  assert.ok(slots.every(slot => slot > now && slot <= now + ROSTER_INTERVAL));
  assert.ok(new Set(slots.map(slot => Math.floor((slot - now) / MINUTE))).size >= 13);
  const guild = { region: "eu", slug: "el-forever" };
  const first = nextRosterFetchAt(guild, now);
  assert.equal(nextRosterFetchAt(guild, now).getTime(), first.getTime());
  assert.equal(nextRosterFetchAt(guild, first.getTime()).getTime(), first.getTime() + ROSTER_INTERVAL);
});

test("freshness comparisons distinguish delayed rosters from legitimate later level gains", () => {
  const observed = new Date("2026-11-08T10:00:00Z");
  assert.deepEqual(profileComparison(47, { level: 51, sourceUpdatedAt: new Date("2026-11-08T09:50:00Z") }, observed), { profileAhead: true, rosterAhead: false });
  assert.deepEqual(profileComparison(47, { level: 51, sourceUpdatedAt: new Date("2026-11-08T10:01:00Z") }, observed), { profileAhead: false, rosterAhead: false });
  assert.deepEqual(profileComparison(51, { level: 47, sourceUpdatedAt: observed }, observed), { profileAhead: false, rosterAhead: true });
});
test("retry policy honors both Retry-After formats and increases delays without abandoning 404s", () => {
  assert.equal(retryAfter("120"), 120_000);
  assert.equal(retryAfter("Thu, 05 Nov 2026 12:01:00 GMT", Date.parse("2026-11-05T12:00:00Z")), 60_000);
  assert.equal(retryAfter("nonsense"), 0);
  assert.equal(failureDelay(0, new ArmoryError("not_found", 404), 0), 15 * MINUTE);
  assert.equal(failureDelay(2, new ArmoryError("not_found", 404), 0), 60 * MINUTE);
  assert.equal(failureDelay(0, new ArmoryError("limited", 429, 4 * 60 * MINUTE), 0), 4 * 60 * MINUTE);
  assert.ok(failureDelay(100, new ArmoryError("unavailable"), 0) <= 24 * 60 * MINUTE);
});
test("500 failures among 1,000 alternating profiles never pause the shared queue", () => {
  let health = armoryQueueHealth({}, "initial");
  for (let index = 0; index < 1_000; index++) {
    health = armoryQueueHealth(health, `character:${index}`, index % 2 === 0 ? new ArmoryError("upstream_error", 500) : undefined, index * 500);
    assert.equal(health.pauseMs, 0);
  }
});
test("outage detection requires ten distinct failures in a recent uninterrupted window", () => {
  const failure = new ArmoryError("upstream_error", 500);
  let health = armoryQueueHealth({}, "first", failure, 0);
  for (let index = 0; index < 20; index++) health = armoryQueueHealth(health, "first", failure, 500);
  assert.equal(health.failedJobs.length, 1); assert.equal(health.pauseMs, 0);
  for (let index = 1; index < 9; index++) {
    health = armoryQueueHealth(health, String(index), failure, 1_000);
    assert.equal(health.pauseMs, 0);
  }
  const outage = armoryQueueHealth(health, "tenth", failure, 2_000);
  assert.equal(outage.pauseMs, 2 * MINUTE); assert.deepEqual(outage.failedJobs, []);
  assert.equal(armoryQueueHealth(health, "after-gap", failure, 5 * MINUTE).failedJobs.length, 1);
  for (const error of [undefined, new ArmoryError("not_found", 404), new ArmoryError("stale_data"), new ArmoryError("identity_mismatch")]) {
    assert.deepEqual(armoryQueueHealth(health, "healthy-endpoint", error, 2_000).failedJobs, []);
  }
  assert.equal(armoryQueueHealth({}, "limited", new ArmoryError("upstream_error", 429, 3600_000)).pauseMs, 3600_000);
  assert.equal(armoryQueueHealth({}, "unavailable", new ArmoryError("upstream_error", 503, 180_000)).pauseMs, 180_000);
  for (const status of [401, 403, 429]) assert.equal(armoryQueueHealth({}, "blocked", new ArmoryError("upstream_error", status)).pauseMs, 2 * MINUTE);
});
test("progress and scheduling preserve observations and do not allow refreshes to bypass retries", () => {
  const sourceUpdatedAt = new Date("2026-11-05T10:00:00Z");
  assert.throws(() => validateProgress({ level: 20, sourceUpdatedAt }, { level: 19, sourceUpdatedAt }), ArmoryError);
  assert.throws(() => validateProgress({ level: 20, sourceUpdatedAt }, { level: 21, sourceUpdatedAt: new Date("2026-11-04") }), ArmoryError);
  validateProgress({ level: 20, sourceUpdatedAt }, { level: 20, sourceUpdatedAt });
  assert.equal(refreshDelay(20, sourceUpdatedAt, sourceUpdatedAt.getTime()), 2 * MINUTE);
  assert.equal(refreshDelay(20, sourceUpdatedAt, sourceUpdatedAt.getTime() + 2 * 86400_000), 60 * MINUTE);
  assert.equal(refreshDelay(60, sourceUpdatedAt), 6 * 60 * MINUTE);
  const value = { status: "tracked", failures: 0, nextFetchAt: new Date(60 * MINUTE), lastAttemptAt: new Date(0) };
  assert.equal(mayRequestRefresh(value, 6 * MINUTE), true);
  assert.equal(mayRequestRefresh(value, MINUTE), false);
  assert.equal(mayRequestRefresh({ ...value, failures: 1 }, 6 * MINUTE), false);
  assert.equal(mayRequestRefresh({ ...value, status: "pending" }, 6 * MINUTE), false);
});
