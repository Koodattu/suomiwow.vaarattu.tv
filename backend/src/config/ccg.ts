export type CcgMode = "current" | "legacy";
export type CcgFinish = "standard" | "foil" | "golden" | "prismatic" | "holographic" | "negative";
export type CcgTierGrade = "S" | "A" | "B" | "C" | "D" | "E" | "F";
export type CcgSetState = "draft" | "current" | "legacy" | "locked";

export const CCG_TIME_ZONE = "Europe/Helsinki";
export const CCG_FEATURE_ENABLED = process.env.CCG_FEATURE_ENABLED !== "false";
export const CCG_CARDS_PER_PACK = 5;
export const CCG_DAILY_PACKS_PER_MODE = 10;
export const CCG_GUEST_CLAIM_CARD_LIMIT_PER_MODE = CCG_CARDS_PER_PACK * CCG_DAILY_PACKS_PER_MODE;
export const CCG_DUPLICATES_PER_BONUS_PACK = 10;
export const CCG_GUEST_COOKIE = "swccg_guest";
export const CCG_PACK_RULE_VERSION = "pack-v6-quadratic-finish-pity";
export const CCG_GRADING_VERSION = "grade-v2-rarity-ladder";
export const CCG_ELIGIBILITY_VERSION = "mythic-reports-v2";
export const CCG_THEME_VERSION = "vault-v1";
export const CCG_POOL_VERSION = "pool-v4-a-rank-guarantee";

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

export const CCG_CONFIGURED_SETS: readonly CcgConfiguredSet[] = [
  {
    zoneId: 19,
    slug: "uldir",
    raidName: "Uldir",
    expansionName: "Battle for Azeroth",
    mythicPlusSeason: "season-bfa-1",
    state: "legacy",
    backgroundPath: "/ccg/uldir-desktop.avif",
    themeKey: "uldir",
    mark: "ULD",
    accent: "#4FA8FF",
    glow: "rgba(79, 168, 255, 0.34)",
    crop: crop(50, 50, 1.1, 5, 4),
  },
  {
    zoneId: 21,
    slug: "battle-of-dazaralor",
    raidName: "Battle of Dazar'alor",
    expansionName: "Battle for Azeroth",
    mythicPlusSeason: "season-bfa-2",
    state: "legacy",
    backgroundPath: "/ccg/battle-of-dazaralor-desktop.webp",
    themeKey: "dazaralor",
    mark: "BOD",
    accent: "#40D6D2",
    glow: "rgba(64, 214, 210, 0.32)",
    crop: crop(48, 49, 1.11, 5, 4),
  },
  {
    zoneId: 22,
    slug: "crucible-of-storms",
    raidName: "Crucible of Storms",
    expansionName: "Battle for Azeroth",
    mythicPlusSeason: "season-bfa-2",
    state: "legacy",
    backgroundPath: "/ccg/crucible-of-storms-desktop.avif",
    themeKey: "crucible",
    mark: "COS",
    accent: "#7377FF",
    glow: "rgba(115, 119, 255, 0.34)",
    crop: crop(53, 50, 1.12, 4, 3),
  },
  {
    zoneId: 23,
    slug: "the-eternal-palace",
    raidName: "The Eternal Palace",
    expansionName: "Battle for Azeroth",
    mythicPlusSeason: "season-bfa-3",
    state: "legacy",
    backgroundPath: "/ccg/the-eternal-palace-desktop.avif",
    themeKey: "eternal-palace",
    mark: "EP",
    accent: "#72D7FF",
    glow: "rgba(114, 215, 255, 0.32)",
    crop: crop(50, 51, 1.1, 5, 4),
  },
  {
    zoneId: 24,
    slug: "nyalotha",
    raidName: "Ny'alotha, the Waking City",
    expansionName: "Battle for Azeroth",
    mythicPlusSeason: "season-bfa-4",
    state: "legacy",
    backgroundPath: "/ccg/nyalotha-desktop.webp",
    themeKey: "nyalotha",
    mark: "NYA",
    accent: "#8B7CFF",
    glow: "rgba(139, 124, 255, 0.36)",
    crop: crop(49, 48, 1.13, 4, 3),
  },
  {
    zoneId: 26,
    slug: "castle-nathria",
    raidName: "Castle Nathria",
    expansionName: "Shadowlands",
    mythicPlusSeason: "season-sl-1",
    state: "legacy",
    backgroundPath: "/ccg/castle-nathria-desktop.jpg",
    themeKey: "nathria",
    mark: "CN",
    accent: "#A47AFF",
    glow: "rgba(164, 122, 255, 0.34)",
    crop: crop(51, 50, 1.12, 4, 3),
  },
  {
    zoneId: 28,
    slug: "sanctum-of-domination",
    raidName: "Sanctum of Domination",
    expansionName: "Shadowlands",
    mythicPlusSeason: "season-sl-2",
    state: "legacy",
    backgroundPath: "/ccg/sanctum-of-domination-desktop.avif",
    themeKey: "sanctum",
    mark: "SOD",
    accent: "#6F8FFF",
    glow: "rgba(111, 143, 255, 0.34)",
    crop: crop(49, 49, 1.12, 4, 3),
  },
  {
    zoneId: 29,
    slug: "sepulcher-of-the-first-ones",
    raidName: "Sepulcher of the First Ones",
    expansionName: "Shadowlands",
    mythicPlusSeason: "season-sl-3",
    state: "legacy",
    backgroundPath: "/ccg/sepulcher-of-the-first-ones-desktop.avif",
    themeKey: "sepulcher",
    mark: "SFO",
    accent: "#8C82FF",
    glow: "rgba(140, 130, 255, 0.35)",
    crop: crop(52, 50, 1.13, 4, 3),
  },
  {
    zoneId: 31,
    slug: "vault-of-the-incarnates",
    raidName: "Vault of the Incarnates",
    expansionName: "Dragonflight",
    mythicPlusSeason: "season-df-1",
    state: "legacy",
    backgroundPath: "/ccg/vault-of-the-incarnates-desktop.avif",
    themeKey: "vault",
    mark: "VOTI",
    accent: "#4BC5FF",
    glow: "rgba(75, 197, 255, 0.34)",
    crop: crop(50, 50, 1.1, 5, 4),
  },
  {
    zoneId: 33,
    slug: "aberrus",
    raidName: "Aberrus, the Shadowed Crucible",
    expansionName: "Dragonflight",
    mythicPlusSeason: "season-df-2",
    state: "legacy",
    backgroundPath: "/ccg/aberrus-desktop.jpg",
    themeKey: "aberrus",
    mark: "ABR",
    accent: "#747CFF",
    glow: "rgba(116, 124, 255, 0.35)",
    crop: crop(51, 49, 1.12, 4, 3),
  },
  {
    zoneId: 35,
    slug: "amirdrassil",
    raidName: "Amirdrassil, the Dream's Hope",
    expansionName: "Dragonflight",
    mythicPlusSeason: "season-df-3",
    state: "legacy",
    backgroundPath: "/ccg/amirdrassil-desktop.jpg",
    themeKey: "amirdrassil",
    mark: "AMI",
    accent: "#53D5D5",
    glow: "rgba(83, 213, 213, 0.32)",
    crop: crop(49, 50, 1.11, 5, 4),
  },
  {
    zoneId: 38,
    slug: "nerubar-palace",
    raidName: "Nerub-ar Palace",
    expansionName: "The War Within",
    mythicPlusSeason: "season-tww-1",
    state: "legacy",
    backgroundPath: "/ccg/nerubar-palace-desktop.avif",
    themeKey: "nerubar",
    mark: "NER",
    accent: "#7F7DFF",
    glow: "rgba(127, 125, 255, 0.36)",
    crop: crop(52, 49, 1.13, 4, 3),
  },
  {
    zoneId: 42,
    slug: "liberation-of-undermine",
    raidName: "Liberation of Undermine",
    expansionName: "The War Within",
    mythicPlusSeason: "season-tww-2",
    state: "legacy",
    backgroundPath: "/ccg/liberation-of-undermine-desktop.webp",
    themeKey: "undermine",
    mark: "LOU",
    accent: "#5AAEFF",
    glow: "rgba(90, 174, 255, 0.34)",
    crop: crop(48, 50, 1.11, 5, 4),
  },
  {
    zoneId: 44,
    slug: "manaforge-omega",
    raidName: "Manaforge Omega",
    expansionName: "The War Within",
    mythicPlusSeason: "season-tww-3",
    state: "legacy",
    backgroundPath: "/ccg/manaforge-omega-desktop.jpg",
    themeKey: "manaforge",
    mark: "MFO",
    accent: "#967BFF",
    glow: "rgba(150, 123, 255, 0.36)",
    crop: crop(51, 50, 1.1, 5, 4),
  },
  {
    zoneId: 46,
    slug: "march-on-queldanas",
    raidName: "March on Quel'Danas",
    expansionName: "Midnight",
    mythicPlusSeason: "season-mn-1",
    state: "current",
    backgroundPath: "/ccg/march-on-queldanas-desktop.jpg",
    themeKey: "queldanas",
    mark: "MQD",
    accent: "#46CFFF",
    glow: "rgba(70, 207, 255, 0.35)",
    crop: crop(49, 49, 1.1, 5, 4),
  },
] as const;

export const getConfiguredCcgSet = (zoneId: number): CcgConfiguredSet | undefined => CCG_CONFIGURED_SETS.find((set) => set.zoneId === zoneId);
