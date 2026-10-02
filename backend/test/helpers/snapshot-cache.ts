import type { TestContext } from "node:test";
import Cache from "../../src/models/Cache";
import CacheRefreshLease from "../../src/models/CacheRefreshLease";
import logger from "../../src/utils/logger";

export interface SnapshotEntry {
  key: string;
  data: unknown;
  cachedAt: Date;
  expiresAt: Date;
  staleExpiresAt: Date;
  ttlMs?: number;
}

/** Model boundary fixture; separate cache instances share storage but not in-flight work. */
export function mockSnapshotStorage(t: TestContext) {
  t.mock.method(logger, "info", () => logger);
  const entries = new Map<string, SnapshotEntry>();
  const leases = new Map<string, { _id: string; owner: string; expiresAt: Date }>();
  type Filter = { key?: string; _id?: string; owner?: string; cachedAt?: { $gt?: Date; $lte?: Date }; expiresAt?: { $gt?: Date; $lte?: Date } };
  const matches = (entry: { cachedAt?: Date; expiresAt: Date; owner?: string }, filter: Filter) =>
    (!filter.owner || filter.owner === entry.owner) &&
    (!filter.cachedAt?.$gt || !!entry.cachedAt && entry.cachedAt > filter.cachedAt.$gt) &&
    (!filter.cachedAt?.$lte || !!entry.cachedAt && entry.cachedAt <= filter.cachedAt.$lte) &&
    (!filter.expiresAt?.$gt || entry.expiresAt > filter.expiresAt.$gt) &&
    (!filter.expiresAt?.$lte || entry.expiresAt <= filter.expiresAt.$lte);

  t.mock.method(Cache, "findOne", ((filter: Filter) => ({ lean: async () => {
    const entry = entries.get(filter.key!);
    return entry && matches(entry, filter) ? structuredClone(entry) : null;
  } })) as typeof Cache.findOne);
  t.mock.method(Cache, "findOneAndUpdate", (async (filter: Filter, update: { $set: SnapshotEntry }) => {
    const entry = { ...entries.get(filter.key!), ...update.$set, key: filter.key! };
    entries.set(entry.key, structuredClone(entry));
    return entry;
  }) as unknown as typeof Cache.findOneAndUpdate);
  t.mock.method(Cache, "updateOne", (async (filter: Filter, update: { $set: Partial<SnapshotEntry> }) => {
    const entry = entries.get(filter.key!);
    if (!entry || !matches(entry, filter)) return { matchedCount: 0 };
    entries.set(entry.key, { ...entry, ...update.$set });
    return { matchedCount: 1 };
  }) as unknown as typeof Cache.updateOne);
  t.mock.method(CacheRefreshLease, "findOneAndUpdate", (async (filter: Filter, update: { $set: { owner: string; expiresAt: Date } }) => {
    const lease = leases.get(filter._id!);
    if (lease && !matches(lease, filter)) throw Object.assign(new Error("duplicate lease"), { code: 11000 });
    const next = { _id: filter._id!, ...update.$set };
    leases.set(next._id, next);
    return next;
  }) as unknown as typeof CacheRefreshLease.findOneAndUpdate);
  t.mock.method(CacheRefreshLease, "exists", (async (filter: Filter) => {
    const lease = leases.get(filter._id!);
    return lease && matches(lease, filter) ? { _id: lease._id } : null;
  }) as unknown as typeof CacheRefreshLease.exists);
  t.mock.method(CacheRefreshLease, "deleteOne", (async (filter: Filter) => {
    const lease = leases.get(filter._id!);
    return { deletedCount: lease && matches(lease, filter) && leases.delete(lease._id) ? 1 : 0 };
  }) as unknown as typeof CacheRefreshLease.deleteOne);
  t.mock.method(CacheRefreshLease, "updateOne", (async (filter: Filter, update: { $set: { expiresAt: Date } }) => {
    const lease = leases.get(filter._id!);
    if (!lease || !matches(lease, filter)) return { matchedCount: 0 };
    leases.set(lease._id, { ...lease, ...update.$set });
    return { matchedCount: 1 };
  }) as unknown as typeof CacheRefreshLease.updateOne);
  return { entries, leases };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
