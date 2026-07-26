import { CCG_PACK_RECHARGE_INTERVAL_HOURS, CCG_PACK_STORAGE_CAPS, CcgMode } from "../config/ccg";

const HOUR_MS = 60 * 60 * 1000;
const RECHARGE_TICK_MS = 30 * 60 * 1000;

export type CcgRechargeBalances = Record<CcgMode, number>;

export function getRechargeTickStart(date: Date = new Date()): Date {
  return new Date(Math.floor(date.getTime() / RECHARGE_TICK_MS) * RECHARGE_TICK_MS);
}

function countRechargeBoundaries(mode: CcgMode, lastTick: number, currentTick: number): number {
  const intervalMs = CCG_PACK_RECHARGE_INTERVAL_HOURS[mode] * HOUR_MS;
  return Math.floor(currentTick / intervalMs) - Math.floor(lastTick / intervalMs);
}

export function getRechargeGrants(lastRechargeAt: Date, date: Date = new Date()): CcgRechargeBalances {
  const lastTick = getRechargeTickStart(lastRechargeAt).getTime();
  const currentTick = getRechargeTickStart(date).getTime();
  if (currentTick <= lastTick) return { current: 0, legacy: 0 };

  return {
    current: Math.min(CCG_PACK_STORAGE_CAPS.current, countRechargeBoundaries("current", lastTick, currentTick)),
    legacy: Math.min(CCG_PACK_STORAGE_CAPS.legacy, countRechargeBoundaries("legacy", lastTick, currentTick)),
  };
}

export function applyPackRecharge(
  balances: CcgRechargeBalances,
  lastRechargeAt: Date,
  date: Date = new Date(),
  additionalBalances: CcgRechargeBalances = { current: 0, legacy: 0 },
): { balances: CcgRechargeBalances; lastRechargeAt: Date } {
  const grants = getRechargeGrants(lastRechargeAt, date);
  const rechargeBalance = (mode: CcgMode): number => {
    const availableCapacity = Math.max(0, CCG_PACK_STORAGE_CAPS[mode] - balances[mode] - additionalBalances[mode]);
    return balances[mode] + Math.min(grants[mode], availableCapacity);
  };
  return {
    balances: {
      current: rechargeBalance("current"),
      legacy: rechargeBalance("legacy"),
    },
    lastRechargeAt: getRechargeTickStart(date),
  };
}

export function getNextPackRechargeAt(mode: CcgMode, date: Date = new Date()): Date {
  const intervalMs = CCG_PACK_RECHARGE_INTERVAL_HOURS[mode] * HOUR_MS;
  return new Date((Math.floor(date.getTime() / intervalMs) + 1) * intervalMs);
}
