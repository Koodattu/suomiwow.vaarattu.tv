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

function fitsEqual(left: CharacterRenderFit, right: CharacterRenderFit): boolean {
  return left.top === right.top && left.ground === right.ground && left.centerX === right.centerX;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
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
