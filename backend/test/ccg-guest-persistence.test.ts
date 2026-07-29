/// <reference path="../src/types/express-session.d.ts" />

import assert from "node:assert/strict";
import test from "node:test";
import "express-session";
import mongoose from "mongoose";
import { CCG_GUEST_COOKIE, CCG_GUEST_COOKIE_MAX_AGE_MS } from "../src/config/ccg";
import CcgDailyAllowance from "../src/models/CcgDailyAllowance";
import CcgGuest from "../src/models/CcgGuest";
import CcgLedgerEntry from "../src/models/CcgLedgerEntry";
import CcgOwnership from "../src/models/CcgOwnership";
import CcgPackBalance from "../src/models/CcgPackBalance";
import CcgPackOpening from "../src/models/CcgPackOpening";
import CcgQualityProgress from "../src/models/CcgQualityProgress";
import CcgSeriesOwnership from "../src/models/CcgSeriesOwnership";
import { isGuestExpiryIndex } from "../src/services/ccg-guest-persistence-migration.service";
import ccgService from "../src/services/ccg.service";

test("guest collection schemas do not declare expiry indexes", () => {
  const models = [
    CcgGuest,
    CcgOwnership,
    CcgSeriesOwnership,
    CcgPackBalance,
    CcgDailyAllowance,
    CcgPackOpening,
    CcgLedgerEntry,
    CcgQualityProgress,
  ];

  for (const model of models) {
    const indexes = model.schema.indexes() as Array<[Record<string, unknown>, unknown]>;
    assert.equal(
      indexes.some(([key]) => Object.prototype.hasOwnProperty.call(key, "expiresAt")),
      false,
      `${model.modelName} must not expire guest records`,
    );
  }
});

test("guest persistence migration recognizes every legacy expiry index", () => {
  assert.equal(isGuestExpiryIndex({ name: "expiresAt_1", key: { expiresAt: 1 } }), true);
  assert.equal(isGuestExpiryIndex({ name: "dateKey_1_expiresAt_1", key: { dateKey: 1, expiresAt: 1 } }), true);
  assert.equal(isGuestExpiryIndex({ name: "dateKey_1", key: { dateKey: 1 } }), false);
});

test("guest owner resolution ignores the original date and renews the persistent cookie", async () => {
  const guestModel = CcgGuest as any;
  const originalFindOne = guestModel.findOne;
  const guestId = new mongoose.Types.ObjectId();
  let guestFilter: Record<string, unknown> | null = null;
  const captured: { cookie?: { name: string; value: string; options: Record<string, unknown> } } = {};

  try {
    guestModel.findOne = (filter: Record<string, unknown>) => {
      guestFilter = filter;
      return {
        lean: async () => ({
          _id: guestId,
          dateKey: "2026-07-28",
          lastSeenAt: new Date(),
          claimedAt: null,
        }),
      };
    };

    const owner = await ccgService.resolveOwner(
      { session: {}, cookies: { [CCG_GUEST_COOKIE]: "persistent-token" } } as any,
      {
        cookie(name: string, value: string, options: Record<string, unknown>) {
          captured.cookie = { name, value, options };
        },
      } as any,
    );

    assert.equal(String(owner.ownerId), String(guestId));
    assert.equal(owner.ownerType, "guest");
    assert.deepEqual(guestFilter && Object.keys(guestFilter).sort(), ["claimedAt", "tokenHash"]);
    assert.equal(captured.cookie?.name, CCG_GUEST_COOKIE);
    assert.equal(captured.cookie?.value, "persistent-token");
    assert.equal(captured.cookie?.options.maxAge, CCG_GUEST_COOKIE_MAX_AGE_MS);
  } finally {
    guestModel.findOne = originalFindOne;
  }
});
