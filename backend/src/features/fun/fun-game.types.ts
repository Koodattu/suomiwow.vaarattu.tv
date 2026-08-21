import type { IGuildCrest, IRaidSchedule } from "../../models/Guild";

export const FUN_GAME_SLUGS = [
  "immaculate-roster",
  "guild-guessr",
  "wipeprint",
  "raider-resume",
  "raid-connections",
  "lock-it-in",
  "suomidle",
  "higher-or-wipe",
  "closest-without-going-over",
] as const;

export type FunGameSlug = (typeof FUN_GAME_SLUGS)[number];

export type BossMechanicCharacter = {
  id: string;
  name: string;
  realm: string;
  region: string;
  classID: number;
  renderUrl: string;
  renderFit: {
    top: number;
    ground: number;
    centerX: number;
  };
};

export type BossMechanicCharactersResponse = {
  characters: BossMechanicCharacter[];
};

export type FunRaid = {
  id: number;
  name: string;
  expansion: string;
  iconUrl: string | null;
};

export type FunGuild = {
  id: string;
  name: string;
  realm: string;
  faction: string | null;
  crest: IGuildCrest | null;
};

export type FunCharacter = {
  key: string;
  wclCanonicalCharacterId: number;
  characterId: string | null;
  name: string;
  realm: string;
  region: string;
  classID: number;
  avatarUrl: string | null;
};

type FunRoundBase = {
  roundId: string;
  generatedAt: string;
};

export type ImmaculateRosterRound = FunRoundBase & {
  game: "immaculate-roster";
  raid: FunRaid;
  rows: Array<{ id: string; guild: FunGuild }>;
  columns: Array<{ classID: number; name: string; iconUrl: string }>;
  solution: {
    validCharacterKeysByCell: Record<string, string[]>;
    exampleAnswerByCell: Record<string, { key: string; name: string; realm: string }>;
  };
};

export type GuildGuessrRound = FunRoundBase & {
  game: "guild-guessr";
  neighbors: Array<{
    guild: FunGuild;
    sharedCharacters: number;
    sharedRaids: string[];
  }>;
  solution: {
    target: FunGuild & {
      faction: string | null;
      crest: IGuildCrest | null;
      raidSchedule: IRaidSchedule | null;
      trackedRaids: FunRaid[];
      firstSeenAt: string;
      lastSeenAt: string;
    };
  };
};

export type WipeprintBossOption = {
  key: string;
  raidId: number;
  raidName: string;
  expansion: string;
  bossId: number;
  bossName: string;
  bossIconUrl: string | null;
  raidIconUrl: string | null;
  bossIndex: number;
  bossCount: number;
};

export type WipeprintRound = FunRoundBase & {
  game: "wipeprint";
  pulls: Array<{
    pullNumber: number;
    progressPercentage: number | null;
    phase: string | null;
    duration: number | null;
    isKill: boolean;
  }>;
  bossOptions: WipeprintBossOption[];
  solution: {
    boss: WipeprintBossOption;
    sourceGuild: FunGuild;
  };
};

export type RaiderResumeCandidate = {
  key: string;
  name: string;
  realm: string;
  region: string;
  classID: number;
  firstSeenAt: string;
  lastSeenAt: string;
  raidCount: number;
  guildCount: number;
  reportCount: number;
};

export type RaiderResumeRound = FunRoundBase & {
  game: "raider-resume";
  timeline: FunRaid[];
  solution: {
    target: RaiderResumeCandidate & {
      avatarUrl: string | null;
      guilds: Array<{
        name: string;
        realm: string;
        faction: string | null;
        crest: IGuildCrest | null;
        firstSeenAt: string;
        lastSeenAt: string;
        raidNames: string[];
      }>;
    };
  };
};

export type RaidConnectionsRound = FunRoundBase & {
  game: "raid-connections";
  raid: FunRaid;
  tiles: FunCharacter[];
  solution: {
    groups: Array<{
      id: string;
      guild: FunGuild;
      memberKeys: string[];
    }>;
  };
};

export type LockItInRound = FunRoundBase & {
  game: "lock-it-in";
  mode: "pulls" | "kill-order";
  raid: FunRaid;
  boss: { id: number; name: string; iconUrl: string | null };
  revealOrder: FunGuild[];
  solution: {
    ranking: Array<{
      guild: FunGuild;
      pullCount: number;
      killedAt: string | null;
    }>;
  };
};

export type SuomidleCandidate = {
  key: string;
  name: string;
  realm: string;
  classID: number;
  specName: string;
  role: "dps" | "healer" | "tank";
  guildName: string;
  guild: FunGuild;
  raidId: number;
  raidName: string;
  raidExpansion: string;
  raidIconUrl: string | null;
  mythicPlusScore: number;
  achievementCount: number;
  firstSeenAt: string;
};

export type SuomidleRound = FunRoundBase & {
  game: "suomidle";
  solution: { target: SuomidleCandidate };
};

export const FUN_GAME_SEARCH_SLUGS = ["guild-guessr", "raider-resume", "suomidle"] as const;
export type FunGameSearchSlug = (typeof FUN_GAME_SEARCH_SLUGS)[number];
export type FunGameSearchResponse =
  | { game: "guild-guessr"; candidates: FunGuild[] }
  | { game: "raider-resume"; candidates: RaiderResumeCandidate[] }
  | { game: "suomidle"; candidates: SuomidleCandidate[] };

export type HigherOrWipeOption = {
  id: string;
  label: string;
  detail: string;
  value: number;
  classID?: number;
  guild?: FunGuild;
  boss?: { id: number; name: string; iconUrl: string | null };
  raid?: FunRaid;
};

export const HIGHER_OR_WIPE_MODES = ["random", "pulls", "started", "mythic-plus", "achievements"] as const;
export type HigherOrWipeMode = (typeof HIGHER_OR_WIPE_MODES)[number];

export type HigherOrWipeQuestion = {
  id: string;
  kind: "guild-pulls" | "cutting-edge" | "mythic-plus" | "boss-progress-time" | "guild-started";
  unit: "pulls" | "achievements" | "score" | "minutes" | "year";
  left: HigherOrWipeOption;
  right: HigherOrWipeOption;
  correctSide: "left" | "right";
};

export type HigherOrWipeRound = FunRoundBase & {
  game: "higher-or-wipe";
  mode: HigherOrWipeMode;
  questions: HigherOrWipeQuestion[];
};

export type ClosestWithoutGoingOverRound = FunRoundBase & {
  game: "closest-without-going-over";
  challenge: {
    kind: "guild-boss-pulls" | "guild-boss-minutes" | "guild-kill-rank" | "mythic-plus-score";
    unit: "pulls" | "minutes" | "rank" | "score";
    subject: string;
    detail: string;
    raid: FunRaid | null;
    boss: { id: number; name: string; iconUrl: string | null } | null;
    guild: FunGuild | null;
    characterClassID: number | null;
  };
  distribution: { min: number; median: number; max: number; values: number[] };
  solution: { value: number };
};

export type FunGameRound =
  | ImmaculateRosterRound
  | GuildGuessrRound
  | WipeprintRound
  | RaiderResumeRound
  | RaidConnectionsRound
  | LockItInRound
  | SuomidleRound
  | HigherOrWipeRound
  | ClosestWithoutGoingOverRound;

export function isFunGameSlug(value: string): value is FunGameSlug {
  return (FUN_GAME_SLUGS as readonly string[]).includes(value);
}

export function isHigherOrWipeMode(value: string): value is HigherOrWipeMode {
  return (HIGHER_OR_WIPE_MODES as readonly string[]).includes(value);
}

export function isFunGameSearchSlug(value: string): value is FunGameSearchSlug {
  return (FUN_GAME_SEARCH_SLUGS as readonly string[]).includes(value);
}
