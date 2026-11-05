import type { WorldView } from "./figurine-world";

export const OVERLAY_STATIONS = ["recycler", "forge", "merchant", "quests", "wheel", "trading", "mail", "feed", "fame", "leaderboard"] as const;
export type OverlayStation = typeof OVERLAY_STATIONS[number];
export const isOverlayStation = (view: WorldView): view is OverlayStation => (OVERLAY_STATIONS as readonly string[]).includes(view);
