import { AsyncLocalStorage } from "node:async_hooks";
import mongoose, { ClientSession } from "mongoose";
import logger from "../utils/logger";

export const INGESTION_LEASE_MS = 120_000;
export const INGESTION_HEARTBEAT_MS = 30_000;

export interface IngestionLease {
  model: { collection: mongoose.Collection };
  filter: Record<string, unknown>;
  token: string;
  tokenField: string;
  timeField: string;
  expiryField: string;
}

export class IngestionLeaseLostError extends Error {
  constructor() { super("Ingestion lease expired or changed owner; retry the update"); }
}

// Old binaries have no expiry field. Respect their original timeout during rollout.
export function availableLease(tokenField: string, timeField: string, expiryField: string, legacyMs: number) {
  const now = new Date();
  return { $or: [
    { [tokenField]: { $exists: false } },
    { [expiryField]: { $lte: now } },
    { [expiryField]: { $exists: false }, [timeField]: { $lt: new Date(now.getTime() - legacyMs) } },
  ] };
}

interface HeldLease extends IngestionLease {
  timer?: NodeJS.Timeout;
  renewing?: Promise<void>;
  lost: boolean;
}

// Only connection.transaction() uses this setting. Existing explicit-session
// transactions are unchanged. It also covers writes inside ingestion helpers.
mongoose.set("transactionAsyncLocalStorage", true);

export class IngestionLeaseService {
  private held = new Set<HeldLease>();
  private context = new AsyncLocalStorage<HeldLease[]>();
  private writing = new AsyncLocalStorage<boolean>();
  private draining = false;
  private acquiring = 0;

  assertAcceptingWork(): void {
    if (this.draining) throw new Error("Ingestion is shutting down; retry the update");
  }

  async acquiringLease<T>(work: () => Promise<T>): Promise<T> {
    this.assertAcceptingWork();
    this.acquiring++;
    try { return await work(); } finally { this.acquiring--; }
  }

  track(lease: IngestionLease): void {
    const held: HeldLease = { ...lease, lost: false };
    this.held.add(held);
    const schedule = () => {
      held.timer = setTimeout(() => {
        held.renewing = this.touch(held).catch((error) => {
          held.lost = true;
          logger.warn("Ingestion lease renewal failed; further writes are blocked", error);
        }).finally(() => {
          held.renewing = undefined;
          if (this.held.has(held) && !held.lost) schedule();
        });
      }, INGESTION_HEARTBEAT_MS);
      held.timer.unref();
    };
    schedule();
  }

  async run<T>(token: string, work: () => Promise<T>): Promise<T> {
    const leases = [...this.held].filter((lease) => lease.token === token);
    if (!leases.length) throw new IngestionLeaseLostError();
    return this.context.run([...new Set([...(this.context.getStore() || []), ...leases])], work);
  }

  private async touch(lease: HeldLease, session?: ClientSession): Promise<void> {
    if (lease.lost) throw new IngestionLeaseLostError();
    const now = new Date();
    const result = await lease.model.collection.updateOne({
      ...lease.filter, [lease.tokenField]: lease.token, [lease.expiryField]: { $gt: now },
    }, {
      $set: { [lease.timeField]: now, [lease.expiryField]: new Date(now.getTime() + INGESTION_LEASE_MS) },
      // A real write makes takeover conflict with this transaction, even in the
      // same millisecond. Checking ownership with a read would not fence writes.
      $inc: { [`${lease.tokenField}Revision`]: 1 },
    }, { session });
    if (!result.matchedCount) throw new IngestionLeaseLostError();
  }

  async fence(session: ClientSession): Promise<void> {
    for (const lease of this.context.getStore() || []) await this.touch(lease, session);
  }

  async writeFor<T>(token: string, work: () => Promise<T>): Promise<T> {
    return this.run(token, () => this.write(work));
  }

  /** Short database-only unit of work; never put external requests in here. */
  async write<T>(work: () => Promise<T>): Promise<T> {
    if (!this.context.getStore()?.length || this.writing.getStore()) return work();
    return mongoose.connection.transaction(async (session) => {
      await this.fence(session);
      const result = await this.writing.run(true, work);
      await this.fence(session);
      return result;
    });
  }

  async release(token: string): Promise<void> {
    const leases = [...this.held].filter((lease) => lease.token === token);
    let failure: unknown;
    for (const lease of leases) {
      clearTimeout(lease.timer);
      await lease.renewing;
      // Remove only this owner's lock, never a successor's lock or report policy.
      try {
        await lease.model.collection.updateOne({ ...lease.filter, [lease.tokenField]: token }, {
          $unset: { [lease.tokenField]: 1, [lease.timeField]: 1, [lease.expiryField]: 1 },
        });
      } catch (error) {
        failure ??= error;
      } finally {
        this.held.delete(lease);
        clearTimeout(lease.timer);
      }
    }
    if (failure) throw failure;
  }

  beginShutdown(): void { this.draining = true; }

  async drain(timeoutMs = 8_000): Promise<boolean> {
    this.beginShutdown();
    const deadline = Date.now() + timeoutMs;
    while ((this.held.size || this.acquiring) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(50, Math.max(1, deadline - Date.now()))));
    }
    // Timed-out work still owns its lease until process exit/expiry. Do not
    // unlock it while it may still be writing.
    return this.held.size === 0 && this.acquiring === 0;
  }
}

export default new IngestionLeaseService();
