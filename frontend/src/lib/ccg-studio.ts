import type { StudioCreation, StudioState } from "../types/ccg-studio";

export type StudioSlot = {
  id: string;
  unlock: "follower" | "subscriber" | null;
  creation: StudioCreation | null;
  used: boolean;
};

// Draft placement is provisional. Only the server's publication allowance spends slots.
export function getStudioSlots(data: StudioState, placements: Record<string, string> = {}) {
  const slots: StudioSlot[] = [
    ...Array.from({ length: data.entitlements.base }, (_, index) => ({ id: `base:${index}`, unlock: null })),
    { id: "follower", unlock: data.entitlements.follower ? null : "follower" as const },
    ...Array.from({ length: 3 }, (_, index) => ({ id: `subscriber:${index}`, unlock: data.entitlements.subscriber ? null : "subscriber" as const })),
  ].map((slot) => ({ ...slot, creation: null, used: false }));
  const extra = Math.max(0, data.allowance.earned - slots.filter((slot) => !slot.unlock).length);
  for (let index = 0; index < extra; index++) slots.push({ id: `earned:${index}`, unlock: null, creation: null, used: false });

  const published = data.creations.filter((source) => source.cardId).sort((a, b) => a.id.localeCompare(b.id));
  const drafts = data.creations.filter((source) => !source.cardId).sort((a, b) => a.id.localeCompare(b.id));
  for (const sources of [published, drafts]) {
    // Honor existing placements before filling holes, so selecting a later empty slot stays put.
    for (const source of sources) {
      const slot = slots.find((entry) => entry.id === placements[source.id] && !entry.unlock && !entry.creation && !entry.used);
      if (slot) { slot.creation = source; slot.used = Boolean(source.cardId); }
    }
    for (const source of sources) {
      if (slots.some((slot) => slot.creation?.id === source.id)) continue;
      const slot = slots.find((entry) => !entry.unlock && !entry.creation && !entry.used);
      if (slot) { slot.creation = source; slot.used = Boolean(source.cardId); }
    }
    if (sources === published) {
      let unrepresented = Math.max(0, data.allowance.used - published.length);
      for (const slot of slots) {
        if (unrepresented && !slot.unlock && !slot.creation) { slot.used = true; unrepresented--; }
      }
    }
  }
  return slots.sort((a, b) => Number(Boolean(a.unlock)) - Number(Boolean(b.unlock)));
}

export function getStudioRaidCards(characters: StudioState["characters"]) {
  return [...new Map(characters.flatMap((character) => character.cards)
    .filter((card) => card.set.kind === "raid")
    .map((card) => [card.id, card])).values()];
}
