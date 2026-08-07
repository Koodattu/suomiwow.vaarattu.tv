import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import CcgCard from "../src/models/CcgCard";
import CharacterRenderAsset from "../src/models/CharacterRenderAsset";
import ccgCardAvailabilityService, { resolveCcgCardNotFoundStatus } from "../src/services/ccg-card-availability.service";

test("new cards enter the live roster by default", () => {
  assert.equal(new CcgCard().availabilityStatus, "active");
});

test("a first Blizzard 404 archives a card without a stored render", () => {
  assert.equal(resolveCcgCardNotFoundStatus(false), "archived");
});

test("a locally stored render protects a card from Blizzard 404 archival", () => {
  assert.equal(resolveCcgCardNotFoundStatus(true), "active");
});

test("404 handling restores a stale non-active card when its render is stored locally", async () => {
  const characterId = new mongoose.Types.ObjectId();
  const service = ccgCardAvailabilityService as any;
  const renderAssetModel = CharacterRenderAsset as any;
  const originalLoadRows = service.loadRows;
  const originalNoteAvailable = service.noteAvailable;
  const originalExists = renderAssetModel.exists;

  try {
    service.loadRows = async () => [{
      setId: new mongoose.Types.ObjectId(),
      availabilityStatus: "archived",
    }];
    renderAssetModel.exists = async () => ({ _id: new mongoose.Types.ObjectId() });
    service.noteAvailable = async (restoredCharacterId: mongoose.Types.ObjectId) => ({
      characterId: restoredCharacterId,
      previousStatus: "archived",
      status: "active",
      cardSnapshots: 1,
      setsRebuilt: 1,
    });

    const transition = await service.noteNotFound(characterId);
    assert.equal(transition.characterId, characterId);
    assert.equal(transition.status, "active");
  } finally {
    service.loadRows = originalLoadRows;
    service.noteAvailable = originalNoteAvailable;
    renderAssetModel.exists = originalExists;
  }
});
