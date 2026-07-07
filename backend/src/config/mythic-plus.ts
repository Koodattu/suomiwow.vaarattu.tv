export const RAIDER_IO_MYTHIC_PLUS_EXPANSION_IDS = [11, 10, 9, 8, 7, 6];

// Main seasonal slugs we want to expose by default. Raider.IO static data is
// still the source of truth, but this list keeps cutoff/event seasons out of
// public views unless we explicitly opt into them later.
export const RAIDER_IO_MAIN_MYTHIC_PLUS_SEASON_SLUGS = [
  "season-mn-1",
  "season-tww-3",
  "season-tww-2",
  "season-tww-1",
  "season-df-4",
  "season-df-3",
  "season-df-2",
  "season-df-1",
  "season-sl-4",
  "season-sl-3",
  "season-sl-2",
  "season-sl-1",
  "season-bfa-4",
  "season-bfa-3",
  "season-bfa-2",
  "season-bfa-1",
  "season-7.3.2",
  "season-7.3.0",
  "season-7.2.5",
  "season-7.2.0",
] as const;

export const RAIDER_IO_MAIN_MYTHIC_PLUS_SEASON_SET = new Set<string>(RAIDER_IO_MAIN_MYTHIC_PLUS_SEASON_SLUGS);

export type MythicPlusScoreBucket = "all" | "dps" | "healer" | "tank" | "spec_0" | "spec_1" | "spec_2" | "spec_3";

export const MYTHIC_PLUS_SCORE_BUCKETS: MythicPlusScoreBucket[] = ["all", "dps", "healer", "tank", "spec_0", "spec_1", "spec_2", "spec_3"];

export const MYTHIC_PLUS_ROLE_BUCKETS = new Set<MythicPlusScoreBucket>(["dps", "healer", "tank"]);
