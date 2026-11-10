import { createRealmIdentityKey } from "./realm";

/** Source recordings are retained; consumers count groups of physical pulls. */
export interface PullIdentity {
  reportCode: string;
  fightId: number;
  guildId?: unknown;
  zoneId?: number;
  encounterID?: number;
  difficulty?: number;
  timestamp?: Date | string;
  reportStartTime?: number;
  fightStartTime?: number;
  duration: number;
  isKill: boolean;
  bossPercentage?: number;
  combatantInfoRosterComplete?: boolean;
  combatants?: { name: string; server: string }[];
  deathEventsFetchStatus?: string;
}

export const PULL_IDENTITY_PROJECTION = "reportCode fightId guildId zoneId encounterID difficulty timestamp reportStartTime fightStartTime duration isKill bossPercentage combatantInfoRosterComplete combatants";
const MAX_CLOCK_SKEW_MS = 10_000;

export function pullStartTime(pull: PullIdentity): number {
  if (pull.timestamp !== undefined) return new Date(pull.timestamp).getTime();
  if (!Number.isFinite(pull.reportStartTime) || !Number.isFinite(pull.fightStartTime) || pull.reportStartTime! < 0 || pull.fightStartTime! < 0) return NaN;
  return pull.reportStartTime! + pull.fightStartTime!;
}

function scope(pull: PullIdentity): string {
  return JSON.stringify([String(pull.guildId ?? ""), pull.zoneId, pull.encounterID, pull.difficulty]);
}

function completeRoster(pull: PullIdentity): Set<string> | null {
  if (!pull.combatantInfoRosterComplete || !pull.combatants?.length) return null;
  const identities = new Set<string>();
  for (const player of pull.combatants) {
    const name = player.name?.normalize("NFKC").trim().toLowerCase();
    const realm = player.server && createRealmIdentityKey(player.server);
    if (!name || !realm) return null;
    identities.add(`${name}:${realm}`);
  }
  return identities.size === pull.combatants.length ? identities : null;
}

export function isSamePull(a: PullIdentity, b: PullIdentity): boolean {
  if (scope(a) !== scope(b)) return false;
  if (a.reportCode === b.reportCode) return false;
  if (!a.encounterID || a.isKill !== b.isKill) return false;
  const startA = pullStartTime(a), startB = pullStartTime(b);
  if (![startA, startB, a.duration, b.duration].every(value => Number.isFinite(value) && value >= 0)) return false;
  const shorterDuration = Math.min(a.duration, b.duration);
  const startDelta = Math.abs(startA - startB);
  const durationDelta = Math.abs(a.duration - b.duration);
  if (shorterDuration <= 0 || startDelta > Math.min(MAX_CLOCK_SKEW_MS, shorterDuration / 3)) return false;

  const rosterA = completeRoster(a), rosterB = completeRoster(b);
  const sameRoster = rosterA !== null && rosterB !== null && rosterA.size === rosterB.size && [...rosterA].every(player => rosterB.has(player));
  if (a.combatantInfoRosterComplete && b.combatantInfoRosterComplete && !sameRoster) return false;
  if (Number.isFinite(a.bossPercentage) && Number.isFinite(b.bossPercentage) && a.bossPercentage !== b.bossPercentage) return false;

  // Historical/incomplete recordings retain the narrow timing-only fallback.
  if (startDelta <= 1000 && durationDelta <= 1000) return true;
  const sameHealth = a.bossPercentage !== undefined && Number.isFinite(a.bossPercentage) &&
    a.bossPercentage >= 0 && a.bossPercentage <= 100 && (a.isKill || a.bossPercentage > 0) && a.bossPercentage === b.bossPercentage;
  return sameRoster && sameHealth && durationDelta <= Math.min(5000, shorterDuration * 0.01);
}

/** Prefer usable detail without mixing events from different recorder clocks. */
export function comparePullDetails(a: PullIdentity, b: PullIdentity): number {
  return Number(b.deathEventsFetchStatus === "fetched") - Number(a.deathEventsFetchStatus === "fetched") ||
    Number(b.combatantInfoRosterComplete === true) - Number(a.combatantInfoRosterComplete === true) ||
    (b.combatants?.length ?? 0) - (a.combatants?.length ?? 0) || comparePullTime(a, b);
}

function comparePullTime(a: PullIdentity, b: PullIdentity): number {
  const time = (pull: PullIdentity) => Number.isFinite(pullStartTime(pull)) ? pullStartTime(pull) : Infinity;
  return time(a) - time(b) || a.reportCode.localeCompare(b.reportCode) || a.fightId - b.fightId;
}

// Every copy must agree with every other copy (no transitive merges).
// If multiple groups fit, retain the ambiguous recording rather than guessing.
class PullGroups<T extends PullIdentity> {
  private pending: T[][] = [];
  private active = new Map<string, T[][]>();
  private previousTime = -Infinity;

  add(fight: T): T[][] {
    const time = pullStartTime(fight);
    if (!Number.isFinite(time)) return [[fight]];
    if (time < this.previousTime) throw new Error("Pull grouping requires chronological input");
    this.previousTime = time;
    const ready: T[][] = [];
    while (this.pending.length && time - pullStartTime(this.pending[0][0]) > MAX_CLOCK_SKEW_MS) {
      const group = this.pending.shift()!;
      const key = scope(group[0]);
      const active = this.active.get(key)!;
      active.splice(active.indexOf(group), 1);
      if (!active.length) this.active.delete(key);
      ready.push(group);
    }
    const key = scope(fight);
    const active = this.active.get(key) ?? [];
    const matches = active.filter(group => group.every(member =>
      (member.reportCode === fight.reportCode && member.fightId === fight.fightId) || isSamePull(member, fight)));
    if (matches.length === 1) matches[0].push(fight);
    else {
      const next = [fight];
      this.pending.push(next);
      active.push(next);
      this.active.set(key, active);
    }
    return ready;
  }

  finish(): T[][] { return this.pending; }
}

export function groupPulls<T extends PullIdentity>(fights: readonly T[]): T[][] {
  const groups = new PullGroups<T>();
  const result = [...fights].sort(comparePullTime).flatMap(fight => groups.add(fight));
  return [...result, ...groups.finish()].sort((a, b) => comparePullTime(a[0], b[0]));
}

/** Bounded 10-second window; duplicates can span cursor/consumer batch boundaries. */
export async function* groupSortedPulls<T extends PullIdentity>(fights: AsyncIterable<T>): AsyncGenerator<T[]> {
  const groups = new PullGroups<T>();
  for await (const fight of fights) yield* groups.add(fight);
  yield* groups.finish();
}
