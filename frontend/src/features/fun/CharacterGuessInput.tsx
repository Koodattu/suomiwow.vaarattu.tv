"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useCharacterSearch } from "@/lib/queries";
import type { CharacterSearchResult } from "@/types";
import FunAutocomplete from "./FunAutocomplete";
import FunCharacterIdentity from "./FunCharacterIdentity";
import { useDebouncedSearchQuery } from "./useFunGameSearch";

export function characterGuessKey(character: Pick<CharacterSearchResult, "wclCanonicalCharacterId" | "classID">): string | null {
  return typeof character.wclCanonicalCharacterId === "number" ? `wcl:${character.wclCanonicalCharacterId}:${character.classID}` : null;
}

export default function CharacterGuessInput({
  onSelect,
  disabled,
  autoFocus,
  immediate,
  cell,
  showClassIcon = true,
}: {
  onSelect: (character: CharacterSearchResult) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  immediate?: boolean;
  cell?: boolean;
  showClassIcon?: boolean;
}) {
  const t = useTranslations("fun");
  const [query, setQuery] = useState("");
  const debounce = useDebouncedSearchQuery(query);
  const search = useCharacterSearch(debounce.debouncedQuery, debounce.debouncedQuery.length >= 2, "fun");
  const isSearching = debounce.trimmedQuery.length >= 2 && (!debounce.isCurrent || search.isFetching);
  const characters = (debounce.isCurrent ? search.data?.characters ?? [] : []).filter((character) => characterGuessKey(character) !== null);

  return (
    <FunAutocomplete
      items={characters}
      getKey={(character) => characterGuessKey(character)!}
      getLabel={(character) => `${character.name} — ${character.realm}`}
      getSearchText={(character) => `${character.name} ${character.realm} ${character.matchedName ?? ""}`}
      renderOption={(character) => showClassIcon ? (
        <FunCharacterIdentity character={character} iconSize={30} />
      ) : (
        <span className="block min-w-0 text-left"><span className="block truncate font-bold">{character.name}</span><span className="block truncate text-xs text-slate-400">{character.realm}</span></span>
      )}
      placeholder={t("common.searchCharacter")}
      emptyLabel={debounce.trimmedQuery.length < 2 ? t("common.typeTwoCharacters") : isSearching ? t("common.searching") : search.isError ? t("common.searchFailed") : t("common.noCharacters")}
      disabled={disabled}
      loading={isSearching}
      filterItems={false}
      autoFocus={autoFocus}
      immediate={immediate}
      cell={cell}
      onSelect={onSelect}
      onQueryChange={setQuery}
    />
  );
}
