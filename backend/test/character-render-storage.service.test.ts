import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import sharp from "sharp";
import CharacterRenderAsset from "../src/models/CharacterRenderAsset";
import characterRenderStorageService, { CharacterRenderIngestError, measureCharacterRenderFits, processCharacterRender } from "../src/services/character-render-storage.service";

function createRgba(width: number, height: number): Buffer {
  return Buffer.alloc(width * height * 4);
}

test("crops transparent character renders with safety padding and precomputes fit metadata", async () => {
  const width = 100;
  const height = 80;
  const pixels = createRgba(width, height);
  for (let y = 10; y < 50; y += 1) {
    for (let x = 30; x < 50; x += 1) {
      const offset = (y * width + x) * 4;
      pixels[offset] = 40;
      pixels[offset + 1] = 120;
      pixels[offset + 2] = 220;
      pixels[offset + 3] = 255;
    }
  }
  const png = await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer();

  const result = await processCharacterRender(png);
  const outputMetadata = await sharp(result.output).metadata();

  assert.equal(result.sourceWidth, 100);
  assert.equal(result.sourceHeight, 80);
  assert.equal(result.cropLeft, 28);
  assert.equal(result.cropTop, 8);
  assert.equal(result.width, 24);
  assert.equal(result.height, 44);
  assert.equal(outputMetadata.format, "webp");
  assert.equal(outputMetadata.width, 24);
  assert.equal(outputMetadata.height, 44);
  assert.ok(outputMetadata.hasAlpha);
  assert.equal(result.silhouetteFit.centerX, 0.5);
  assert.equal(result.silhouetteFit.top, 2 / 44);
  assert.equal(result.silhouetteFit.ground, 42 / 44);
  assert.deepEqual(result.stanceFit, result.silhouetteFit);
});

test("rejects renders with no visible alpha", async () => {
  const png = await sharp(createRgba(20, 20), { raw: { width: 20, height: 20, channels: 4 } }).png().toBuffer();
  await assert.rejects(() => processCharacterRender(png), /contained no visible pixels/);
});

test("ignores a tall soft effect when fitting the top of a solid stance", async () => {
  const width = 100;
  const height = 100;
  const pixels = createRgba(width, height);
  for (let y = 10; y < 25; y += 1) {
    for (let x = 40; x < 60; x += 1) {
      pixels[(y * width + x) * 4 + 3] = 32;
    }
  }
  for (let y = 30; y < 80; y += 1) {
    for (let x = 30; x < 70; x += 1) {
      pixels[(y * width + x) * 4 + 3] = 255;
    }
  }
  const png = await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer();

  const result = await processCharacterRender(png);

  assert.equal(result.cropTop, 8);
  assert.equal(result.height, 74);
  assert.equal(result.silhouetteFit.top, 2 / 74);
  assert.equal(result.stanceFit.top, 22 / 74);
  assert.equal(result.stanceFit.ground, 72 / 74);
  assert.deepEqual((await measureCharacterRenderFits(result.output)).stanceFit, result.stanceFit);
});

test("preserves the silhouette top for ordinary antialiasing and mostly translucent renders", async () => {
  const width = 80;
  const height = 80;
  const antialiasedPixels = createRgba(width, height);
  for (let x = 30; x < 50; x += 1) antialiasedPixels[(9 * width + x) * 4 + 3] = 32;
  for (let y = 10; y < 50; y += 1) {
    for (let x = 25; x < 55; x += 1) antialiasedPixels[(y * width + x) * 4 + 3] = 255;
  }
  const antialiasedPng = await sharp(antialiasedPixels, { raw: { width, height, channels: 4 } }).png().toBuffer();
  const antialiasedResult = await processCharacterRender(antialiasedPng);
  assert.equal(antialiasedResult.stanceFit.top, antialiasedResult.silhouetteFit.top);

  const translucentPixels = createRgba(width, height);
  for (let y = 10; y < 60; y += 1) {
    for (let x = 25; x < 55; x += 1) translucentPixels[(y * width + x) * 4 + 3] = 96;
  }
  for (let y = 45; y < 55; y += 1) {
    for (let x = 35; x < 45; x += 1) translucentPixels[(y * width + x) * 4 + 3] = 255;
  }
  const translucentPng = await sharp(translucentPixels, { raw: { width, height, channels: 4 } }).png().toBuffer();
  const translucentResult = await processCharacterRender(translucentPng);
  assert.equal(translucentResult.stanceFit.top, translucentResult.silhouetteFit.top);
});

test("detects the ground beneath a wide stance", async () => {
  const width = 100;
  const height = 100;
  const pixels = createRgba(width, height);
  for (let y = 10; y < 55; y += 1) {
    for (let x = 40; x < 60; x += 1) pixels[(y * width + x) * 4 + 3] = 255;
  }
  for (let y = 45; y < 80; y += 1) {
    for (let x = 20; x < 32; x += 1) pixels[(y * width + x) * 4 + 3] = 255;
    for (let x = 68; x < 80; x += 1) pixels[(y * width + x) * 4 + 3] = 255;
  }
  const png = await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer();

  const result = await processCharacterRender(png);

  assert.equal(result.stanceFit.ground, result.silhouetteFit.ground);
  assert.deepEqual((await measureCharacterRenderFits(result.output)).stanceFit, result.stanceFit);
});

test("does not use a low side-held object as the stance ground", async () => {
  const width = 100;
  const height = 100;
  const pixels = createRgba(width, height);
  for (let y = 10; y < 70; y += 1) {
    for (let x = 30; x < 70; x += 1) pixels[(y * width + x) * 4 + 3] = 255;
  }
  for (let y = 20; y < 90; y += 1) {
    for (let x = 75; x < 80; x += 1) pixels[(y * width + x) * 4 + 3] = 255;
  }
  const png = await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer();

  const result = await processCharacterRender(png);

  assert.equal(result.height, 84);
  assert.equal(result.stanceFit.ground, 62 / 84);
  assert.equal(result.silhouetteFit.ground, 82 / 84);
});

test("saved-source ingestion falls back only for unusable render data", async () => {
  const storage = characterRenderStorageService as any;
  const originalIngest = storage.ingest;
  const characterId = new mongoose.Types.ObjectId();

  try {
    storage.ingest = async () => {
      throw new CharacterRenderIngestError("render_download_404", "missing");
    };
    assert.equal(
      await storage.ingestExistingSource(characterId, "https://render.worldofwarcraft.com/eu/missing.png"),
      null,
    );

    storage.ingest = async () => { throw new Error("storage unavailable"); };
    await assert.rejects(
      () => storage.ingestExistingSource(characterId, "https://render.worldofwarcraft.com/eu/render.png"),
      /storage unavailable/,
    );
  } finally {
    storage.ingest = originalIngest;
  }
});

test("stored character renders have no expiry and serving does not filter by age", async () => {
  const assetModel = CharacterRenderAsset as any;
  const originalFindById = assetModel.findById;
  const assetId = new mongoose.Types.ObjectId();
  let capturedFilter: Record<string, unknown> | undefined;

  try {
    assetModel.findById = async (id: string) => {
      capturedFilter = { _id: id };
      return null;
    };

    await characterRenderStorageService.getForServing(String(assetId));

    assert.equal(CharacterRenderAsset.schema.path("expiresAt"), undefined);
    assert.deepEqual(capturedFilter, {
      _id: String(assetId),
    });
    assert.equal(Object.prototype.hasOwnProperty.call(capturedFilter, "expiresAt"), false);
  } finally {
    assetModel.findById = originalFindById;
  }
});
