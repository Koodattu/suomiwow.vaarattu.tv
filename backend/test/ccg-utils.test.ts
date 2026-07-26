import assert from "node:assert/strict";
import test from "node:test";
import {
  CCG_A_OR_BETTER_GRADES,
  CCG_COMMUNITY_SET,
  CCG_CONFIGURED_SETS,
  CCG_FINISH_ORDER,
  CCG_INITIAL_PACKS,
  CCG_PACK_STORAGE_CAPS,
  normalizeCcgRaidName,
} from "../src/config/ccg";
import {
  MIN_CHARACTER_RAID_MYTHIC_REPORTS_FOR_CCG_ELIGIBILITY,
  MIN_CHARACTER_RAID_PULLS_FOR_RANKING_ELIGIBILITY,
} from "../src/config/character-eligibility";
import { RAIDER_IO_MAIN_MYTHIC_PLUS_SEASON_SET } from "../src/config/mythic-plus";
import {
  hasApplicableAlternativeArt,
  normalizeAlternativeArtFilename,
  normalizeQuipAudioFilename,
  normalizeQuipText,
  serializeOwnershipRows,
  serializeQuip,
} from "../src/utils/ccg-alternative-art";
import {
  emptyFinishPity,
  finishChanceForCounter,
  gradeForPercentile,
  nextFinish,
  resolveCardCrop,
  resolveOwnedFinish,
  rollArtVariant,
  rollOwnedFinish,
  rollProtectedFinish,
} from "../src/utils/ccg-random";
import { planPackSelections, selectCommunityCard, selectPackCards } from "../src/utils/ccg-pack";
import { createWowCharacterIdentityKey } from "../src/utils/ccg-identity";
import { nextCcgCardSnapshotVersion, shouldPublishCcgCardSnapshot } from "../src/utils/ccg-card-snapshot";
import { normalizeCcgRedeemCode } from "../src/utils/ccg-redeem";
import { evaluateCcgReadiness } from "../src/utils/ccg-readiness";
import { applyPackRecharge, getNextPackRechargeAt, getRechargeGrants } from "../src/utils/ccg-recharge";
import { applyCcgPackRollover } from "../src/utils/ccg-rollover";
import { getHelsinkiDateKey, getNextHelsinkiReset } from "../src/utils/helsinki-time";

test("canonical grading maps a 100-card population to the versioned S through F bands", () => {
  const counts = new Map<string, number>();
  for (let index = 0; index < 100; index += 1) {
    const grade = gradeForPercentile(index, 100);
    counts.set(grade, (counts.get(grade) ?? 0) + 1);
  }
  assert.deepEqual(Object.fromEntries(counts), { S: 5, A: 10, B: 20, C: 20, D: 20, E: 15, F: 10 });
});

test("card snapshots publish only for a new character or a changed rarity grade", () => {
  assert.equal(shouldPublishCcgCardSnapshot(null, "B"), true);
  assert.equal(shouldPublishCcgCardSnapshot({ tierGrade: "B" }, "B"), false);
  assert.equal(shouldPublishCcgCardSnapshot({ tierGrade: "B" }, "A"), true);
});

test("card snapshot versions advance without requiring a legacy version field", () => {
  assert.equal(nextCcgCardSnapshotVersion(null), 1);
  assert.equal(nextCcgCardSnapshotVersion({}), 2);
  assert.equal(nextCcgCardSnapshotVersion({ snapshotVersion: 2 }), 3);
});

test("card crops are deterministic and stay inside each raid's safe flair range", () => {
  for (const set of CCG_CONFIGURED_SETS) {
    const first = resolveCardCrop(`${set.slug}:character`, set.crop);
    const second = resolveCardCrop(`${set.slug}:character`, set.crop);
    assert.deepEqual(first, second);
    assert.ok(first.x >= set.crop.x - set.crop.xJitter && first.x <= set.crop.x + set.crop.xJitter);
    assert.ok(first.y >= set.crop.y - set.crop.yJitter && first.y <= set.crop.y + set.crop.yJitter);
    assert.ok(first.scale >= set.crop.scale && first.scale <= set.crop.scale + 0.03);
  }
});

test("every raid artwork uses its configured horizontal crop range", () => {
  const expectedRanges = new Map<number, readonly [number, number]>([
    [6, [0, 100]],
    [7, [0, 61]],
    [8, [0, 47]],
    [10, [26, 88]],
    [11, [15, 80]],
    [13, [43, 81]],
    [17, [21, 75]],
    [19, [59, 85]],
    [21, [49, 77]],
    [23, [36, 90]],
    [24, [0, 100]],
    [26, [25, 63]],
    [28, [50, 96]],
    [29, [55, 97]],
    [31, [58, 95]],
    [33, [65, 97]],
    [35, [40, 75]],
    [38, [53, 89]],
    [42, [39, 70]],
    [44, [28, 64]],
    [46, [26, 80]],
  ]);

  assert.equal(CCG_CONFIGURED_SETS.length, expectedRanges.size);
  for (const set of CCG_CONFIGURED_SETS) {
    const expected = expectedRanges.get(set.zoneId);
    assert.ok(expected, `Missing expected range for ${set.raidName}`);
    assert.deepEqual([set.crop.x - set.crop.xJitter, set.crop.x + set.crop.xJitter], expected);
  }
});

test("Community artwork uses the default 25 to 75 horizontal crop range", () => {
  assert.deepEqual(
    [CCG_COMMUNITY_SET.crop.x - CCG_COMMUNITY_SET.crop.xJitter, CCG_COMMUNITY_SET.crop.x + CCG_COMMUNITY_SET.crop.xJitter],
    [25, 75],
  );
});

test("short raids excluded from CCG stay excluded", () => {
  assert.equal(CCG_CONFIGURED_SETS.some((set) => set.zoneId === 22), false);
  assert.equal(CCG_CONFIGURED_SETS.some((set) => set.zoneId === 12), false);
});

test("configured CCG raid names omit comma-qualified subtitles", () => {
  assert.equal(CCG_CONFIGURED_SETS.find((set) => set.zoneId === 33)?.raidName, "Aberrus");
  assert.equal(CCG_CONFIGURED_SETS.find((set) => set.zoneId === 35)?.raidName, "Amirdrassil");
  assert.equal(CCG_CONFIGURED_SETS.every((set) => !set.raidName.includes(",")), true);
  assert.equal(normalizeCcgRaidName("Future Raid, the Subtitle"), "Future Raid");
});

test("every raid set is pinned to its intended Mythic+ season", () => {
  const expectedSeasons = new Map<number, string>([
    [6, "none"],
    [7, "none"],
    [8, "none"],
    [10, "none"],
    [11, "none"],
    [13, "season-7.2.5"],
    [17, "season-7.3.2"],
    [19, "season-bfa-1"],
    [21, "season-bfa-2"],
    [23, "season-bfa-3"],
    [24, "season-bfa-4"],
    [26, "season-sl-1"],
    [28, "season-sl-2"],
    [29, "season-sl-3"],
    [31, "season-df-1"],
    [33, "season-df-2"],
    [35, "season-df-3"],
    [38, "season-tww-1"],
    [42, "season-tww-2"],
    [44, "season-tww-3"],
    [46, "season-mn-1"],
  ]);

  assert.deepEqual(
    CCG_CONFIGURED_SETS.map((set) => [set.zoneId, set.mythicPlusSeason]),
    Array.from(expectedSeasons),
  );
  assert.equal(CCG_CONFIGURED_SETS.some((set) => set.mythicPlusSeason === "season-sl-4" || set.mythicPlusSeason === "season-df-4"), false);
  for (const set of CCG_CONFIGURED_SETS) {
    assert.equal(set.mythicPlusSeason === "none" || RAIDER_IO_MAIN_MYTHIC_PLUS_SEASON_SET.has(set.mythicPlusSeason), true);
  }
});

test("WoD and Legion CCG sets use their supplied backgrounds", () => {
  const expectedBackgrounds = new Map<number, string>([
    [6, "/ccg/highmaul.png"],
    [7, "/ccg/blackrock_foundry.png"],
    [8, "/ccg/hellfire_citadel.png"],
    [10, "/ccg/emerald_nightmare.png"],
    [11, "/ccg/nighthold.png"],
    [13, "/ccg/tomb_of_sargeras.png"],
    [17, "/ccg/antorus.png"],
  ]);

  assert.deepEqual(
    CCG_CONFIGURED_SETS.filter((set) => expectedBackgrounds.has(set.zoneId)).map((set) => [set.zoneId, set.backgroundPath]),
    Array.from(expectedBackgrounds),
  );
});

test("CCG eligibility requires three Mythic reports and fifty pulls", () => {
  assert.equal(MIN_CHARACTER_RAID_MYTHIC_REPORTS_FOR_CCG_ELIGIBILITY, 3);
  assert.equal(MIN_CHARACTER_RAID_PULLS_FOR_RANKING_ELIGIBILITY, 50);
});

test("quality protection honors hard pity, minimum finishes, and independent resets", () => {
  const first = rollProtectedFinish(emptyFinishPity(), "standard", (maximum) => maximum - 1);
  assert.equal(first.finish, "standard");
  assert.deepEqual(first.pity, { foil: 1, golden: 1, prismatic: 1, holographic: 1, negative: 1 });

  const foilPity = { ...emptyFinishPity(), foil: 4 };
  const guaranteed = rollProtectedFinish(foilPity, "standard", (maximum) => maximum - 1);
  assert.equal(guaranteed.finish, "foil");
  assert.equal(guaranteed.pity.foil, 0);
  assert.equal(guaranteed.pity.golden, 1);

  const upgraded = rollProtectedFinish(emptyFinishPity(), nextFinish("prismatic"), (maximum) => maximum - 1);
  assert.equal(upgraded.finish, "holographic");
  assert.equal(upgraded.pity.holographic, 0);

  const negativePity = { ...emptyFinishPity(), negative: 999 };
  const negative = rollProtectedFinish(negativePity, "standard", (maximum) => maximum - 1);
  const followingCard = rollProtectedFinish(negative.pity, "standard", (maximum) => maximum - 1);
  assert.equal(negative.finish, "negative");
  assert.notEqual(followingCard.finish, "negative");
});

test("owned finishes are resolved per raid card and only completed-card duplicates qualify for a reward", () => {
  assert.deepEqual(resolveOwnedFinish("standard", new Set(["foil"])), {
    finish: "standard",
    isDuplicate: false,
    isCompletedCardDuplicate: false,
  });
  assert.deepEqual(resolveOwnedFinish("foil", new Set(["standard", "foil"])), {
    finish: "golden",
    isDuplicate: true,
    isCompletedCardDuplicate: false,
  });
  assert.deepEqual(resolveOwnedFinish("prismatic", new Set(["standard", "prismatic"])), {
    finish: "golden",
    isDuplicate: true,
    isCompletedCardDuplicate: false,
  });
  assert.deepEqual(resolveOwnedFinish("prismatic", new Set(["standard", "foil", "golden"])), {
    finish: "prismatic",
    isDuplicate: false,
    isCompletedCardDuplicate: false,
  });
  assert.deepEqual(resolveOwnedFinish("negative", new Set(["standard", "golden", "prismatic", "holographic", "negative"])), {
    finish: "foil",
    isDuplicate: true,
    isCompletedCardDuplicate: false,
  });
  assert.deepEqual(resolveOwnedFinish("prismatic", new Set(CCG_FINISH_ORDER)), {
    finish: "prismatic",
    isDuplicate: true,
    isCompletedCardDuplicate: true,
  });
});

test("a promoted duplicate resets protection for the rolled and awarded finishes", () => {
  const pity = { ...emptyFinishPity(), foil: 4, golden: 10 };
  const result = rollOwnedFinish(pity, new Set(["standard", "foil"]), (maximum) => maximum - 1);
  assert.equal(result.finish, "golden");
  assert.equal(result.isDuplicate, true);
  assert.equal(result.isCompletedCardDuplicate, false);
  assert.equal(result.pity.foil, 0);
  assert.equal(result.pity.golden, 0);

  const downwardResult = rollOwnedFinish(
    { ...emptyFinishPity(), foil: 4, golden: 24 },
    new Set(["standard", "golden"]),
    (maximum) => maximum - 1,
  );
  assert.equal(downwardResult.finish, "foil");
  assert.equal(downwardResult.isDuplicate, true);
  assert.equal(downwardResult.pity.foil, 0);
  assert.equal(downwardResult.pity.golden, 0);
});

test("quality protection stays flat until late soft pity and then accelerates", () => {
  assert.equal(finishChanceForCounter(1, 100), 0.01);
  assert.equal(finishChanceForCounter(50, 100), 0.01);
  assert.equal(finishChanceForCounter(80, 100), 0.01);
  assert.ok(finishChanceForCounter(81, 100) > 0.01);
  assert.ok(finishChanceForCounter(95, 100) > finishChanceForCounter(90, 100));
  assert.equal(finishChanceForCounter(100, 100), 1);

  const pity = { ...emptyFinishPity(), golden: 9 };
  let rollIndex = 0;
  const result = rollProtectedFinish(pity, "standard", (maximum) => {
    rollIndex += 1;
    return rollIndex === 2 ? Math.floor(maximum * 0.2) : maximum - 1;
  });
  assert.equal(result.finish, "standard");
  assert.equal(result.pity.golden, 10);
});

test("every selected pack has five cards and an A-or-better guaranteed slot", () => {
  const grades = ["S", "A", "B", "C", "D", "E", "F"] as const;
  const buckets = grades.map((grade, index) => ({ grade, cardIds: [`card-${index}`] }));
  const selected = selectPackCards(buckets, (maximum) => maximum - 1);
  assert.equal(selected.length, 5);
  assert.equal(CCG_A_OR_BETTER_GRADES.has(selected[4].tierGrade), true);
  assert.equal(selected[0].tierGrade, "F");
});

test("a pack cannot be produced when no A-or-better card exists", () => {
  assert.throws(() => selectPackCards([{ grade: "F", cardIds: ["only-card"] }], () => 0), /no eligible cards/);
});

test("first-time pack grants distinguish guest and authenticated storage", () => {
  assert.deepEqual(CCG_PACK_STORAGE_CAPS, { current: 25, legacy: 25 });
  assert.deepEqual(CCG_INITIAL_PACKS.guest, { current: 5, legacy: 5 });
  assert.deepEqual(CCG_INITIAL_PACKS.user, { current: 25, legacy: 25 });
});

test("pack recharge follows shared Helsinki hour boundaries and respects storage caps", () => {
  const grants = getRechargeGrants(new Date("2026-01-01T07:00:00.000Z"), new Date("2026-01-01T10:05:00.000Z"));
  assert.deepEqual(grants, { current: 2, legacy: 3 });
  assert.equal(getNextPackRechargeAt("current", new Date("2026-07-24T10:30:00.000Z")).toISOString(), "2026-07-24T11:00:00.000Z");
  assert.equal(getNextPackRechargeAt("legacy", new Date("2026-07-24T10:30:00.000Z")).toISOString(), "2026-07-24T11:00:00.000Z");

  const recharged = applyPackRecharge(
    { current: CCG_PACK_STORAGE_CAPS.current - 1, legacy: CCG_PACK_STORAGE_CAPS.legacy - 1 },
    new Date("2026-01-01T07:00:00.000Z"),
    new Date("2026-01-01T10:05:00.000Z"),
  );
  assert.deepEqual(recharged.balances, CCG_PACK_STORAGE_CAPS);
  assert.equal(recharged.lastRechargeAt.toISOString(), "2026-01-01T10:00:00.000Z");

  const overCap = applyPackRecharge(
    { current: 50, legacy: 26 },
    new Date("2026-01-01T07:00:00.000Z"),
    new Date("2026-01-01T10:05:00.000Z"),
  );
  assert.deepEqual(overCap.balances, { current: 50, legacy: 26 });

  const blockedByBonusPacks = applyPackRecharge(
    { current: 20, legacy: 20 },
    new Date("2026-01-01T07:00:00.000Z"),
    new Date("2026-01-01T10:05:00.000Z"),
    { current: 10, legacy: 4 },
  );
  assert.deepEqual(blockedByBonusPacks.balances, { current: 20, legacy: 21 });
});

test("authenticated raid rollover moves all Current packs to Legacy and refills Current storage", () => {
  const rollover = applyCcgPackRollover(
    "user",
    { current: 10, legacy: 7 },
    { current: 4, legacy: 2 },
    new Date("2026-01-01T10:00:00.000Z"),
    new Date("2026-01-01T10:00:00.000Z"),
    25,
  );

  assert.deepEqual(rollover.balances, { current: 25, legacy: 7 });
  assert.equal(rollover.regularCurrentMoved, 10);
  assert.equal(rollover.bonusCurrentMoved, 4);
  assert.equal(7 + 2 + rollover.regularCurrentMoved + rollover.bonusCurrentMoved, 23);
});

test("raid rollover includes lazy recharge accrued before the cutover", () => {
  const rollover = applyCcgPackRollover(
    "user",
    { current: 20, legacy: 7 },
    { current: 4, legacy: 2 },
    new Date("2026-01-01T07:00:00.000Z"),
    new Date("2026-01-01T10:05:00.000Z"),
    25,
  );

  assert.deepEqual(rollover.balances, { current: 25, legacy: 10 });
  assert.equal(rollover.regularCurrentMoved, 21);
  assert.equal(rollover.lastRechargeAt.toISOString(), "2026-01-01T10:00:00.000Z");
});

test("guest rollover preserves old Current packs in Legacy and restores the guest allowance", () => {
  const rollover = applyCcgPackRollover(
    "guest",
    { current: 3, legacy: 4 },
    { current: 0, legacy: 0 },
    new Date("2026-01-01T10:00:00.000Z"),
    new Date("2026-01-01T10:00:00.000Z"),
    5,
  );

  assert.deepEqual(rollover.balances, { current: 5, legacy: 7 });
  assert.equal(rollover.regularCurrentMoved, 3);
});

test("each missed raid rollover carries the prior refill into Legacy", () => {
  const first = applyCcgPackRollover(
    "user",
    { current: 10, legacy: 7 },
    { current: 4, legacy: 2 },
    new Date("2026-01-01T10:00:00.000Z"),
    new Date("2026-01-01T10:00:00.000Z"),
    25,
  );
  const creditsAfterFirst = { current: 0, legacy: 2 + 4 + first.regularCurrentMoved };
  const second = applyCcgPackRollover(
    "user",
    first.balances,
    creditsAfterFirst,
    first.lastRechargeAt,
    new Date("2026-01-01T10:00:00.000Z"),
    25,
  );

  assert.equal(second.regularCurrentMoved, 25);
  assert.deepEqual(second.balances, { current: 25, legacy: 7 });
  assert.equal(second.balances.legacy + creditsAfterFirst.legacy + second.regularCurrentMoved, 48);
});

test("redeem codes normalize safely without accepting ambiguous separators", () => {
  assert.equal(normalizeCcgRedeemCode("  vault-2026  "), "VAULT-2026");
  assert.equal(normalizeCcgRedeemCode("PACK_DROP"), "PACK_DROP");
  assert.equal(normalizeCcgRedeemCode("ab"), null);
  assert.equal(normalizeCcgRedeemCode("PACK DROP"), null);
  assert.equal(normalizeCcgRedeemCode("PACK--DROP"), null);
  assert.equal(normalizeCcgRedeemCode("PÄCK"), null);
});

test("a mode-wide pack plan can draw cards from multiple raid pools", () => {
  const values = [0, 0, 0, 2, 0, 1, 0, 4, 0, 0];
  let cursor = 0;
  const plan = planPackSelections(
    [
      { poolId: "pool-a", setId: "raid-a", version: "1", counts: [{ grade: "A", count: 2 }] },
      { poolId: "pool-b", setId: "raid-b", version: "1", counts: [{ grade: "A", count: 3 }] },
    ],
    (maximum) => values[cursor++] % maximum,
  );
  assert.equal(plan.length, 5);
  assert.equal(plan.every((row) => row.tierGrade === "A"), true);
  assert.deepEqual(new Set(plan.map((row) => row.setId)), new Set(["raid-a", "raid-b"]));
});

test("a targeted pack plan stays inside its selected raid pool", () => {
  const plan = planPackSelections(
    [{ poolId: "pool-a", setId: "raid-a", version: "1", counts: [{ grade: "A", count: 5 }] }],
    () => 0,
  );
  assert.equal(plan.length, 5);
  assert.equal(plan.every((row) => row.poolId === "pool-a" && row.setId === "raid-a"), true);
});

test("community cards pass a second 50/50 gate after their pool roll", () => {
  assert.equal(selectCommunityCard(9, ["community"], () => 0), null);

  const rejectedRolls = [9, 1];
  assert.equal(selectCommunityCard(9, ["community"], () => rejectedRolls.shift()!), null);

  const acceptedRolls = [9, 0, 0];
  assert.equal(selectCommunityCard(9, ["community"], () => acceptedRolls.shift()!), "community");
});

test("alternative art uses one 1-in-4 roll and only applies backgrounds to Community cards", () => {
  const art = {
    collectorKey: "character:laku",
    characterArtFilename: "laku_clap.png",
    characterArtEnabled: true,
    backgroundArtFilename: "housing.png",
    backgroundArtEnabled: true,
  };
  assert.equal(hasApplicableAlternativeArt(art, false), true);
  assert.equal(hasApplicableAlternativeArt({ ...art, characterArtEnabled: false }, false), false);
  assert.equal(hasApplicableAlternativeArt({ ...art, characterArtEnabled: false }, true), true);
  assert.equal(rollArtVariant(true, () => 0), "standard");
  assert.equal(rollArtVariant(true, () => 1), "standard");
  assert.equal(rollArtVariant(true, () => 2), "standard");
  let rollMaximum = 0;
  assert.equal(rollArtVariant(true, (maximum) => {
    rollMaximum = maximum;
    return maximum - 1;
  }), "alternative");
  assert.equal(rollMaximum, 4);
  assert.equal(rollArtVariant(false, () => 3), "standard");
});

test("alternative art is one global unlock and does not split finish quantities", () => {
  assert.deepEqual(serializeOwnershipRows([
    { finish: "standard", quantity: 3 },
    { finish: "foil", quantity: 4, alternativeQuantity: 3 },
  ]), [
    { finish: "standard", artVariant: "standard", quantity: 3 },
    { finish: "foil", artVariant: "standard", quantity: 4 },
  ]);
  assert.deepEqual(serializeOwnershipRows([
    { finish: "standard", quantity: 3 },
    { finish: "foil", quantity: 4, alternativeQuantity: 3 },
  ], true), [
    { finish: "standard", artVariant: "standard", quantity: 3 },
    { finish: "standard", artVariant: "alternative", quantity: 3 },
    { finish: "foil", artVariant: "standard", quantity: 4 },
    { finish: "foil", artVariant: "alternative", quantity: 4 },
  ]);
});

test("alternative artwork accepts image filenames but rejects paths", () => {
  assert.equal(normalizeAlternativeArtFilename(" laku_clap.png "), "laku_clap.png");
  assert.equal(normalizeAlternativeArtFilename(""), null);
  assert.throws(() => normalizeAlternativeArtFilename("../laku.png"), /filename only/);
  assert.throws(() => normalizeAlternativeArtFilename("laku.svg"), /filename only/);
});

test("card quips normalize optional text and serialize safe public audio paths", () => {
  assert.equal(normalizeQuipText("  We go again.  "), "We go again.");
  assert.equal(normalizeQuipText(""), null);
  assert.throws(() => normalizeQuipText("x".repeat(501)), /500 characters/);
  assert.equal(normalizeQuipAudioFilename(" haisuli.wav "), "haisuli.wav");
  assert.equal(normalizeQuipAudioFilename(null), null);
  assert.throws(() => normalizeQuipAudioFilename("../quip.mp3"), /filename only/);
  assert.throws(() => normalizeQuipAudioFilename("quip.txt"), /filename only/);
  assert.deepEqual(serializeQuip({
    collectorKey: "character:test",
    quipText: "We go again.",
    quipAudioFilename: "voice line.mp3",
  }), {
    text: "We go again.",
    audioFilename: "voice line.mp3",
    audioPath: "/ccg/audio/quips/voice%20line.mp3",
  });
  assert.equal(serializeQuip({ collectorKey: "character:test" }), null);
});

test("community identity matches display and slug forms of a realm", () => {
  assert.equal(
    createWowCharacterIdentityKey("EU", "Twisting Nether", "Example"),
    createWowCharacterIdentityKey("eu", "twisting-nether", "example"),
  );
});

test("raid activation readiness fails closed and becomes irreversible after enablement", () => {
  assert.deepEqual(evaluateCcgReadiness({ eligible: 99, mediaReady: 49, enabled: false }).blockers, [
    "eligible_population",
    "media_ready",
    "media_coverage",
  ]);
  assert.equal(evaluateCcgReadiness({ eligible: 100, mediaReady: 75, enabled: false }).readyToEnable, true);
  assert.deepEqual(evaluateCcgReadiness({ eligible: 100, mediaReady: 75, enabled: true }).blockers, ["already_enabled"]);
});

test("Helsinki day keys and next reset follow daylight-saving transitions", () => {
  const springMidnight = new Date("2026-03-28T22:00:00.000Z");
  assert.equal(getHelsinkiDateKey(springMidnight), "2026-03-29");
  assert.equal(getNextHelsinkiReset(springMidnight).toISOString(), "2026-03-29T21:00:00.000Z");

  const autumnMidnight = new Date("2026-10-24T21:00:00.000Z");
  assert.equal(getHelsinkiDateKey(autumnMidnight), "2026-10-25");
  assert.equal(getNextHelsinkiReset(autumnMidnight).toISOString(), "2026-10-25T22:00:00.000Z");
});
