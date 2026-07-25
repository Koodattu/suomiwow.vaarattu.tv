import type { CcgArtVariant, CcgCard, CcgFinish, CcgTierGrade } from "@/types";

export const CCG_FINISH_ORDER: readonly CcgFinish[] = ["standard", "foil", "golden", "prismatic", "holographic", "negative"];

export const CCG_FINISH_PITY_LIMITS: Readonly<Record<Exclude<CcgFinish, "standard">, number>> = {
  foil: 5,
  golden: 25,
  prismatic: 50,
  holographic: 100,
  negative: 1000,
};

export const CCG_RARITY_KEYS: Record<CcgTierGrade, "artifact" | "legendary" | "epic" | "rare" | "uncommon" | "common" | "poor"> = {
  S: "artifact",
  A: "legendary",
  B: "epic",
  C: "rare",
  D: "uncommon",
  E: "common",
  F: "poor",
};

export function compareCcgFinish(left: CcgFinish, right: CcgFinish): number {
  return CCG_FINISH_ORDER.indexOf(left) - CCG_FINISH_ORDER.indexOf(right);
}

export function hasAlternativeArtwork(card: CcgCard | null): boolean {
  if (!card?.alternativeArt) return false;
  return card.alternativeArt.characterArtEnabled
    || (card.set.kind === "community" && card.alternativeArt.backgroundArtEnabled);
}

export function bestOwnedFinish(
  card: CcgCard,
  artVariant?: CcgArtVariant,
): { finish: CcgFinish; artVariant: CcgArtVariant; quantity: number; total: number } | null {
  const ownership = card.ownership?.filter((row) => !artVariant || row.artVariant === artVariant) ?? [];
  if (ownership.length === 0) return null;
  const row = [...ownership].sort((left, right) => (
    compareCcgFinish(right.finish, left.finish)
    || Number(right.artVariant === "alternative") - Number(left.artVariant === "alternative")
  ))[0];
  const quantityByFinish = (card.ownership ?? []).reduce((quantities, item) => {
    quantities.set(item.finish, Math.max(quantities.get(item.finish) ?? 0, item.quantity));
    return quantities;
  }, new Map<CcgFinish, number>());
  return {
    finish: row.finish,
    artVariant: row.artVariant,
    quantity: row.quantity,
    total: card.totalQuantity ?? Array.from(quantityByFinish.values()).reduce((sum, quantity) => sum + quantity, 0),
  };
}
