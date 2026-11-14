import { queryOptions } from "@tanstack/react-query";
import { foreverApi } from "./forever-api";

export interface NamegameBoard {
  generatedAt: string;
  names: { name: string; category: string; score: number; rank: number }[];
  categories: string[]; total: number; page: number; pageSize: number;
}

export function namegameOptions(filters: { category: string; search: string; sort: string }, page: number) {
  return queryOptions({
    queryKey: ["forever", "namegame", filters, page],
    queryFn: ({ signal }) => foreverApi<NamegameBoard>(`forever/namegame?${new URLSearchParams({ ...filters, page: String(page) })}`, "GET", undefined, signal),
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
}
