import "dotenv/config";
import { readFile } from "node:fs/promises";
import mongoose from "mongoose";
import CcgCard from "../models/CcgCard";
import CcgCommunityCharacter from "../models/CcgCommunityCharacter";
import CharacterMedia from "../models/CharacterMedia";
import CharacterRenderAsset, { CharacterRenderFit } from "../models/CharacterRenderAsset";
import {
  measureCharacterRenderFits,
  resolveCharacterRenderStoragePath,
} from "../services/character-render-storage.service";

type RepairResult = {
  scanned: number;
  changed: number;
  failed: number;
  assetsUpdated: number;
  mediaUpdated: number;
  cardsUpdated: number;
  communityCharactersUpdated: number;
};

const PROGRESS_INTERVAL = 250;

function fitsEqual(left: CharacterRenderFit, right: CharacterRenderFit): boolean {
  return left.top === right.top && left.ground === right.ground && left.centerX === right.centerX;
}

function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${remainder}s`;
  return `${remainder}s`;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const mode = apply ? "apply" : "preview";
  const mongoUri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/wow_guild_tracker";
  const result: RepairResult = {
    scanned: 0,
    changed: 0,
    failed: 0,
    assetsUpdated: 0,
    mediaUpdated: 0,
    cardsUpdated: 0,
    communityCharactersUpdated: 0,
  };

  await mongoose.connect(mongoUri);
  try {
    const total = await CharacterRenderAsset.countDocuments({ status: "active" });
    const startedAt = Date.now();
    console.log(`[CharacterRenderFitRepair] Starting ${mode} scan of ${total} active render assets`);
    const cursor = CharacterRenderAsset.find({ status: "active" }).cursor();
    for await (const asset of cursor) {
      result.scanned += 1;
      try {
        const bytes = await readFile(resolveCharacterRenderStoragePath(asset.storageKey));
        const fits = await measureCharacterRenderFits(bytes);
        if (fitsEqual(asset.silhouetteFit, fits.silhouetteFit) && fitsEqual(asset.stanceFit, fits.stanceFit)) continue;
        result.changed += 1;
        if (!apply) continue;

        const assetUpdate = await CharacterRenderAsset.collection.updateOne(
          { _id: asset._id, status: "active", storageKey: asset.storageKey },
          { $set: fits },
        );
        if (assetUpdate.matchedCount === 0) continue;
        result.assetsUpdated += assetUpdate.modifiedCount;

        const [mediaUpdate, cardUpdate, communityUpdate] = await Promise.all([
          CharacterMedia.collection.updateMany(
            { renderAssetId: asset._id },
            { $set: { renderFit: fits.stanceFit } },
          ),
          CcgCard.collection.updateMany(
            { renderAssetId: asset._id },
            { $set: { renderFit: fits.stanceFit } },
          ),
          CcgCommunityCharacter.collection.updateMany(
            { renderAssetId: asset._id },
            { $set: { renderFit: fits.stanceFit } },
          ),
        ]);
        result.mediaUpdated += mediaUpdate.modifiedCount;
        result.cardsUpdated += cardUpdate.modifiedCount;
        result.communityCharactersUpdated += communityUpdate.modifiedCount;
      } catch (error) {
        result.failed += 1;
        console.error(`[CharacterRenderFitRepair] Failed asset ${asset._id}:`, error);
      } finally {
        if (result.scanned % PROGRESS_INTERVAL === 0 || result.scanned === total) {
          const elapsedSeconds = Math.max(0.001, (Date.now() - startedAt) / 1000);
          const rate = result.scanned / elapsedSeconds;
          const remainingSeconds = rate > 0 ? (total - result.scanned) / rate : 0;
          const percent = total > 0 ? Math.min(100, result.scanned / total * 100) : 100;
          console.log(
            `[CharacterRenderFitRepair] ${mode} ${result.scanned}/${total} (${percent.toFixed(1)}%)`
            + ` | changed ${result.changed} | failed ${result.failed}`
            + ` | ${rate.toFixed(1)} assets/s | ETA ${formatDuration(remainingSeconds)}`,
          );
        }
      }
    }
  } finally {
    await mongoose.disconnect();
  }

  console.log(`[CharacterRenderFitRepair] ${apply ? "Applied" : "Previewed"} stored render fits`);
  console.log(JSON.stringify(result, null, 2));
  if (result.failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
