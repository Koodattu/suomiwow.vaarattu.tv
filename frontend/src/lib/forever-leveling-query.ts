import { queryOptions } from "@tanstack/react-query";
import { foreverApi, type ForeverBoard } from "./forever-api";

export const emptyForeverFilters = { guild: "", race: "", className: "", faction: "", ruleset: "", twitch: "", search: "" };
export type ForeverFilters = typeof emptyForeverFilters;

export function foreverLevelingRefetchInterval(data?: Pick<ForeverBoard, "generatedAt">, now = Date.now()) {
  const generatedAt = Date.parse(data?.generatedAt || "");
  // A revisited/prefetched query may already contain an older server snapshot.
  return Number.isFinite(generatedAt) ? Math.max(1000, Math.min(30_000, generatedAt + 60_000 - now)) : 30_000;
}

export function foreverLevelingOptions(filters: ForeverFilters, page: number) {
  return queryOptions({
    queryKey: ["forever", "leveling", filters, page],
    queryFn: ({ signal }) => foreverApi<ForeverBoard>(`forever/leveling?${new URLSearchParams({ ...filters, page: String(page) })}`, "GET", undefined, signal),
    // Combined with the backend's 30s snapshot, active views stay within about a minute.
    staleTime: 15_000,
    refetchInterval: query => foreverLevelingRefetchInterval(query.state.data),
    refetchOnWindowFocus: true,
  });
}
