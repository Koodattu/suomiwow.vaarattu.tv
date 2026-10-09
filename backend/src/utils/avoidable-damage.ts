import { createRealmIdentityKey } from "./realm";
import { CLASSES } from "../config/classes";

export interface MechanicActor { id: number; name: string; server?: string; subType?: string }
export interface MechanicFight { id: number; encounterID: number; difficulty: number; friendlyPlayers: number[] | null }
export interface MechanicDamageEvent {
  type: string;
  fight: number;
  targetID: number;
  abilityGameID: number;
  amount?: number;
  absorbed?: number;
  overkill?: number;
  hitType?: number;
  tick?: boolean;
}
export interface DamageTotals { damage: number; hits: number; directHits: number; ticks: number }
export const emptyDamageTotals = (): DamageTotals => ({ damage: 0, hits: 0, directHits: 0, ticks: 0 });

export function addMechanicDamage(totals: DamageTotals, event: MechanicDamageEvent): void {
  if (event.type !== "damage" || event.hitType === 0 || event.hitType === 10) return;
  const positive = (value: number | undefined) => typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
  const damage = positive(event.amount) + positive(event.absorbed) + positive(event.overkill);
  // Misses/immune events are not hits. Fully absorbed and blocked landed hits are.
  if (!damage && ![1, 2, 3, 4, 5, 6].includes(event.hitType ?? -1)) return;
  totals.damage += damage;
  totals.hits++;
  if (event.tick) totals.ticks++;
  else totals.directHits++;
}

// Report appearances and the UI use WCL class IDs, not Blizzard class IDs.
export const mechanicClassId = (actor: MechanicActor) => CLASSES.find((entry) => entry.name.replace(/\s/g, "") === (actor.subType ?? "").replace(/\s/g, ""))?.id ?? 0;
export function mechanicIdentity(name: string, realm: string, region: string, classId: number): string {
  return `${region.toLowerCase()}:${createRealmIdentityKey(realm)}:${name.normalize("NFKC").toLowerCase()}:${classId}`;
}

export interface PullIdentity {
  reportCode: string;
  fightId: number;
  encounterID: number;
  reportStartTime: number;
  fightStartTime: number;
  duration: number;
  isKill: boolean;
  bossPercentage?: number;
  combatantInfoRosterComplete?: boolean;
  combatants?: { name: string; server: string }[];
}

function completeMythicRoster(pull: PullIdentity): Set<string> | null {
  if (!pull.combatantInfoRosterComplete || pull.combatants?.length !== 20) return null;
  const identities = new Set<string>();
  for (const player of pull.combatants) {
    const name = player.name?.normalize("NFKC").trim().toLowerCase();
    const realm = player.server && createRealmIdentityKey(player.server);
    if (!name || !realm) return null;
    identities.add(`${name}:${realm}`);
  }
  return identities.size === 20 ? identities : null;
}

export function isSameMechanicPull(a: PullIdentity, b: PullIdentity): boolean {
  if (a.reportCode === b.reportCode || a.encounterID !== b.encounterID || a.isKill !== b.isKill) return false;
  if (![a.reportStartTime, b.reportStartTime, a.fightStartTime, b.fightStartTime, a.duration, b.duration]
    .every((value) => Number.isFinite(value) && value >= 0)) return false;
  const shorterDuration = Math.min(a.duration, b.duration);
  const startDelta = Math.abs((a.reportStartTime + a.fightStartTime) - (b.reportStartTime + b.fightStartTime));
  const durationDelta = Math.abs(a.duration - b.duration);
  // Require substantial overlap, including for short wipes followed by a quick reset.
  if (shorterDuration <= 0 || startDelta > Math.min(10_000, shorterDuration / 3)) return false;

  const rosterA = completeMythicRoster(a);
  const rosterB = completeMythicRoster(b);
  const sameRoster = rosterA !== null && rosterB !== null && [...rosterA].every((player) => rosterB.has(player));
  if (a.combatantInfoRosterComplete && b.combatantInfoRosterComplete && !sameRoster) return false;
  if (Number.isFinite(a.bossPercentage) && Number.isFinite(b.bossPercentage) && a.bossPercentage !== b.bossPercentage) return false;

  // Preserve the original narrow match for historical fights without roster metadata.
  if (startDelta <= 1000 && durationDelta <= 1000) return true;
  // Wider clock skew needs independent evidence, not merely a larger time tolerance.
  // Zero health on a wipe can be a missing/default value, so it is not evidence.
  const sameHealth = a.bossPercentage !== undefined && Number.isFinite(a.bossPercentage) &&
    a.bossPercentage >= 0 && a.bossPercentage <= 100 && (a.isKill || a.bossPercentage > 0) && a.bossPercentage === b.bossPercentage;
  return sameRoster && sameHealth && durationDelta <= Math.min(5000, shorterDuration * 0.01);
}

/** Keep ambiguous/interleaved matches separate; every member must match every other member. */
export function groupMechanicPulls<T extends PullIdentity>(fights: readonly T[]): T[][] {
  const sorted = [...fights].sort((a, b) =>
    (a.reportStartTime + a.fightStartTime) - (b.reportStartTime + b.fightStartTime) ||
    a.reportCode.localeCompare(b.reportCode) || a.fightId - b.fightId);
  const groups: T[][] = [];
  for (const fight of sorted) {
    const group = groups[groups.length - 1];
    if (group && group.every((member) => isSameMechanicPull(member, fight))) group.push(fight);
    else groups.push([fight]);
  }
  return groups;
}

export class MechanicCollectionPaused extends Error {}
