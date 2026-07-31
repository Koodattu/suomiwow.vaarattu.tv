import type { CcgArtVariant, CcgBaseFinish, CcgCard, CcgCustomFinish, CcgFinish, CcgTierGrade } from "@/types";

export const CCG_BASE_FINISH_ORDER: readonly CcgBaseFinish[] = ["standard", "foil", "golden", "prismatic", "holographic", "negative"];
export const CCG_FINISH_ORDER: readonly CcgFinish[] = ["standard", "foil", "golden", "prismatic", "holographic", "void", "toxic", "negative"];

export const CCG_CLASS_COLORS: Readonly<Record<number, string>> = {
  1: "#C41E3A",
  2: "#FF7C0A",
  3: "#AAD372",
  4: "#3FC7EB",
  5: "#00FF98",
  6: "#F48CBA",
  7: "#FFFFFF",
  8: "#FFF468",
  9: "#0070DD",
  10: "#8788EE",
  11: "#C69B6D",
  12: "#A330C9",
  13: "#33937F",
};

export const CCG_FINISH_COLORS: Readonly<Record<CcgFinish, string>> = {
  standard: "#d8dee9",
  foil: "#7dd3fc",
  golden: "#f4c152",
  prismatic: "#d8b4fe",
  holographic: "#67e8f9",
  void: "#a78bfa",
  toxic: "#86efac",
  negative: "#f9a8d4",
};

export const CCG_RARITY_COLORS: Readonly<Record<CcgTierGrade, string>> = {
  H: "#00ccff",
  S: "#e6cc80",
  A: "#ff8a1f",
  B: "#c36bff",
  C: "#3b9cff",
  D: "#62e968",
  E: "#ffffff",
  F: "#a3a3a3",
};

export const CCG_FINISH_PITY_LIMITS: Readonly<Record<Exclude<CcgFinish, "standard">, number>> = {
  foil: 5,
  golden: 25,
  prismatic: 50,
  holographic: 100,
  void: 250,
  toxic: 250,
  negative: 1000,
};

export function getCcgFinishOrder(customFinish?: CcgCustomFinish | null): readonly CcgFinish[] {
  if (!customFinish) return CCG_BASE_FINISH_ORDER;
  return [...CCG_BASE_FINISH_ORDER.slice(0, -1), customFinish, "negative"];
}

export function getCcgRedeemFinishOrder(setKind: "raid" | "community", customFinish?: CcgCustomFinish | null): readonly CcgFinish[] {
  return setKind === "community" ? CCG_FINISH_ORDER : getCcgFinishOrder(customFinish);
}

export const CCG_RARITY_KEYS: Record<CcgTierGrade, "heirloom" | "artifact" | "legendary" | "epic" | "rare" | "uncommon" | "common" | "poor"> = {
  H: "heirloom",
  S: "artifact",
  A: "legendary",
  B: "epic",
  C: "rare",
  D: "uncommon",
  E: "common",
  F: "poor",
};

const CCG_PULL_RARITY_SCORE: Readonly<Record<CcgTierGrade, number>> = {
  H: 70,
  S: 60,
  A: 50,
  B: 40,
  C: 30,
  D: 20,
  E: 10,
  F: 0,
};

const CCG_PULL_FINISH_SCORE: Readonly<Record<CcgFinish, number>> = {
  standard: 0,
  foil: 15,
  golden: 28,
  prismatic: 43,
  holographic: 62,
  void: 78,
  toxic: 78,
  negative: 100,
};

type CcgPullQuality = {
  finish: CcgFinish;
  artVariant?: CcgArtVariant;
  card: { tierGrade: CcgTierGrade };
};

/**
 * Scores the whole pull instead of treating finish as an absolute trump card.
 * The crossover points intentionally keep Foil Common below Standard Legendary,
 * while Holographic Common remains above Standard Legendary.
 */
export function getCcgPullQualityScore(pull: CcgPullQuality): number {
  return CCG_PULL_RARITY_SCORE[pull.card.tierGrade] + CCG_PULL_FINISH_SCORE[pull.finish];
}

/** Sort comparator with the strongest pull first. */
export function compareCcgPullQuality(left: CcgPullQuality, right: CcgPullQuality): number {
  return getCcgPullQualityScore(right) - getCcgPullQualityScore(left)
    || CCG_PULL_FINISH_SCORE[right.finish] - CCG_PULL_FINISH_SCORE[left.finish]
    || CCG_PULL_RARITY_SCORE[right.card.tierGrade] - CCG_PULL_RARITY_SCORE[left.card.tierGrade]
    || Number(right.artVariant === "alternative") - Number(left.artVariant === "alternative");
}

export function compareCcgFinish(
  left: CcgFinish,
  right: CcgFinish,
  setKind: "raid" | "community",
  customFinish?: CcgCustomFinish | null,
): number {
  const finishOrder = getCcgRedeemFinishOrder(setKind, customFinish);
  return finishOrder.indexOf(left) - finishOrder.indexOf(right);
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
    compareCcgFinish(right.finish, left.finish, card.set.kind, card.set.customFinish?.key)
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
