import mongoose from "mongoose";
import CcgCard, { CcgCardAvailabilityStatus } from "../models/CcgCard";
import logger from "../utils/logger";
import cacheService from "./cache.service";

export const CCG_CARD_NOT_FOUND_CONFIRMATION_MS = 24 * 60 * 60 * 1000;
const LEADERBOARD_REFRESH_DEBOUNCE_MS = 5_000;

let leaderboardRefreshTimer: NodeJS.Timeout | null = null;
let leaderboardRefreshNeeded = false;

type AvailabilityEvidence = {
  status?: CcgCardAvailabilityStatus | null;
  firstNotFoundAt?: Date | null;
  lastNotFoundAt?: Date | null;
};

export function resolveCcgCardNotFoundStatus(
  evidence: AvailabilityEvidence,
  observedAt: Date,
): CcgCardAvailabilityStatus {
  if (evidence.status === "archived") return "archived";
  const firstNotFoundAt = evidence.firstNotFoundAt;
  const hasEarlierObservation = Boolean(evidence.lastNotFoundAt);
  return hasEarlierObservation
    && firstNotFoundAt instanceof Date
    && firstNotFoundAt.getTime() <= observedAt.getTime() - CCG_CARD_NOT_FOUND_CONFIRMATION_MS
    ? "archived"
    : "verification_pending";
}

type CardAvailabilityRow = {
  setId: mongoose.Types.ObjectId;
  availabilityStatus?: CcgCardAvailabilityStatus | null;
  availabilityFirstNotFoundAt?: Date | null;
  availabilityLastNotFoundAt?: Date | null;
  availabilityChangedAt?: Date | null;
};

export type CcgCardAvailabilityTransition = {
  characterId: mongoose.Types.ObjectId;
  previousStatus: CcgCardAvailabilityStatus | null;
  status: CcgCardAvailabilityStatus | null;
  cardSnapshots: number;
  setsRebuilt: number;
};

function normalizedStatus(value: CcgCardAvailabilityStatus | null | undefined): CcgCardAvailabilityStatus {
  return value ?? "active";
}

function earliestDate(rows: CardAvailabilityRow[], key: "availabilityFirstNotFoundAt" | "availabilityChangedAt"): Date | null {
  return rows.reduce<Date | null>((earliest, row) => {
    const value = row[key];
    return value && (!earliest || value < earliest) ? value : earliest;
  }, null);
}

function latestDate(rows: CardAvailabilityRow[], key: "availabilityLastNotFoundAt" | "availabilityChangedAt"): Date | null {
  return rows.reduce<Date | null>((latest, row) => {
    const value = row[key];
    return value && (!latest || value > latest) ? value : latest;
  }, null);
}

function combinedStatus(rows: CardAvailabilityRow[]): CcgCardAvailabilityStatus {
  if (rows.some((row) => normalizedStatus(row.availabilityStatus) === "archived")) return "archived";
  if (rows.some((row) => normalizedStatus(row.availabilityStatus) === "verification_pending")) return "verification_pending";
  return "active";
}

async function rebuildSets(setIds: mongoose.Types.ObjectId[]): Promise<void> {
  const { default: ccgPublisherService } = await import("./ccg-publisher.service");
  for (const setId of setIds) await ccgPublisherService.rebuildPool(setId);
}

async function invalidateCcgAvailabilityCaches(): Promise<void> {
  const { default: ccgService } = await import("./ccg.service");
  ccgService.invalidateCardAvailabilityCaches();
  await cacheService.invalidatePattern(/^ccg:/);
}

function scheduleLeaderboardRefresh(): void {
  leaderboardRefreshNeeded = true;
  if (leaderboardRefreshTimer) return;
  leaderboardRefreshTimer = setTimeout(async () => {
    leaderboardRefreshTimer = null;
    if (!leaderboardRefreshNeeded) return;
    leaderboardRefreshNeeded = false;
    try {
      const { default: ccgLeaderboardService } = await import("./ccg-leaderboard.service");
      await ccgLeaderboardService.refresh("full");
    } catch (error) {
      logger.error("[CCG/Availability] Failed to refresh the leaderboard after availability changes:", error);
    } finally {
      if (leaderboardRefreshNeeded) scheduleLeaderboardRefresh();
    }
  }, LEADERBOARD_REFRESH_DEBOUNCE_MS);
  leaderboardRefreshTimer.unref();
}

async function reconcileSets(setIds: mongoose.Types.ObjectId[]): Promise<number> {
  if (setIds.length === 0) return 0;
  await rebuildSets(setIds);
  await invalidateCcgAvailabilityCaches();
  scheduleLeaderboardRefresh();
  return setIds.length;
}

async function restoreDerivedState(setIds: mongoose.Types.ObjectId[], characterId: mongoose.Types.ObjectId): Promise<void> {
  try {
    await rebuildSets(setIds);
    await invalidateCcgAvailabilityCaches();
    scheduleLeaderboardRefresh();
  } catch (error) {
    logger.error(`[CCG/Availability] Failed to restore derived state for ${characterId}:`, error);
  }
}

class CcgCardAvailabilityService {
  private async loadRows(characterId: mongoose.Types.ObjectId): Promise<CardAvailabilityRow[]> {
    return CcgCard.find({ characterId })
      .select("setId availabilityStatus availabilityFirstNotFoundAt availabilityLastNotFoundAt availabilityChangedAt")
      .lean<CardAvailabilityRow[]>();
  }

  async noteNotFound(
    characterId: mongoose.Types.ObjectId,
    observedAt = new Date(),
  ): Promise<CcgCardAvailabilityTransition> {
    const rows = await this.loadRows(characterId);
    if (rows.length === 0) {
      return { characterId, previousStatus: null, status: null, cardSnapshots: 0, setsRebuilt: 0 };
    }
    const previousStatus = combinedStatus(rows);
    const firstNotFoundAt = earliestDate(rows, "availabilityFirstNotFoundAt") ?? observedAt;
    const lastNotFoundAt = latestDate(rows, "availabilityLastNotFoundAt");
    const status = resolveCcgCardNotFoundStatus(
      { status: previousStatus, firstNotFoundAt, lastNotFoundAt },
      observedAt,
    );
    const previousChangedAt = latestDate(rows, "availabilityChangedAt");
    const setIds = [...new Map(rows.map((row) => [String(row.setId), row.setId])).values()];

    const update = {
      availabilityStatus: status,
      availabilityFirstNotFoundAt: firstNotFoundAt,
      availabilityLastNotFoundAt: observedAt,
      availabilityChangedAt: status === previousStatus ? previousChangedAt : observedAt,
    };
    const result = await CcgCard.collection.updateMany({ characterId }, { $set: update });
    let setsRebuilt = 0;
    if (status === "archived" && previousStatus !== "archived") {
      try {
        setsRebuilt = await reconcileSets(setIds);
      } catch (error) {
        await CcgCard.collection.updateMany(
          { characterId },
          {
            $set: {
              availabilityStatus: previousStatus,
              availabilityFirstNotFoundAt: firstNotFoundAt,
              availabilityLastNotFoundAt: lastNotFoundAt ?? null,
              availabilityChangedAt: previousChangedAt ?? null,
            },
          },
        );
        await restoreDerivedState(setIds, characterId);
        throw error;
      }
      logger.info(`[CCG/Availability] Archived ${characterId}; rebuilt ${setsRebuilt} set pool(s)`);
    } else if (status !== previousStatus) {
      await invalidateCcgAvailabilityCaches();
    }
    return { characterId, previousStatus, status, cardSnapshots: result.modifiedCount, setsRebuilt };
  }

  async noteAvailable(
    characterId: mongoose.Types.ObjectId,
    observedAt = new Date(),
  ): Promise<CcgCardAvailabilityTransition> {
    const rows = await this.loadRows(characterId);
    if (rows.length === 0) {
      return { characterId, previousStatus: null, status: null, cardSnapshots: 0, setsRebuilt: 0 };
    }
    const previousStatus = combinedStatus(rows);
    if (previousStatus === "active" && rows.every((row) => !row.availabilityFirstNotFoundAt && !row.availabilityLastNotFoundAt)) {
      return { characterId, previousStatus, status: "active", cardSnapshots: 0, setsRebuilt: 0 };
    }
    const archivedSetIds = [...new Map(
      rows
        .filter((row) => normalizedStatus(row.availabilityStatus) === "archived")
        .map((row) => [String(row.setId), row.setId]),
    ).values()];
    const previousFirstNotFoundAt = earliestDate(rows, "availabilityFirstNotFoundAt");
    const previousLastNotFoundAt = latestDate(rows, "availabilityLastNotFoundAt");
    const previousChangedAt = latestDate(rows, "availabilityChangedAt");
    const result = await CcgCard.collection.updateMany(
      { characterId },
      {
        $set: {
          availabilityStatus: "active",
          availabilityFirstNotFoundAt: null,
          availabilityLastNotFoundAt: null,
          availabilityChangedAt: previousStatus === "active" ? previousChangedAt : observedAt,
        },
      },
    );
    let setsRebuilt = 0;
    if (archivedSetIds.length > 0) {
      try {
        setsRebuilt = await reconcileSets(archivedSetIds);
      } catch (error) {
        await CcgCard.collection.updateMany(
          { characterId },
          {
            $set: {
              availabilityStatus: "archived",
              availabilityFirstNotFoundAt: previousFirstNotFoundAt ?? null,
              availabilityLastNotFoundAt: previousLastNotFoundAt ?? null,
              availabilityChangedAt: previousChangedAt ?? null,
            },
          },
        );
        await restoreDerivedState(archivedSetIds, characterId);
        throw error;
      }
      logger.info(`[CCG/Availability] Reactivated ${characterId}; rebuilt ${setsRebuilt} set pool(s)`);
    } else if (previousStatus !== "active") {
      await invalidateCcgAvailabilityCaches();
    }
    return { characterId, previousStatus, status: "active", cardSnapshots: result.modifiedCount, setsRebuilt };
  }
}

export default new CcgCardAvailabilityService();
