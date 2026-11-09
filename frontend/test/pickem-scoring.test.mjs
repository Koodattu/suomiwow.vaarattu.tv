import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";

registerHooks({
  resolve(specifier, context, next) {
    return next(specifier.endsWith("/pickem-score-rows") ? `${specifier}.ts` : specifier, context);
  },
  load(url, context, next) {
    if (url.endsWith("/PickemScoring.tsx")) return {
      format: "module", shortCircuit: true,
      source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
        compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
      }).outputText,
    };
    return next(url, context);
  },
});
const { PickemScoringRules, PickemScoreBreakdown } = await import("../src/components/pickems/PickemScoring.tsx");
const render = (component, props, locale = "en") => renderToStaticMarkup(createElement(
  NextIntlClientProvider,
  { locale, timeZone: "UTC", messages: JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), "utf8")) },
  createElement(component, props),
)).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
const pickem = {
  type: "regular", guildCount: 10, scoreOutOfRangeGuilds: false, finalized: false, rankingsPending: false,
  scoringConfig: { exactMatch: 25, offByOne: 12, offByTwo: 0, offByThree: 4, offByFour: 0, offByFiveOrMore: 3 },
  streakConfig: { enabled: true, minStreak: 2, bonusPerGuild: 2 },
};

const makeEntry = (ranks, points, totalPoints, streakBonus) => ({
  username: "Example", totalPoints, streakBonus,
  positionPoints: points.reduce((sum, value) => sum + value, 0),
  predictions: ranks.map((actualRank, i) => ({ guildName: `Guild ${i + 1}`, realm: "RWF", predictedRank: i + 1, actualRank, points: points[i] })),
});
const entry = makeEntry([1, 2, 4], [10, 10, 8], 34, 6);
const { getPickemScoreRows } = await import("../src/lib/pickem-score-rows.ts");

test("compact rules use backend points, zero-point outcomes and the configured streak threshold", () => {
  const text = render(PickemScoringRules, { pickem: { ...pickem, streakConfig: { enabled: true, minStreak: 4, bonusPerGuild: 7 } } });
  assert.match(text, /25 pts: Exact match/);
  assert.match(text, /12 pts: ±1 position/);
  assert.match(text, /0 pts: ±2 positions/);
  assert.match(text, /4 pts: ±3 positions/);
  assert.match(text, /0 pts: ±4 positions/);
  assert.match(text, /3 pts: 5\+ off/);
  assert.match(text, /0 pts: unranked \/ outside top 10/);
  assert.match(text, /\+7 pts\/guild: Streak of 4\+ guilds in the correct relative order/);
});

test("zero points are combined only when distance and unscored rules award the same points", () => {
  const zero = { ...pickem, scoringConfig: { ...pickem.scoringConfig, offByFiveOrMore: 0 } };
  assert.match(render(PickemScoringRules, { pickem: zero }), /0 pts: 5\+ off or unranked \/ outside top 10/);
  for (const rules of [{ ...zero, scoreOutOfRangeGuilds: true }, { ...zero, type: "rwf" }]) {
    const text = render(PickemScoringRules, { pickem: rules });
    assert.match(text, /0 pts: 5\+ off or unranked/);
    assert.doesNotMatch(text, /outside top/);
  }
});

test("disabled and unavailable rules do not invent default points or bonuses", () => {
  const disabled = render(PickemScoringRules, { pickem: { ...pickem, streakConfig: { ...pickem.streakConfig, enabled: false } } });
  assert.match(disabled, /Streaks disabled/);
  assert.doesNotMatch(disabled, /pts\/guild/);
  assert.match(render(PickemScoringRules, { pickem: { ...pickem, scoringConfig: undefined } }), /Scoring rules unavailable/);
});

test("running totals include each qualifying guild's bonus, including the start of the run", () => {
  assert.deepEqual(getPickemScoreRows(entry, pickem).map(({ total, streakBonus }) => [total, streakBonus]), [[12, 2], [24, 2], [34, 2]]);
  assert.match(render(PickemScoreBreakdown, { entry, pickem, scoresPending: false }), /#1: Guild 1 10 12 \+2.*#2: Guild 2 10 24 \+2.*#3: Guild 3 8 34 \+2/);
});

test("relative-order streaks split on reversals and require the configured length", () => {
  const rules = { ...pickem, streakConfig: { enabled: true, minStreak: 3, bonusPerGuild: 5 } };
  const split = makeEntry([2, 3, 1, 4, 5], [8, 8, 6, 10, 10], 57, 15);
  assert.deepEqual(getPickemScoreRows(split, rules).map(({ total, streakBonus }) => [total, streakBonus]), [[8, 0], [16, 0], [27, 5], [42, 5], [57, 5]]);
});

test("unranked and out-of-range guilds are skipped without breaking a streak", () => {
  const skipped = makeEntry([2, null, 11, 4], [8, 0, 0, 10], 22, 4);
  assert.deepEqual(getPickemScoreRows(skipped, pickem).map(({ total, streakBonus }) => [total, streakBonus]), [[10, 2], [10, 0], [10, 0], [22, 2]]);
  const ranked = makeEntry([2, null, 11, 12], [8, 0, 0, 0], 14, 6);
  for (const rules of [{ ...pickem, scoreOutOfRangeGuilds: true }, { ...pickem, type: "rwf", finalized: true }]) {
    assert.deepEqual(getPickemScoreRows(ranked, rules).map(row => row.streakBonus), [2, 0, 2, 2]);
  }
});

test("duplicate guild names on different realms do not receive the wrong bonus", () => {
  const duplicate = makeEntry([3, 1, 2], [6, 8, 8], 26, 4);
  duplicate.predictions[0].guildName = "Same name";
  duplicate.predictions[1].guildName = "Same name";
  duplicate.predictions[1].realm = "Other realm";
  assert.deepEqual(getPickemScoreRows(duplicate, pickem).map(row => row.streakBonus), [0, 2, 2]);
});

test("disabled streaks and zero bonuses retain position-only running totals", () => {
  const plain = { ...entry, streakBonus: 0, totalPoints: 28 };
  for (const streakConfig of [{ enabled: false, minStreak: 2, bonusPerGuild: 2 }, { enabled: true, minStreak: 2, bonusPerGuild: 0 }]) {
    assert.deepEqual(getPickemScoreRows(plain, { ...pickem, streakConfig }).map(row => row.total), [10, 20, 28]);
  }
});

test("pending, missing or inconsistent backend scores do not show derived totals", () => {
  for (const rules of [{ ...pickem, rankingsPending: true }, { ...pickem, type: "rwf", finalized: false }, { ...pickem, streakConfig: undefined }]) {
    assert.equal(getPickemScoreRows(entry, rules), null);
  }
  assert.equal(getPickemScoreRows({ ...entry, totalPoints: 999 }, pickem), null);
  assert.equal(getPickemScoreRows({ ...entry, streakBonus: undefined }, pickem), null);
  assert.doesNotMatch(render(PickemScoreBreakdown, { entry, pickem, scoresPending: true }), /Points|Streak|Total|34/);
});

test("Finnish rules and columns include the same configured values", () => {
  assert.match(render(PickemScoringRules, { pickem }, "fi"), /\+2 p\/kilta: Vähintään 2 killan putki/);
  assert.match(render(PickemScoreBreakdown, { entry, pickem, scoresPending: false }, "fi"), /Pisteet Yht. Putki/);
});
