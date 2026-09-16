import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { normalizeSupporterAudio, normalizeSupporterImage } from "../src/services/ccg-supporter-media.service";
import { resolveAlternativeArtKey, serializeAlternativeArt, serializeQuip } from "../src/utils/ccg-alternative-art";

function wav(seconds: number) {
  const rate = 16000, samples = Math.round(seconds * rate);
  const result = Buffer.alloc(44 + samples * 2);
  result.write("RIFF", 0); result.writeUInt32LE(result.length - 8, 4); result.write("WAVEfmt ", 8);
  result.writeUInt32LE(16, 16); result.writeUInt16LE(1, 20); result.writeUInt16LE(1, 22);
  result.writeUInt32LE(rate, 24); result.writeUInt32LE(rate * 2, 28); result.writeUInt16LE(2, 32); result.writeUInt16LE(16, 34);
  result.write("data", 36); result.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) result.writeInt16LE(Math.round(Math.sin(i * 440 * 2 * Math.PI / rate) * 4000), 44 + i * 2);
  return result;
}

test("transparent PNG is resized to WebP while opaque and invisible images are rejected", async () => {
  const image = await sharp({ create: { width: 3000, height: 2000, channels: 4, background: { r: 100, g: 20, b: 30, alpha: 0.5 } } }).png().toBuffer();
  const result = await normalizeSupporterImage(image);
  assert.equal(result.width, 2048); assert.ok(result.height < 2048);
  assert.equal((await sharp(result.data).metadata()).format, "webp");
  for (const alpha of [0, 1]) {
    const invalid = await sharp({ create: { width: 10, height: 10, channels: 4, background: { r: 1, g: 2, b: 3, alpha } } }).png().toBuffer();
    await assert.rejects(normalizeSupporterImage(invalid), { code: "media_image_transparency" });
  }
  await assert.rejects(normalizeSupporterImage(Buffer.from("not an image")), { code: "media_image_format" });
  await assert.rejects(normalizeSupporterImage(Buffer.alloc(5 * 1024 * 1024 + 1)), { code: "media_image_size" });
});

test("audio is decoded and converted to MP3; ten seconds and malformed files are rejected", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "supporter-audio-test-"));
  try {
    for (const seconds of [1, 9.9, 10, 12]) {
      const directory = await mkdtemp(path.join(root, "case-"));
      if (seconds >= 10) await assert.rejects(normalizeSupporterAudio(wav(seconds), directory), { code: "media_audio_duration" });
      else {
        const result = await normalizeSupporterAudio(wav(seconds), directory);
        assert.equal(result.contentType, "audio/mpeg");
        assert.ok(Math.abs(result.duration - seconds) < 0.01);
        assert.ok(result.data.length < seconds * 12500 + 2000, "96 kbps encoding remains bounded");
      }
    }
    await assert.rejects(normalizeSupporterAudio(Buffer.from("not audio"), await mkdtemp(path.join(root, "invalid-"))), { code: "media_audio_format" });
  } finally {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    await rm(root, { recursive: true, force: true });
  }
});

test("Supporter customization has a card-specific key and serves approved asset paths", () => {
  const card = { characterId: "character", collectorKey: "wow:eu:realm:name" };
  assert.equal(resolveAlternativeArtKey(card), card.collectorKey);
  assert.equal(resolveAlternativeArtKey({ ...card, supporterCharacterId: "supporter" }), "supporter:supporter");
  const definition = { collectorKey: "supporter:supporter", characterArtFilename: "image.webp", characterArtEnabled: true,
    characterArtPath: "/api/ccg/media/supporter/image", quipAudioFilename: "audio.mp3", quipAudioPath: "/api/ccg/media/supporter/audio" };
  assert.equal(serializeAlternativeArt(definition)?.characterArtPath, definition.characterArtPath);
  assert.equal(serializeQuip(definition)?.audioPath, definition.quipAudioPath);
});
