import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import {
  buildUncheckedWclIdentityAuditPipeline,
  CharacterWclIdentityAuditService,
  classifyCanonicalWclIdentityResult,
  getWclIdentityAuditRetryStatus,
} from "../src/services/character-wcl-identity-audit.service";
import wclService from "../src/services/warcraftlogs.service";

const resolvedWarlock = {
  id: 77628500,
  canonicalID: 77628500,
  name: "Zammue",
  classID: 10,
  hidden: false,
  server: { slug: "stormscale", region: { slug: "EU" } },
};

test("canonical WCL identity audit requires the stored WCL class to match", () => {
  assert.equal(classifyCanonicalWclIdentityResult({ classID: 10, region: "eu" }, resolvedWarlock), "resolved");
  assert.equal(
    classifyCanonicalWclIdentityResult(
      { classID: 5, region: "eu" },
      { ...resolvedWarlock, hidden: true },
    ),
    "class_mismatch",
  );
  assert.equal(classifyCanonicalWclIdentityResult({ classID: 10, region: "eu" }, { ...resolvedWarlock, hidden: true }), "hidden");
  assert.equal(classifyCanonicalWclIdentityResult({ classID: 10, region: "eu" }, null), "not_found");
  assert.equal(
    classifyCanonicalWclIdentityResult({ classID: 10, region: "us" }, resolvedWarlock),
    "invalid_response",
  );
});

test("canonical WCL identity audit queries by the stored canonical ID", () => {
  const service = new CharacterWclIdentityAuditService() as any;
  const query = service.buildWclQuery();

  assert.match(query, /character\(id: \$characterId\)/);
  assert.match(query, /canonicalID/);
  assert.match(query, /classID/);
  assert.match(query, /server\s*{/);
});

test("nightly candidate discovery includes only unaudited Armory-not-found characters", () => {
  const pipeline = buildUncheckedWclIdentityAuditPipeline(
    "characterwclidentityaudits",
    "characterachievementfetchqueues",
    "charactermediafetchqueues",
    1000,
  ) as any[];
  const auditLookup = pipeline.find((stage) => stage.$lookup?.as === "identityAudit")?.$lookup;
  const achievementLookup = pipeline.find((stage) => stage.$lookup?.as === "achievementQueue")?.$lookup;
  const mediaLookup = pipeline.find((stage) => stage.$lookup?.as === "mediaQueue")?.$lookup;
  const uncheckedMatch = pipeline.find((stage) => stage.$match?.["identityAudit.0"]);
  const armoryMissingMatch = pipeline.find((stage) => stage.$match?.$or);

  assert.deepEqual(auditLookup, {
    from: "characterwclidentityaudits",
    localField: "_id",
    foreignField: "characterId",
    as: "identityAudit",
  });
  assert.equal(achievementLookup.from, "characterachievementfetchqueues");
  assert.equal(mediaLookup.from, "charactermediafetchqueues");
  assert.deepEqual(uncheckedMatch, { $match: { "identityAudit.0": { $exists: false } } });
  assert.deepEqual(armoryMissingMatch, {
    $match: {
      $or: [
        {
          achievementQueue: {
            $elemMatch: { signalVersion: "achievement-signal-v1", status: "not_found" },
          },
        },
        { mediaQueue: { $elemMatch: { status: "not_found" } } },
      ],
    },
  });
  assert.deepEqual(pipeline.find((stage) => stage.$limit), { $limit: 1000 });
});

test("transient failures retry up to the configured attempt limit", () => {
  assert.equal(getWclIdentityAuditRetryStatus(1, 3), "pending");
  assert.equal(getWclIdentityAuditRetryStatus(2, 3), "pending");
  assert.equal(getWclIdentityAuditRetryStatus(3, 3), "failed");
});

test("a class mismatch is terminal and never applies the returned identity", async () => {
  const service = new CharacterWclIdentityAuditService() as any;
  const originalQuery = (wclService as any).query;
  let applied = false;
  service.waitForBackgroundCapacity = async () => undefined;
  service.applyResolvedIdentity = async () => {
    applied = true;
    return true;
  };

  try {
    (wclService as any).query = async () => ({
      characterData: { character: { ...resolvedWarlock, classID: 5 } },
    });
    const outcome = await service.processItem({
      _id: new mongoose.Types.ObjectId(),
      characterId: new mongoose.Types.ObjectId(),
      expectedWclCanonicalCharacterId: 77628500,
      expectedClassID: 10,
      sourceName: "Zammue",
      sourceRealm: "stormreaver",
      sourceRegion: "eu",
    });

    assert.equal(outcome.status, "skipped");
    assert.equal(outcome.outcome, "class_mismatch");
    assert.equal(applied, false);
  } finally {
    (wclService as any).query = originalQuery;
  }
});

test("a matching WCL class applies the current name and realm", async () => {
  const service = new CharacterWclIdentityAuditService() as any;
  const originalQuery = (wclService as any).query;
  let appliedIdentity: unknown = null;
  service.waitForBackgroundCapacity = async () => undefined;
  service.applyResolvedIdentity = async (_item: unknown, identity: unknown, hidden: boolean) => {
    appliedIdentity = { identity, hidden };
    return true;
  };

  try {
    (wclService as any).query = async () => ({ characterData: { character: resolvedWarlock } });
    const outcome = await service.processItem({
      _id: new mongoose.Types.ObjectId(),
      characterId: new mongoose.Types.ObjectId(),
      expectedWclCanonicalCharacterId: 77628500,
      expectedClassID: 10,
      sourceName: "Zammue",
      sourceRealm: "stormreaver",
      sourceRegion: "eu",
    });

    assert.equal(outcome.status, "completed");
    assert.equal(outcome.outcome, "resolved");
    assert.deepEqual(appliedIdentity, {
      identity: { name: "Zammue", realm: "stormscale", region: "eu" },
      hidden: false,
    });
  } finally {
    (wclService as any).query = originalQuery;
  }
});
