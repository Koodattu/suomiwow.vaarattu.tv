import assert from "node:assert/strict";
import test from "node:test";
import {
  CCG_A_OR_BETTER_GRADES,
  CCG_COMMUNITY_SET,
  CCG_CONFIGURED_SETS,
  CCG_FINISH_ORDER,
  CCG_FINISH_PITY_LIMITS,
  CCG_INITIAL_PACKS,
  CCG_PACK_STORAGE_CAPS,
  CCG_REGULAR_TIER_GRADES,
  CCG_TIER_GRADES,
  CcgFinish,
  CcgTierGrade,
  getCcgFinishOrder,
  getCcgPackFinishOrder,
  getCcgRedeemFinishOrder,
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
import { planPackSelections, selectCommunityCard, selectCommunityCardForGrade, selectPackCards, shufflePackResults } from "../src/utils/ccg-pack";
import { createWowCharacterIdentityKey } from "../src/utils/ccg-identity";
import { getTransferableGuestPacks, resolveGuestClaimOpeningId, verifyGuestLibrary } from "../src/utils/ccg-guest-library";
import { getCcgSnapshotPreviewDisposition, nextCcgCardSnapshotVersion, shouldPublishCcgCardSnapshot, summarizeCcgSnapshotPreview } from "../src/utils/ccg-card-snapshot";
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

test("card snapshots publish for new characters and changed rarity or performance identity", () => {
  const next = { tierGrade: "B" as const, specName: "shadow", role: "dps" as const, metric: "dps" as const };
  assert.equal(shouldPublishCcgCardSnapshot(null, next), true);
  assert.equal(shouldPublishCcgCardSnapshot(next, next), false);
  assert.equal(shouldPublishCcgCardSnapshot(next, { ...next, tierGrade: "A" }), true);
  assert.equal(shouldPublishCcgCardSnapshot(next, { ...next, specName: "holy", role: "healer", metric: "hps" }), true);
});

test("card snapshot versions advance without requiring a legacy version field", () => {
  assert.equal(nextCcgCardSnapshotVersion(null), 1);
  assert.equal(nextCcgCardSnapshotVersion({}), 2);
  assert.equal(nextCcgCardSnapshotVersion({ snapshotVersion: 2 }), 3);
});

test("snapshot previews separate new characters, rarity changes, unchanged cards, and missing media", () => {
  const preview = summarizeCcgSnapshotPreview(
    [
      { characterId: "new-ready", tierGrade: "S", specName: "shadow", role: "dps", metric: "dps", hasMedia: true },
      { characterId: "new-blocked", tierGrade: "A", specName: "shadow", role: "dps", metric: "dps", hasMedia: false },
      { characterId: "changed-ready", tierGrade: "A", specName: "shadow", role: "dps", metric: "dps", hasMedia: true },
      { characterId: "changed-blocked", tierGrade: "B", specName: "shadow", role: "dps", metric: "dps", hasMedia: false },
      { characterId: "identity-ready", tierGrade: "C", specName: "holy", role: "healer", metric: "hps", hasMedia: true },
      { characterId: "identity-blocked", tierGrade: "C", specName: "holy", role: "healer", metric: "hps", hasMedia: false },
      { characterId: "unchanged", tierGrade: "C", specName: "shadow", role: "dps", metric: "dps", hasMedia: true },
    ] as const,
    [
      { characterId: "changed-ready", tierGrade: "B", specName: "shadow", role: "dps", metric: "dps" },
      { characterId: "changed-blocked", tierGrade: "C", specName: "shadow", role: "dps", metric: "dps" },
      { characterId: "identity-ready", tierGrade: "C", specName: "shadow", role: "dps", metric: "dps" },
      { characterId: "identity-blocked", tierGrade: "C", specName: "shadow", role: "dps", metric: "dps" },
      { characterId: "unchanged", tierGrade: "C", specName: "shadow", role: "dps", metric: "dps" },
    ],
  );

  assert.deepEqual(preview, {
    eligibleCharacters: 7,
    projectedSnapshots: 3,
    newCharacters: 1,
    rarityChanges: 1,
    identityChanges: 1,
    unchangedCharacters: 1,
    blockedByMissingMedia: 3,
    mediaReady: 4,
    missingMedia: 3,
    gradeDistribution: { S: 1, A: 2, B: 1, C: 3, D: 0, E: 0, F: 0 },
  });
});

test("snapshot preview dispositions identify which missing-media characters need action", () => {
  const next = { tierGrade: "A" as const, specName: "shadow", role: "dps" as const, metric: "dps" as const };
  const previous = { ...next, tierGrade: "B" as const };
  const changedIdentity = { ...next, specName: "holy", role: "healer" as const, metric: "hps" as const };
  assert.equal(getCcgSnapshotPreviewDisposition(null, next, false), "blocked_new_character");
  assert.equal(getCcgSnapshotPreviewDisposition(previous, next, false), "blocked_rarity_change");
  assert.equal(getCcgSnapshotPreviewDisposition(next, next, false), "unchanged");
  assert.equal(getCcgSnapshotPreviewDisposition(null, next, true), "new_character");
  assert.equal(getCcgSnapshotPreviewDisposition(previous, next, true), "rarity_change");
  assert.equal(getCcgSnapshotPreviewDisposition(changedIdentity, next, true), "identity_change");
  assert.equal(getCcgSnapshotPreviewDisposition(changedIdentity, next, false), "blocked_identity_change");
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

test("CCG eligibility requires three Mythic reports and forty pulls", () => {
  assert.equal(MIN_CHARACTER_RAID_MYTHIC_REPORTS_FOR_CCG_ELIGIBILITY, 3);
  assert.equal(MIN_CHARACTER_RAID_PULLS_FOR_RANKING_ELIGIBILITY, 40);
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

test("owned finishes are resolved per card series and only completed-series duplicates qualify for a reward", () => {
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

test("raid-scoped finishes extend only their configured set's ladder", () => {
  const defaultOrder = getCcgFinishOrder();
  const voidOrder = getCcgFinishOrder("void");
  const toxicOrder = getCcgFinishOrder("toxic");
  assert.deepEqual(defaultOrder, ["standard", "foil", "golden", "prismatic", "holographic", "negative"]);
  assert.deepEqual(voidOrder, ["standard", "foil", "golden", "prismatic", "holographic", "void", "negative"]);
  assert.deepEqual(toxicOrder, ["standard", "foil", "golden", "prismatic", "holographic", "toxic", "negative"]);
  assert.deepEqual(
    resolveOwnedFinish("negative", new Set<CcgFinish>(defaultOrder), voidOrder),
    { finish: "void", isDuplicate: true, isCompletedCardDuplicate: false },
  );
  assert.equal(
    resolveOwnedFinish("void", new Set<CcgFinish>(voidOrder), voidOrder).isCompletedCardDuplicate,
    true,
  );
  assert.equal(CCG_CONFIGURED_SETS.find((set) => set.slug === "march-on-queldanas")?.customFinish?.key, "void");
});

test("Community redeem codes allow every custom finish without extending pack completion", () => {
  assert.deepEqual(getCcgRedeemFinishOrder("community"), CCG_FINISH_ORDER);
  assert.equal(getCcgRedeemFinishOrder("community").includes("toxic"), true);
  assert.deepEqual(getCcgPackFinishOrder("community", "toxic"), getCcgFinishOrder());
  assert.deepEqual(getCcgRedeemFinishOrder("raid"), getCcgFinishOrder());
  assert.deepEqual(getCcgRedeemFinishOrder("raid", "void"), getCcgFinishOrder("void"));
  assert.equal(getCcgRedeemFinishOrder("raid", "void").includes("toxic"), false);

  const communityCompletionOrder = getCcgFinishOrder();
  assert.deepEqual(
    resolveOwnedFinish("foil", new Set<CcgFinish>(["standard", "foil", "void", "toxic"]), communityCompletionOrder),
    { finish: "golden", isDuplicate: true, isCompletedCardDuplicate: false },
  );
  const ownedWithCodeExclusives = new Set<CcgFinish>([...communityCompletionOrder, "void", "toxic"]);
  assert.deepEqual(
    resolveOwnedFinish("foil", ownedWithCodeExclusives, communityCompletionOrder),
    { finish: "foil", isDuplicate: true, isCompletedCardDuplicate: true },
  );
});

test("raid-scoped finish pity rolls only when that finish is in the active ladder", () => {
  const voidOrder = getCcgFinishOrder("void");
  const result = rollOwnedFinish(
    { ...emptyFinishPity(), void: 249 },
    new Set(),
    (maximum) => maximum - 1,
    voidOrder,
    { ...CCG_FINISH_PITY_LIMITS, void: 250 },
  );
  assert.equal(result.finish, "void");
  assert.equal(result.pity.void, 0);

  const toxicOrder = getCcgFinishOrder("toxic");
  const toxicResult = rollOwnedFinish(
    { ...emptyFinishPity(), toxic: 249 },
    new Set(),
    (maximum) => maximum - 1,
    toxicOrder,
    { ...CCG_FINISH_PITY_LIMITS, toxic: 250 },
  );
  assert.equal(toxicResult.finish, "toxic");
  assert.equal(toxicResult.pity.toxic, 0);

  const baseResult = rollOwnedFinish(
    { ...emptyFinishPity(), void: 249 },
    new Set(),
    (maximum) => maximum - 1,
  );
  assert.equal(baseResult.finish, "standard");
  assert.equal(baseResult.pity.void, undefined);
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
  assert.equal(finishChanceForCounter(1, 250), 1 / 250);
  assert.equal(finishChanceForCounter(200, 250), 1 / 250);
  assert.ok(finishChanceForCounter(201, 250) > 1 / 250);
  assert.equal(finishChanceForCounter(250, 250), 1);

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

test("pack results are shuffled without changing the rolled results", () => {
  const results = ["first", "second", "third", "fourth", "guaranteed"];
  const shuffled = shufflePackResults(results, () => 0);

  assert.deepEqual(results, ["first", "second", "third", "fourth", "guaranteed"]);
  assert.deepEqual(shuffled, ["second", "third", "fourth", "guaranteed", "first"]);
});

test("a pack cannot be produced when no A-or-better card exists", () => {
  assert.throws(() => selectPackCards([{ grade: "F", cardIds: ["only-card"] }], () => 0), /no eligible cards/);
});

test("first-time pack grants distinguish guest and authenticated storage", () => {
  assert.deepEqual(CCG_PACK_STORAGE_CAPS, { current: 50, legacy: 50 });
  assert.deepEqual(CCG_INITIAL_PACKS.guest, { current: 20, legacy: 20 });
  assert.deepEqual(CCG_INITIAL_PACKS.user, { current: 20, legacy: 20 });
});

test("guest conversion transfers remaining server packs with a 20-pack cap per mode", () => {
  assert.deepEqual(getTransferableGuestPacks({ current: 14, legacy: 7 }), { current: 14, legacy: 7 });
  assert.deepEqual(getTransferableGuestPacks({ current: 2_000, legacy: 21 }), { current: 20, legacy: 20 });
  assert.deepEqual(getTransferableGuestPacks({ current: -4, legacy: 8.9 }), { current: 0, legacy: 8 });
  assert.deepEqual(getTransferableGuestPacks(null), { current: 0, legacy: 0 });
});

test("guest conversion uses an explicit opening when supplied and otherwise falls back to the latest opening", () => {
  const openingIds = ["opening-1", "opening-2", "opening-3"];
  assert.equal(resolveGuestClaimOpeningId(openingIds, "opening-1"), "opening-1");
  assert.equal(resolveGuestClaimOpeningId(openingIds, null), "opening-3");
  assert.equal(resolveGuestClaimOpeningId(openingIds, "unknown"), null);
  assert.equal(resolveGuestClaimOpeningId([], null), null);
});

test("guest conversion accepts only ownership reproduced by server opening history", () => {
  const openings = [
    {
      mode: "current" as const,
      results: [
        { cardId: "card-1", finish: "standard" as const, artVariant: "standard" as const, isDuplicate: false },
        { cardId: "card-2", finish: "foil" as const, artVariant: "alternative" as const, isDuplicate: false },
        { cardId: "card-3", finish: "standard" as const, artVariant: "standard" as const, isDuplicate: false },
        { cardId: "card-4", finish: "standard" as const, artVariant: "standard" as const, isDuplicate: false },
        { cardId: "card-1", finish: "standard" as const, artVariant: "alternative" as const, isDuplicate: true },
      ],
    },
    {
      mode: "legacy" as const,
      results: [
        { cardId: "card-5", finish: "standard" as const, artVariant: "standard" as const, isDuplicate: false },
        { cardId: "card-6", finish: "golden" as const, artVariant: "standard" as const, isDuplicate: false },
        { cardId: "card-7", finish: "standard" as const, artVariant: "standard" as const, isDuplicate: false },
        { cardId: "card-8", finish: "standard" as const, artVariant: "standard" as const, isDuplicate: false },
        { cardId: "card-9", finish: "standard" as const, artVariant: "standard" as const, isDuplicate: false },
      ],
    },
  ];
  const ownership = [
    { cardId: "card-1", finish: "standard" as const, quantity: 2, alternativeQuantity: 1 },
    { cardId: "card-2", finish: "foil" as const, quantity: 1, alternativeQuantity: 1 },
    { cardId: "card-3", finish: "standard" as const, quantity: 1, alternativeQuantity: 0 },
    { cardId: "card-4", finish: "standard" as const, quantity: 1, alternativeQuantity: 0 },
    { cardId: "card-5", finish: "standard" as const, quantity: 1, alternativeQuantity: 0 },
    { cardId: "card-6", finish: "golden" as const, quantity: 1, alternativeQuantity: 0 },
    { cardId: "card-7", finish: "standard" as const, quantity: 1, alternativeQuantity: 0 },
    { cardId: "card-8", finish: "standard" as const, quantity: 1, alternativeQuantity: 0 },
    { cardId: "card-9", finish: "standard" as const, quantity: 1, alternativeQuantity: 0 },
  ];

  assert.deepEqual(verifyGuestLibrary(openings, ownership), {
    cards: { current: 5, legacy: 5 },
    duplicates: { current: 1, legacy: 0 },
    totalCards: 10,
  });
  assert.equal(
    verifyGuestLibrary(openings, ownership.map((row) => (
      row.cardId === "card-1" ? { ...row, quantity: 3 } : row
    ))),
    null,
  );
});

test("guest conversion consolidates different snapshot card IDs into one series finish", () => {
  const openings = [{
    mode: "current" as const,
    results: [
      { cardId: "snapshot-1", seriesKey: "set-1:character-1", finish: "standard" as const, isDuplicate: false },
      { cardId: "snapshot-2", seriesKey: "set-1:character-1", finish: "standard" as const, isDuplicate: true },
      { cardId: "card-2", seriesKey: "set-1:character-2", finish: "standard" as const, isDuplicate: false },
      { cardId: "card-3", seriesKey: "set-1:character-3", finish: "foil" as const, isDuplicate: false },
      { cardId: "card-4", seriesKey: "set-1:character-4", finish: "standard" as const, isDuplicate: false },
    ],
  }];
  const ownership = [
    { cardId: "snapshot-1", seriesKey: "set-1:character-1", finish: "standard" as const, quantity: 2, alternativeQuantity: 0 },
    { cardId: "card-2", seriesKey: "set-1:character-2", finish: "standard" as const, quantity: 1, alternativeQuantity: 0 },
    { cardId: "card-3", seriesKey: "set-1:character-3", finish: "foil" as const, quantity: 1, alternativeQuantity: 0 },
    { cardId: "card-4", seriesKey: "set-1:character-4", finish: "standard" as const, quantity: 1, alternativeQuantity: 0 },
  ];

  assert.deepEqual(verifyGuestLibrary(openings, ownership), {
    cards: { current: 5, legacy: 0 },
    duplicates: { current: 1, legacy: 0 },
    totalCards: 5,
  });
});

test("pack recharge follows shared Helsinki half-hour boundaries and respects storage caps", () => {
  const grants = getRechargeGrants(new Date("2026-01-01T07:00:00.000Z"), new Date("2026-01-01T10:05:00.000Z"));
  assert.deepEqual(grants, { current: 3, legacy: 6 });
  assert.equal(getNextPackRechargeAt("current", new Date("2026-07-24T10:30:00.000Z")).toISOString(), "2026-07-24T11:00:00.000Z");
  assert.equal(getNextPackRechargeAt("legacy", new Date("2026-07-24T10:30:00.000Z")).toISOString(), "2026-07-24T11:00:00.000Z");
  assert.equal(getNextPackRechargeAt("legacy", new Date("2026-07-24T10:20:00.000Z")).toISOString(), "2026-07-24T10:30:00.000Z");

  const recharged = applyPackRecharge(
    { current: CCG_PACK_STORAGE_CAPS.current - 1, legacy: CCG_PACK_STORAGE_CAPS.legacy - 1 },
    new Date("2026-01-01T07:00:00.000Z"),
    new Date("2026-01-01T10:05:00.000Z"),
  );
  assert.deepEqual(recharged.balances, CCG_PACK_STORAGE_CAPS);
  assert.equal(recharged.lastRechargeAt.toISOString(), "2026-01-01T10:00:00.000Z");

  const overCap = applyPackRecharge(
    { current: 75, legacy: 51 },
    new Date("2026-01-01T07:00:00.000Z"),
    new Date("2026-01-01T10:05:00.000Z"),
  );
  assert.deepEqual(overCap.balances, { current: 75, legacy: 51 });

  const blockedByBonusPacks = applyPackRecharge(
    { current: 20, legacy: 20 },
    new Date("2026-01-01T07:00:00.000Z"),
    new Date("2026-01-01T10:05:00.000Z"),
    { current: 30, legacy: 26 },
  );
  assert.deepEqual(blockedByBonusPacks.balances, { current: 20, legacy: 24 });
});

test("authenticated raid rollover moves all Current packs to Legacy and refills Current storage", () => {
  const rollover = applyCcgPackRollover(
    "user",
    { current: 10, legacy: 7 },
    { current: 4, legacy: 2 },
    new Date("2026-01-01T10:00:00.000Z"),
    new Date("2026-01-01T10:00:00.000Z"),
    CCG_PACK_STORAGE_CAPS.current,
  );

  assert.deepEqual(rollover.balances, { current: 50, legacy: 7 });
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
    CCG_PACK_STORAGE_CAPS.current,
  );

  assert.deepEqual(rollover.balances, { current: 50, legacy: 13 });
  assert.equal(rollover.regularCurrentMoved, 23);
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
    CCG_PACK_STORAGE_CAPS.current,
  );
  const creditsAfterFirst = { current: 0, legacy: 2 + 4 + first.regularCurrentMoved };
  const second = applyCcgPackRollover(
    "user",
    first.balances,
    creditsAfterFirst,
    first.lastRechargeAt,
    new Date("2026-01-01T10:00:00.000Z"),
    CCG_PACK_STORAGE_CAPS.current,
  );

  assert.equal(second.regularCurrentMoved, 50);
  assert.deepEqual(second.balances, { current: 50, legacy: 7 });
  assert.equal(second.balances.legacy + creditsAfterFirst.legacy + second.regularCurrentMoved, 73);
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

test("Heirloom stays outside regular pack odds and joins only the top Community rarity roll", () => {
  assert.deepEqual(CCG_REGULAR_TIER_GRADES, ["S", "A", "B", "C", "D", "E", "F"]);
  assert.deepEqual(CCG_TIER_GRADES, ["H", "S", "A", "B", "C", "D", "E", "F"]);
  assert.throws(() => selectPackCards([{ grade: "H", cardIds: ["heirloom"] }], () => 0), /no eligible cards/);

  const communityByGrade = new Map<CcgTierGrade, readonly string[]>([["H", ["heirloom"]]]);
  assert.equal(selectCommunityCardForGrade(9, "A", communityByGrade, () => { throw new Error("unexpected roll"); }), null);
  const acceptedRolls = [9, 0, 0];
  assert.equal(
    selectCommunityCardForGrade(9, "S", communityByGrade, () => acceptedRolls.shift()!),
    "heirloom",
  );
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

test("alternative art unlock applies to every owned finish without splitting quantities", () => {
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

test("alternative artwork accepts supported media filenames but rejects paths", () => {
  assert.equal(normalizeAlternativeArtFilename(" laku_clap.png "), "laku_clap.png");
  assert.equal(normalizeAlternativeArtFilename("animated.gif"), "animated.gif");
  assert.equal(normalizeAlternativeArtFilename("bogie.webm"), "bogie.webm");
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
