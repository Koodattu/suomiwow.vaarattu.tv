"use client";

import { PickemPrediction } from "@/types";

const STORAGE_KEY_PREFIX = "pickem-guest-draft:v1:";
const DRAFT_VERSION = 1;

export interface GuestPickemDraft {
  version: typeof DRAFT_VERSION;
  guildCount: number;
  predictions: (PickemPrediction | null)[];
  pendingImport: boolean;
  updatedAt: string;
}

export function getGuestPickemDraftStorageKey(pickemId: string): string {
  return `${STORAGE_KEY_PREFIX}${pickemId}`;
}

function isPrediction(value: unknown): value is PickemPrediction {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prediction = value as Record<string, unknown>;
  return (
    typeof prediction.guildName === "string" &&
    prediction.guildName.length > 0 &&
    prediction.guildName.length <= 100 &&
    typeof prediction.realm === "string" &&
    prediction.realm.length > 0 &&
    prediction.realm.length <= 100 &&
    typeof prediction.position === "number" &&
    Number.isInteger(prediction.position)
  );
}

function normalizePredictions(value: unknown, guildCount: number): (PickemPrediction | null)[] | null {
  if (!Array.isArray(value)) return null;

  const predictions: (PickemPrediction | null)[] = Array(guildCount).fill(null);
  const guildKeys = new Set<string>();

  for (const entry of value) {
    if (entry === null) continue;
    if (!isPrediction(entry) || entry.position < 1 || entry.position > guildCount) continue;

    const guildName = entry.guildName.trim();
    const realm = entry.realm.trim();
    if (!guildName || !realm) continue;

    const guildKey = `${guildName}\u0000${realm}`;
    if (guildKeys.has(guildKey) || predictions[entry.position - 1] !== null) continue;

    guildKeys.add(guildKey);
    predictions[entry.position - 1] = {
      guildName,
      realm,
      position: entry.position,
    };
  }

  return predictions;
}

export function readGuestPickemDraft(pickemId: string, guildCount: number): GuestPickemDraft | null {
  if (typeof window === "undefined") return null;

  try {
    const storedValue = window.localStorage.getItem(getGuestPickemDraftStorageKey(pickemId));
    if (!storedValue) return null;

    const parsed = JSON.parse(storedValue) as Partial<GuestPickemDraft>;
    if (parsed.version !== DRAFT_VERSION) return null;

    const predictions = normalizePredictions(parsed.predictions, guildCount);
    if (!predictions) return null;

    return {
      version: DRAFT_VERSION,
      guildCount,
      predictions,
      pendingImport: parsed.pendingImport === true,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

export function saveGuestPickemDraft(
  pickemId: string,
  guildCount: number,
  predictions: (PickemPrediction | null)[],
  options: { pendingImport?: boolean } = {},
): GuestPickemDraft | null {
  if (typeof window === "undefined") return null;

  const normalizedPredictions = normalizePredictions(predictions, guildCount);
  if (!normalizedPredictions) return null;

  const currentDraft = readGuestPickemDraft(pickemId, guildCount);
  const draft: GuestPickemDraft = {
    version: DRAFT_VERSION,
    guildCount,
    predictions: normalizedPredictions,
    pendingImport: options.pendingImport ?? currentDraft?.pendingImport ?? false,
    updatedAt: new Date().toISOString(),
  };

  try {
    window.localStorage.setItem(getGuestPickemDraftStorageKey(pickemId), JSON.stringify(draft));
    return draft;
  } catch {
    return null;
  }
}

export function setGuestPickemPendingImport(pickemId: string, guildCount: number, pendingImport: boolean): GuestPickemDraft | null {
  const draft = readGuestPickemDraft(pickemId, guildCount);
  if (!draft) return null;

  return saveGuestPickemDraft(pickemId, guildCount, draft.predictions, { pendingImport });
}

export function clearGuestPickemDraft(pickemId: string): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.removeItem(getGuestPickemDraftStorageKey(pickemId));
  } catch {
    // A failed cleanup is non-fatal; the server remains authoritative.
  }
}
