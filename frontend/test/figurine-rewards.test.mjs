import assert from "node:assert/strict";
import test from "node:test";
import { FISH, QUESTS, WHEEL, boostedQuality, castLine, claimQuest, crateState, dayKey, grantReward, openCrate, parseRecords, questBoard, readRecords, recordPull, spinWheel, startQuestPeriods, weekKey, wheelSegment } from "../src/lib/figurine-collection.ts";

const store = () => { const data = new Map(); return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }; };
const day = (date, hour = 12) => new Date(`${date}T${String(hour).padStart(2, "0")}:00:00`);

test("the daily crate opens once a day, builds a streak to seven with a golden boost, and restarts", () => {
  const memory = store();
  for (let n = 1; n <= 7; n++) {
    const now = day(`2026-11-${String(n).padStart(2, "0")}`);
    assert.equal(crateState(readRecords(memory), now).day, n);
    const { reward } = openCrate(now, memory);
    assert.deepEqual(reward, n === 7 ? { boxes: 1, boost: "golden" } : { boxes: 1 });
    grantReward(reward, memory);
    assert.equal(openCrate(day(`2026-11-${String(n).padStart(2, "0")}`, 20), memory), null, "twice in a day");
  }
  assert.deepEqual(readRecords(memory).boons, { boxes: 7, boost: "golden" });
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
  assert.equal(first.segment, 7); assert.equal(readRecords(memory).boons.boxes, 0, "granted only once the spin has played");
  grantReward(first.reward, memory); assert.equal(readRecords(memory).boons.boxes, 3);
  assert.equal(spinWheel(0.1, day("2026-11-01", 22), memory), null);
  assert.ok(spinWheel(0.1, day("2026-11-02"), memory));
  assert.throws(() => wheelSegment(1));
});

test("the day's first cast lands a box and a figure, then fish of fair weights", () => {
  const memory = store(), random = () => 0.5;
  assert.deepEqual(castLine(random, day("2026-11-01"), memory), { kind: "daily", reward: { boxes: 1, figure: true } });
  const fish = castLine(random, day("2026-11-01", 13), memory);
  assert.equal(fish.kind, "fish");
  const [low, high] = FISH[fish.fish].weight;
  assert.ok(fish.weight >= low && fish.weight <= high && fish.best);
  assert.equal(castLine(random, day("2026-11-01", 14), memory).best, false);
  assert.equal(readRecords(memory).stats.fish, 3);
  assert.equal(castLine(random, day("2026-11-02"), memory).kind, "daily");
});

test("quests count from their period's start, claim once for banked boxes, and turn over", () => {
  const memory = store(), now = day("2026-11-02");
  for (let i = 0; i < 2; i++) recordPull({ key: "s1:a", quality: "standard" }, "box", now, memory);
  startQuestPeriods(now, memory);
  for (let i = 0; i < 3; i++) recordPull({ key: "s1:a", quality: "standard" }, "box", now, memory);
  const board = questBoard(readRecords(memory), false, now), open3 = board.find((quest) => quest.id === "open3");
  assert.deepEqual([open3.progress, open3.done, open3.claimed], [3, true, false]);
  assert.equal(claimQuest("open3", false, now, memory), 1);
  assert.equal(claimQuest("open3", false, now, memory), 0, "claimed once");
  assert.equal(claimQuest("galaxy", false, now, memory), 0, "not done");
  assert.equal(readRecords(memory).boons.boxes, 1);
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
  const parsed = parseRecords(JSON.stringify({ boons: { boxes: -2, boost: "standard" }, daily: { crate: "nope", streak: 40 }, stats: { opened: "x", fish: 4 } }));
  assert.deepEqual(parsed.boons, { boxes: 0, boost: null });
  assert.deepEqual(parsed.daily, { crate: null, streak: 7, spin: null, catch: null });
  assert.equal(parsed.stats.opened, 0); assert.equal(parsed.stats.fish, 4);
});
