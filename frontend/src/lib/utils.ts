import { ClassInfo, RaidProgressSummary, OfficialRaidProgress } from "@/types";

// Format seconds to a readable time string
export function formatTime(seconds: number): string {
  if (seconds === 0) return "0m";

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

// Get Twitch stream thumbnail URL from channel name
// Twitch provides thumbnails at: https://static-cdn.jtvnw.net/previews-ttv/live_user_{login}-{width}x{height}.jpg
export function getTwitchThumbnailUrl(channelName: string, width: number = 440, height: number = 248): string {
  return `https://static-cdn.jtvnw.net/previews-ttv/live_user_${channelName.toLowerCase()}-${width}x${height}.jpg`;
}

// Get the full icon URL from filename
export function getIconUrl(iconFilename: string | undefined): string | undefined {
  if (!iconFilename) return undefined;

  // If it's already a full URL (for backwards compatibility), return as-is
  if (iconFilename.startsWith("http://") || iconFilename.startsWith("https://")) {
    return iconFilename;
  }

  // Otherwise construct URL from API base and filename
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
  return `${apiUrl}/icons/${iconFilename}`;
}

// Format percentage
export function formatPercent(percent: number): string {
  return `${percent.toFixed(1)}%`;
}

// Get difficulty color
export function getDifficultyColor(difficulty: "mythic" | "heroic"): string {
  return difficulty === "mythic" ? "text-orange-500" : "text-purple-500";
}

// Format event message
export function formatEventMessage(event: {
  type: string;
  guildName: string;
  bossName?: string;
  difficulty: string;
  data: { pullCount?: number; bestPercent?: number; progressDisplay?: string; hiatusDays?: number };
}): string {
  const { type, guildName, bossName, difficulty, data } = event;

  if (type === "boss_kill") {
    const pulls = data.pullCount || 0;
    return `${guildName} defeated ${bossName} (${difficulty}) after ${pulls} pull${pulls !== 1 ? "s" : ""}!`;
  }

  if (type === "best_pull") {
    // Use progressDisplay if available (includes phase info), otherwise fall back to simple percent
    if (data.progressDisplay) {
      return `${guildName} reached ${formatPhaseDisplay(data.progressDisplay)} on ${bossName} (${difficulty})!`;
    }
    const percent = data.bestPercent || 0;
    return `${guildName} reached ${percent.toFixed(1)}% on ${bossName} (${difficulty})!`;
  }

  if (type === "hiatus") {
    const days = data.hiatusDays || 7;
    if (days >= 30) {
      return `${guildName} has not raided for over a month.`;
    }
    return `${guildName} has not raided for ${days} days.`;
  }

  if (type === "regress") {
    if (bossName) {
      const percent = data.bestPercent || 0;
      return `${guildName} failed to improve on ${bossName} (${difficulty}, ${percent.toFixed(1)}%) during their raid.`;
    }
    return `${guildName} had no progress during their raid.`;
  }

  if (type === "reproge") {
    const pulls = data.pullCount || 0;
    return `${guildName} re-killed ${bossName} (${difficulty}) after ${pulls} pull${pulls !== 1 ? "s" : ""}!`;
  }

  return `${guildName} - ${bossName || "Unknown"}`;
}

// Get time ago string
export function getTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  // Format full date as dd.mm.yyyy
  const day = date.getDate().toString().padStart(2, "0");
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const year = date.getFullYear();
  const fullDate = `${day}.${month}.${year}`;

  if (seconds < 60) return `just now (${fullDate})`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;

  return fullDate;
}

// Generate WarcraftLogs URL for a kill
export function getKillLogUrl(reportCode: string, fightId: number): string {
  return `https://www.warcraftlogs.com/reports/${reportCode}#fight=${fightId}`;
}

// Format phase display string by shortening phase names
// Examples: "45.2% Stage One: XYZ" -> "45.2% P1", "67.8% Intermission 2: XYZ" -> "67.8% I2"
export function formatPhaseDisplay(displayString: string): string {
  if (!displayString) return displayString;

  // Remove everything after colons (e.g., "Stage One: XYZ" -> "Stage One")
  let formatted = displayString.replace(/:.*$/, "").trim();

  // Apply transformations
  formatted = formatted
    // Stage One -> P1, Stage Two -> P2, etc.
    .replace(/Stage One\b/gi, "P1")
    .replace(/Stage Two\b/gi, "P2")
    .replace(/Stage Three\b/gi, "P3")
    .replace(/Stage Four\b/gi, "P4")
    .replace(/Stage Five\b/gi, "P5")
    // Intermission 1 -> I1, Intermission 2 -> I2, etc.
    .replace(/Intermission (\d+)\b/gi, "I$1")
    .replace(/Intermission One\b/gi, "I1")
    .replace(/Intermission Two\b/gi, "I2")
    // Intermission (without number) -> I1
    .replace(/Intermission\b/gi, "I1")
    .replace(/\bI\?/gi, "I1");

  return formatted;
}

// Pick the best (lowest) world rank from WCL and Raider.IO sources
export function getBestWorldRank(progress: { wclWorldRank?: number; rioWorldRank?: number; worldRank?: number } | null | undefined): number | undefined {
  if (!progress) return undefined;
  const { wclWorldRank, rioWorldRank, worldRank } = progress;
  if (wclWorldRank && rioWorldRank) return Math.min(wclWorldRank, rioWorldRank);
  return wclWorldRank || rioWorldRank || worldRank;
}

// Get CSS color for world rank based on rank number
export function getWorldRankColor(rank: number | undefined): string {
  if (!rank) return "var(--rank-gray)";
  if (rank === 1) return "var(--rank-gold)";
  if (rank <= 100) return "var(--rank-orange)";
  if (rank <= 1000) return "var(--rank-blue)";
  if (rank <= 10000) return "var(--rank-green)";
  return "var(--rank-gray)";
}

export function getRankColor(rank: number, totalItems: number): { color: string } {
  if (rank === 1) {
    return { color: "var(--rank-gold)" }; // Gold for first place
  }

  // Calculate the rank threshold for each percentile tier
  const top1Percent = (totalItems * 1) / 100;
  const top5Percent = (totalItems * 5) / 100;
  const top25Percent = (totalItems * 25) / 100;
  const top50Percent = (totalItems * 50) / 100;
  const top75Percent = (totalItems * 75) / 100;

  if (rank <= top1Percent) return { color: "var(--rank-pink)" }; // Top 1%
  if (rank <= top5Percent) return { color: "var(--rank-orange)" }; // Top 5%
  if (rank <= top25Percent) return { color: "var(--rank-purple)" }; // Top 25%
  if (rank <= top50Percent) return { color: "var(--rank-blue)" }; // Top 50%
  if (rank <= top75Percent) return { color: "var(--rank-green)" }; // Top 75%
  return { color: "var(--rank-gray)" }; // Rest
}

/** WarcraftLogs-style parse color based on percentile (0–100). */
export function getParseColor(percent: number): string {
  if (percent >= 100) return "var(--rank-gold)"; // Gold — Rank 1
  if (percent >= 99) return "var(--rank-pink)"; // Pink — Top 1%
  if (percent >= 95) return "var(--rank-orange)"; // Orange — Legendary
  if (percent >= 75) return "var(--rank-purple)"; // Purple — Epic
  if (percent >= 50) return "var(--rank-blue)"; // Blue — Rare
  if (percent >= 25) return "var(--rank-green)"; // Green — Uncommon
  return "var(--rank-gray)"; // Grey — Common
}

// Get Tailwind color class for leaderboard rank (1-5 orange, 6-20 purple, 21-50 blue, rest green)
export function getLeaderboardRankColor(rank: number): string {
  if (rank <= 5) return "text-orange-500"; // Legendary
  if (rank <= 20) return "text-purple-500"; // Epic
  if (rank <= 50) return "text-blue-400"; // Rare
  return "text-green-500"; // Uncommon
}

export function formatSpecName(specName: string): string {
  const normalized = specName.replace(/-/g, " ").trim();
  if (!normalized) return "";
  return normalized.toLowerCase().replace(/\b\w/g, (match) => match.toUpperCase());
}

export function normalizeSpecNameForApi(specName: string): string {
  return specName.trim().toLowerCase().replace(/[\s-]+/g, "");
}

export function formatRealmName(value: string): string {
  return value
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

// Format guild name with parent guild if applicable
// Format: parent_guild (guild_name) - server_name
// Example: "IHAN SAMA (ST-Raid) - Stormreaver" or "Tuju - Kazzak" (no parent)
export function formatGuildName(guildName: string, realm: string, parentGuild?: string): string {
  if (parentGuild) {
    return `${parentGuild} (${guildName}) - ${realm}`;
  }
  return `${guildName} - ${realm}`;
}

// Generate guild profile URL from realm and name
export function getGuildProfileUrl(realm: string, name: string): string {
  const encodedRealm = encodeURIComponent(realm);
  const encodedName = encodeURIComponent(name);
  return `/guilds/${encodedRealm}/${encodedName}`;
}

// Generate Raider.IO guild URL
export function getRaiderIOGuildUrl(region: string, realm: string, guildName: string): string {
  const encodedRealm = encodeURIComponent(realm.toLowerCase().replace(/\s+/g, "-"));
  const encodedGuildName = encodeURIComponent(guildName);
  return `https://raider.io/guilds/${region.toLowerCase()}/${encodedRealm}/${encodedGuildName}`;
}

// Tier score thresholds (matching tierlists page)
const TIER_THRESHOLDS = {
  S: { min: 900, max: 1000 },
  A: { min: 740, max: 899 },
  B: { min: 580, max: 739 },
  C: { min: 420, max: 579 },
  D: { min: 260, max: 419 },
  E: { min: 100, max: 259 },
  F: { min: 0, max: 99 },
} as const;

export type TierLetter = "S" | "A" | "B" | "C" | "D" | "E" | "F";

// Get tier letter based on score (0-1000 scale)
export function getTierLetter(score: number): TierLetter {
  if (score >= TIER_THRESHOLDS.S.min) return "S";
  if (score >= TIER_THRESHOLDS.A.min) return "A";
  if (score >= TIER_THRESHOLDS.B.min) return "B";
  if (score >= TIER_THRESHOLDS.C.min) return "C";
  if (score >= TIER_THRESHOLDS.D.min) return "D";
  if (score >= TIER_THRESHOLDS.E.min) return "E";
  return "F";
}

// Get tier color class based on tier letter
export function getTierColor(tier: TierLetter): string {
  switch (tier) {
    case "S":
      return "text-red-400";
    case "A":
      return "text-orange-300";
    case "B":
      return "text-yellow-300";
    case "C":
      return "text-yellow-200";
    case "D":
      return "text-lime-300";
    case "E":
      return "text-green-300";
    case "F":
      return "text-cyan-300";
    default:
      return "text-gray-400";
  }
}

// Get tier background color class based on tier letter (for blocky tier display)
export function getTierBgColor(tier: TierLetter): string {
  switch (tier) {
    case "S":
      return "bg-red-400";
    case "A":
      return "bg-orange-300";
    case "B":
      return "bg-yellow-300";
    case "C":
      return "bg-yellow-200";
    case "D":
      return "bg-lime-300";
    case "E":
      return "bg-green-300";
    case "F":
      return "bg-cyan-300";
    default:
      return "bg-gray-400";
  }
}

export const CLASSES: ClassInfo[] = [
  {
    id: 1,
    name: "Death Knight",
    iconUrl: "classicon_deathknight",
    specs: [
      { name: "blood", role: "tank" },
      { name: "frost", role: "dps" },
      { name: "unholy", role: "dps" },
    ],
  },
  {
    id: 2,
    name: "Druid",
    iconUrl: "classicon_druid",
    specs: [
      { name: "balance", role: "dps" },
      { name: "feral", role: "dps" },
      { name: "guardian", role: "tank" },
      { name: "restoration", role: "healer" },
    ],
  },
  {
    id: 3,
    name: "Hunter",
    iconUrl: "classicon_hunter",
    specs: [
      { name: "beast-mastery", role: "dps" },
      { name: "marksmanship", role: "dps" },
      { name: "survival", role: "dps" },
    ],
  },
  {
    id: 4,
    name: "Mage",
    iconUrl: "classicon_mage",
    specs: [
      { name: "arcane", role: "dps" },
      { name: "fire", role: "dps" },
      { name: "frost", role: "dps" },
    ],
  },
  {
    id: 5,
    name: "Monk",
    iconUrl: "classicon_monk",
    specs: [
      { name: "brewmaster", role: "tank" },
      { name: "mistweaver", role: "healer" },
      { name: "windwalker", role: "dps" },
    ],
  },
  {
    id: 6,
    name: "Paladin",
    iconUrl: "classicon_paladin",
    specs: [
      { name: "holy", role: "healer" },
      { name: "protection", role: "tank" },
      { name: "retribution", role: "dps" },
    ],
  },
  {
    id: 7,
    name: "Priest",
    iconUrl: "classicon_priest",
    specs: [
      { name: "discipline", role: "healer" },
      { name: "holy", role: "healer" },
      { name: "shadow", role: "dps" },
    ],
  },
  {
    id: 8,
    name: "Rogue",
    iconUrl: "classicon_rogue",
    specs: [
      { name: "assassination", role: "dps" },
      { name: "outlaw", role: "dps" },
      { name: "subtlety", role: "dps" },
    ],
  },
  {
    id: 9,
    name: "Shaman",
    iconUrl: "classicon_shaman",
    specs: [
      { name: "elemental", role: "dps" },
      { name: "enhancement", role: "dps" },
      { name: "restoration", role: "healer" },
    ],
  },
  {
    id: 10,
    name: "Warlock",
    iconUrl: "classicon_warlock",
    specs: [
      { name: "affliction", role: "dps" },
      { name: "demonology", role: "dps" },
      { name: "destruction", role: "dps" },
    ],
  },
  {
    id: 11,
    name: "Warrior",
    iconUrl: "classicon_warrior",
    specs: [
      { name: "arms", role: "dps" },
      { name: "fury", role: "dps" },
      { name: "protection", role: "tank" },
    ],
  },
  {
    id: 12,
    name: "Demon Hunter",
    iconUrl: "classicon_demonhunter",
    specs: [
      { name: "havoc", role: "dps" },
      { name: "vengeance", role: "tank" },
      { name: "devourer", role: "dps" },
    ],
  },
  {
    id: 13,
    name: "Evoker",
    iconUrl: "classicon_evoker",
    specs: [
      { name: "devastation", role: "dps" },
      { name: "preservation", role: "healer" },
      { name: "augmentation", role: "dps" },
    ],
  },
];

export function getClassInfoById(classId: number): {
  name: string;
  iconUrl: string;
} {
  const classInfo = CLASSES.find((c) => c.id === classId);
  return classInfo ? { name: classInfo.name, iconUrl: classInfo.iconUrl + ".jpg" } : { name: "Unknown", iconUrl: "classicon_unknown.jpg" };
}

export function getClassById(classId: number): ClassInfo | undefined {
  return CLASSES.find((c) => c.id === classId);
}

export function getAllClasses(): ClassInfo[] {
  return CLASSES;
}

export function getSpecIconUrl(classId: number, specName: string): string | undefined {
  const classInfo = getClassInfoById(classId);
  if (!classInfo) return undefined;

  const normalizedSpecName = normalizeSpecNameForApi(specName);
  const specIconFilename = classInfo.iconUrl.replace(".jpg", `_${normalizedSpecName}.jpg`);
  return specIconFilename;
}

/** Find the matching OfficialRaidProgress entry for a given raid slug */
export function findOfficialProgressForRaid(officialProgress: OfficialRaidProgress[] | undefined, raidSlug: string, rioSlug?: string): OfficialRaidProgress | undefined {
  if (!officialProgress?.length || !raidSlug) return undefined;
  const normalized = raidSlug.toLowerCase();
  const normalizedRio = rioSlug?.toLowerCase() || "";
  return officialProgress.find((op) => {
    const tierSlug = op.raidTierSlug.toLowerCase();
    return tierSlug === normalized || tierSlug.includes(normalized) || normalized.includes(tierSlug) || (normalizedRio && tierSlug === normalizedRio);
  });
}

/**
 * Returns the higher of log-based vs official (Raider.IO) progress, with a flag if official was used.
 * Official progress reflects in-game kills regardless of log visibility.
 */
export function getEffectiveProgress(
  logProgress: RaidProgressSummary | null,
  official: OfficialRaidProgress | undefined,
  difficulty: "mythic" | "heroic",
): { text: string; isOfficial: boolean } {
  const logKills = logProgress?.bossesDefeated ?? 0;
  const totalBosses = logProgress?.totalBosses ?? official?.totalBosses ?? 0;
  const officialKills = difficulty === "mythic" ? (official?.mythicBossesKilled ?? 0) : (official?.heroicBossesKilled ?? 0);

  if (officialKills > logKills && totalBosses > 0) {
    return { text: `${officialKills}/${totalBosses}`, isOfficial: true };
  }
  if (logProgress) {
    return { text: `${logKills}/${totalBosses}`, isOfficial: false };
  }
  if (officialKills > 0 && totalBosses > 0) {
    return { text: `${officialKills}/${totalBosses}`, isOfficial: true };
  }
  return { text: "-", isOfficial: false };
}
