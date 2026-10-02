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
}
export function isSameMechanicPull(a: PullIdentity, b: PullIdentity): boolean {
  return a.encounterID === b.encounterID && a.isKill === b.isKill &&
    Math.abs((a.reportStartTime + a.fightStartTime) - (b.reportStartTime + b.fightStartTime)) <= 1000 &&
    Math.abs(a.duration - b.duration) <= 1000;
}

export class MechanicCollectionPaused extends Error {}
