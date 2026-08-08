import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import CcgLedgerEntry from "../src/models/CcgLedgerEntry";
import CcgPackCredit from "../src/models/CcgPackCredit";
import Pickem, { DEFAULT_PICKEM_CCG_REWARD_PACKS } from "../src/models/Pickem";
import User from "../src/models/User";
import pickemCcgRewardService, { getPickemCcgRewardSourceKey } from "../src/services/pickem-ccg-reward.service";
import pickemService from "../src/services/pickem.service";

function queryResult<T>(read: () => T) {
  return {
    session: async () => read(),
    then: (resolve: (value: T) => unknown, reject: (error: unknown) => unknown) => Promise.resolve(read()).then(resolve, reject),
  };
}

function leanQueryResult<T>(read: () => T) {
  const query = {
    select: () => query,
    lean: async () => read(),
  };
  return query;
}

test("backfills current and future Pickems with the default reward while disabling expired ones", async () => {
  const originalUpdateMany = Pickem.updateMany;
  const calls: unknown[][] = [];
  Pickem.updateMany = (async (...args: unknown[]) => {
    calls.push(args);
    return { modifiedCount: calls.length === 1 ? 2 : 3 };
  }) as typeof Pickem.updateMany;

  const now = new Date("2026-08-06T12:00:00.000Z");
  try {
    assert.deepEqual(await pickemService.ensureCcgRewardDefaults(now), { rewarded: 2, disabled: 3 });
    assert.deepEqual(calls[0], [
      {
        $or: [{ ccgRewardPacks: { $exists: false } }, { ccgRewardPacks: null }],
        votingEnd: { $gte: now },
      },
      { $set: { ccgRewardPacks: DEFAULT_PICKEM_CCG_REWARD_PACKS } },
    ]);
    assert.deepEqual(calls[1], [
      {
        $or: [{ ccgRewardPacks: { $exists: false } }, { ccgRewardPacks: null }],
        votingEnd: { $lt: now },
      },
      { $set: { ccgRewardPacks: 0 } },
    ]);
  } finally {
    Pickem.updateMany = originalUpdateMany;
  }
});

test("uses durable unique keys for one Pickem reward per user", () => {
  const creditIndex = CcgPackCredit.schema.indexes().find(([keys]) => keys.ownerId === 1 && keys.sourceKey === 1);
  const ledgerIndex = CcgLedgerEntry.schema.indexes().find(([keys]) => keys.ownerType === 1 && keys.ownerId === 1 && keys.idempotencyKey === 1);

  assert.equal(creditIndex?.[1]?.unique, true);
  assert.equal(ledgerIndex?.[1]?.unique, true);
  assert.ok((CcgPackCredit.schema.path("source") as mongoose.SchemaType & { enumValues?: string[] }).enumValues?.includes("pickem_reward"));
  assert.ok((CcgLedgerEntry.schema.path("action") as mongoose.SchemaType & { enumValues?: string[] }).enumValues?.includes("pickem_reward"));
  assert.equal((User.schema.path("pickems") as any).schema.path("ccgRewardClaimed"), undefined);
});

test("claims generic packs once for submitted regular and RWF Pickems even after voting ends", async () => {
  const originalStartSession = mongoose.startSession;
  const originalPickemFindOne = Pickem.findOne;
  const originalUserExists = User.exists;
  const originalCreditExists = CcgPackCredit.exists;
  const originalCreditCreate = CcgPackCredit.create;
  const originalLedgerCreate = CcgLedgerEntry.create;

  const pickems = new Map([
    ["regular-ended", { _id: new mongoose.Types.ObjectId(), pickemId: "regular-ended", type: "regular", ccgRewardPacks: 25, votingEnd: new Date("2026-01-01T00:00:00.000Z") }],
    ["rwf-ended", { _id: new mongoose.Types.ObjectId(), pickemId: "rwf-ended", type: "rwf", ccgRewardPacks: 25, votingEnd: new Date("2026-01-01T00:00:00.000Z") }],
  ]);
  const claimedSourceKeys = new Set<string>();
  const creditCreates: any[] = [];
  const ledgerCreates: any[] = [];

  mongoose.startSession = (async () => ({
    withTransaction: async (operation: () => Promise<void>) => operation(),
    endSession: async () => undefined,
  })) as typeof mongoose.startSession;
  Pickem.findOne = ((filter: { pickemId: string }) => queryResult(() => pickems.get(filter.pickemId) ?? null)) as unknown as typeof Pickem.findOne;
  User.exists = (() => ({ session: async () => ({ _id: new mongoose.Types.ObjectId() }) })) as unknown as typeof User.exists;
  CcgPackCredit.exists = ((filter: { sourceKey: string }) => queryResult(() => claimedSourceKeys.has(filter.sourceKey) ? { _id: new mongoose.Types.ObjectId() } : null)) as unknown as typeof CcgPackCredit.exists;
  CcgPackCredit.create = (async (rows: any[]) => {
    creditCreates.push(rows[0]);
    claimedSourceKeys.add(rows[0].sourceKey);
    return rows;
  }) as typeof CcgPackCredit.create;
  CcgLedgerEntry.create = (async (rows: any[]) => {
    ledgerCreates.push(rows[0]);
    return rows;
  }) as typeof CcgLedgerEntry.create;

  const userId = new mongoose.Types.ObjectId();
  try {
    for (const pickemId of pickems.keys()) {
      assert.deepEqual(await pickemCcgRewardService.claim(userId, pickemId), {
        packs: 25,
        claimed: true,
        alreadyClaimed: false,
      });
      assert.deepEqual(await pickemCcgRewardService.claim(userId, pickemId), {
        packs: 25,
        claimed: true,
        alreadyClaimed: true,
      });
    }

    assert.equal(creditCreates.length, 2);
    assert.equal(ledgerCreates.length, 2);
    assert.ok(creditCreates.every((credit) => credit.source === "pickem_reward" && credit.remaining === 25 && credit.mode === undefined));
    assert.deepEqual(ledgerCreates.map((entry) => entry.metadata.pickemType).sort(), ["regular", "rwf"]);
  } finally {
    mongoose.startSession = originalStartSession;
    Pickem.findOne = originalPickemFindOne;
    User.exists = originalUserExists;
    CcgPackCredit.exists = originalCreditExists;
    CcgPackCredit.create = originalCreditCreate;
    CcgLedgerEntry.create = originalLedgerCreate;
  }
});

test("claimed status does not depend on unspent pack balance", async () => {
  const originalExists = CcgPackCredit.exists;
  CcgPackCredit.exists = (() => Promise.resolve({ _id: new mongoose.Types.ObjectId(), remaining: 0 })) as unknown as typeof CcgPackCredit.exists;

  try {
    const status = await pickemCcgRewardService.getStatus(
      { _id: new mongoose.Types.ObjectId(), ccgRewardPacks: 25 } as any,
      new mongoose.Types.ObjectId(),
      true,
    );
    assert.deepEqual(status, { packs: 25, eligible: true, claimed: true });
  } finally {
    CcgPackCredit.exists = originalExists;
  }
});

test("summarizes claimable and enterable Pickem pack opportunities", async () => {
  const originalUserFindById = User.findById;
  const originalPickemFind = Pickem.find;
  const originalCreditFind = CcgPackCredit.find;
  const now = new Date("2026-08-08T12:00:00.000Z");
  const submittedUnclaimedId = new mongoose.Types.ObjectId();
  const submittedClaimedId = new mongoose.Types.ObjectId();
  const openUnsubmittedId = new mongoose.Types.ObjectId();
  let pickems: any[] = [
    {
      _id: submittedUnclaimedId,
      pickemId: "submitted-unclaimed",
      ccgRewardPacks: 25,
      votingStart: new Date("2026-01-01T00:00:00.000Z"),
      votingEnd: new Date("2026-02-01T00:00:00.000Z"),
    },
    {
      _id: submittedClaimedId,
      pickemId: "submitted-claimed",
      ccgRewardPacks: 10,
      votingStart: new Date("2026-08-01T00:00:00.000Z"),
      votingEnd: new Date("2026-09-01T00:00:00.000Z"),
    },
    {
      _id: openUnsubmittedId,
      pickemId: "open-unsubmitted",
      ccgRewardPacks: 5,
      votingStart: new Date("2026-08-01T00:00:00.000Z"),
      votingEnd: new Date("2026-09-01T00:00:00.000Z"),
    },
  ];
  let claimedSourceKeys = [getPickemCcgRewardSourceKey(submittedClaimedId)];
  let submittedPickemIds = ["submitted-unclaimed", "submitted-claimed"];

  User.findById = (() => leanQueryResult(() => ({ pickems: submittedPickemIds.map((pickemId) => ({ pickemId })) }))) as unknown as typeof User.findById;
  Pickem.find = (() => leanQueryResult(() => pickems)) as unknown as typeof Pickem.find;
  CcgPackCredit.find = (() => leanQueryResult(() => claimedSourceKeys.map((sourceKey) => ({ sourceKey })))) as unknown as typeof CcgPackCredit.find;

  try {
    assert.deepEqual(
      await pickemCcgRewardService.getOpportunitySummary(
        new mongoose.Types.ObjectId(),
        now,
      ),
      { hasOpportunity: true, claimablePacks: 25 },
    );

    pickems = [pickems[2]];
    claimedSourceKeys = [];
    submittedPickemIds = [];
    assert.deepEqual(
      await pickemCcgRewardService.getOpportunitySummary(new mongoose.Types.ObjectId(), now),
      { hasOpportunity: true, claimablePacks: 0 },
    );

    pickems = [{ ...pickems[0], votingEnd: new Date("2026-08-07T00:00:00.000Z") }];
    assert.deepEqual(
      await pickemCcgRewardService.getOpportunitySummary(new mongoose.Types.ObjectId(), now),
      { hasOpportunity: false, claimablePacks: 0 },
    );
  } finally {
    User.findById = originalUserFindById;
    Pickem.find = originalPickemFind;
    CcgPackCredit.find = originalCreditFind;
  }
});
