export type CcgMode = "current" | "legacy";
export type CcgFinish = "standard" | "foil" | "golden" | "prismatic" | "holographic" | "negative";
export type CcgArtVariant = "standard" | "alternative";
export type CcgTierGrade = "S" | "A" | "B" | "C" | "D" | "E" | "F";
export type CcgSetState = "draft" | "current" | "legacy" | "locked";
export type CcgSetKind = "raid" | "community";

export const CCG_TIME_ZONE = "Europe/Helsinki";
export const CCG_FEATURE_ENABLED = process.env.CCG_FEATURE_ENABLED !== "false";
export const CCG_CARDS_PER_PACK = 5;
export const CCG_PACK_STORAGE_CAPS: Readonly<Record<CcgMode, number>> = { current: 25, legacy: 25 };
export const CCG_PACK_RECHARGE_INTERVAL_HOURS: Readonly<Record<CcgMode, number>> = { current: 2, legacy: 1 };
export const CCG_INITIAL_PACKS = {
  user: { current: 25, legacy: 25 },
  guest: { current: 5, legacy: 5 },
};
export const CCG_PACK_BALANCE_VERSION = 2;
export const CCG_GUEST_COOKIE = "swccg_guest";
export const CCG_PACK_RULE_VERSION = "pack-v9-raid-card-completion-rewards";
export const CCG_GRADING_VERSION = "grade-v2-rarity-ladder";
export const CCG_ELIGIBILITY_VERSION = "complete-scores-mythic-reports-v3";
export const CCG_THEME_VERSION = "vault-v1";
export const CCG_POOL_VERSION = "pool-v4-a-rank-guarantee";
export const CCG_COMMUNITY_ZONE_ID = -1;
export const CCG_COMMUNITY_SET = {
  zoneId: CCG_COMMUNITY_ZONE_ID,
  slug: "community",
  raidName: "Community",
  expansionName: "SuomiWoW",
  mythicPlusSeason: "none",
  state: "legacy" as const,
  backgroundPath: "/ccg/general_wide.webp",
  themeKey: "community",
  mark: "SW",
  accent: "#58D9E8",
  glow: "rgba(88, 217, 232, 0.36)",
  crop: { x: 50, y: 50, scale: 1.08, xJitter: 5, yJitter: 10 },
};

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function ratio(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback;
}

export const CCG_ENABLE_MIN_ELIGIBLE_CHARACTERS = positiveInteger(process.env.CCG_ENABLE_MIN_ELIGIBLE_CHARACTERS, 100);
export const CCG_ENABLE_MIN_MEDIA_READY_CHARACTERS = positiveInteger(process.env.CCG_ENABLE_MIN_MEDIA_READY_CHARACTERS, 50);
export const CCG_ENABLE_MIN_MEDIA_COVERAGE = ratio(process.env.CCG_ENABLE_MIN_MEDIA_COVERAGE, 0.75);

export const CCG_TIER_GRADES: readonly CcgTierGrade[] = ["S", "A", "B", "C", "D", "E", "F"];
export const CCG_A_OR_BETTER_GRADES = new Set<CcgTierGrade>(["S", "A"]);

export const CCG_WEIGHTED_GRADE_ODDS: Readonly<Record<CcgTierGrade, number>> = {
  S: 30,
  A: 70,
  B: 150,
  C: 200,
  D: 220,
  E: 180,
  F: 150,
};

export const CCG_GUARANTEED_GRADE_ODDS: Readonly<Record<CcgTierGrade, number>> = {
  S: 60,
  A: 140,
  B: 0,
  C: 0,
  D: 0,
  E: 0,
  F: 0,
};

export const CCG_FINISH_ORDER: readonly CcgFinish[] = ["standard", "foil", "golden", "prismatic", "holographic", "negative"];

export type CcgProtectedFinish = Exclude<CcgFinish, "standard">;

export const CCG_FINISH_PITY_LIMITS: Readonly<Record<CcgProtectedFinish, number>> = {
  foil: 5,
  golden: 25,
  prismatic: 50,
  holographic: 100,
  negative: 1000,
};

export type CcgBackgroundSafeCrop = {
  x: number;
  y: number;
  scale: number;
  xJitter: number;
  yJitter: number;
};

export type CcgConfiguredSet = {
  zoneId: number;
  slug: string;
  raidName: string;
  expansionName: string;
  mythicPlusSeason: string;
  state: CcgSetState;
  backgroundPath: string;
  packArtOffsetX?: number;
  themeKey: string;
  mark: string;
  accent: string;
  glow: string;
  crop: CcgBackgroundSafeCrop;
};

const crop = (x: number, y: number, scale: number, xJitter: number, yJitter: number): CcgBackgroundSafeCrop => ({
  x,
  y,
  scale,
  xJitter,
  yJitter,
});

export const normalizeCcgRaidName = (raidName: string): string => raidName.split(",", 1)[0].trim();

const CCG_CONFIGURED_SET_DEFINITIONS = [
  {
    zoneId: 6,
    slug: "highmaul",
    raidName: "Highmaul",
    expansionName: "Warlords of Draenor",
    mythicPlusSeason: "none",
    state: "legacy",
    backgroundPath: "/ccg/highmaul.png",
    packArtOffsetX: 43,
    themeKey: "highmaul",
    mark: "HM",
    accent: "#D98A50",
    glow: "rgba(217, 138, 80, 0.34)",
    crop: crop(50, 50, 1.1, 5, 10),
  },
  {
    zoneId: 7,
    slug: "blackrock-foundry",
    raidName: "Blackrock Foundry",
    expansionName: "Warlords of Draenor",
    mythicPlusSeason: "none",
    state: "legacy",
    backgroundPath: "/ccg/blackrock_foundry.png",
    packArtOffsetX: 54,
    themeKey: "blackrock-foundry",
    mark: "BRF",
    accent: "#FF6A3D",
    glow: "rgba(255, 106, 61, 0.34)",
    crop: crop(50, 50, 1.1, 5, 10),
  },
  {
    zoneId: 8,
    slug: "hellfire-citadel",
    raidName: "Hellfire Citadel",
    expansionName: "Warlords of Draenor",
    mythicPlusSeason: "none",
    state: "legacy",
    backgroundPath: "/ccg/hellfire_citadel.png",
    packArtOffsetX: 50,
    themeKey: "hellfire-citadel",
    mark: "HFC",
    accent: "#8EDB45",
    glow: "rgba(142, 219, 69, 0.34)",
    crop: crop(50, 50, 1.1, 5, 10),
  },
  {
    zoneId: 10,
    slug: "emerald-nightmare",
    raidName: "The Emerald Nightmare",
    expansionName: "Legion",
    mythicPlusSeason: "none",
    state: "legacy",
    backgroundPath: "/ccg/emerald_nightmare.png",
    packArtOffsetX: 60,
    themeKey: "emerald-nightmare",
    mark: "EN",
    accent: "#E44C6F",
    glow: "rgba(228, 76, 111, 0.34)",
    crop: crop(62, 50, 1.1, 5, 10),
  },
  {
    zoneId: 11,
    slug: "nighthold",
    raidName: "The Nighthold",
    expansionName: "Legion",
    mythicPlusSeason: "none",
    state: "legacy",
    backgroundPath: "/ccg/nighthold.png",
    packArtOffsetX: 40,
    themeKey: "nighthold",
    mark: "NH",
    accent: "#83A7FF",
    glow: "rgba(131, 167, 255, 0.34)",
    crop: crop(45, 50, 1.1, 5, 10),
  },
  {
    zoneId: 13,
    slug: "tomb-of-sargeras",
    raidName: "Tomb of Sargeras",
    expansionName: "Legion",
    mythicPlusSeason: "season-7.2.5",
    state: "legacy",
    backgroundPath: "/ccg/tomb_of_sargeras.png",
    packArtOffsetX: 48,
    themeKey: "tomb-of-sargeras",
    mark: "TOS",
    accent: "#9EEA4D",
    glow: "rgba(158, 234, 77, 0.34)",
    crop: crop(50, 50, 1.1, 5, 10),
  },
  {
    zoneId: 17,
    slug: "antorus",
    raidName: "Antorus, the Burning Throne",
    expansionName: "Legion",
    mythicPlusSeason: "season-7.3.2",
    state: "legacy",
    backgroundPath: "/ccg/antorus.png",
    packArtOffsetX: 50,
    themeKey: "antorus",
    mark: "ANT",
    accent: "#63E074",
    glow: "rgba(99, 224, 116, 0.34)",
    crop: crop(45, 50, 1.1, 5, 10),
  },
  {
    zoneId: 19,
    slug: "uldir",
    raidName: "Uldir",
    expansionName: "Battle for Azeroth",
    mythicPlusSeason: "season-bfa-1",
    state: "legacy",
    backgroundPath: "/ccg/uldir-desktop.avif",
    packArtOffsetX: 66,
    themeKey: "uldir",
    mark: "ULD",
    accent: "#C99343",
    glow: "rgba(201, 147, 67, 0.4)",
    crop: crop(50, 50, 1.1, 5, 10),
  },
  {
    zoneId: 21,
    slug: "battle-of-dazaralor",
    raidName: "Battle of Dazar'alor",
    expansionName: "Battle for Azeroth",
    mythicPlusSeason: "season-bfa-2",
    state: "legacy",
    backgroundPath: "/ccg/battle-of-dazaralor-desktop.webp",
    packArtOffsetX: 59,
    themeKey: "dazaralor",
    mark: "BOD",
    accent: "#397FC4",
    glow: "rgba(57, 127, 196, 0.4)",
    crop: crop(48, 50, 1.11, 5, 10),
  },
  {
    zoneId: 23,
    slug: "the-eternal-palace",
    raidName: "The Eternal Palace",
    expansionName: "Battle for Azeroth",
    mythicPlusSeason: "season-bfa-3",
    state: "legacy",
    backgroundPath: "/ccg/the-eternal-palace-desktop.avif",
    packArtOffsetX: 64,
    themeKey: "eternal-palace",
    mark: "EP",
    accent: "#9565DB",
    glow: "rgba(149, 101, 219, 0.42)",
    crop: crop(50, 50, 1.1, 5, 10),
  },
  {
    zoneId: 24,
    slug: "nyalotha",
    raidName: "Ny'alotha, the Waking City",
    expansionName: "Battle for Azeroth",
    mythicPlusSeason: "season-bfa-4",
    state: "legacy",
    backgroundPath: "/ccg/nyalotha-desktop.webp",
    packArtOffsetX: 60,
    themeKey: "nyalotha",
    mark: "NYA",
    accent: "#A950BA",
    glow: "rgba(169, 80, 186, 0.44)",
    crop: crop(49, 50, 1.13, 4, 10),
  },
  {
    zoneId: 26,
    slug: "castle-nathria",
    raidName: "Castle Nathria",
    expansionName: "Shadowlands",
    mythicPlusSeason: "season-sl-1",
    state: "legacy",
    backgroundPath: "/ccg/castle-nathria-desktop.jpg",
    packArtOffsetX: 63,
    themeKey: "nathria",
    mark: "CN",
    accent: "#C8454F",
    glow: "rgba(200, 69, 79, 0.44)",
    crop: crop(51, 50, 1.12, 4, 10),
  },
  {
    zoneId: 28,
    slug: "sanctum-of-domination",
    raidName: "Sanctum of Domination",
    expansionName: "Shadowlands",
    mythicPlusSeason: "season-sl-2",
    state: "legacy",
    backgroundPath: "/ccg/sanctum-of-domination-desktop.avif",
    packArtOffsetX: 58,
    themeKey: "sanctum",
    mark: "SOD",
    accent: "#6F8FFF",
    glow: "rgba(111, 143, 255, 0.34)",
    crop: crop(49, 50, 1.12, 4, 10),
  },
  {
    zoneId: 29,
    slug: "sepulcher-of-the-first-ones",
    raidName: "Sepulcher of the First Ones",
    expansionName: "Shadowlands",
    mythicPlusSeason: "season-sl-3",
    state: "legacy",
    backgroundPath: "/ccg/sepulcher-of-the-first-ones-desktop.avif",
    packArtOffsetX: 65,
    themeKey: "sepulcher",
    mark: "SFO",
    accent: "#C9AB4F",
    glow: "rgba(201, 171, 79, 0.4)",
    crop: crop(52, 50, 1.13, 4, 10),
  },
  {
    zoneId: 31,
    slug: "vault-of-the-incarnates",
    raidName: "Vault of the Incarnates",
    expansionName: "Dragonflight",
    mythicPlusSeason: "season-df-1",
    state: "legacy",
    backgroundPath: "/ccg/vault-of-the-incarnates-desktop.avif",
    packArtOffsetX: 73,
    themeKey: "vault",
    mark: "VOTI",
    accent: "#9A6645",
    glow: "rgba(154, 102, 69, 0.42)",
    crop: crop(50, 50, 1.1, 5, 10),
  },
  {
    zoneId: 33,
    slug: "aberrus",
    raidName: "Aberrus, the Shadowed Crucible",
    expansionName: "Dragonflight",
    mythicPlusSeason: "season-df-2",
    state: "legacy",
    backgroundPath: "/ccg/aberrus-desktop.jpg",
    packArtOffsetX: 80,
    themeKey: "aberrus",
    mark: "ABR",
    accent: "#747CFF",
    glow: "rgba(116, 124, 255, 0.35)",
    crop: crop(51, 50, 1.12, 4, 10),
  },
  {
    zoneId: 35,
    slug: "amirdrassil",
    raidName: "Amirdrassil, the Dream's Hope",
    expansionName: "Dragonflight",
    mythicPlusSeason: "season-df-3",
    state: "legacy",
    backgroundPath: "/ccg/amirdrassil-desktop.jpg",
    packArtOffsetX: 56,
    themeKey: "amirdrassil",
    mark: "AMI",
    accent: "#4FAE72",
    glow: "rgba(79, 174, 114, 0.4)",
    crop: crop(49, 50, 1.11, 5, 10),
  },
  {
    zoneId: 38,
    slug: "nerubar-palace",
    raidName: "Nerub-ar Palace",
    expansionName: "The War Within",
    mythicPlusSeason: "season-tww-1",
    state: "legacy",
    backgroundPath: "/ccg/nerubar-palace-desktop.avif",
    packArtOffsetX: 63,
    themeKey: "nerubar",
    mark: "NER",
    accent: "#9C62D4",
    glow: "rgba(156, 98, 212, 0.44)",
    crop: crop(52, 50, 1.13, 4, 10),
  },
  {
    zoneId: 42,
    slug: "liberation-of-undermine",
    raidName: "Liberation of Undermine",
    expansionName: "The War Within",
    mythicPlusSeason: "season-tww-2",
    state: "legacy",
    backgroundPath: "/ccg/liberation-of-undermine-desktop.webp",
    packArtOffsetX: 59,
    themeKey: "undermine",
    mark: "LOU",
    accent: "#70BD54",
    glow: "rgba(112, 189, 84, 0.42)",
    crop: crop(48, 50, 1.11, 5, 10),
  },
  {
    zoneId: 44,
    slug: "manaforge-omega",
    raidName: "Manaforge Omega",
    expansionName: "The War Within",
    mythicPlusSeason: "season-tww-3",
    state: "legacy",
    backgroundPath: "/ccg/manaforge-omega-desktop.jpg",
    packArtOffsetX: 53,
    themeKey: "manaforge",
    mark: "MFO",
    accent: "#967BFF",
    glow: "rgba(150, 123, 255, 0.36)",
    crop: crop(51, 50, 1.1, 5, 10),
  },
  {
    zoneId: 46,
    slug: "march-on-queldanas",
    raidName: "March on Quel'Danas",
    expansionName: "Midnight",
    mythicPlusSeason: "season-mn-1",
    state: "current",
    backgroundPath: "/ccg/march-on-queldanas-desktop.jpg",
    packArtOffsetX: 57,
    themeKey: "queldanas",
    mark: "MQD",
    accent: "#46CFFF",
    glow: "rgba(70, 207, 255, 0.35)",
    crop: crop(49, 50, 1.1, 5, 10),
  },
] as const satisfies readonly CcgConfiguredSet[];

export const CCG_CONFIGURED_SETS: readonly CcgConfiguredSet[] = CCG_CONFIGURED_SET_DEFINITIONS.map((set) => ({
  ...set,
  raidName: normalizeCcgRaidName(set.raidName),
}));

export const getConfiguredCcgSet = (zoneId: number): CcgConfiguredSet | undefined => CCG_CONFIGURED_SETS.find((set) => set.zoneId === zoneId);
