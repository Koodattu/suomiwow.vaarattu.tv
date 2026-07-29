import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import Character from "../src/models/Character";
import {
  buildObservedIdentityGuard,
  updateCharacterIdentityFromObservation,
} from "../src/services/character-observed-identity.service";

test("guards observed identity updates with the newest persisted observation", () => {
  const observedAt = new Date("2026-07-29T12:00:00.000Z");

  assert.deepEqual(buildObservedIdentityGuard(observedAt), {
    $expr: {
      $lte: [
        {
          $ifNull: [
            "$identityObservedAt",
            { $ifNull: ["$lastReportSeenAt", new Date(0)] },
          ],
        },
        observedAt,
      ],
    },
  });
});

test("persists the identity and its observation timestamp in one guarded update", async () => {
  const characterModel = Character as any;
  const originalUpdateOne = characterModel.updateOne;
  const characterId = new mongoose.Types.ObjectId();
  const observedAt = new Date("2026-07-29T12:00:00.000Z");
  let capturedFilter: Record<string, any> | undefined;
  let capturedUpdate: Record<string, any> | undefined;

  try {
    characterModel.updateOne = async (filter: Record<string, any>, update: Record<string, any>) => {
      capturedFilter = filter;
      capturedUpdate = update;
      return { modifiedCount: 1 };
    };

    const modified = await updateCharacterIdentityFromObservation(
      characterId,
      { name: "Maisié", realm: "Stormreaver", region: "EU" },
      observedAt,
    );

    assert.equal(modified, true);
    assert.equal(String(capturedFilter?._id), String(characterId));
    assert.ok(capturedFilter?.$expr);
    assert.deepEqual(capturedUpdate?.$set, {
      name: "Maisié",
      realm: "Stormreaver",
      region: "EU",
      identityObservedAt: observedAt,
    });
  } finally {
    characterModel.updateOne = originalUpdateOne;
  }
});
