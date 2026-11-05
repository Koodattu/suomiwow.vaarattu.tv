import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import { dailyDeals, PLAYER_OFFERS, canAffordTrade } from "../src/lib/figurine-trading.ts";
import { dayKey, exchangeTrade, spendCoin, grantReward, readRecords, readCollection, addToCollection } from "../src/lib/figurine-collection.ts";

const store = () => { const data = new Map(); return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }; };
const coin = amount => ({ kind: "coins", amount });
const figure = { kind: "figure", key: "community-001:roidy", quality: "standard" };

test("daily merchant stock is stable, rotates each day and refresh, and favours the player", () => {
  const deals = dailyDeals("2026-11-04");
  assert.equal(deals.length, 3);
  assert.deepEqual(dailyDeals("2026-11-04"), deals);
  for (const next of [dailyDeals("2026-11-05"), dailyDeals("2026-11-04", 1)]) {
    assert.ok(next.every(item => !deals.some(old => old.id === item.id)));
    assert.notDeepEqual(next.map(item => item.receive), deals.map(item => item.receive));
  }
  assert.equal(deals[0].give.amount, 1, "standard figures are cheaper than the market's two-coin baseline");
  assert.equal(deals[1].receive.amount, 3, "the merchant pays more for a standard figure");
  assert.equal(deals[2].give.amount, 4, "golden figures cost less than the market's five-coin baseline");
});
test("player listings include many unique buy and sell offers with real catalogue keys", async () => {
  assert.ok(PLAYER_OFFERS.length >= 20);
  assert.equal(new Set(PLAYER_OFFERS.map(item => item.id)).size, PLAYER_OFFERS.length);
  assert.ok(PLAYER_OFFERS.some(item => item.give.kind === "coins"));
  assert.ok(PLAYER_OFFERS.some(item => item.receive.kind === "coins"));
  const catalogs = await Promise.all(["community-001", "community-002"].map(async id => JSON.parse(await readFile(new URL(`../src/data/figurines/${id}.json`, import.meta.url)))));
  const keys = catalogs.flatMap(c => c.characters.map(item => `${c.id}:${item.id}`));
  for (const offer of [...PLAYER_OFFERS, ...dailyDeals("2026-11-04")]) for (const asset of [offer.give, offer.receive]) if (asset.kind === "figure") assert.ok(keys.includes(asset.key));
});
test("buying and selling update the existing local wallet and collection", () => {
  const s = store(); grantReward({ coins: 10 }, s);
  const before = readRecords(s).boons.coins;
  assert.equal(exchangeTrade(coin(2), figure, s), true);
  assert.equal(readRecords(s).boons.coins, before - 2);
  assert.equal(readCollection(s)[figure.key].standard, 1);
  assert.equal(exchangeTrade(figure, coin(3), s), true);
  assert.equal(readRecords(s).boons.coins, before + 1);
  assert.equal(readCollection(s)[figure.key], undefined);
});
test("unaffordable and invalid exchanges do not change either side", () => {
  const s = store(), balance = readRecords(s).boons.coins;
  for (const [give, receive] of [[coin(balance + 1), figure], [figure, coin(3)], [coin(-1), figure], [coin(0.5), figure], [coin(1), { ...figure, quality: "fake" }]]) {
    assert.equal(exchangeTrade(give, receive, s), false);
    assert.equal(readRecords(s).boons.coins, balance);
    assert.deepEqual(readCollection(s), {});
  }
  assert.equal(canAffordTrade(coin(2), 1, {}), false);
  assert.equal(canAffordTrade(figure, 100, {}), false);
  addToCollection(figure.key, "golden", s);
  assert.equal(canAffordTrade(figure, 100, readCollection(s)), false, "quality must match");
});

const source = await readFile(new URL("../src/app/collectibles/TradingPost.tsx", import.meta.url), "utf8");
const hook = ts.transpile(source.slice(source.indexOf("export function useTradingPost"), source.indexOf("export type TradingState")).replace("export function", "function"));
function tradingSession(s) {
  let state, ref;
  const context = vm.createContext({ dayKey, dailyDeals, PLAYER_OFFERS,
    useState: initial => [state ??= initial, next => { state = next; }], useRef: initial => ref ??= { current: initial },
    exchangeTrade: (give, receive) => exchangeTrade(give, receive, s), spendCoin: () => spendCoin(s) });
  vm.runInContext(hook, context);
  return date => context.useTradingPost(new Date(date));
}
test("a listing can be claimed only once, even before a rerender or after navigation", () => {
  const s = store(); grantReward({ coins: 10 }, s);
  const render = tradingSession(s), post = render("2026-11-04T12:00:00"), deal = post.deals[0];
  assert.equal(post.onTrade(deal.id), true);
  const balance = readRecords(s).boons.coins;
  assert.equal(post.onTrade(deal.id), false);
  assert.equal(render("2026-11-04T12:00:00").onTrade(deal.id), false);
  assert.equal(readRecords(s).boons.coins, balance);
});
test("refresh spends exactly one coin, replaces stock, rejects stale offers and cannot overdraft", () => {
  const s = store(); grantReward({ coins: 3 }, s);
  const render = tradingSession(s), post = render("2026-11-04T12:00:00"), old = post.deals[0];
  const balance = readRecords(s).boons.coins;
  assert.equal(post.onRefresh(), true);
  assert.equal(readRecords(s).boons.coins, balance - 1);
  assert.equal(post.onTrade(old.id), false);
  assert.notEqual(render("2026-11-04T12:00:00").deals[0].id, old.id);
  while (readRecords(s).boons.coins) assert.equal(post.onRefresh(), true);
  const exhausted = render("2026-11-04T12:00:00");
  assert.equal(exhausted.onRefresh(), false);
  assert.deepEqual(render("2026-11-04T12:00:00").deals, exhausted.deals);
});
test("a new calendar day resets refreshed stock without charging coins", () => {
  const s = store(); grantReward({ coins: 3 }, s);
  const render = tradingSession(s);
  render("2026-11-04T12:00:00").onRefresh();
  const balance = readRecords(s).boons.coins;
  const next = render("2026-11-05T12:00:00");
  assert.deepEqual(next.deals, dailyDeals("2026-11-05"));
  assert.equal(readRecords(s).boons.coins, balance);
});
