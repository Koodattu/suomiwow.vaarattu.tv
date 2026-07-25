import { CcgMode } from "../config/ccg";
import { applyPackRecharge } from "./ccg-recharge";

type RolloverOwnerType = "user" | "guest";

export type CcgPackRolloverResult = {
  balances: Record<CcgMode, number>;
  lastRechargeAt: Date;
  regularCurrentMoved: number;
  bonusCurrentMoved: number;
};

export function applyCcgPackRollover(
  ownerType: RolloverOwnerType,
  balances: Record<CcgMode, number>,
  creditBalances: Record<CcgMode, number>,
  lastRechargeAt: Date,
  effectiveAt: Date,
  newCurrentPacks: number,
): CcgPackRolloverResult {
  const recharged = effectiveAt.getTime() > lastRechargeAt.getTime()
    ? applyPackRecharge(balances, lastRechargeAt, effectiveAt, creditBalances)
    : { balances, lastRechargeAt };
  const regularCurrentMoved = recharged.balances.current;

  return {
    balances: {
      current: newCurrentPacks,
      legacy: recharged.balances.legacy + (ownerType === "guest" ? regularCurrentMoved : 0),
    },
    lastRechargeAt: recharged.lastRechargeAt,
    regularCurrentMoved,
    bonusCurrentMoved: creditBalances.current,
  };
}
