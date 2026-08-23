"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import RaidSelector from "@/components/RaidSelector";
import CharacterTierBoard, { CharacterTierBoardItem } from "@/components/character-tier-lists/CharacterTierBoard";
import { useCharacterTierListRaids, useGlobalCharacterTierList, useRaids } from "@/lib/queries";
import { getAllClasses } from "@/lib/utils";
import type { CharacterTierListCharacter, CharacterTierListRole } from "@/types";

type GeneratedView = "role" | "all";
type GeneratedMetric = "performance" | "mechanics" | "combined";

type CharacterTierListUrlState = {
  raidId: number | null;
  guildName: string;
  classId: number | "all";
  view: GeneratedView;
  metric: GeneratedMetric;
};

function getCharacterTierListUrlState(searchParams: URLSearchParams): CharacterTierListUrlState {
  const requestedRaidId = Number(searchParams.get("raid"));
  const requestedClassId = Number(searchParams.get("class"));
  const guildName = searchParams.get("guild")?.trim().slice(0, 100) || "all";

  return {
    raidId: Number.isSafeInteger(requestedRaidId) && requestedRaidId > 0 ? requestedRaidId : null,
    guildName,
    classId: getAllClasses().some((classInfo) => classInfo.id === requestedClassId) ? requestedClassId : "all",
    view: searchParams.get("view") === "role" ? "role" : "all",
    metric: searchParams.get("metric") === "performance" || searchParams.get("metric") === "mechanics" ? (searchParams.get("metric") as GeneratedMetric) : "combined",
  };
}

function toBoardItem(character: CharacterTierListCharacter, metric: GeneratedMetric): CharacterTierBoardItem {
  return {
    characterKey: character.characterKey,
    accountGroupId: character.accountGroupId,
    name: character.name,
    realm: character.realm,
    region: character.region,
    classID: character.classID,
    guildName: character.guildName,
    reportCount: character.reportCount,
    score: metric === "performance" ? character.parseScore : metric === "mechanics" ? character.survivalScore : character.score,
    parseScore: character.parseScore,
    survivalScore: character.survivalScore,
    role: character.role,
    metric: character.metric,
    specName: character.specName,
    bestSpecName: character.bestSpecName,
    pulls: character.pulls,
    deaths: character.deaths,
    lastSeenAt: character.lastSeenAt,
  };
}

function CharacterTierListsContent() {
  const searchParamsKey = useSearchParams().toString();
  const [characterSearch, setCharacterSearch] = useState("");
  return <CharacterTierListsState key={searchParamsKey} searchParamsKey={searchParamsKey} characterSearch={characterSearch} setCharacterSearch={setCharacterSearch} />;
}

function CharacterTierListsState({
  searchParamsKey,
  characterSearch,
  setCharacterSearch,
}: {
  searchParamsKey: string;
  characterSearch: string;
  setCharacterSearch: (value: string) => void;
}) {
  const searchParams = useMemo(() => new URLSearchParams(searchParamsKey), [searchParamsKey]);
  const initialUrlState = getCharacterTierListUrlState(searchParams);
  const t = useTranslations("characterTierListsPage");
  const pathname = usePathname();
  const router = useRouter();
  const [requestedRaidId, setRequestedRaidId] = useState<number | null>(initialUrlState.raidId);
  const [guildName, setGuildName] = useState(initialUrlState.guildName);
  const [classId, setClassId] = useState<number | "all">(initialUrlState.classId);
  const [view, setView] = useState<GeneratedView>(initialUrlState.view);
  const [metric, setMetric] = useState<GeneratedMetric>(initialUrlState.metric);

  const { data: allRaids } = useRaids();
  const { data: tierListRaids } = useCharacterTierListRaids();
  const classes = useMemo(() => getAllClasses(), []);

  const raids = useMemo(() => {
    if (!allRaids || !tierListRaids) return [];
    const availableRaidIds = new Set(tierListRaids.map((raid) => raid.raidId));
    return allRaids.filter((raid) => availableRaidIds.has(raid.id));
  }, [allRaids, tierListRaids]);
  const raidsInitialized = !!allRaids && !!tierListRaids;
  const selectedRaidId = useMemo(() => {
    if (!raidsInitialized) return null;
    if (requestedRaidId && raids.some((raid) => raid.id === requestedRaidId)) return requestedRaidId;
    return raids[0]?.id ?? null;
  }, [raids, raidsInitialized, requestedRaidId]);

  const filters = useMemo(
    () => ({
      minReports: 3,
      role: null as CharacterTierListRole | null,
      classId: classId === "all" ? null : classId,
      limit: "all" as const,
    }),
    [classId],
  );

  const { data, isLoading, error } = useGlobalCharacterTierList(selectedRaidId, filters, selectedRaidId !== null);
  const referenceCharacters = useMemo(() => data?.characters.map((character) => toBoardItem(character, metric)) ?? [], [data, metric]);
  const guildNames = useMemo(
    () => Array.from(new Set(data?.characters.map((character) => character.guildName?.trim()).filter((name): name is string => !!name) ?? [])).sort((a, b) => a.localeCompare(b)),
    [data],
  );
  const activeGuildName = data && guildName !== "all" && guildNames.includes(guildName) ? guildName : "all";
  const resolvedGuildName = data ? activeGuildName : guildName;
  const normalizedCharacterSearch = characterSearch.trim().toLowerCase();
  const characters = useMemo(
    () =>
      referenceCharacters
        .filter((character) => activeGuildName === "all" || character.guildName?.trim() === activeGuildName)
        .filter((character) => !normalizedCharacterSearch || character.name.toLowerCase().includes(normalizedCharacterSearch)),
    [activeGuildName, normalizedCharacterSearch, referenceCharacters],
  );
  const roleGroups = useMemo(
    () => ({
      tank: characters.filter((character) => character.role === "tank"),
      healer: characters.filter((character) => character.role === "healer"),
      dps: characters.filter((character) => character.role === "dps"),
    }),
    [characters],
  );
  const referenceRoleGroups = useMemo(
    () => ({
      tank: referenceCharacters.filter((character) => character.role === "tank"),
      healer: referenceCharacters.filter((character) => character.role === "healer"),
      dps: referenceCharacters.filter((character) => character.role === "dps"),
    }),
    [referenceCharacters],
  );

  useEffect(() => {
    const urlRaidId = selectedRaidId ?? requestedRaidId;
    if (!urlRaidId) return;
    const params = new URLSearchParams(searchParamsKey);
    params.set("raid", String(urlRaidId));
    if (resolvedGuildName === "all") params.delete("guild");
    else params.set("guild", resolvedGuildName);
    if (classId === "all") params.delete("class");
    else params.set("class", String(classId));
    if (view === "all") params.delete("view");
    else params.set("view", view);
    if (metric === "combined") params.delete("metric");
    else params.set("metric", metric);
    const nextSearchParamsKey = params.toString();
    if (nextSearchParamsKey === searchParamsKey) return;
    router.replace(`${pathname}?${nextSearchParamsKey}`, { scroll: false });
  }, [classId, metric, pathname, requestedRaidId, resolvedGuildName, router, searchParamsKey, selectedRaidId, view]);

  return (
    <main className="min-h-screen bg-gray-950 px-4 py-6 text-white md:px-6 md:py-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="space-y-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <h1 className="text-balance text-2xl font-bold lg:text-3xl">{t("globalTitle")}</h1>
              {data?.generatedAt && <p className="mt-1 text-sm text-gray-400">{t("lastCalculated", { date: new Date(data.generatedAt).toLocaleString() })}</p>}
            </div>

            <div className="w-full lg:w-auto">
              <RaidSelector raids={raids} selectedRaidId={selectedRaidId} onRaidSelect={(raidId) => setRequestedRaidId(raidId)} compact />
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-3 lg:justify-end">
            <div className="w-full sm:w-auto">
              <label htmlFor="character-tier-list-search" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-400">
                {t("character")}
              </label>
              <input
                id="character-tier-list-search"
                type="search"
                value={characterSearch}
                onChange={(event) => setCharacterSearch(event.target.value)}
                placeholder={t("searchCharacters")}
                className="min-h-10 w-full rounded-md border border-gray-700 bg-gray-800 px-3 text-sm text-gray-100 placeholder:text-gray-500 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 sm:w-44"
              />
            </div>

            <div className="w-full sm:w-auto">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-400">{t("guild")}</label>
              <select
                value={activeGuildName}
                onChange={(event) => setGuildName(event.target.value)}
                className="min-h-10 w-full rounded-md border border-gray-700 bg-gray-800 px-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 sm:w-48"
              >
                <option value="all">{t("allGuilds")}</option>
                {guildNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>

            <div className="w-full sm:w-auto">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-400">{t("class")}</label>
              <select
                value={classId}
                onChange={(event) => setClassId(event.target.value === "all" ? "all" : Number(event.target.value))}
                className="min-h-10 w-full rounded-md border border-gray-700 bg-gray-800 px-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 sm:w-36"
              >
                <option value="all">{t("allClasses")}</option>
                {classes.map((classInfo) => (
                  <option key={classInfo.id} value={classInfo.id}>
                    {classInfo.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="w-full sm:w-auto">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-400">{t("view")}</label>
              <div role="group" aria-label={t("view")} className="inline-flex min-h-10 w-full overflow-hidden rounded-md border border-gray-700 bg-gray-800 sm:w-auto">
                <button type="button" aria-pressed={view === "role"} onClick={() => setView("role")} className={`flex-1 px-2.5 text-sm font-semibold sm:flex-none ${view === "role" ? "bg-blue-600 text-white" : "text-gray-300 hover:bg-gray-700"}`}>
                  {t("byRole")}
                </button>
                <button type="button" aria-pressed={view === "all"} onClick={() => setView("all")} className={`flex-1 px-2.5 text-sm font-semibold sm:flex-none ${view === "all" ? "bg-blue-600 text-white" : "text-gray-300 hover:bg-gray-700"}`}>
                  {t("all")}
                </button>
              </div>
            </div>

            <div className="w-full sm:w-auto">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-400">{t("metric")}</label>
              <div role="group" aria-label={t("metric")} className="inline-flex min-h-10 w-full overflow-hidden rounded-md border border-gray-700 bg-gray-800 sm:w-auto">
                <button type="button" aria-pressed={metric === "performance"} onClick={() => setMetric("performance")} className={`flex-1 px-2.5 text-sm font-semibold sm:flex-none ${metric === "performance" ? "bg-blue-600 text-white" : "text-gray-300 hover:bg-gray-700"}`}>
                  {t("performance")}
                </button>
                <button type="button" aria-pressed={metric === "mechanics"} onClick={() => setMetric("mechanics")} className={`flex-1 px-2.5 text-sm font-semibold sm:flex-none ${metric === "mechanics" ? "bg-blue-600 text-white" : "text-gray-300 hover:bg-gray-700"}`}>
                  {t("mechanics")}
                </button>
                <button type="button" aria-pressed={metric === "combined"} onClick={() => setMetric("combined")} className={`flex-1 px-2.5 text-sm font-semibold sm:flex-none ${metric === "combined" ? "bg-blue-600 text-white" : "text-gray-300 hover:bg-gray-700"}`}>
                  {t("combined")}
                </button>
              </div>
            </div>
          </div>
        </div>

        {isLoading && <div className="rounded-lg border border-gray-800 bg-gray-900 px-4 py-8 text-center text-gray-400">{t("loading")}</div>}
        {error && <div className="rounded-lg border border-red-900 bg-red-950/40 px-4 py-8 text-center text-red-200">{t("error")}</div>}
        {!isLoading && !error && data && (
          <div className="space-y-5">
            {view === "all" ? (
              <CharacterTierBoard characters={characters} referenceCharacters={referenceCharacters} showSpecIcons emptyMessage={t("noScoredCharacters")} />
            ) : (
              <div className="grid gap-5 xl:grid-cols-3">
                <CharacterTierBoard title={t("tank")} characters={roleGroups.tank} referenceCharacters={referenceRoleGroups.tank} showSpecIcons emptyMessage={t("noScoredCharacters")} />
                <CharacterTierBoard title={t("healer")} characters={roleGroups.healer} referenceCharacters={referenceRoleGroups.healer} showSpecIcons emptyMessage={t("noScoredCharacters")} />
                <CharacterTierBoard title={t("dps")} characters={roleGroups.dps} referenceCharacters={referenceRoleGroups.dps} showSpecIcons emptyMessage={t("noScoredCharacters")} />
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

export default function CharacterTierListsPage() {
  return (
    <Suspense fallback={null}>
      <CharacterTierListsContent />
    </Suspense>
  );
}
