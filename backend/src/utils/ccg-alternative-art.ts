import { CcgArtVariant, CcgFinish } from "../config/ccg";

export const CCG_ALTERNATIVE_CHARACTER_PATH = "/ccg/alternative/character";
export const CCG_ALTERNATIVE_BACKGROUND_PATH = "/ccg/alternative/background";
export const CCG_QUIP_AUDIO_PATH = "/ccg/audio/quips";

const ALTERNATIVE_ART_FILENAME = /^[a-zA-Z0-9][a-zA-Z0-9 _.()-]*\.(?:avif|gif|jpe?g|png|webm|webp)$/i;
const QUIP_AUDIO_FILENAME = /^[a-zA-Z0-9][a-zA-Z0-9 _.()-]*\.(?:aac|m4a|mp3|ogg|wav)$/i;
const MAX_QUIP_TEXT_LENGTH = 500;

export type CcgAlternativeArtDefinition = {
  collectorKey: string;
  characterArtFilename?: string | null;
  characterArtEnabled?: boolean;
  backgroundArtFilename?: string | null;
  backgroundArtEnabled?: boolean;
  quipText?: string | null;
  quipAudioFilename?: string | null;
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
    throw new Error("Use an artwork filename only (PNG, JPG, WebP, AVIF, GIF, or WebM)");
  }
  return filename;
}

export function normalizeQuipText(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw new Error("Quip text must be text");
  const text = value.trim();
  if (!text) return null;
  if (text.length > MAX_QUIP_TEXT_LENGTH) throw new Error(`Quip text cannot exceed ${MAX_QUIP_TEXT_LENGTH} characters`);
  return text;
}

export function normalizeQuipAudioFilename(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw new Error("Quip audio filename must be text");
  const filename = value.trim();
  if (!filename) return null;
  if (filename.length > 120 || !QUIP_AUDIO_FILENAME.test(filename)) {
    throw new Error("Use an audio filename only (MP3, WAV, OGG, M4A, or AAC)");
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

export function serializeQuip(definition: CcgAlternativeArtDefinition | undefined) {
  if (!definition) return null;
  const text = definition.quipText?.trim() || null;
  const audioFilename = definition.quipAudioFilename?.trim() || null;
  if (!text && !audioFilename) return null;
  return {
    text,
    audioFilename,
    audioPath: audioFilename ? `${CCG_QUIP_AUDIO_PATH}/${encodeURIComponent(audioFilename)}` : null,
  };
}

export function serializeOwnershipRows(rows: readonly CcgStoredOwnership[], alternativeArtUnlocked = false): CcgSerializedOwnership[] {
  return rows.flatMap((row) => {
    return [
      { finish: row.finish, artVariant: "standard" as const, quantity: row.quantity },
      ...(alternativeArtUnlocked ? [{ finish: row.finish, artVariant: "alternative" as const, quantity: row.quantity }] : []),
    ];
  });
}
