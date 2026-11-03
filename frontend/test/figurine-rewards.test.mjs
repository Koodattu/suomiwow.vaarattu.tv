import assert from "node:assert/strict";
import test from "node:test";
import { ANGLER_TOP, FISH, QUESTS, WHEEL, anglerScore, boostedQuality, catchScore, claimQuest, dailyCatchesLeft, fishOf, landCatch, moveFavorite, rollCatch, setFavoriteQuality, showcaseOf, toggleFavorite, crateState, dayKey, regenerateCoins, spendCoin, COIN_INTERVAL_MS, RECORDS_KEY, grantReward, openCrate, parseRecords, questBoard, readRecords, recordPull, spinWheel, startQuestPeriods, weekKey, wheelSegment } from "../src/lib/figurine-collection.ts";

const store = () => { const data = new Map(); return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }; };
const day = (date, hour = 12) => new Date(`${date}T${String(hour).padStart(2, "0")}:00:00`);

test("the daily crate opens once a day, builds a streak to seven with a golden boost, and restarts", () => {
  const memory = store();
  for (let n = 1; n <= 7; n++) {
    const now = day(`2026-11-${String(n).padStart(2, "0")}`);
    assert.equal(crateState(readRecords(memory), now).day, n);
    const { reward } = openCrate(now, memory);
    assert.deepEqual(reward, n === 7 ? { coins: 1, boost: "golden" } : { coins: 1 });
    grantReward(reward, memory);
    assert.equal(openCrate(day(`2026-11-${String(n).padStart(2, "0")}`, 20), memory), null, "twice in a day");
  }
  assert.deepEqual(readRecords(memory).boons, { coins: 7, boost: "golden" });
  assert.equal(crateState(readRecords(memory), day("2026-11-08")).day, 1, "after seven it starts over");
  openCrate(day("2026-11-08"), memory);
  assert.equal(crateState(readRecords(memory), day("2026-11-10")).day, 1, "a missed day starts over");
});

test("the wheel spins once a day and lands by weight on its eight segments", () => {
  assert.equal(WHEEL.length, 8);
  const counts = Array(8).fill(0);
  for (let i = 0; i < 1000; i++) counts[wheelSegment((i + 0.5) / 1000)]++;
  assert.deepEqual(counts.map((n) => Math.round(n / 10)), WHEEL.map(({ weight }) => weight));
  const memory = store();
  const first = spinWheel(0.999, day("2026-11-01"), memory);
  assert.equal(first.segment, 7); assert.equal(readRecords(memory).boons.coins, 0, "granted only once the spin has played");
  grantReward(first.reward, memory); assert.equal(readRecords(memory).boons.coins, 3);
  assert.equal(spinWheel(0.1, day("2026-11-01", 22), memory), null);
  assert.ok(spinWheel(0.1, day("2026-11-02"), memory));
  assert.throws(() => wheelSegment(1));
});

test("the day's first three catches are a coin, a figure and a coin, then fish of fair weights; a missed hook lands nothing", () => {
  const memory = store(), now = day("2026-11-01"), random = () => 0.5;
  const prizes = [];
  for (let i = 0; i < 3; i++) {
    const roll = rollCatch(readRecords(memory), random, now);
    // Rolling alone (the line went out, the fish got away) changes nothing.
    assert.deepEqual(rollCatch(readRecords(memory), random, now), roll);
    prizes.push(landCatch(roll, now, memory).reward);
  }
  assert.deepEqual(prizes, [{ coins: 1 }, { figure: true }, { coins: 1 }]);
  assert.equal(dailyCatchesLeft(readRecords(memory), now), 0);
  const roll = rollCatch(readRecords(memory), random, now), caught = landCatch(roll, now, memory);
  assert.equal(caught.kind, "fish");
  const [low, high] = fishOf(caught.fish).weight;
  assert.ok(caught.weight >= low && caught.weight <= high && caught.best && caught.first);
  const again = landCatch(roll, now, memory);
  assert.deepEqual([again.best, again.first], [false, false]);
  // Both go on the anglers' board, scored the same.
  assert.equal(again.score, caught.score);
  assert.deepEqual(readRecords(memory).angler.map(({ score }) => score), [caught.score, caught.score]);
  assert.deepEqual(readRecords(memory).fish[caught.fish], { count: 2, best: caught.weight, golden: 0, galaxy: 0 });
  assert.equal(readRecords(memory).stats.fish, 5);
  assert.equal(dailyCatchesLeft(readRecords(memory), day("2026-11-02")), 3, "a new day brings three more");
  // Ten fish and a boot; rarer finishes come from the low end of the finish roll.
  assert.equal(FISH.filter((entry) => !entry.junk).length, 10);
  const rolls = [0.99, 0.5, 0.05];
  const golden = rollCatch(readRecords(memory), () => rolls.shift() ?? 0.5, now);
  assert.equal(golden.quality, "golden");
  assert.equal(golden.fish, "boot");
});

test("favourites keep their order; the first sixteen still owned make the display", () => {
  const memory = store(), keys = Array.from({ length: 18 }, (_, i) => `s1:f${i}`);
  for (const key of keys) toggleFavorite({ key, quality: "standard" }, memory);
  moveFavorite("s1:f17", 0, memory);
  assert.deepEqual(readRecords(memory).favorites.slice(0, 2).map(({ key }) => key), ["s1:f17", "s1:f0"]);
  toggleFavorite({ key: "s1:f0", quality: "standard" }, memory);
  assert.equal(readRecords(memory).favorites.length, 17);
  setFavoriteQuality("s1:f17", "golden", memory);
  const owned = Object.fromEntries(keys.map((key) => [key, { standard: 1 }]));
  delete owned["s1:f1"];
  const shown = showcaseOf(readRecords(memory).favorites, owned);
  assert.equal(shown.length, 16);
  assert.deepEqual(shown[0], { key: "s1:f17", quality: "standard" }, "an unowned finish falls back to the best owned");
  assert.ok(!shown.some(({ key }) => key === "s1:f1"), "a figure no longer owned leaves the display");
  // Older records' fixed slots become favourites in slot order.
  const legacy = parseRecords(JSON.stringify({ showcase: [null, { key: "s1:b", quality: "golden" }, { key: "s1:a", quality: "standard" }] }));
  assert.deepEqual(legacy.favorites, [{ key: "s1:b", quality: "golden" }, { key: "s1:a", quality: "standard" }]);
});

test("quests count from their period's start, claim once for banked coins, and turn over", () => {
  const memory = store(), now = day("2026-11-02");
  for (let i = 0; i < 2; i++) recordPull({ key: "s1:a", quality: "standard" }, "box", now, memory);
  startQuestPeriods(now, memory);
  for (let i = 0; i < 3; i++) recordPull({ key: "s1:a", quality: "standard" }, "box", now, memory);
  const board = questBoard(readRecords(memory), false, now), open3 = board.find((quest) => quest.id === "open3");
  assert.deepEqual([open3.progress, open3.done, open3.claimed], [3, true, false]);
  assert.equal(claimQuest("open3", false, now, memory), 1);
  assert.equal(claimQuest("open3", false, now, memory), 0, "claimed once");
  assert.equal(claimQuest("galaxy", false, now, memory), 0, "not done");
  assert.equal(readRecords(memory).boons.coins, 1);
  const tomorrow = questBoard(readRecords(memory), false, day("2026-11-03")).find((quest) => quest.id === "open3");
  assert.deepEqual([tomorrow.progress, tomorrow.claimed], [0, false]);
  assert.equal(questBoard(readRecords(memory), true, now).find((quest) => quest.id === "series").done, true);
  assert.equal(new Set(QUESTS.map(({ id }) => id)).size, QUESTS.length);
});

test("boosts lift a roll, never lower it; periods use local days and ISO weeks; bad records parse safely", () => {
  assert.equal(boostedQuality("standard", "golden"), "golden");
  assert.equal(boostedQuality("galaxy", "golden"), "galaxy");
  assert.equal(boostedQuality("golden", null), "golden");
  assert.equal(dayKey(day("2026-11-01", 23)), "2026-11-01");
  assert.equal(weekKey(day("2026-01-01")), "2026-W01");
  assert.equal(weekKey(day("2026-11-01")), "2026-W44");
  const parsed = parseRecords(JSON.stringify({ boons: { coins: -2, boost: "standard" }, daily: { crate: "nope", streak: 40 }, stats: { opened: "x", fish: 4 } }));
  assert.deepEqual(parsed.boons, { coins: 0, boost: null });
  assert.deepEqual(parsed.daily, { crate: null, streak: 7, spin: null, catch: null, caught: 0 });
  assert.equal(parsed.stats.opened, 0); assert.equal(parsed.stats.fish, 4);
});

test("a catch scores its rarity, its size for its kind and its finish, and the ten best make the anglers' score", () => {
  // Rarity points, times one to two across the kind's weight range, times the finish.
  assert.equal(catchScore("smallfish", 0.2, "standard"), 10);
  assert.equal(catchScore("smallfish", 0.6, "standard"), 20);
  assert.equal(catchScore("mightfish", 40, "galaxy"), 1500);
  assert.equal(catchScore("eel", 6, "golden"), 180);
  assert.equal(catchScore("boot", 2.6, "galaxy"), 0, "junk scores nothing");
  const memory = store(), now = day("2026-11-01");
  for (let i = 0; i < 3; i++) landCatch(rollCatch(readRecords(memory), () => 0.5, now), now, memory);
  landCatch({ kind: "fish", fish: "boot", weight: 2, quality: "standard" }, now, memory);
  for (let i = 0; i < 12; i++) landCatch({ kind: "fish", fish: "smallfish", weight: 0.2 + i * 0.03, quality: "standard" }, now, memory);
  const board = readRecords(memory).angler;
  assert.equal(board.length, ANGLER_TOP);
  assert.ok(board.every(({ fish }) => fish === "smallfish"), "the boot never makes the board");
  assert.deepEqual(board.map(({ score }) => score), [...board.map(({ score }) => score)].sort((a, b) => b - a));
  assert.equal(anglerScore(readRecords(memory)), board.reduce((total, { score }) => total + score, 0));
  // Stored scores are worked out again on reading.
  const forged = parseRecords(JSON.stringify({ angler: [{ fish: "salmon", weight: 12, quality: "standard", score: 99999, at: "2026-11-01T10:00:00.000Z" }, { fish: "nope", weight: 1, quality: "standard", at: "2026-11-01T10:00:00.000Z" }] }));
  assert.deepEqual(forged.angler.map(({ fish, score }) => [fish, score]), [["salmon", 120]]);
});


test("the session wallet starts with three coins, regenerates every four hours and preserves partial intervals", () => {
  const memory = store(), start = day("2026-11-03");
  assert.equal(regenerateCoins(start, memory), 3);
  assert.equal(regenerateCoins(start, memory), 0, "mounting twice cannot grant twice");
  assert.equal(regenerateCoins(new Date(+start + COIN_INTERVAL_MS - 1), memory), 0);
  assert.equal(regenerateCoins(new Date(+start + COIN_INTERVAL_MS), memory), 1);
  assert.equal(regenerateCoins(new Date(+start + COIN_INTERVAL_MS * 3.5), memory), 2);
  assert.equal(readRecords(memory).boons.coins, 6);
  assert.equal(readRecords(memory).coinAt, new Date(+start + COIN_INTERVAL_MS * 3).toISOString());
  // Reading saved records retains the remaining half interval, with no duplicate reward.
  assert.equal(parseRecords(memory.getItem(RECORDS_KEY)).boons.coins, 6);
  assert.equal(regenerateCoins(new Date(+start + COIN_INTERVAL_MS * 4), memory), 1);
  assert.equal(regenerateCoins(start, memory), 0, "a backwards clock cannot grant coins");
});

test("each box costs one coin; empty wallets cannot spend, boosts are preserved and failures can refund", () => {
  const memory = store();
  assert.equal(spendCoin(memory), false);
  grantReward({ coins: 2, boost: "golden" }, memory);
  assert.equal(spendCoin(memory), true); assert.equal(readRecords(memory).boons.coins, 1);
  assert.equal(spendCoin(memory), true); assert.equal(spendCoin(memory), false);
  assert.deepEqual(readRecords(memory).boons, { coins: 0, boost: "golden" });
  grantReward({ coins: 1 }, memory); // Failed model load refunds the reserved coin.
  assert.equal(readRecords(memory).boons.coins, 1);
});

test("old box rewards are discarded and invalid coin values never become spendable", () => {
  const legacy = parseRecords(JSON.stringify({ boons: { boxes: 99, boost: "golden" } }));
  assert.deepEqual(legacy.boons, { coins: 0, boost: "golden" });
  for (const coins of [-1, 1.5, "4", null, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(parseRecords(JSON.stringify({ boons: { coins } })).boons.coins, 0);
  }
  const memory = store(); memory.setItem(RECORDS_KEY, JSON.stringify(legacy));
  regenerateCoins(day("2026-11-03"), memory);
  assert.equal(readRecords(memory).boons.coins, 3);
});
