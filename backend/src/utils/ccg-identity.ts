import mongoose from "mongoose";

function normalizeIdentityPart(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]+/gu, "");
}

export function createWowCharacterIdentityKey(region: string, realm: string, name: string): string {
  return `wow:${normalizeIdentityPart(region)}:${normalizeIdentityPart(realm)}:${normalizeIdentityPart(name)}`;
}

export function createCharacterCollectorKey(characterId: mongoose.Types.ObjectId | string): string {
  return `character:${String(characterId)}`;
}

export function resolveCollectorKey(card: { collectorKey?: string | null; characterId: mongoose.Types.ObjectId | string }): string {
  return card.collectorKey || createCharacterCollectorKey(card.characterId);
}
