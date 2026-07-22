import type { CcgCard, CcgFinish } from "@/types";

export const CCG_FINISH_ORDER: readonly CcgFinish[] = ["standard", "foil", "golden", "prismatic", "holographic", "negative"];

export function compareCcgFinish(left: CcgFinish, right: CcgFinish): number {
  return CCG_FINISH_ORDER.indexOf(left) - CCG_FINISH_ORDER.indexOf(right);
}

export function bestOwnedFinish(card: CcgCard): { finish: CcgFinish; quantity: number; total: number } | null {
  if (!card.ownership?.length) return null;
  const row = [...card.ownership].sort((left, right) => compareCcgFinish(right.finish, left.finish))[0];
  return { finish: row.finish, quantity: row.quantity, total: card.ownership.reduce((sum, item) => sum + item.quantity, 0) };
}
