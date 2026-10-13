import mongoose from "mongoose";
import Guild from "../models/Guild";
import ingestionLeases, { availableLease, INGESTION_LEASE_MS } from "./ingestion-lease.service";

export const availableGuildUpdate = () => availableLease("wclUpdateLockToken", "wclUpdateStartedAt", "wclUpdateLeaseExpiresAt", 60 * 60 * 1000);
export const availableGuildMigration = () => availableLease("logSourceMigrationLockToken", "logSourceMigrationLockedAt", "logSourceMigrationLeaseExpiresAt", 2 * 60 * 60 * 1000);

export function isGuildLeaseActive(token: string | undefined, startedAt: Date | undefined, expiresAt: Date | undefined, legacyMs: number): boolean {
  return Boolean(token && (expiresAt ? expiresAt.getTime() > Date.now() : !startedAt || startedAt.getTime() >= Date.now() - legacyMs));
}

export async function acquireGuildIngestionLease(guildId: string, token: string, migration = false) {
  return ingestionLeases.acquiringLease(async () => {
    const tokenField = migration ? "logSourceMigrationLockToken" : "wclUpdateLockToken";
    const timeField = migration ? "logSourceMigrationLockedAt" : "wclUpdateStartedAt";
    const expiryField = migration ? "logSourceMigrationLeaseExpiresAt" : "wclUpdateLeaseExpiresAt";
    const guild = await Guild.findOneAndUpdate({
      _id: guildId, $and: [availableGuildUpdate(), availableGuildMigration()],
    }, { $set: {
      [tokenField]: token, [timeField]: new Date(), [expiryField]: new Date(Date.now() + INGESTION_LEASE_MS),
    } }, { returnDocument: "after" });
    if (guild) {
      ingestionLeases.track({ model: Guild, filter: { _id: new mongoose.Types.ObjectId(guildId) }, token, tokenField, timeField, expiryField });
    }
    return guild;
  });
}
