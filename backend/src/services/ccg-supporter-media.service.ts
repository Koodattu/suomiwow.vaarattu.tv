import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import mongoose from "mongoose";
import sharp from "sharp";
import Media from "../models/CcgSupporterMedia";
import Source from "../models/CcgSupporterCharacter";
import { CcgSupporterError } from "../utils/ccg-supporter";
import { resolveCharacterRenderStoragePath } from "./character-render-storage.service";
import cache from "./cache.service";
import AsyncSemaphore from "../utils/async-semaphore";

const execute = promisify(execFile);
export const SUPPORTER_IMAGE_BYTES = 5 * 1024 * 1024;
export const SUPPORTER_AUDIO_BYTES = 8 * 1024 * 1024;
const AUDIO_FORMATS = "mp3,wav,flac,ogg,aac,mov,matroska,webm,aiff,asf";
const DAY = 86_400_000;
export type SupporterMediaKind = "image" | "audio";

export function supporterMediaUrl(id: mongoose.Types.ObjectId | string) {
  return `/api/ccg/media/supporter/${id}`;
}

export async function normalizeSupporterImage(input: Buffer) {
  if (!input.length || input.length > SUPPORTER_IMAGE_BYTES) throw new CcgSupporterError(400, "media_image_size");
  try {
    const options = { limitInputPixels: 40_000_000, failOn: "warning" as const };
    const metadata = await sharp(input, options).metadata();
    if (!["png", "webp"].includes(metadata.format ?? "") || (metadata.pages ?? 1) !== 1 || !metadata.hasAlpha) {
      throw new CcgSupporterError(400, "media_image_format");
    }
    const normalized = await sharp(input, options).rotate().resize(2048, 2048, { fit: "inside", withoutEnlargement: true }).webp({ quality: 85, alphaQuality: 100 }).toBuffer({ resolveWithObject: true });
    const stats = await sharp(normalized.data).stats();
    const alpha = stats.channels[3];
    if (!alpha || alpha.min === 255 || alpha.max === 0) throw new CcgSupporterError(400, "media_image_transparency");
    return { data: normalized.data, contentType: "image/webp", width: normalized.info.width, height: normalized.info.height };
  } catch (error) {
    if (error instanceof CcgSupporterError) throw error;
    throw new CcgSupporterError(400, "media_image_format");
  }
}

export async function normalizeSupporterAudio(input: Buffer, directory: string) {
  if (!input.length || input.length > SUPPORTER_AUDIO_BYTES) throw new CcgSupporterError(400, "media_audio_size");
  const source = path.join(directory, "input");
  const output = path.join(directory, "output.mp3");
  await writeFile(source, input, { flag: "wx" });
  const inputOptions = ["-protocol_whitelist", "file,pipe", "-format_whitelist", AUDIO_FORMATS];
  try {
    const probe = await execute(process.env.FFPROBE_PATH || "ffprobe", ["-v", "error", ...inputOptions, "-show_streams", "-show_format", "-of", "json", source], { timeout: 15_000, maxBuffer: 256 * 1024, windowsHide: true });
    const details = JSON.parse(probe.stdout);
    const stream = details.streams?.find((entry: { codec_type?: string }) => entry.codec_type === "audio");
    if (!stream) throw new CcgSupporterError(400, "media_audio_format");
    const decoded = await execute(process.env.FFMPEG_PATH || "ffmpeg", ["-v", "error", "-xerror", "-nostdin", "-threads", "1", ...inputOptions, "-i", source,
      "-map", "0:a:0", "-t", "10.01", "-ac", "1", "-ar", "48000", "-f", "s16le", "pipe:1"],
    { encoding: "buffer", timeout: 15_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true });
    const duration = decoded.stdout.length / 96_000;
    if (duration <= 0 || duration >= 10) throw new CcgSupporterError(400, "media_audio_duration");
    await execute(process.env.FFMPEG_PATH || "ffmpeg", ["-v", "error", "-nostdin", "-threads", "1", ...inputOptions, "-i", source,
      "-map", "0:a:0", "-vn", "-map_metadata", "-1", "-map_chapters", "-1", "-ac", "2", "-ar", "44100", "-c:a", "libmp3lame", "-b:a", "96k", output],
    { timeout: 15_000, maxBuffer: 256 * 1024, windowsHide: true });
    return { data: await readFile(output), contentType: "audio/mpeg", duration };
  } catch (error) {
    if (error instanceof CcgSupporterError) throw error;
    if (["ENOENT", "EPERM", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "")) throw new CcgSupporterError(503, "media_processor_unavailable");
    throw new CcgSupporterError(400, "media_audio_format");
  }
}

class SupporterMediaService {
  private readonly processing = new AsyncSemaphore(2);
  private queued = 0;

  async prepare(id: mongoose.Types.ObjectId, kind: SupporterMediaKind, input: Buffer) {
    if (this.queued >= 4) throw new CcgSupporterError(503, "media_busy");
    this.queued += 1;
    try { return await this.processing.run(() => this.prepareFile(id, kind, input)); }
    finally { this.queued -= 1; }
  }

  private async prepareFile(id: mongoose.Types.ObjectId, kind: SupporterMediaKind, input: Buffer) {
    const root = resolveCharacterRenderStoragePath("supporter");
    await mkdir(root, { recursive: true });
    const temporary = await mkdtemp(path.join(root, "upload-"));
    const storageKey = `supporter/${id}.${kind === "image" ? "webp" : "mp3"}`;
    try {
      const { data, ...metadata } = kind === "image" ? await normalizeSupporterImage(input) : await normalizeSupporterAudio(input, temporary);
      const staged = path.join(temporary, "normalized");
      await writeFile(staged, data, { flag: "wx" });
      await rename(staged, resolveCharacterRenderStoragePath(storageKey));
      return { ...metadata, storageKey, byteLength: data.length, sha256: createHash("sha256").update(data).digest("hex") };
    } finally {
      if (!path.resolve(temporary).startsWith(`${root}${path.sep}`)) throw new Error("Invalid media temporary directory");
      await rm(temporary, { recursive: true, force: true });
    }
  }

  async review(id: string, reviewer: string, action: unknown, reason: unknown) {
    if (!mongoose.Types.ObjectId.isValid(id) || !["approve", "reject", "revoke"].includes(String(action))) throw new CcgSupporterError(400, "invalid_media");
    if (reason !== undefined && (typeof reason !== "string" || reason.trim().length > 500)) throw new CcgSupporterError(400, "invalid_media");
    if (action !== "approve" && !String(reason ?? "").trim()) throw new CcgSupporterError(400, "media_reason_required");
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const row = await Media.findById(id).session(session);
        if (!row || row.status !== (action === "revoke" ? "approved" : "pending")) throw new CcgSupporterError(409, "media_changed");
        if (action === "approve") {
          const file = row.storageKey ? await stat(resolveCharacterRenderStoragePath(row.storageKey)).catch(() => null) : null;
          if (!file || file.size !== row.byteLength) throw new CcgSupporterError(409, "invalid_media");
        }
        const source = await Source.findOneAndUpdate({ _id: row.sourceId, cardId: { $exists: true } }, { $inc: { __v: 1 } }, { session });
        if (!source) throw new CcgSupporterError(404, "character_not_found");
        if (action === "approve") await Media.updateMany({ sourceId: row.sourceId, kind: row.kind, status: "approved" },
          { $set: { status: "superseded", purgeAfter: new Date(Date.now() + 30 * DAY) } }, { session });
        row.status = action === "approve" ? "approved" : "rejected";
        row.reason = action === "approve" ? null : String(reason).trim();
        row.reviewedBy = new mongoose.Types.ObjectId(reviewer); row.reviewedAt = new Date();
        row.purgeAfter = action === "approve" ? null : new Date(Date.now() + 30 * DAY);
        await row.save({ session });
      });
    } finally { await session.endSession(); }
    await cache.invalidatePattern(/^ccg:/);
    return { ok: true };
  }

  async list(sourceIds: mongoose.Types.ObjectId[]) {
    const rows = await Media.find({ sourceId: { $in: sourceIds }, purgedAt: null }).sort({ createdAt: -1 }).lean();
    return rows.map((row) => ({ id: String(row._id), sourceId: String(row.sourceId), kind: row.kind, status: row.status,
      url: row.contentType ? supporterMediaUrl(row._id) : null, reason: row.reason, width: row.width, height: row.height,
      duration: row.duration, createdAt: row.createdAt }));
  }

  async cleanup() {
    const rows = await Media.find({ purgeAfter: { $ne: null, $lte: new Date() }, purgedAt: null }).limit(100);
    for (const row of rows) {
      if (row.status === "processing") {
        const claimed = await Media.updateOne({ _id: row._id, status: "processing", purgeAfter: row.purgeAfter }, { $set: { status: "failed", reason: "media_upload_failed" } });
        if (!claimed.modifiedCount) continue;
      }
      if (row.storageKey) await unlink(resolveCharacterRenderStoragePath(row.storageKey)).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
      await Media.updateOne({ _id: row._id, status: row.status === "processing" ? "failed" : row.status, purgeAfter: row.purgeAfter }, { $set: { purgedAt: new Date() } });
    }
    const root = resolveCharacterRenderStoragePath("supporter");
    const directories = await readdir(root, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return []; throw error; });
    for (const directory of directories.filter((entry) => entry.isDirectory() && /^upload-[a-zA-Z0-9]+$/.test(entry.name)).slice(0, 100)) {
      const target = path.resolve(root, directory.name);
      if (!target.startsWith(`${root}${path.sep}`)) throw new Error("Invalid media temporary directory");
      if ((await stat(target)).mtimeMs < Date.now() - DAY) await rm(target, { recursive: true, force: true });
    }
  }
}

export default new SupporterMediaService();
