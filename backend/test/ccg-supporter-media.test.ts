import assert from "node:assert/strict";
import test, { TestContext } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import mongoose from "mongoose";
import media, { normalizeSupporterAudio, normalizeSupporterImage, normalizeSupporterVideo, supporterMediaUrl } from "../src/services/ccg-supporter-media.service";
import * as storage from "../src/services/character-render-storage.service";
import Media from "../src/models/CcgSupporterMedia";
import artReview, { SupporterArtReview } from "../src/services/ccg-supporter-art-review.service";
import { resolveAlternativeArtKey, serializeAlternativeArt, serializeQuip } from "../src/utils/ccg-alternative-art";

test("twenty simultaneous media submissions queue with only two active conversions", async (t) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let active = 0;
  let peak = 0;
  t.mock.method(media as any, "prepareFile", async () => {
    active++;
    peak = Math.max(peak, active);
    try { await gate; return { storageKey: "fixture" }; }
    finally { active--; }
  });
  const submissions = Promise.all(Array.from({ length: 20 }, (_, index) =>
    media.prepare(new mongoose.Types.ObjectId(), index % 2 ? "audio" : "image", Buffer.from("fixture"))));
  try {
    await assert.rejects(media.prepare(new mongoose.Types.ObjectId(), "image", Buffer.from("fixture")), { code: "media_busy" });
    assert.equal(active, 2);
  } finally { release(); }
  assert.equal((await submissions).length, 20);
  assert.equal(peak, 2);
  await media.prepare(new mongoose.Types.ObjectId(), "image", Buffer.from("fixture"));
});

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

async function assertFirstFrameReview(t: TestContext, source: string, red: number, blue: number, alpha: number) {
  const id = String(new mongoose.Types.ObjectId());
  const resolve = t.mock.method(storage, "resolveCharacterRenderStoragePath", () => source);
  const find = t.mock.method(Media, "findOne", () => ({ lean: async () => ({ storageKey: "animation.webm", contentType: "video/webm" }) }) as any);
  const approved = t.mock.method(media, "review", async () => ({ ok: true }));
  const updated = t.mock.method(Media, "updateOne", (() => Promise.resolve({})) as any);
  let result: SupporterArtReview = { decision: "safe", safetyConfidence: 99, reason: "Harmless image.", model: "test",
    policyVersion: "test", responseId: null, autoApproved: true, reviewedAt: new Date() };
  const review = t.mock.method(artReview, "review", async (_image: Buffer) => result);
  try {
    await media.autoReview(id);
    assert.equal(review.mock.callCount(), 1, "Animation must reach AI review");
    const image = review.mock.calls[0].arguments[0];
    const metadata = await sharp(image).metadata();
    assert.equal(metadata.format, "webp");
    assert.equal(metadata.pages ?? 1, 1, "AI receives a single still frame");
    assert.equal(metadata.width, 64); assert.equal(metadata.height, 48);
    const pixels = await sharp(image).ensureAlpha().raw().toBuffer();
    assert.ok(Math.abs(pixels[0] - red) < 15 && Math.abs(pixels[2] - blue) < 15, "AI sees the first frame's colors, not the later frame");
    assert.ok(Math.abs(pixels[3] - alpha) < 5, "First-frame transparency is retained");
    assert.deepEqual(approved.mock.calls[0].arguments, [id, null, "approve", undefined, result]);
    assert.equal(updated.mock.callCount(), 0);

    result = { ...result, safetyConfidence: 74.9, autoApproved: false };
    await media.autoReview(id);
    assert.equal(approved.mock.callCount(), 1, "Below-threshold animation remains pending");
    assert.deepEqual(updated.mock.calls[0].arguments, [{ _id: id, status: "pending", aiReview: null }, { $set: { aiReview: result } }]);
  } finally {
    for (const mock of [resolve, find, approved, updated, review]) mock.mock.restore();
  }
}

test("PNG and WebP accept opaque, translucent and invisible images while preserving alpha", async () => {
  const image = await sharp({ create: { width: 3000, height: 2000, channels: 4, background: { r: 100, g: 20, b: 30, alpha: 0.5 } } }).png().toBuffer();
  const result = await normalizeSupporterImage(image);
  assert.equal(result.width, 2048); assert.ok(result.height < 2048);
  assert.equal((await sharp(result.data).metadata()).format, "webp");
  for (const alpha of [0, 0.5, 1]) {
    for (const format of ["png", "webp"] as const) {
      const input = await sharp({ create: { width: 10, height: 10, channels: 4, background: { r: 1, g: 2, b: 3, alpha } } }).toFormat(format).toBuffer();
      const accepted = await normalizeSupporterImage(input);
      const pixels = await sharp(accepted.data).ensureAlpha().raw().toBuffer();
      assert.ok(pixels.filter((_value, index) => index % 4 === 3).every((value) => Math.abs(value - alpha * 255) <= 1));
    }
  }
  const rgb = await sharp({ create: { width: 10, height: 10, channels: 3, background: { r: 10, g: 20, b: 30 } } }).png().toBuffer();
  assert.equal((await normalizeSupporterImage(rgb)).contentType, "image/webp");
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

test("recoverable MP3 damage is re-encoded into clean audio", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "supporter-audio-recovery-"));
  const execute = promisify(execFile);
  try {
    const source = path.join(root, "source.wav");
    const encoded = path.join(root, "source.mp3");
    await writeFile(source, wav(1));
    await execute(process.env.FFMPEG_PATH || "ffmpeg", ["-v", "error", "-i", source, "-c:a", "libmp3lame", encoded], { windowsHide: true });
    const damaged = Buffer.concat([await readFile(encoded), Buffer.alloc(128, 0xff)]);
    const fixture = path.join(root, "damaged.mp3");
    await writeFile(fixture, damaged);
    await assert.rejects(execute(process.env.FFMPEG_PATH || "ffmpeg", ["-v", "error", "-xerror", "-i", fixture, "-f", "null", "-"], { windowsHide: true }),
      (error: unknown) => /Invalid data|Header missing/i.test(String((error as { stderr?: string }).stderr)), "The fixture must reproduce strict decoder rejection");
    const result = await normalizeSupporterAudio(damaged, await mkdtemp(path.join(root, "normalize-")));
    assert.equal(result.contentType, "audio/mpeg");
    assert.ok(Math.abs(result.duration - 1) < 0.01);
    const output = path.join(root, "clean.mp3");
    await writeFile(output, result.data);
    const verified = await execute(process.env.FFMPEG_PATH || "ffmpeg", ["-v", "error", "-xerror", "-i", output, "-f", "null", "-"], { windowsHide: true });
    assert.equal(verified.stderr, "", "The normalized MP3 must decode without errors");
    await assert.rejects(normalizeSupporterAudio(Buffer.alloc(8 * 1024 * 1024 + 1), root), { code: "media_audio_size" });
  } finally {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    await rm(root, { recursive: true, force: true });
  }
});

test("WebM artwork retains animation and transparency, strips audio, and reviews only the first frame", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "supporter-video-test-"));
  const execute = promisify(execFile);
  try {
    for (const codec of ["libvpx", "libvpx-vp9"]) {
      for (const alpha of [0, 0.5, 1]) {
        const directory = await mkdtemp(path.join(root, "case-"));
        for (const frame of [0, 1]) {
          await sharp({ create: { width: 64, height: 48, channels: 4, background: { r: frame * 200, g: 20, b: 100, alpha } } })
            .png().toFile(path.join(directory, `frame${frame}.png`));
        }
        const fixture = path.join(directory, "fixture.webm");
        await execute(process.env.FFMPEG_PATH || "ffmpeg", ["-v", "error", "-framerate", "2", "-i", path.join(directory, "frame%d.png"),
          "-f", "lavfi", "-i", "sine=duration=1", "-c:v", codec, "-auto-alt-ref", "0", "-pix_fmt", alpha === 1 ? "yuv420p" : "yuva420p", "-c:a", "libopus", "-shortest", fixture], { windowsHide: true });
        const input = await readFile(fixture);
        const result = await normalizeSupporterVideo(input, directory);
        assert.equal(result.contentType, "video/webm");
        assert.equal(result.width, 64); assert.equal(result.height, 48);
        assert.ok(result.data.length > 0);
        const probe = await execute(process.env.FFPROBE_PATH || "ffprobe", ["-v", "error", "-count_frames", "-show_streams", "-of", "json", path.join(directory, "output.webm")], { windowsHide: true });
        const streams = JSON.parse(probe.stdout).streams;
        assert.equal(streams.length, 1, "artwork has no audio stream");
        assert.equal(streams[0].codec_name, "vp9");
        assert.equal(Number(streams[0].nb_read_frames), 2, "both animation frames are retained");
        const decoded = await execute(process.env.FFMPEG_PATH || "ffmpeg", ["-v", "error", "-c:v", "libvpx-vp9", "-i", path.join(directory, "output.webm"),
          "-vf", "alphaextract", "-f", "rawvideo", "pipe:1"], { encoding: "buffer", windowsHide: true });
        // VP8/VP9 encoding is lossy, including its alpha plane.
        assert.ok(decoded.stdout.every((value) => Math.abs(value - Math.round(alpha * 255)) <= 2), `${codec} alpha ${alpha}: decoded values ${[...new Set(decoded.stdout)]}`);
        if (alpha === 0.5) await assertFirstFrameReview(t, path.join(directory, "output.webm"), 0, 100, 127);
      }
    }
    await assert.rejects(normalizeSupporterVideo(Buffer.from("not WebM"), await mkdtemp(path.join(root, "invalid-"))), { code: "media_image_format" });
    await assert.rejects(normalizeSupporterVideo(Buffer.alloc(5 * 1024 * 1024 + 1), root), { code: "media_image_size" });
  } finally {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    await rm(root, { recursive: true, force: true });
  }
});

test("GIF uploads retain all frames and transparency as WebM and review only the first frame", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "supporter-gif-test-"));
  const execute = promisify(execFile);
  t.mock.method(storage, "resolveCharacterRenderStoragePath", (key: string) => path.join(root, key));
  try {
    for (const mode of ["transparent", "opaque", "invisible"]) {
      const directory = await mkdtemp(path.join(root, "case-"));
      for (const frame of [0, 1]) {
        const pixels = Buffer.alloc(64 * 48 * 4);
        for (let pixel = 0; pixel < 64 * 48; pixel++) {
          pixels[pixel * 4] = frame ? 220 : 20;
          pixels[pixel * 4 + 2] = frame ? 20 : 220;
          pixels[pixel * 4 + 3] = mode === "invisible" || (mode === "transparent" && pixel % 64 >= 32) ? 0 : 255;
        }
        await sharp(pixels, { raw: { width: 64, height: 48, channels: 4 } }).png().toFile(path.join(directory, `frame${frame}.png`));
      }
      const fixture = path.join(directory, "fixture.gif");
      await execute(process.env.FFMPEG_PATH || "ffmpeg", ["-v", "error", "-framerate", "2", "-i", path.join(directory, "frame%d.png"),
        "-filter_complex", "split[a][b];[a]palettegen=reserve_transparent=1[p];[b][p]paletteuse=dither=none", "-loop", "0", fixture], { windowsHide: true });
      const input = await readFile(fixture);
      const id = new mongoose.Types.ObjectId();
      const result = await media.prepare(id, "image", input);
      assert.equal(result.contentType, "video/webm");
      assert.equal(result.storageKey, `supporter/${id}.webm`);
      assert.ok("width" in result && "height" in result);
      assert.equal(result.width, 64); assert.equal(result.height, 48);
      const output = path.join(root, result.storageKey);
      const probe = await execute(process.env.FFPROBE_PATH || "ffprobe", ["-v", "error", "-count_frames", "-show_streams", "-show_packets", "-show_format", "-of", "json", output], { windowsHide: true });
      const { streams, packets, format } = JSON.parse(probe.stdout);
      assert.equal(streams.length, 1);
      assert.equal(Number(streams[0].nb_read_frames), 2, "GIF loops are not expanded or flattened into a single frame");
      assert.equal(Number(packets[1].pts_time) - Number(packets[0].pts_time), 0.5, "GIF frame timing is preserved");
      assert.equal(Number(format.duration), 1, "The final GIF frame retains its display duration");
      const decoded = await execute(process.env.FFMPEG_PATH || "ffmpeg", ["-v", "error", "-c:v", "libvpx-vp9", "-i", output,
        "-fps_mode", "passthrough", "-pix_fmt", "rgba", "-f", "rawvideo", "pipe:1"], { encoding: "buffer", windowsHide: true });
      const frameBytes = 64 * 48 * 4;
      assert.equal(decoded.stdout.length, frameBytes * 2);
      if (mode !== "invisible") assert.notDeepEqual(decoded.stdout.subarray(0, frameBytes), decoded.stdout.subarray(frameBytes), "Both distinct animation frames survive conversion");
      const alpha = decoded.stdout.filter((_value, index) => index % 4 === 3);
      if (mode === "transparent") assert.ok(alpha.some((value) => value === 0) && alpha.some((value) => value === 255));
      else assert.ok(alpha.every((value) => Math.abs(value - (mode === "invisible" ? 0 : 255)) <= 1), `${mode}: decoded alpha values ${[...new Set(alpha)]}`);
      if (mode === "transparent") await assertFirstFrameReview(t, output, 20, 220, 255);
    }
    await assert.rejects(media.prepare(new mongoose.Types.ObjectId(), "image", Buffer.from("GIF89a broken data")), { code: "media_image_format" });
  } finally {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    await rm(root, { recursive: true, force: true });
  }
});

test("AVIF contents upload regardless of filename, retain animation and alpha, and receive first-frame review", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "supporter-avif-test-"));
  const execute = promisify(execFile);
  t.mock.method(storage, "resolveCharacterRenderStoragePath", (key: string) => path.join(root, key));
  try {
    for (const frameCount of [1, 2]) {
      for (const alpha of [0, 0.5, 1]) {
        const directory = await mkdtemp(path.join(root, "case-"));
        for (let frame = 0; frame < frameCount; frame++) {
          await sharp({ create: { width: 64, height: 48, channels: 4, background: { r: frame ? 220 : 20, g: 20, b: frame ? 20 : 220, alpha } } })
            .png().toFile(path.join(directory, `frame${frame}.png`));
        }
        const fixture = path.join(directory, "fixture.gif");
        await execute(process.env.FFMPEG_PATH || "ffmpeg", ["-v", "error", "-framerate", "2", "-i", path.join(directory, "frame%d.png"),
          ...(alpha === 1 ? ["-map", "0:v"] : ["-filter_complex", "[0:v]split[color][alpha];[alpha]alphaextract,setparams=colorspace=bt709[mask]", "-map", "[color]", "-map", "[mask]"]),
          "-c:v", "libaom-av1", "-threads", "1", "-cpu-used", "8", "-crf", "20", "-pix_fmt:v:0", "yuv444p", ...(alpha === 1 ? [] : ["-pix_fmt:v:1", "gray"]), "-f", "avif", fixture], { windowsHide: true });
        const input = await readFile(fixture);
        assert.equal(input.toString("ascii", 4, 8), "ftyp", "The .gif fixture actually contains AVIF");
        const result = await media.prepare(new mongoose.Types.ObjectId(), "image", input);
        assert.equal(result.contentType, "video/webm");
        const output = path.join(root, result.storageKey);
        const probe = await execute(process.env.FFPROBE_PATH || "ffprobe", ["-v", "error", "-count_frames", "-show_streams", "-show_packets", "-of", "json", output], { windowsHide: true });
        const { streams, packets } = JSON.parse(probe.stdout);
        assert.equal(streams.length, 1, "Only the combined color and transparency stream is stored");
        assert.equal(Number(streams[0].nb_read_frames), frameCount, "The animation is not replaced by its still cover");
        if (frameCount > 1) assert.equal(Number(packets[1].pts_time) - Number(packets[0].pts_time), 0.5);
        const decoded = await execute(process.env.FFMPEG_PATH || "ffmpeg", ["-v", "error", "-c:v", "libvpx-vp9", "-i", output,
          "-fps_mode", "passthrough", "-pix_fmt", "rgba", "-f", "rawvideo", "pipe:1"], { encoding: "buffer", windowsHide: true });
        assert.equal(decoded.stdout.length, 64 * 48 * 4 * frameCount);
        assert.ok(decoded.stdout.filter((_value, index) => index % 4 === 3).every((value) => Math.abs(value - alpha * 255) <= 1));
        if (frameCount > 1 && alpha > 0) assert.ok(decoded.stdout[64 * 48 * 4] > 200, "The second color frame survives");
        if (alpha === 0.5) await assertFirstFrameReview(t, output, 20, 220, 127);

        const unsupported = Buffer.from(input);
        for (let offset = 8; offset < unsupported.readUInt32BE(0); offset += 4) {
          if (["avif", "avis"].includes(unsupported.toString("ascii", offset, offset + 4))) unsupported.write("isom", offset);
        }
        await assert.rejects(media.prepare(new mongoose.Types.ObjectId(), "image", unsupported), { code: "media_image_format" });
      }
    }
    const broken = Buffer.from("0000ftypavif0000broken data");
    broken.writeUInt32BE(16, 0);
    await assert.rejects(media.prepare(new mongoose.Types.ObjectId(), "image", broken), { code: "media_image_format" });
  } finally {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    await rm(root, { recursive: true, force: true });
  }
});

test("failed animation frame extraction leaves the submission pending without calling AI", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "supporter-frame-failure-"));
  try {
    const source = path.join(root, "broken.webm");
    await writeFile(source, "not WebM");
    t.mock.method(storage, "resolveCharacterRenderStoragePath", () => source);
    t.mock.method(Media, "findOne", () => ({ lean: async () => ({ storageKey: "broken.webm", contentType: "video/webm" }) }) as any);
    const review = t.mock.method(artReview, "review");
    const approve = t.mock.method(media, "review", async () => ({ ok: true }));
    const update = t.mock.method(Media, "updateOne", (() => Promise.resolve({})) as any);
    await media.autoReview(String(new mongoose.Types.ObjectId()));
    assert.equal(review.mock.callCount(), 0);
    assert.equal(approve.mock.callCount(), 0);
    assert.equal(update.mock.callCount(), 0);
  } finally {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    await rm(root, { recursive: true, force: true });
  }
});

test("Supporter customization has a card-specific key and serves approved asset paths", () => {
  assert.equal(supporterMediaUrl("image", "image/webp"), "/api/ccg/media/supporter/image");
  const videoUrl = supporterMediaUrl("video", "video/webm");
  assert.match(videoUrl, /\.webm$/);
  assert.equal(new URL(videoUrl, "https://example.com").pathname, "/api/ccg/media/supporter/video");
  const card = { characterId: "character", collectorKey: "wow:eu:realm:name" };
  assert.equal(resolveAlternativeArtKey(card), card.collectorKey);
  assert.equal(resolveAlternativeArtKey({ ...card, supporterCharacterId: "supporter" }), "supporter:supporter");
  const definition = { collectorKey: "supporter:supporter", characterArtFilename: "image.webp", characterArtEnabled: true,
    characterArtPath: "/api/ccg/media/supporter/image", quipAudioFilename: "audio.mp3", quipAudioPath: "/api/ccg/media/supporter/audio" };
  assert.equal(serializeAlternativeArt(definition)?.characterArtPath, definition.characterArtPath);
  assert.equal(serializeQuip(definition)?.audioPath, definition.quipAudioPath);
});
