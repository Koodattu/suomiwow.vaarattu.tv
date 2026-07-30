import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import { simulateLegacyBalance } from "../src/services/ccg-pack-migration.service";

const ownerId = new mongoose.Types.ObjectId();
const base = {
  _id: new mongoose.Types.ObjectId(),
  ownerType: "user" as const,
  ownerId,
  currentRemaining: 20,
  legacyRemaining: 7,
  lastRechargeAt: new Date("2026-01-01T07:00:00.000Z"),
  lastRolloverSequence: 0,
  grantVersion: 3,
  hasPlayed: true,
  firstPlayedAt: new Date("2025-12-01T00:00:00.000Z"),
};

test("unified-pack migration materializes both legacy recharge schedules before summing", () => {
  const result = simulateLegacyBalance(
    base,
    { current: 4, legacy: 2 },
    [],
    new Date("2026-01-01T10:05:00.000Z"),
  );

  assert.equal(result.regularBefore, 27);
  assert.equal(result.elapsedRechargePacks, 9);
  assert.equal(result.remaining, 36);
});

test("unified-pack migration preserves balances above the new recharge cap", () => {
  const result = simulateLegacyBalance(
    { ...base, currentRemaining: 80, legacyRemaining: 55 },
    { current: 0, legacy: 0 },
    [],
    new Date("2026-01-01T10:05:00.000Z"),
  );

  assert.equal(result.elapsedRechargePacks, 0);
  assert.equal(result.remaining, 135);
});

test("unified-pack migration preserves an older balance when collection history proves activity", () => {
  const result = simulateLegacyBalance(
    {
      ...base,
      ownerType: "guest",
      currentRemaining: 3,
      legacyRemaining: 2,
      grantVersion: 2,
      hasPlayed: false,
    },
    { current: 0, legacy: 0 },
    [],
    base.lastRechargeAt,
    true,
  );

  assert.equal(result.hasPlayed, true);
  assert.equal(result.remaining, 35);
});

test("unified-pack migration preserves entitlement from an unapplied user rollover", () => {
  const cutoverAt = new Date("2026-01-01T10:00:00.000Z");
  const result = simulateLegacyBalance(
    { ...base, currentRemaining: 10, lastRechargeAt: cutoverAt },
    { current: 4, legacy: 2 },
    [{ sequence: 1, effectiveAt: cutoverAt, userCurrentPacks: 50, guestCurrentPacks: 5 }],
    cutoverAt,
  );

  assert.equal(result.rolloverPacks, 50);
  assert.equal(result.remaining, 67);
  assert.equal(result.remaining + 6, 73);
});

test("unified-pack migration accounts for carried packs across multiple unapplied rollovers", () => {
  const cutoverAt = new Date("2026-01-01T10:00:00.000Z");
  const rollover = { effectiveAt: cutoverAt, userCurrentPacks: 50, guestCurrentPacks: 5 };
  const result = simulateLegacyBalance(
    { ...base, currentRemaining: 10, lastRechargeAt: cutoverAt },
    { current: 4, legacy: 2 },
    [{ ...rollover, sequence: 1 }, { ...rollover, sequence: 2 }],
    cutoverAt,
  );

  assert.equal(result.rolloverPacks, 100);
  assert.equal(result.remaining, 117);
  assert.equal(result.remaining + 6, 123);
});

test("unified-pack migration preserves guest packs across an unapplied rollover", () => {
  const cutoverAt = new Date("2026-01-01T10:00:00.000Z");
  const result = simulateLegacyBalance(
    {
      ...base,
      ownerType: "guest",
      currentRemaining: 3,
      legacyRemaining: 4,
      lastRechargeAt: cutoverAt,
    },
    { current: 0, legacy: 0 },
    [{ sequence: 1, effectiveAt: cutoverAt, userCurrentPacks: 50, guestCurrentPacks: 5 }],
    cutoverAt,
  );

  assert.equal(result.remaining, 12);
});
