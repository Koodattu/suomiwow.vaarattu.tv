import assert from "node:assert/strict";
import test from "node:test";
import { CrawlerClassifier } from "../src/services/crawler-classification";

const browser = { agent: "Mozilla/5.0 Chrome/150.0", method: "GET", path: "/api/raids", anonymousIdentity: "one" };
const feeds: typeof fetch = async url => Response.json({ prefixes: String(url).includes("google.com")
  ? [{ ipv4Prefix: "192.0.2.0/24" }, { ipv6Prefix: "2001:db8::/48" }]
  : [{ ipv4Prefix: "198.51.100.0/24" }] });

test("verification requires both the provider name and a current matching network", async () => {
  const classifier = new CrawlerClassifier();
  const google = { ...browser, agent: "Mozilla/5.0 (compatible; Googlebot/2.1)", ip: "192.0.2.10" };
  const bing = { ...browser, agent: "bingbot/2.0", ip: "198.51.100.254" };
  assert.equal(classifier.classify(google), "suspected");
  await classifier.refresh(feeds);
  for (const ip of ["192.0.2.10", "::ffff:192.0.2.10", "2001:db8:0:1::9"]) {
    assert.equal(classifier.classify({ ...google, ip }), "googlebot");
  }
  assert.equal(classifier.classify(bing), "bingbot");
  assert.equal(classifier.classify({ ...google, ip: bing.ip }), "suspected");
  assert.equal(classifier.classify({ ...bing, ip: google.ip }), "suspected");
  assert.equal(classifier.classify({ ...google, ip: undefined }), "suspected");
  assert.equal(classifier.classify({ ...browser, ip: google.ip }), "other");
  assert.equal(classifier.classify({ ...browser, agent: "SomeSpider/1" }), "suspected");
  assert.equal(classifier.classify({ ...browser, agent: "Discordbot/2.0" }), "other");
  assert.equal(classifier.classify({ ...browser, agent: "UptimeRobot/2.0" }), "other");
  // A malformed replacement cannot partially overwrite a known-good provider range.
  await classifier.refresh(async url => String(url).includes("google.com")
    ? Response.json({ prefixes: [{ ipv4Prefix: "203.0.113.0/24" }, {}] }) : feeds(url));
  assert.equal(classifier.classify(google), "googlebot");
  assert.equal(classifier.classify({ ...google, ip: "203.0.113.1" }), "suspected");
  assert.equal(classifier.classify(google, Date.now() + 49 * 3_600_000), "suspected");
});

test("anonymous profile sweeps are suspected only after enough distinct clients and profiles", () => {
  const classifier = new CrawlerClassifier();
  const start = Date.now();
  const read = (i: number) => ({ ...browser, anonymousIdentity: String(i % 8),
    referer: `https://suomiwow.vaarattu.tv/characters/realm/character-${i}?tab=raid` });
  for (let i = 0; i < 15; i++) assert.equal(classifier.classify(read(i), start), "other");
  assert.equal(classifier.classify(read(15), start), "suspected");
  assert.equal(classifier.classify({ ...read(16), path: "/api/characters/realm/new", referer: undefined }, start), "suspected");
  assert.equal(classifier.classify({ ...read(16), anonymousIdentity: undefined }, start), "other");
  assert.equal(classifier.classify({ ...read(16), method: "POST" }, start), "other");
  assert.equal(classifier.classify({ ...browser, referer: "https://other.example/characters/realm/new" }, start), "other");
  assert.equal(classifier.classify(read(16), start + 4 * 3_600_000), "other");
});

test("a single reader, a popular profile, and ordinary mixed browsing stay unclassified as crawlers", () => {
  for (const pattern of ["single reader", "popular profile", "mixed browsing"]) {
    const classifier = new CrawlerClassifier();
    for (let i = 0; i < 45; i++) {
      const path = `/api/characters/realm/${pattern === "popular profile" ? "popular" : i}`;
      if (pattern === "mixed browsing") classifier.classify(browser);
      assert.equal(classifier.classify({ ...browser, path, anonymousIdentity: pattern === "single reader" ? "one" : String(i) }), "other");
    }
  }
});
