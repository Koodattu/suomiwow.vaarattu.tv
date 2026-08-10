"use client";

import { useEffect, useState } from "react";
import { useFunGameSearch as useFunGameSearchQuery } from "@/lib/queries";
import type { FunGameSearchCandidateByGame, FunGameSearchSlug } from "@/types";

export function useDebouncedSearchQuery(query: string, delay = 180) {
  const trimmedQuery = query.trim().slice(0, 60);
  const [debouncedQuery, setDebouncedQuery] = useState(trimmedQuery);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(trimmedQuery), trimmedQuery.length < 2 ? 0 : delay);
    return () => window.clearTimeout(timer);
  }, [delay, trimmedQuery]);

  return {
    trimmedQuery,
    debouncedQuery,
    isCurrent: trimmedQuery === debouncedQuery,
  };
}

export function useDebouncedFunGameSearch<Game extends FunGameSearchSlug>(game: Game, query: string) {
  const debounce = useDebouncedSearchQuery(query);
  const search = useFunGameSearchQuery(game, debounce.debouncedQuery, debounce.debouncedQuery.length >= 2);
  const candidates: FunGameSearchCandidateByGame[Game][] = debounce.isCurrent ? search.data?.candidates ?? [] : [];

  return {
    ...debounce,
    candidates,
    isSearching: debounce.trimmedQuery.length >= 2 && (!debounce.isCurrent || search.isFetching),
    isError: debounce.isCurrent && search.isError,
  };
}
