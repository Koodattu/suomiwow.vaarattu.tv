import { CCG_PACK_RECHARGE_INTERVAL_HOURS, CCG_PACK_STORAGE_CAPS, CCG_TIME_ZONE, CcgMode } from "../config/ccg";

const HOUR_MS = 60 * 60 * 1000;
const helsinkiHourFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: CCG_TIME_ZONE,
  hour: "2-digit",
  hourCycle: "h23",
});

export type CcgRechargeBalances = Record<CcgMode, number>;

export function getRechargeHourStart(date: Date = new Date()): Date {
  return new Date(Math.floor(date.getTime() / HOUR_MS) * HOUR_MS);
}

function isRechargeBoundary(mode: CcgMode, date: Date): boolean {
  if (mode === "legacy") return true;
  return Number(helsinkiHourFormatter.format(date)) % CCG_PACK_RECHARGE_INTERVAL_HOURS.current === 0;
}

export function getRechargeGrants(lastRechargeAt: Date, date: Date = new Date()): CcgRechargeBalances {
  const lastHour = getRechargeHourStart(lastRechargeAt).getTime();
  const currentHour = getRechargeHourStart(date).getTime();
  if (currentHour <= lastHour) return { current: 0, legacy: 0 };

  const elapsedHours = Math.floor((currentHour - lastHour) / HOUR_MS);
  const legacy = Math.min(CCG_PACK_STORAGE_CAPS.legacy, elapsedHours);
  if (elapsedHours > CCG_PACK_STORAGE_CAPS.current * CCG_PACK_RECHARGE_INTERVAL_HOURS.current + 2) {
    return { current: CCG_PACK_STORAGE_CAPS.current, legacy };
  }

  let current = 0;
  for (let hour = 1; hour <= elapsedHours; hour += 1) {
    if (isRechargeBoundary("current", new Date(lastHour + hour * HOUR_MS))) current += 1;
  }
  return { current: Math.min(CCG_PACK_STORAGE_CAPS.current, current), legacy };
}

export function applyPackRecharge(
  balances: CcgRechargeBalances,
  lastRechargeAt: Date,
  date: Date = new Date(),
): { balances: CcgRechargeBalances; lastRechargeAt: Date } {
  const grants = getRechargeGrants(lastRechargeAt, date);
  return {
    balances: {
      current: Math.min(CCG_PACK_STORAGE_CAPS.current, balances.current + grants.current),
      legacy: Math.min(CCG_PACK_STORAGE_CAPS.legacy, balances.legacy + grants.legacy),
    },
    lastRechargeAt: getRechargeHourStart(date),
  };
}

export function getNextPackRechargeAt(mode: CcgMode, date: Date = new Date()): Date {
  const currentHour = getRechargeHourStart(date).getTime();
  for (let offset = 1; offset <= CCG_PACK_RECHARGE_INTERVAL_HOURS.current + 2; offset += 1) {
    const candidate = new Date(currentHour + offset * HOUR_MS);
    if (isRechargeBoundary(mode, candidate)) return candidate;
  }
  throw new Error(`Unable to resolve next ${mode} pack recharge`);
}
