import { CCG_PACK_RECHARGE_INTERVAL_MINUTES, CCG_PACK_STORAGE_CAP } from "../config/ccg";

const RECHARGE_TICK_MS = CCG_PACK_RECHARGE_INTERVAL_MINUTES * 60 * 1000;

export function getRechargeTickStart(date: Date = new Date()): Date {
  return new Date(Math.floor(date.getTime() / RECHARGE_TICK_MS) * RECHARGE_TICK_MS);
}

export function getRechargeGrants(lastRechargeAt: Date, date: Date = new Date()): number {
  const lastTick = getRechargeTickStart(lastRechargeAt).getTime();
  const currentTick = getRechargeTickStart(date).getTime();
  if (currentTick <= lastTick) return 0;
  return Math.min(CCG_PACK_STORAGE_CAP, Math.floor((currentTick - lastTick) / RECHARGE_TICK_MS));
}

export function applyPackRecharge(
  balance: number,
  lastRechargeAt: Date,
  date: Date = new Date(),
  additionalBalance = 0,
): { balance: number; lastRechargeAt: Date } {
  const grants = getRechargeGrants(lastRechargeAt, date);
  const availableCapacity = Math.max(0, CCG_PACK_STORAGE_CAP - balance - additionalBalance);
  return {
    balance: balance + Math.min(grants, availableCapacity),
    lastRechargeAt: getRechargeTickStart(date),
  };
}

export function getNextPackRechargeAt(date: Date = new Date()): Date {
  return new Date((Math.floor(date.getTime() / RECHARGE_TICK_MS) + 1) * RECHARGE_TICK_MS);
}
