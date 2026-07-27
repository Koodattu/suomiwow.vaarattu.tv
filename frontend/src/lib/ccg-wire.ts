import type {
  CcgAdminCardSearchResponse,
  CcgAdminRedeemCode,
  CcgAdminRedeemCodesResponse,
  CcgArtVariant,
  CcgCard,
  CcgCardVariant,
  CcgCatalogResponse,
  CcgCollectionResponse,
  CcgFeaturedCardResponse,
  CcgFinish,
  CcgOpening,
  CcgOverlayEvent,
  CcgRedeemResult,
  CcgSet,
  CcgShare,
} from "@/types";

export type CcgCardWire = Omit<CcgCard, "set" | "variants"> & {
  setId: string;
  variants?: CcgCardVariantWire[];
};

type CcgCardVariantWire = Omit<CcgCardVariant, "card"> & {
  card: CcgCardWire;
};

export type CcgCatalogResponseWire = Omit<CcgCatalogResponse, "cards"> & {
  cards: CcgCardWire[];
};

export type CcgFeaturedCardResponseWire = Omit<CcgFeaturedCardResponse, "card"> & {
  card: CcgCardWire | null;
};

export type CcgCollectionResponseWire = Omit<CcgCollectionResponse, "cards"> & {
  cards: CcgCardWire[];
};

export type CcgOpeningWire = Omit<CcgOpening, "results"> & {
  results: Array<{
    position: number;
    finish: CcgFinish;
    artVariant: CcgArtVariant;
    isDuplicate: boolean;
    card: CcgCardWire;
  }>;
};

export type CcgOverlayEventWire = Omit<CcgOverlayEvent, "card"> & {
  sets: CcgSet[];
  card: CcgCardWire;
};

export type CcgShareWire =
  | (Omit<Extract<CcgShare, { kind: "card" }>, "card"> & {
      sets: CcgSet[];
      card: { card: CcgCardWire; finish: CcgFinish; artVariant: CcgArtVariant };
    })
  | (Omit<Extract<CcgShare, { kind: "pack" }>, "pack"> & { pack: CcgOpeningWire });

export type CcgRedeemResultWire = {
  code: string;
  sets: CcgSet[];
  reward:
    | { type: "packs"; currentPacks: number; legacyPacks: number }
    | { type: "card"; finish: CcgFinish; artVariant: CcgArtVariant; card: CcgCardWire };
};

export type CcgAdminCardSearchResponseWire = Omit<CcgAdminCardSearchResponse, "cards"> & {
  sets: CcgSet[];
  cards: CcgCardWire[];
};

type CcgAdminRedeemCodeWire = Omit<CcgAdminRedeemCode, "reward"> & {
  reward:
    | Extract<CcgAdminRedeemCode["reward"], { type: "packs" }>
    | (Omit<Extract<CcgAdminRedeemCode["reward"], { type: "card" }>, "card"> & {
        card: CcgCardWire | null;
      });
};

export type CcgAdminRedeemCodesResponseWire = {
  sets: CcgSet[];
  codes: CcgAdminRedeemCodeWire[];
};

export type CcgAdminRedeemCodeResponseWire = {
  sets: CcgSet[];
  code: CcgAdminRedeemCodeWire;
};

function getSetMap(sets: CcgSet[]): Map<string, CcgSet> {
  return new Map(sets.map((set) => [set.id, set]));
}

function hydrateCard(card: CcgCardWire, setById: ReadonlyMap<string, CcgSet>): CcgCard {
  const { setId, variants, ...fields } = card;
  const set = setById.get(setId);
  if (!set) throw new Error(`CCG response omitted set ${setId}`);
  return {
    ...fields,
    set,
    ...(variants ? {
      variants: variants.map((variant) => ({
        ...variant,
        card: hydrateCard(variant.card, setById),
      })),
    } : {}),
  };
}

function hydrateCards(cards: CcgCardWire[], sets: CcgSet[]): CcgCard[] {
  const setById = getSetMap(sets);
  return cards.map((card) => hydrateCard(card, setById));
}

export function hydrateCcgCatalog(response: CcgCatalogResponseWire): CcgCatalogResponse {
  return { ...response, cards: hydrateCards(response.cards, response.sets) };
}

export function hydrateCcgFeaturedCard(response: CcgFeaturedCardResponseWire): CcgFeaturedCardResponse {
  const setById = getSetMap(response.sets);
  return { ...response, card: response.card ? hydrateCard(response.card, setById) : null };
}

export function hydrateCcgCollection(response: CcgCollectionResponseWire): CcgCollectionResponse {
  return { ...response, cards: hydrateCards(response.cards, response.sets) };
}

export function hydrateCcgOpening(opening: CcgOpeningWire): CcgOpening {
  const setById = getSetMap(opening.sets);
  return {
    ...opening,
    results: opening.results.map((result) => ({
      ...result,
      card: hydrateCard(result.card, setById),
    })),
  };
}

export function hydrateCcgOverlayEvent(event: CcgOverlayEventWire): CcgOverlayEvent {
  const { sets, card, ...fields } = event;
  return { ...fields, card: hydrateCard(card, getSetMap(sets)) };
}

export function hydrateCcgShare(share: CcgShareWire): CcgShare {
  if (share.kind === "pack") return { ...share, pack: hydrateCcgOpening(share.pack) };
  const setById = getSetMap(share.sets);
  return {
    id: share.id,
    kind: share.kind,
    createdAt: share.createdAt,
    unboxedBy: share.unboxedBy,
    card: { ...share.card, card: hydrateCard(share.card.card, setById) },
  };
}

export function hydrateCcgRedeemResult(response: CcgRedeemResultWire): CcgRedeemResult {
  if (response.reward.type === "packs") return { code: response.code, reward: response.reward };
  const setById = getSetMap(response.sets);
  return {
    code: response.code,
    reward: { ...response.reward, card: hydrateCard(response.reward.card, setById) },
  };
}

export function hydrateCcgAdminCardSearch(response: CcgAdminCardSearchResponseWire): CcgAdminCardSearchResponse {
  return { search: response.search, cards: hydrateCards(response.cards, response.sets) };
}

function hydrateAdminRedeemCode(
  code: CcgAdminRedeemCodeWire,
  setById: ReadonlyMap<string, CcgSet>,
): CcgAdminRedeemCode {
  if (code.reward.type === "packs") return code as CcgAdminRedeemCode;
  return {
    ...code,
    reward: {
      ...code.reward,
      card: code.reward.card ? hydrateCard(code.reward.card, setById) : null,
    },
  };
}

export function hydrateCcgAdminRedeemCodes(response: CcgAdminRedeemCodesResponseWire): CcgAdminRedeemCodesResponse {
  const setById = getSetMap(response.sets);
  return { codes: response.codes.map((code) => hydrateAdminRedeemCode(code, setById)) };
}

export function hydrateCcgAdminRedeemCode(response: CcgAdminRedeemCodeResponseWire): { code: CcgAdminRedeemCode } {
  return { code: hydrateAdminRedeemCode(response.code, getSetMap(response.sets)) };
}
