import { CcgArtVariant, CcgFinish } from "../config/ccg";

export const CCG_ALTERNATIVE_CHARACTER_PATH = "/ccg/alternative/character";
export const CCG_ALTERNATIVE_BACKGROUND_PATH = "/ccg/alternative/background";

const ALTERNATIVE_ART_FILENAME = /^[a-zA-Z0-9][a-zA-Z0-9 _.()-]*\.(?:avif|jpe?g|png|webp)$/i;

export type CcgAlternativeArtDefinition = {
  collectorKey: string;
  characterArtFilename?: string | null;
  characterArtEnabled?: boolean;
  backgroundArtFilename?: string | null;
  backgroundArtEnabled?: boolean;
};

export type CcgStoredOwnership = {
  finish: CcgFinish;
  quantity: number;
  alternativeQuantity?: number | null;
};

export type CcgSerializedOwnership = {
  finish: CcgFinish;
  artVariant: CcgArtVariant;
  quantity: number;
};

export function normalizeAlternativeArtFilename(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw new Error("Alternative artwork filename must be text");
  const filename = value.trim();
  if (!filename) return null;
  if (filename.length > 120 || !ALTERNATIVE_ART_FILENAME.test(filename)) {
    throw new Error("Use an image filename only (PNG, JPG, WebP, or AVIF)");
  }
  return filename;
}

export function hasApplicableAlternativeArt(definition: CcgAlternativeArtDefinition | undefined, isCommunity: boolean): boolean {
  if (!definition) return false;
  const characterArt = Boolean(definition.characterArtEnabled && definition.characterArtFilename);
  const backgroundArt = Boolean(isCommunity && definition.backgroundArtEnabled && definition.backgroundArtFilename);
  return characterArt || backgroundArt;
}

export function serializeAlternativeArt(definition: CcgAlternativeArtDefinition | undefined) {
  if (!definition) return null;
  return {
    characterArtFilename: definition.characterArtFilename ?? null,
    characterArtPath: definition.characterArtFilename
      ? `${CCG_ALTERNATIVE_CHARACTER_PATH}/${encodeURIComponent(definition.characterArtFilename)}`
      : null,
    characterArtEnabled: Boolean(definition.characterArtEnabled && definition.characterArtFilename),
    backgroundArtFilename: definition.backgroundArtFilename ?? null,
    backgroundArtPath: definition.backgroundArtFilename
      ? `${CCG_ALTERNATIVE_BACKGROUND_PATH}/${encodeURIComponent(definition.backgroundArtFilename)}`
      : null,
    backgroundArtEnabled: Boolean(definition.backgroundArtEnabled && definition.backgroundArtFilename),
  };
}

export function serializeOwnershipRows(rows: readonly CcgStoredOwnership[]): CcgSerializedOwnership[] {
  return rows.flatMap((row) => {
    const alternativeQuantity = Math.min(row.quantity, Math.max(0, row.alternativeQuantity ?? 0));
    const standardQuantity = row.quantity - alternativeQuantity;
    return [
      ...(standardQuantity > 0 ? [{ finish: row.finish, artVariant: "standard" as const, quantity: standardQuantity }] : []),
      ...(alternativeQuantity > 0 ? [{ finish: row.finish, artVariant: "alternative" as const, quantity: alternativeQuantity }] : []),
    ];
  });
}
