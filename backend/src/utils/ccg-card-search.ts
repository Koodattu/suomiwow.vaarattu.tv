import mongoose from "mongoose";
import { resolveCollectorKey } from "./ccg-identity";
import { normalizeSearchText } from "./search";

export type CcgCardSearchSource = {
  _id: mongoose.Types.ObjectId;
  characterId: mongoose.Types.ObjectId;
  collectorKey?: string | null;
  name: string;
  realm: string;
  classID: number;
  guildName?: string | null;
  publishedAt: Date;
};

export type CcgCardSearchCandidate = {
  collectorKey: string;
  cardIds: mongoose.Types.ObjectId[];
  characterId: mongoose.Types.ObjectId;
  name: string;
  realm: string;
  classID: number;
  publishedAt: Date;
  searchText: string[];
  characterSearchText: string[];
};

export function buildCcgCardSearchCandidates(
  cards: ReadonlyArray<CcgCardSearchSource>,
  currentNameByCharacterId: ReadonlyMap<string, string>,
): CcgCardSearchCandidate[] {
  const candidatesByCharacter = new Map<string, Omit<CcgCardSearchCandidate, "searchText" | "characterSearchText"> & {
    searchText: Set<string>;
    characterSearchText: Set<string>;
  }>();
  for (const card of cards) {
    const collectorKey = resolveCollectorKey(card);
    const currentName = currentNameByCharacterId.get(String(card.characterId));
    const searchText = [
      card.name,
      `${card.name} ${card.realm}`,
      card.guildName ?? "",
      card.guildName ? `${card.name} ${card.guildName}` : "",
      currentName ?? "",
      currentName ? `${currentName} ${card.realm}` : "",
      currentName && card.guildName ? `${currentName} ${card.guildName}` : "",
    ].map(normalizeSearchText).filter(Boolean);
    const characterSearchText = [
      card.name,
      `${card.name} ${card.realm}`,
      currentName ?? "",
      currentName ? `${currentName} ${card.realm}` : "",
    ].map(normalizeSearchText).filter(Boolean);
    const existing = candidatesByCharacter.get(collectorKey);
    if (!existing) {
      candidatesByCharacter.set(collectorKey, {
        collectorKey,
        cardIds: [card._id],
        characterId: card.characterId,
        name: currentName ?? card.name,
        realm: card.realm,
        classID: card.classID,
        publishedAt: card.publishedAt,
        searchText: new Set(searchText),
        characterSearchText: new Set(characterSearchText),
      });
      continue;
    }

    existing.cardIds.push(card._id);
    searchText.forEach((value) => existing.searchText.add(value));
    characterSearchText.forEach((value) => existing.characterSearchText.add(value));
    if (card.publishedAt.getTime() > existing.publishedAt.getTime()) {
      existing.characterId = card.characterId;
      existing.name = currentName ?? card.name;
      existing.realm = card.realm;
      existing.classID = card.classID;
      existing.publishedAt = card.publishedAt;
    }
  }
  return Array.from(candidatesByCharacter.values(), (candidate) => ({
    ...candidate,
    searchText: Array.from(candidate.searchText),
    characterSearchText: Array.from(candidate.characterSearchText),
  }));
}
