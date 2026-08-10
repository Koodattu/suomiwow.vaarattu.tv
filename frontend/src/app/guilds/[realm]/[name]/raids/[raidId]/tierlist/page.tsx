"use client";

import Link from "next/link";
import { use, useMemo, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import CharacterTierBoard, { CharacterTierBoardItem } from "@/components/character-tier-lists/CharacterTierBoard";
import CustomCharacterTierListMaker from "@/components/character-tier-lists/CustomCharacterTierListMaker";
import { useCustomCharacterTierList, useGlobalCharacterTierList, useGuildCharacterTierList, useSharedCharacterTierList } from "@/lib/queries";
import { getAllClasses } from "@/lib/utils";
import type { CharacterTierListCharacter, CharacterTierListRole } from "@/types";

interface PageProps {
  params: Promise<{ realm: string; name: string; raidId: string }>;
  searchParams: Promise<{ fromShare?: string; mode?: string }>;
}

type PageMode = "generated" | "custom";
type GeneratedView = "role" | "all";
type GeneratedMetric = "performance" | "mechanics" | "combined";
type GeneratedLayout = "even" | "relative";

const MODE_LINK_CLASS_NAME =
  "inline-flex min-h-10 w-full items-center justify-center rounded-md bg-blue-600 px-4 text-sm font-semibold text-white transition-[scale,background-color] duration-150 ease-out hover:bg-blue-500 active:scale-[0.96] sm:w-auto";

function toBoardItem(character: CharacterTierListCharacter, metric: GeneratedMetric): CharacterTierBoardItem {
  return {
    characterKey: character.characterKey,
    accountGroupId: character.accountGroupId,
    name: character.name,
    realm: character.realm,
    region: character.region,
    classID: character.classID,
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

export default function GuildCharacterTierListPage({ params, searchParams }: PageProps) {
  const resolvedParams = use(params);
  const resolvedSearchParams = use(searchParams);
  const t = useTranslations("characterTierListsPage");
  const realm = decodeURIComponent(resolvedParams.realm);
  const name = decodeURIComponent(resolvedParams.name);
  const raidId = parseInt(resolvedParams.raidId, 10);
  const fromShareId = resolvedSearchParams.fromShare ? decodeURIComponent(resolvedSearchParams.fromShare) : null;

  const mode: PageMode = fromShareId || resolvedSearchParams.mode === "custom" ? "custom" : "generated";
  const [view, setView] = useState<GeneratedView>("all");
  const [metric, setMetric] = useState<GeneratedMetric>("combined");
  const [layout, setLayout] = useState<GeneratedLayout>("relative");
  const [classId, setClassId] = useState<number | "all">("all");
  const classes = useMemo(() => getAllClasses(), []);

  const filters = useMemo(
    () => ({
      minReports: 3,
      role: null as CharacterTierListRole | null,
      classId: classId === "all" ? null : classId,
      limit: 1000,
    }),
    [classId],
  );
  const globalFilters = useMemo(() => ({ ...filters, limit: "all" as const }), [filters]);

  const validRaidId = Number.isFinite(raidId) ? raidId : null;
  const { data, isLoading, error } = useGuildCharacterTierList(realm, name, validRaidId, filters, mode === "generated");
  const { data: globalData, isLoading: globalLoading, error: globalError } = useGlobalCharacterTierList(validRaidId, globalFilters, mode === "generated" && layout === "relative");
  const { data: customData, isLoading: customLoading, error: customError } = useCustomCharacterTierList(realm, name, validRaidId, mode === "custom" && !fromShareId);
  const { data: sharedData, isLoading: sharedLoading, error: sharedError } = useSharedCharacterTierList(fromShareId, mode === "custom" && !!fromShareId);
  const activeCustomData = fromShareId ? sharedData : customData;
  const activeCustomLoading = fromShareId ? sharedLoading : customLoading;
  const activeCustomError = fromShareId ? sharedError : customError;
  const characters = useMemo(() => data?.characters.map((character) => toBoardItem(character, metric)) ?? [], [data, metric]);
  const globalCharacters = useMemo(() => globalData?.characters.map((character) => toBoardItem(character, metric)) ?? [], [globalData, metric]);
  const generatedLoading = isLoading || (layout === "relative" && globalLoading);
  const generatedError = error ?? (layout === "relative" ? globalError : null);
  const hasGeneratedData = !!data && (layout === "even" || !!globalData);

  const roleGroups = useMemo(
    () => ({
      tank: characters.filter((character) => character.role === "tank"),
      healer: characters.filter((character) => character.role === "healer"),
      dps: characters.filter((character) => character.role === "dps"),
    }),
    [characters],
  );
  const globalRoleGroups = useMemo(
    () => ({
      tank: globalCharacters.filter((character) => character.role === "tank"),
      healer: globalCharacters.filter((character) => character.role === "healer"),
      dps: globalCharacters.filter((character) => character.role === "dps"),
    }),
    [globalCharacters],
  );

  const tierListPath = `/guilds/${encodeURIComponent(realm)}/${encodeURIComponent(name)}/raids/${raidId}/tierlist`;
  const customTierListPath = `${tierListPath}?mode=custom`;
  const renderPageHeader = (actions: ReactNode, controls?: ReactNode) => (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="text-sm text-gray-400">
            {name} / {realm}
          </p>
          <h1 className="text-3xl font-bold">{t("guildTitle")}</h1>
        </div>
        {actions}
      </div>
      <div className={controls ? "flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between" : ""}>
        <p className="max-w-3xl text-sm text-gray-400">{t("guildSubtitle")}</p>
        {controls}
      </div>
    </div>
  );

  return (
    <main className="min-h-screen bg-gray-950 px-4 py-6 text-white md:px-6 md:py-8">
      <div className="mx-auto max-w-7xl space-y-6">
        {mode === "generated" &&
          renderPageHeader(
            <Link href={customTierListPath} className={MODE_LINK_CLASS_NAME}>
              {t("createMyTierList")}
            </Link>,
            <div className="flex flex-wrap items-end gap-3 lg:justify-end">
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

              <div className="w-full sm:w-auto">
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-400">{t("layout")}</label>
                <div role="group" aria-label={t("layout")} className="inline-flex min-h-10 w-full overflow-hidden rounded-md border border-gray-700 bg-gray-800 sm:w-auto">
                  <button type="button" aria-pressed={layout === "even"} onClick={() => setLayout("even")} className={`flex-1 px-2.5 text-sm font-semibold sm:flex-none ${layout === "even" ? "bg-blue-600 text-white" : "text-gray-300 hover:bg-gray-700"}`}>
                    {t("even")}
                  </button>
                  <button type="button" aria-pressed={layout === "relative"} onClick={() => setLayout("relative")} className={`flex-1 px-2.5 text-sm font-semibold sm:flex-none ${layout === "relative" ? "bg-blue-600 text-white" : "text-gray-300 hover:bg-gray-700"}`}>
                    {t("relative")}
                  </button>
                </div>
              </div>
            </div>,
          )}

        {mode === "generated" && (
          <>
            {generatedLoading && <div className="rounded-lg border border-gray-800 bg-gray-900 px-4 py-8 text-center text-gray-400">{t("loading")}</div>}
            {generatedError && <div className="rounded-lg border border-red-900 bg-red-950/40 px-4 py-8 text-center text-red-200">{t("error")}</div>}
            {!generatedLoading && !generatedError && hasGeneratedData && data && (
              <div className="space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-gray-400">
                  <span>{t("characterCount", { visible: data.characters.length, total: data.total })}</span>
                  {data.generatedAt && <span>{t("lastCalculated", { date: new Date(data.generatedAt).toLocaleString() })}</span>}
                </div>
                {view === "all" ? (
                  <CharacterTierBoard characters={characters} referenceCharacters={layout === "relative" ? globalCharacters : undefined} emptyMessage={t("noScoredCharacters")} />
                ) : (
                  <div className="grid gap-5 xl:grid-cols-3">
                    <CharacterTierBoard title={t("tank")} characters={roleGroups.tank} referenceCharacters={layout === "relative" ? globalRoleGroups.tank : undefined} emptyMessage={t("noScoredCharacters")} />
                    <CharacterTierBoard title={t("healer")} characters={roleGroups.healer} referenceCharacters={layout === "relative" ? globalRoleGroups.healer : undefined} emptyMessage={t("noScoredCharacters")} />
                    <CharacterTierBoard title={t("dps")} characters={roleGroups.dps} referenceCharacters={layout === "relative" ? globalRoleGroups.dps : undefined} emptyMessage={t("noScoredCharacters")} />
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {mode === "custom" && (
          <>
            {(activeCustomLoading || activeCustomError || !activeCustomData) &&
              renderPageHeader(
                <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                  <Link href={tierListPath} className={MODE_LINK_CLASS_NAME}>
                    {t("viewGeneratedTierList")}
                  </Link>
                </div>,
              )}
            {activeCustomLoading && <div className="rounded-lg border border-gray-800 bg-gray-900 px-4 py-8 text-center text-gray-400">{t("loading")}</div>}
            {activeCustomError && <div className="rounded-lg border border-red-900 bg-red-950/40 px-4 py-8 text-center text-red-200">{t("error")}</div>}
            {!activeCustomLoading && !activeCustomError && activeCustomData && (
              <CustomCharacterTierListMaker
                realm={realm}
                name={name}
                raidId={raidId}
                data={activeCustomData}
                sourceShareId={fromShareId}
                canUpdateSharedList={sharedData?.share.canEdit ?? false}
                renderHeader={(actions) =>
                  renderPageHeader(
                    <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                      {actions}
                      <Link href={tierListPath} className={MODE_LINK_CLASS_NAME}>
                        {t("viewGeneratedTierList")}
                      </Link>
                    </div>,
                  )
                }
              />
            )}
          </>
        )}
      </div>
    </main>
  );
}
