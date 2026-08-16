import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import mongoose from "mongoose";
import sharp from "sharp";
import CharacterRenderAsset, { CharacterRenderFit, ICharacterRenderAsset } from "../models/CharacterRenderAsset";
import logger from "../utils/logger";

const ALLOWED_RENDER_HOST = "render.worldofwarcraft.com";
const MAX_RENDER_BYTES = 16 * 1024 * 1024;
const MAX_INPUT_PIXELS = 64 * 1024 * 1024;
const ALPHA_THRESHOLD = 1;
const STANCE_TOP_ALPHA_THRESHOLD = 128;
const STANCE_TOP_SOFT_LEAD_MIN_RATIO = 0.05;
const STANCE_TOP_SOLID_MASS_MIN_RATIO = 0.5;
const CROP_PADDING_PIXELS = 2;
const STANCE_SCAN_HALF_WIDTH_RATIO = 0.1;
const STANCE_GROUND_ALPHA_THRESHOLD = 32;
const STANCE_GROUND_PERCENTILE = 0.85;
const PUBLIC_ASSET_PREFIX = "/api/ccg/media/assets";
const MAX_PUBLIC_CACHE_SECONDS = 365 * 24 * 60 * 60;

const storageRoot = path.resolve(process.env.CCG_MEDIA_CACHE_DIR || path.join(process.cwd(), "data", "ccg-media"));

export type StoredCharacterRender = {
  assetId: mongoose.Types.ObjectId;
  url: string;
  fit: CharacterRenderFit;
  byteLength: number;
  width: number;
  height: number;
};

export type CharacterRenderAssetStats = {
  active: number;
  activeBytes: number;
  expired: number;
  expiringWithinSevenDays: number;
  purged: number;
};

export class CharacterRenderIngestError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "CharacterRenderIngestError";
  }
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function assetUrl(assetId: mongoose.Types.ObjectId | string): string {
  return `${PUBLIC_ASSET_PREFIX}/${assetId}`;
}

export function resolveCharacterRenderStoragePath(storageKey: string): string {
  const absolutePath = path.resolve(storageRoot, storageKey);
  if (!absolutePath.startsWith(`${storageRoot}${path.sep}`)) throw new Error("Invalid character render storage key");
  return absolutePath;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readResponseBody(response: Response): Promise<Buffer> {
  if (!response.body) throw new CharacterRenderIngestError("render_download_failed", "The Blizzard character render response had no body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > MAX_RENDER_BYTES) {
        await reader.cancel();
        throw new CharacterRenderIngestError("render_too_large", "The Blizzard character render exceeded the download limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, byteLength);
}

async function downloadRender(sourceUrl: string): Promise<Buffer> {
  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    throw new CharacterRenderIngestError("invalid_source_url", "Blizzard returned an invalid character render URL");
  }
  if (url.protocol !== "https:" || url.hostname !== ALLOWED_RENDER_HOST) {
    throw new CharacterRenderIngestError("invalid_source_host", "Blizzard returned a character render from an unexpected host");
  }

  let response: Response;
  try {
    response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new CharacterRenderIngestError("render_download_failed", "The Blizzard character render download failed");
  }
  if (!response.ok) {
    throw new CharacterRenderIngestError(`render_download_${response.status}`, `The Blizzard character render download returned HTTP ${response.status}`);
  }
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > MAX_RENDER_BYTES) {
    throw new CharacterRenderIngestError("render_too_large", "The Blizzard character render exceeded the download limit");
  }
  const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
  if (contentType !== "image/png") {
    throw new CharacterRenderIngestError("render_not_png", "The Blizzard character render was not a PNG image");
  }
  const buffer = await readResponseBody(response);
  if (buffer.length === 0 || buffer.length > MAX_RENDER_BYTES) {
    throw new CharacterRenderIngestError("render_invalid_size", "The Blizzard character render had an invalid size");
  }
  return buffer;
}

function analyzeAlpha(data: Buffer, width: number, height: number, channels: number) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let alphaMass = 0;
  let solidAlphaMass = 0;
  let solidTopY = height;
  let weightedX = 0;
  const horizontalAlphaMass = new Float64Array(width);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = data[(y * width + x) * channels + 3];
      if (alpha < ALPHA_THRESHOLD) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      alphaMass += alpha;
      if (alpha >= STANCE_TOP_ALPHA_THRESHOLD) {
        solidAlphaMass += alpha;
        solidTopY = Math.min(solidTopY, y);
      }
      weightedX += (x + 0.5) * alpha;
      horizontalAlphaMass[x] += alpha;
    }
  }
  if (alphaMass === 0 || maxX < minX || maxY < minY) {
    throw new CharacterRenderIngestError("render_empty", "The Blizzard character render contained no visible pixels");
  }

  let accumulatedAlpha = 0;
  let stanceCenterX = width / 2;
  for (let x = 0; x < width; x += 1) {
    accumulatedAlpha += horizontalAlphaMass[x];
    if (accumulatedAlpha < alphaMass / 2) continue;
    stanceCenterX = x + 0.5;
    break;
  }
  const stanceHalfWidth = Math.max(1, Math.round(width * STANCE_SCAN_HALF_WIDTH_RATIO));
  const stanceStartX = Math.max(minX, Math.floor(stanceCenterX - stanceHalfWidth));
  const stanceEndX = Math.min(maxX, Math.ceil(stanceCenterX + stanceHalfWidth));
  const stanceColumnBottoms: number[] = [];
  const leftColumnBottoms: number[] = [];
  const rightColumnBottoms: number[] = [];
  const leftEndX = Math.floor(stanceCenterX - 0.5);
  const rightStartX = Math.ceil(stanceCenterX + 0.5);
  for (let x = minX; x <= maxX; x += 1) {
    for (let y = maxY; y >= minY; y -= 1) {
      if (data[(y * width + x) * channels + 3] < STANCE_GROUND_ALPHA_THRESHOLD) continue;
      if (x >= stanceStartX && x <= stanceEndX) stanceColumnBottoms.push(y);
      if (x <= leftEndX) leftColumnBottoms.push(y);
      if (x >= rightStartX) rightColumnBottoms.push(y);
      break;
    }
  }
  stanceColumnBottoms.sort((left, right) => left - right);
  leftColumnBottoms.sort((left, right) => left - right);
  rightColumnBottoms.sort((left, right) => left - right);
  const groundAtPercentile = (bottoms: number[]) => bottoms[
    Math.round((bottoms.length - 1) * STANCE_GROUND_PERCENTILE)
  ];
  const centralGroundY = groundAtPercentile(stanceColumnBottoms) ?? maxY;
  const leftGroundY = groundAtPercentile(leftColumnBottoms) ?? centralGroundY;
  const rightGroundY = groundAtPercentile(rightColumnBottoms) ?? centralGroundY;
  // A deeper ground must have support on both sides of the character. This
  // catches wide stances without letting a low side-held weapon set the floor.
  const bilateralGroundY = Math.min(leftGroundY, rightGroundY);
  const silhouetteHeight = maxY - minY + 1;
  const hasSoftEffectLead = solidTopY <= maxY
    && solidTopY - minY >= silhouetteHeight * STANCE_TOP_SOFT_LEAD_MIN_RATIO
    && solidAlphaMass >= alphaMass * STANCE_TOP_SOLID_MASS_MIN_RATIO;

  return {
    minX,
    minY,
    maxX,
    maxY,
    centerX: weightedX / alphaMass,
    stanceTopY: hasSoftEffectLead ? solidTopY : minY,
    stanceGroundY: Math.max(centralGroundY, bilateralGroundY),
  };
}

function buildCharacterRenderFits(
  bounds: ReturnType<typeof analyzeAlpha>,
  frameLeft: number,
  frameTop: number,
  frameWidth: number,
  frameHeight: number,
): { silhouetteFit: CharacterRenderFit; stanceFit: CharacterRenderFit } {
  const centerX = clampUnit((bounds.centerX - frameLeft) / frameWidth);
  return {
    silhouetteFit: {
      top: clampUnit((bounds.minY - frameTop) / frameHeight),
      ground: clampUnit((bounds.maxY + 1 - frameTop) / frameHeight),
      centerX,
    },
    stanceFit: {
      top: clampUnit((bounds.stanceTopY - frameTop) / frameHeight),
      ground: clampUnit((bounds.stanceGroundY + 1 - frameTop) / frameHeight),
      centerX,
    },
  };
}

export async function measureCharacterRenderFits(input: Buffer): Promise<{
  silhouetteFit: CharacterRenderFit;
  stanceFit: CharacterRenderFit;
}> {
  const decoded = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const bounds = analyzeAlpha(decoded.data, decoded.info.width, decoded.info.height, decoded.info.channels);
  return buildCharacterRenderFits(bounds, 0, 0, decoded.info.width, decoded.info.height);
}

export async function processCharacterRender(input: Buffer) {
  const source = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS });
  const metadata = await source.metadata();
  if (metadata.format !== "png" || !metadata.width || !metadata.height) {
    throw new CharacterRenderIngestError("render_invalid_png", "The Blizzard character render could not be decoded as PNG");
  }
  const decoded = await source.clone().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const bounds = analyzeAlpha(decoded.data, decoded.info.width, decoded.info.height, decoded.info.channels);
  const cropLeft = Math.max(0, bounds.minX - CROP_PADDING_PIXELS);
  const cropTop = Math.max(0, bounds.minY - CROP_PADDING_PIXELS);
  const cropRight = Math.min(metadata.width - 1, bounds.maxX + CROP_PADDING_PIXELS);
  const cropBottom = Math.min(metadata.height - 1, bounds.maxY + CROP_PADDING_PIXELS);
  const width = cropRight - cropLeft + 1;
  const height = cropBottom - cropTop + 1;
  const { silhouetteFit, stanceFit } = buildCharacterRenderFits(bounds, cropLeft, cropTop, width, height);
  const output = await source
    .extract({ left: cropLeft, top: cropTop, width, height })
    .webp({ quality: 95, alphaQuality: 100, effort: 6, smartSubsample: true })
    .toBuffer();

  return {
    output,
    width,
    height,
    sourceWidth: metadata.width,
    sourceHeight: metadata.height,
    cropLeft,
    cropTop,
    silhouetteFit,
    stanceFit,
  };
}

async function persistBytes(storageKey: string, bytes: Buffer): Promise<void> {
  const filePath = resolveCharacterRenderStoragePath(storageKey);
  if (await fileExists(filePath)) return;
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, bytes, { flag: "wx" });
    await rename(temporaryPath, filePath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    if (!(await fileExists(filePath))) throw error;
  }
}

class CharacterRenderStorageService {
  getPublicUrl(assetId: mongoose.Types.ObjectId | string): string {
    return assetUrl(assetId);
  }

  async ingest(characterId: mongoose.Types.ObjectId, sourceUrl: string, validatedAt = new Date()): Promise<StoredCharacterRender> {
    const input = await downloadRender(sourceUrl);
    let processed;
    try {
      processed = await processCharacterRender(input);
    } catch (error) {
      if (error instanceof CharacterRenderIngestError) throw error;
      throw new CharacterRenderIngestError("render_invalid_png", "The Blizzard character render could not be decoded as PNG");
    }
    const sha256 = createHash("sha256").update(processed.output).digest("hex");
    const storageKey = path.posix.join(sha256.slice(0, 2), `${sha256}.webp`);
    await persistBytes(storageKey, processed.output);
    const update = {
      characterId,
      sourceUrl,
      sourceValidatedAt: validatedAt,
      status: "active" as const,
      sha256,
      storageKey,
      contentType: "image/webp" as const,
      byteLength: processed.output.length,
      width: processed.width,
      height: processed.height,
      sourceWidth: processed.sourceWidth,
      sourceHeight: processed.sourceHeight,
      cropLeft: processed.cropLeft,
      cropTop: processed.cropTop,
      silhouetteFit: processed.silhouetteFit,
      stanceFit: processed.stanceFit,
      purgedAt: null,
      purgeReason: null,
    };
    let asset: ICharacterRenderAsset | null;
    try {
      asset = await CharacterRenderAsset.findOneAndUpdate(
        { characterId, sha256 },
        { $set: update },
        { upsert: true, returnDocument: "after" },
      );
    } catch (error) {
      if (!(error instanceof mongoose.mongo.MongoServerError) || error.code !== 11000) throw error;
      asset = await CharacterRenderAsset.findOneAndUpdate(
        { characterId, sha256 },
        { $set: update },
        { returnDocument: "after" },
      );
    }
    if (!asset) throw new Error("Character render asset could not be persisted");
    // Another worker can purge a shared content-addressed file between the
    // initial write and this asset upsert. Ensure the committed reference has bytes.
    await persistBytes(storageKey, processed.output);
    return {
      assetId: asset._id as mongoose.Types.ObjectId,
      url: assetUrl(asset._id as mongoose.Types.ObjectId),
      fit: asset.stanceFit,
      byteLength: asset.byteLength,
      width: asset.width,
      height: asset.height,
    };
  }

  async ingestExistingSource(
    characterId: mongoose.Types.ObjectId,
    sourceUrl: string | null | undefined,
    validatedAt = new Date(),
  ): Promise<StoredCharacterRender | null> {
    if (!sourceUrl) return null;
    try {
      return await this.ingest(characterId, sourceUrl, validatedAt);
    } catch (error) {
      if (!(error instanceof CharacterRenderIngestError)) throw error;
      logger.warn(`[CharacterRenderStorage] Stored source URL was unusable for ${characterId}; falling back to Blizzard media (${error.code})`);
      return null;
    }
  }

  async getForServing(assetId: string): Promise<{ asset: ICharacterRenderAsset; filePath: string; cacheSeconds: number } | null> {
    if (!mongoose.Types.ObjectId.isValid(assetId)) return null;
    const asset = await CharacterRenderAsset.findById(assetId);
    if (!asset) return null;
    const filePath = resolveCharacterRenderStoragePath(asset.storageKey);
    if (!(await fileExists(filePath))) {
      logger.error(`[CharacterRenderStorage] Missing file for asset ${assetId}`);
      return null;
    }
    return { asset, filePath, cacheSeconds: MAX_PUBLIC_CACHE_SECONDS };
  }

  async getStats(): Promise<CharacterRenderAssetStats> {
    const [activeRows, purged] = await Promise.all([
      CharacterRenderAsset.aggregate<{ count: number; bytes: number }>([
        { $match: { status: "active" } },
        { $group: { _id: null, count: { $sum: 1 }, bytes: { $sum: "$byteLength" } } },
      ]),
      CharacterRenderAsset.countDocuments({ status: "purged" }),
    ]);
    return {
      active: activeRows[0]?.count ?? 0,
      activeBytes: activeRows[0]?.bytes ?? 0,
      expired: 0,
      expiringWithinSevenDays: 0,
      purged,
    };
  }
}

export default new CharacterRenderStorageService();
