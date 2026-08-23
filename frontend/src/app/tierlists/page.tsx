"use client";

import { Suspense, useEffect, useState, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { GuildTierScore } from "@/types";
import { useTranslations } from "next-intl";
import GuildCrest from "@/components/GuildCrest";
import RaidSelector from "@/components/RaidSelector";
import { useRaids, useTierListRaids, useOverallTierList, useTierListForRaid } from "@/lib/queries";

// Crown tier is special - only the highest scoring guild gets it
// S and F tiers are harder to achieve (narrower score ranges)
// A through E are evenly distributed in between
const TIERS = ["Crown", "S", "A", "B", "C", "D", "E", "F"] as const;
type TierName = (typeof TIERS)[number];

const TIER_COLORS: Record<TierName, string> = {
  Crown: "bg-purple-400",
  S: "bg-red-400",
  A: "bg-orange-300",
  B: "bg-yellow-300",
  C: "bg-yellow-200",
  D: "bg-lime-300",
  E: "bg-green-300",
  F: "bg-cyan-300",
};

// Proportional tier widths as fractions of the score range (must sum to 1.0)
// S and F are narrower (10% each) making them harder to achieve
// A-E are evenly split across the middle 80% (16% each)
const TIER_PROPORTIONS: { tier: Exclude<TierName, "Crown">; fraction: number }[] = [
  { tier: "S", fraction: 0.1 },
  { tier: "A", fraction: 0.16 },
  { tier: "B", fraction: 0.16 },
  { tier: "C", fraction: 0.16 },
  { tier: "D", fraction: 0.16 },
  { tier: "E", fraction: 0.16 },
  { tier: "F", fraction: 0.1 },
];

// Calculate dynamic tier thresholds based on actual guild score distribution.
// Crown guild (rank #1) is excluded from threshold calculation so the
// remaining guilds spread naturally across S-F tiers.
function calculateDynamicThresholds(scores: number[]): Record<Exclude<TierName, "Crown">, { min: number }> {
  if (scores.length === 0) {
    // Fallback: even split across 0-1000
    return { S: { min: 900 }, A: { min: 740 }, B: { min: 580 }, C: { min: 420 }, D: { min: 260 }, E: { min: 100 }, F: { min: 0 } };
  }

  const maxScore = Math.max(...scores);
  const minScore = Math.min(...scores);
  const range = maxScore - minScore;

  if (range === 0) {
    // All guilds have the same score — put them all in C (middle tier)
    return {
      S: { min: maxScore + 1 },
      A: { min: maxScore + 1 },
      B: { min: maxScore + 1 },
      C: { min: maxScore },
      D: { min: maxScore - 1 },
      E: { min: maxScore - 2 },
      F: { min: maxScore - 3 },
    };
  }

  // Walk from highest tier down, carving out each tier's slice of the range
  const thresholds = {} as Record<Exclude<TierName, "Crown">, { min: number }>;
  let cursor = maxScore;

  for (const { tier, fraction } of TIER_PROPORTIONS) {
    const tierSize = range * fraction;
    const tierMin = cursor - tierSize;
    thresholds[tier] = { min: tierMin };
    cursor = tierMin;
  }

  // Ensure F tier always covers down to (or below) the actual minimum
  thresholds.F.min = Math.min(thresholds.F.min, minScore);

  return thresholds;
}

// Get tier based on score using dynamic thresholds
function getTierByScore(score: number, thresholds: Record<Exclude<TierName, "Crown">, { min: number }>): Exclude<TierName, "Crown"> {
  if (score >= thresholds.S.min) return "S";
  if (score >= thresholds.A.min) return "A";
  if (score >= thresholds.B.min) return "B";
  if (score >= thresholds.C.min) return "C";
  if (score >= thresholds.D.min) return "D";
  if (score >= thresholds.E.min) return "E";
  return "F";
}

interface TierListDisplayProps {
  title: string;
  guilds: GuildTierScore[];
  scoreKey: "overallScore" | "speedScore" | "efficiencyScore";
  onGuildClick: (realm: string, name: string) => void;
}

function TierListDisplay({ title, guilds, scoreKey, onGuildClick }: TierListDisplayProps) {
  // Sort guilds by score descending to find the crown holder
  const sortedGuilds = useMemo(() => [...guilds].sort((a, b) => b[scoreKey] - a[scoreKey]), [guilds, scoreKey]);

  // Calculate dynamic tier thresholds from non-crown guild scores
  const tierGroups = useMemo(() => {
    const groups: Record<TierName, GuildTierScore[]> = {
      Crown: [],
      S: [],
      A: [],
      B: [],
      C: [],
      D: [],
      E: [],
      F: [],
    };

    if (sortedGuilds.length === 0) return groups;

    // Crown goes to #1; thresholds computed from the rest
    const nonCrownScores = sortedGuilds.slice(1).map((g) => g[scoreKey]);
    const thresholds = calculateDynamicThresholds(nonCrownScores);

    sortedGuilds.forEach((guild, index) => {
      if (index === 0) {
        groups.Crown.push(guild);
      } else {
        groups[getTierByScore(guild[scoreKey], thresholds)].push(guild);
      }
    });

    return groups;
  }, [sortedGuilds, scoreKey]);

  // Guilds are already sorted within each tier by score (highest first)

  return (
    <div className="flex-1 min-w-0">
      <h3 className="text-base md:text-lg font-bold text-white mb-2 md:mb-3 text-center">{title}</h3>
      <div className="border border-gray-700 rounded-lg overflow-hidden">
        {TIERS.map((tier) => {
          const tierGuilds = tierGroups[tier];
          return (
            <div key={tier} className="flex border-b border-gray-700 last:border-b-0">
              <div className={`w-10 md:w-20 min-h-14 md:min-h-20 flex items-center justify-center font-bold text-lg md:text-2xl text-gray-900 ${TIER_COLORS[tier]} shrink-0`}>
                {tier === "Crown" ? "👑" : tier}
              </div>
              <div className="flex-1 bg-gray-800 p-1.5 md:p-2 flex flex-wrap items-center gap-1 md:gap-2 min-h-14 md:min-h-20">
                {tierGuilds.map((guild, idx) => (
                  <div
                    key={idx}
                    className="bg-gray-700 hover:bg-gray-600 px-1.5 md:px-2 py-1 md:py-1.5 rounded text-xs md:text-sm text-gray-200 flex items-center gap-1 md:gap-2 transition-colors cursor-pointer"
                    onClick={() => onGuildClick(guild.realm, guild.guildName)}
                  >
                    <div className="w-5 h-5 md:w-8 md:h-8 shrink-0">
                      <GuildCrest crest={guild.crest} faction={guild.faction} size={128} className="scale-[0.15] md:scale-[0.25] origin-top-left" />
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="truncate">
                        <span className="font-bold">{guild.guildName}</span>
                        {guild.parent_guild && <span className="text-gray-400 hidden md:inline"> ({guild.parent_guild})</span>}
                      </span>
                      <span className="text-[10px] md:text-xs text-gray-400 truncate">{guild.realm}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface GuildScoresTableProps {
  guilds: GuildTierScore[];
  onGuildClick: (realm: string, name: string) => void;
  calculatedAt: string | null;
  t: ReturnType<typeof useTranslations<"tierListsPage">>;
}

function GuildScoresTable({ guilds, onGuildClick, calculatedAt, t }: GuildScoresTableProps) {
  const [expanded, setExpanded] = useState(false);

  const sortedGuilds = useMemo(() => [...guilds].sort((a, b) => b.overallScore - a.overallScore), [guilds]);

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between gap-3">
        <button type="button" onClick={() => setExpanded((prev) => !prev)} className="flex items-center gap-2 text-sm text-gray-300 hover:text-white transition-colors px-2 py-1">
          <svg className={`w-4 h-4 transition-transform ${expanded ? "rotate-90" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          {t("guildScores")}
        </button>
        {calculatedAt && (
          <p className="text-right text-gray-400 text-xs md:text-sm">
            {t("lastCalculated")}: {new Date(calculatedAt).toLocaleString()}
          </p>
        )}
      </div>
      {expanded && (
        <div className="mt-2 border border-gray-700 rounded-lg overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-gray-800 text-gray-400 text-xs uppercase">
              <tr>
                <th className="px-3 py-2 w-10">{t("rank")}</th>
                <th className="px-3 py-2">{t("guild")}</th>
                <th className="px-3 py-2">{t("realm")}</th>
                <th className="px-3 py-2 text-right">{t("overall")}</th>
                <th className="px-3 py-2 text-right">{t("speed")}</th>
                <th className="px-3 py-2 text-right">{t("efficiency")}</th>
              </tr>
            </thead>
            <tbody>
              {sortedGuilds.map((guild, index) => (
                <tr
                  key={`${guild.guildId}-${index}`}
                  onClick={() => onGuildClick(guild.realm, guild.guildName)}
                  className="border-t border-gray-700 bg-gray-800/50 hover:bg-gray-700/60 cursor-pointer transition-colors"
                >
                  <td className="px-3 py-2 text-gray-400">{index + 1}</td>
                  <td className="px-3 py-2 text-gray-200 font-medium">{guild.guildName}</td>
                  <td className="px-3 py-2 text-gray-400">{guild.realm}</td>
                  <td className="px-3 py-2 text-right text-gray-200">{guild.overallScore}</td>
                  <td className="px-3 py-2 text-right text-gray-200">{guild.speedScore}</td>
                  <td className="px-3 py-2 text-right text-gray-200">{guild.efficiencyScore}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function getRequestedRaidId(searchParams: URLSearchParams): number | null | undefined {
  const value = searchParams.get("raid");
  if (value === "overall") return null;
  const raidId = Number(value);
  return Number.isSafeInteger(raidId) && raidId > 0 ? raidId : undefined;
}

function TierListsContent() {
  const searchParamsKey = useSearchParams().toString();
  return <TierListsState key={searchParamsKey} searchParamsKey={searchParamsKey} />;
}

function TierListsState({ searchParamsKey }: { searchParamsKey: string }) {
  const searchParams = useMemo(() => new URLSearchParams(searchParamsKey), [searchParamsKey]);
  const t = useTranslations("tierListsPage");
  const navigationT = useTranslations("navigation");
  const pathname = usePathname();
  const router = useRouter();
  const [requestedRaidId, setRequestedRaidId] = useState<number | null | undefined>(() => getRequestedRaidId(searchParams));

  // Fetch raid metadata
  const { data: allRaids } = useRaids();
  const { data: tierListRaidsData, isLoading: isRaidsLoading, error: raidsError } = useTierListRaids();

  // Filter to only raids that have tier list data
  const raids = useMemo(() => {
    if (!allRaids || !tierListRaidsData) return [];
    const tierListRaidIds = new Set(tierListRaidsData.map((r) => r.raidId));
    return allRaids.filter((r) => tierListRaidIds.has(r.id));
  }, [allRaids, tierListRaidsData]);
  const initialized = !!allRaids && !!tierListRaidsData;
  const defaultRaidId = raids.find((raid) => raid.isPrimary)?.id ?? raids[0]?.id ?? null;
  const selectedRaidId = useMemo(() => {
    if (!initialized) return null;
    if (requestedRaidId === null) return null;
    if (requestedRaidId && raids.some((raid) => raid.id === requestedRaidId)) return requestedRaidId;
    return defaultRaidId;
  }, [defaultRaidId, initialized, raids, requestedRaidId]);

  useEffect(() => {
    if (!initialized) return;
    const params = new URLSearchParams(searchParamsKey);
    params.set("raid", selectedRaidId === null ? "overall" : String(selectedRaidId));
    const nextSearchParamsKey = params.toString();
    if (nextSearchParamsKey === searchParamsKey) return;
    router.replace(`${pathname}?${nextSearchParamsKey}`, { scroll: false });
  }, [initialized, pathname, router, searchParamsKey, selectedRaidId]);

  // Fetch tier data based on selection
  const isOverallSelected = selectedRaidId === null && initialized;
  const { data: overallData, isLoading: isOverallLoading, error: overallError } = useOverallTierList(isOverallSelected);
  const { data: raidData, isLoading: isRaidDataLoading, error: raidDataError } = useTierListForRaid(selectedRaidId);

  const loading = isRaidsLoading || !initialized;
  const dataLoading = isOverallSelected ? isOverallLoading : isRaidDataLoading;
  const error = raidsError || overallError || raidDataError;

  const guilds = isOverallSelected ? (overallData?.guilds ?? []) : (raidData?.guilds ?? []);
  const calculatedAt = isOverallSelected ? (overallData?.calculatedAt ?? null) : (raidData?.calculatedAt ?? null);

  const handleRaidSelect = (raidId: number | null) => {
    setRequestedRaidId(raidId);
  };

  if (loading) {
    return (
      <div className="w-full px-6">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full px-6">
        <div className="bg-red-900/50 border border-red-500 rounded-lg p-4 text-center">
          <p className="text-red-300">{t("error")}</p>
        </div>
      </div>
    );
  }

  // Handle guild click to navigate to profile
  const handleGuildClick = (realm: string, name: string) => {
    const encodedRealm = encodeURIComponent(realm);
    const encodedName = encodeURIComponent(name);
    router.push(`/guilds/${encodedRealm}/${encodedName}`);
  };

  return (
    <div className="w-full px-3 md:px-6">
      <div className="flex flex-col gap-4 mb-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl lg:text-3xl font-bold text-white text-balance">{t("title")}</h1>
          <p className="text-sm text-gray-500 text-pretty">{t("subtitle")}</p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-end lg:shrink-0">
          <div className="flex shrink-0 self-start rounded bg-gray-900 border border-gray-800 p-1 sm:self-end">
            <Link href={selectedRaidId === null ? "/tierlists?raid=overall" : `/tierlists?raid=${selectedRaidId}`} aria-current="page" className="rounded bg-blue-600 px-3 py-2 text-sm text-white transition-colors">
              {navigationT("guildType")}
            </Link>
            <Link href={selectedRaidId ? `/tierlists/characters?raid=${selectedRaidId}` : "/tierlists/characters"} className="rounded px-3 py-2 text-sm text-gray-400 transition-colors hover:text-white">
              {navigationT("characterType")}
            </Link>
          </div>
          <div className="flex items-end gap-3">
            <RaidSelector raids={raids} selectedRaidId={selectedRaidId} onRaidSelect={handleRaidSelect} showOverall={true} />
            {dataLoading && <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-blue-500 mb-2"></div>}
          </div>
        </div>
      </div>

      {/* Tier Lists Grid - Stack on mobile, side by side on desktop */}
      {guilds.length > 0 ? (
        <>
          <div className="flex flex-col lg:flex-row gap-4">
            <TierListDisplay title={t("overall")} guilds={guilds} scoreKey="overallScore" onGuildClick={handleGuildClick} />
            <TierListDisplay title={t("speed")} guilds={guilds} scoreKey="speedScore" onGuildClick={handleGuildClick} />
            <TierListDisplay title={t("efficiency")} guilds={guilds} scoreKey="efficiencyScore" onGuildClick={handleGuildClick} />
          </div>
          <GuildScoresTable guilds={guilds} onGuildClick={handleGuildClick} calculatedAt={calculatedAt} t={t} />
        </>
      ) : (
        <div className="bg-gray-800 rounded-lg p-8 text-center">
          <p className="text-gray-400">{t("noDataForRaid")}</p>
        </div>
      )}
    </div>
  );
}

export default function TierListsPage() {
  return (
    <Suspense fallback={null}>
      <TierListsContent />
    </Suspense>
  );
}
