"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useCharacterSearch } from "@/lib/queries";
import type { CharacterSearchResult } from "@/types";
import FunAutocomplete from "./FunAutocomplete";

export function characterGuessKey(character: Pick<CharacterSearchResult, "wclCanonicalCharacterId" | "classID">): string | null {
  return typeof character.wclCanonicalCharacterId === "number" ? `wcl:${character.wclCanonicalCharacterId}:${character.classID}` : null;
}

export default function CharacterGuessInput({ onSelect, disabled }: { onSelect: (character: CharacterSearchResult) => void; disabled?: boolean }) {
  const t = useTranslations("fun");
  const [query, setQuery] = useState("");
  const search = useCharacterSearch(query, query.trim().length >= 2, "fun");
  const characters = (search.data?.characters ?? []).filter((character) => characterGuessKey(character) !== null);

  return (
    <FunAutocomplete
      items={characters}
      getKey={(character) => characterGuessKey(character)!}
      getLabel={(character) => `${character.name} — ${character.realm}`}
      getSearchText={(character) => `${character.name} ${character.realm} ${character.matchedName ?? ""}`}
      renderOption={(character) => (
        <div className="flex items-center justify-between gap-3">
          <span className="font-semibold">{character.name}</span>
          <span className="text-xs text-slate-400">{character.realm}</span>
        </div>
      )}
      placeholder={t("common.searchCharacter")}
      emptyLabel={query.trim().length < 2 ? t("common.typeTwoCharacters") : search.isFetching ? t("common.searching") : t("common.noCharacters")}
      disabled={disabled}
      onSelect={onSelect}
      onQueryChange={setQuery}
    />
  );
}
