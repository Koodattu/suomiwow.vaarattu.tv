import assert from "node:assert/strict";
import test from "node:test";
import { CURRENT_RAID_IDS, PRIMARY_RAID_ID, TRACKED_RAIDS } from "../src/config/guilds";
import Pickem from "../src/models/Pickem";
import pickemService from "../src/services/pickem.service";
import {
  getRegularPickemRaidIdsValidationError,
  isPickemPlaceholderRaidIds,
  isPickemReferenceRaidId,
  PICKEM_PLACEHOLDER_RAID_ID,
  PICKEM_REFERENCE_RANKINGS_LIMIT,
} from "../src/utils/pickemRaid";

test("accepts the Pickem placeholder only as the sole regular raid ID", () => {
  assert.equal(isPickemPlaceholderRaidIds([PICKEM_PLACEHOLDER_RAID_ID]), true);
  assert.equal(getRegularPickemRaidIdsValidationError([PICKEM_PLACEHOLDER_RAID_ID]), null);
  assert.equal(getRegularPickemRaidIdsValidationError([46]), null);
  assert.equal(getRegularPickemRaidIdsValidationError([PICKEM_PLACEHOLDER_RAID_ID, 46]), "The upcoming raid placeholder must be selected on its own");
  assert.equal(getRegularPickemRaidIdsValidationError([]), "raidIds must be a non-empty array for regular pickems");
  assert.equal(getRegularPickemRaidIdsValidationError([0]), "raidIds must contain positive raid IDs or the upcoming raid placeholder");
});

test("keeps the Pickem placeholder out of provider-backed raid tracking", () => {
  assert.equal(TRACKED_RAIDS.includes(PICKEM_PLACEHOLDER_RAID_ID), false);
  assert.equal(CURRENT_RAID_IDS.includes(PICKEM_PLACEHOLDER_RAID_ID), false);
});

test("allows reference rankings for past tracked raids and the primary current raid", () => {
  const pastRaidId = TRACKED_RAIDS.find((raidId) => !CURRENT_RAID_IDS.includes(raidId));
  assert.notEqual(pastRaidId, undefined);
  assert.equal(isPickemReferenceRaidId(pastRaidId!), true);
  assert.equal(isPickemReferenceRaidId(PRIMARY_RAID_ID), true);
  assert.equal(CURRENT_RAID_IDS.filter((raidId) => raidId !== PRIMARY_RAID_ID).every((raidId) => !isPickemReferenceRaidId(raidId)), true);
  assert.equal(isPickemReferenceRaidId(PICKEM_PLACEHOLDER_RAID_ID), false);
  assert.equal(PICKEM_REFERENCE_RANKINGS_LIMIT, 15);
});

test("does not finalize a regular Pickem while it still uses the placeholder", async () => {
  const originalFindOne = Pickem.findOne;
  Pickem.findOne = (async () => ({
    type: "regular",
    raidIds: [PICKEM_PLACEHOLDER_RAID_ID],
    finalized: false,
  })) as unknown as typeof Pickem.findOne;

  try {
    const result = await pickemService.finalizeRegularPickem("upcoming-raid");
    assert.deepEqual(result, {
      success: false,
      error: "Replace the upcoming raid placeholder with the real raid before finalizing",
    });
  } finally {
    Pickem.findOne = originalFindOne;
  }
});
