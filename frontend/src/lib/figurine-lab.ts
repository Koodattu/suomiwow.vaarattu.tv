export type AppearanceItem = {
  id: number;
  slot: { type: string; name: string };
  item_appearance_modifier_id?: number;
  secondary_id?: number;
  secondary_item_appearance_modifier_id?: number;
  enchant?: number;
};

export type CharacterAppearance = {
  character: { id: number; name: string; realm: { slug: string } };
  playable_race: { id: number; name: string };
  playable_class: { id: number; name: string };
  gender: { type: string };
  items: AppearanceItem[];
  customizations: { option: { id: number; name?: string }; choice: { id: number; name?: string } }[];
};

export type LabCharacter = {
  name: string;
  realm: string;
  race: string;
  characterClass: string;
  lastLogin: number | null;
  fetchedAt: string;
  renderUrl: string | null;
  appearance: CharacterAppearance;
  equipment: {
    slot: string;
    slotName: string;
    equippedId: number;
    equippedName: string;
    visibleId: number;
    visibleName: string;
    transmogged: boolean;
    modifier: number | null;
    secondaryId: number | null;
  }[];
};

export function normalizeCharacterQuery(name: string, realm: string) {
  const characterName = name.trim().normalize("NFC").toLowerCase();
  const realmSlug = realm.trim().toLowerCase().replace(/\s+/g, "-");
  if (!/^\p{L}{2,12}$/u.test(characterName) || realmSlug.length > 80 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(realmSlug)) {
    return null;
  }
  return { name: characterName, realm: realmSlug };
}

type EquippedItem = {
  slot: { type: string; name: string };
  item: { id: number };
  name: string;
  transmog?: { item: { id: number; name: string } };
};

export function compareAppearance(items: AppearanceItem[], equippedItems: EquippedItem[]): LabCharacter["equipment"] {
  return equippedItems.map((item) => {
    const visible = items.find((entry) => entry.slot.type === item.slot.type);
    const visibleId = visible?.id ?? item.transmog?.item.id ?? item.item.id;
    return {
      slot: item.slot.type,
      slotName: item.slot.name,
      equippedId: item.item.id,
      equippedName: item.name,
      visibleId,
      visibleName: item.transmog?.item.id === visibleId ? item.transmog.item.name : item.item.id === visibleId ? item.name : String(visibleId),
      transmogged: visibleId !== item.item.id,
      modifier: visible?.item_appearance_modifier_id ?? null,
      secondaryId: visible?.secondary_id ?? null,
    };
  });
}

/** Resolve only files explicitly selected by the user; never fetch a model's remote URLs. */
export function resolveModelResource(url: string, paths: string[]): string | null {
  if (/^(?:data:|blob:)/i.test(url)) return url;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("//")) return null;
  let decoded: string;
  try { decoded = decodeURIComponent(url).replace(/\\/g, "/").replace(/^\.\//, ""); } catch { return null; }
  const exact = paths.filter((path) => path === decoded || path.endsWith(`/${decoded}`));
  if (exact.length === 1) return exact[0];
  const basename = decoded.split("/").pop();
  const matches = paths.filter((path) => path.split("/").pop() === basename);
  return matches.length === 1 ? matches[0] : null;
}
