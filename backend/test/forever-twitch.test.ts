import assert from "node:assert/strict";
import test from "node:test";
import { normalizeTwitchChannel } from "../src/features/forever/forever-twitch";
import { foreverSeedRecords } from "../src/features/forever/forever-seed";

test("Twitch associations accept only channel identities and support clearing", () => {
  for (const value of [" Wiba ", "https://www.twitch.tv/Wiba/", "twitch.tv/Wiba", "www.twitch.tv/wiba"]) assert.equal(normalizeTwitchChannel(value), "wiba");
  for (const value of [null, "", "  "]) assert.equal(normalizeTwitchChannel(value), null);
  for (const value of [undefined, {}, "ab", "a".repeat(26), "javascript:alert(1)", "https://example.com/wiba", "https://twitch.tv@evil.com/wiba", "https://twitch.tv/videos/123", "https://twitch.tv/wiba?x=1", "https://twitch.tv:443/wiba#test"]) assert.throws(() => normalizeTwitchChannel(value));
});
test("seeds merge friends and streamers, retain accents, and exclude unresolved identities", () => {
  const rows = foreverSeedRecords();
  assert.equal(rows.length, 76); assert.equal(new Set(rows.map((row) => row.slug)).size, 76);
  assert.equal(rows.filter((row) => row.twitchChannel).length, 38);
  for (const [name, channel] of [["Mansikan Pappi", "aitomansikka"], ["Munapoolo Paladin", "munapoolo"], ["Kirjuri Committ", "comm1tt"], ["Cobra Gaming", "cobragam1ng"], ["Laenoril Stillmoon", "yawnywolf"]]) {
    assert.equal(rows.find((row) => row.name === name)?.twitchChannel, channel);
  }
  assert.deepEqual(rows.find((row) => row.name === "Wiba Wiba"), { region: "eu", name: "Wiba Wiba", slug: "wiba-wiba", twitchChannel: "wiba" });
  assert.equal(rows.find((row) => row.twitchChannel === "kiuza")?.slug, "kiuza-tiäksää");
  assert.equal(rows.find((row) => row.twitchChannel === "zaikki")?.slug, "zaikow-reborn");
  assert.ok(rows.some((row) => row.slug === "shyiez-eléntari"));
  for (const name of ["Moist Wanderer", "Sysi Simsalabim", "Katti Mau", "Zeta Cygni", "Hot Ted", "Kaania Kuukkeli", "Sir Salomaa", "Toveri Kissa", "Yara Walking"]) {
    assert.equal(rows.filter((row) => row.name === name).length, 1);
  }
  for (const channel of ["eddisdead", "omaquu", "flex_fi", "pelaajainenn", "wimmawebba"]) assert.ok(!rows.some((row) => row.twitchChannel === channel));
  for (const name of ["Elyrìanna", "Elyriannà", "Flînk", "Np"]) assert.ok(!rows.some((row) => row.name === name));
});
