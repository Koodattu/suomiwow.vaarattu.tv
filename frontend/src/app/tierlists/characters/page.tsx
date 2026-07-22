"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import RaidSelector from "@/components/RaidSelector";
import CharacterTierBoard, { CharacterTierBoardItem } from "@/components/character-tier-lists/CharacterTierBoard";
import { useCharacterTierListRaids, useGlobalCharacterTierList, useRaids } from "@/lib/queries";
import { getAllClasses } from "@/lib/utils";
import type { CharacterTierListRole } from "@/types";

type GeneratedView = "roles" | "combined";

function toBoardItem(character: {
  characterKey: string;
  accountGroupId?: string | null;
  name: string;
  realm: string;
  region: string;
  classID: number;
  guildName: string | null;
  reportCount: number;
  score: number;
  parseScore: number;
  survivalScore: number | null;
  role: CharacterTierListRole;
  metric: "dps" | "hps";
  specName: string;
  bestSpecName: string | null;
  pulls: number;
  deaths: number;
  lastSeenAt?: string | Date | null;
}): CharacterTierBoardItem {
  return {
    characterKey: character.characterKey,
    accountGroupId: character.accountGroupId,
    name: character.name,
    realm: character.realm,
    region: character.region,
    classID: character.classID,
    guildName: character.guildName,
    reportCount: character.reportCount,
    score: character.score,
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

export default function CharacterTierListsPage() {
  const t = useTranslations("characterTierListsPage");
  const [selectedRaidId, setSelectedRaidId] = useState<number | null>(null);
  const [minReports, setMinReports] = useState(3);
  const [classId, setClassId] = useState<number | "all">("all");
  const [view, setView] = useState<GeneratedView>("combined");

  const { data: allRaids } = useRaids();
  const { data: tierListRaids } = useCharacterTierListRaids();
  const classes = useMemo(() => getAllClasses(), []);

  const raids = useMemo(() => {
    if (!allRaids || !tierListRaids) return [];
    const availableRaidIds = new Set(tierListRaids.map((raid) => raid.raidId));
    return allRaids.filter((raid) => availableRaidIds.has(raid.id));
  }, [allRaids, tierListRaids]);

  useEffect(() => {
    if (!selectedRaidId && raids.length > 0) {
      setSelectedRaidId(raids[0].id);
    }
  }, [raids, selectedRaidId]);

  const filters = useMemo(
    () => ({
      minReports,
      role: null as CharacterTierListRole | null,
      classId: classId === "all" ? null : classId,
      limit: "all" as const,
    }),
    [classId, minReports],
  );

  const { data, isLoading, error } = useGlobalCharacterTierList(selectedRaidId, filters, selectedRaidId !== null);
  const characters = useMemo(() => data?.characters.map(toBoardItem) ?? [], [data]);
  const roleGroups = useMemo(
    () => ({
      tank: characters.filter((character) => character.role === "tank"),
      healer: characters.filter((character) => character.role === "healer"),
      dps: characters.filter((character) => character.role === "dps"),
    }),
    [characters],
  );

  return (
    <main className="min-h-screen bg-gray-950 px-4 py-6 text-white md:px-6 md:py-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="min-w-0 xl:max-w-sm">
            <h1 className="text-balance text-2xl font-bold lg:text-3xl">{t("globalTitle")}</h1>
            {data?.generatedAt && <p className="mt-1 text-sm text-gray-400">{t("lastCalculated", { date: new Date(data.generatedAt).toLocaleString() })}</p>}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 sm:items-end xl:grid-cols-[minmax(260px,350px)_auto_auto_auto] xl:shrink-0">
            <div>
              <RaidSelector raids={raids} selectedRaidId={selectedRaidId} onRaidSelect={(raidId) => setSelectedRaidId(raidId)} />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-400">{t("minReports")}</label>
              <input
                type="number"
                min={1}
                max={999}
                value={minReports}
                onChange={(event) => setMinReports(Math.max(1, Number(event.target.value) || 1))}
                className="min-h-10 w-full rounded-md border border-gray-700 bg-gray-800 px-3 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 sm:w-28"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-400">{t("class")}</label>
              <select
                value={classId}
                onChange={(event) => setClassId(event.target.value === "all" ? "all" : Number(event.target.value))}
                className="min-h-10 w-full rounded-md border border-gray-700 bg-gray-800 px-3 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 sm:w-44"
              >
                <option value="all">{t("allClasses")}</option>
                {classes.map((classInfo) => (
                  <option key={classInfo.id} value={classInfo.id}>
                    {classInfo.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-400">{t("view")}</label>
              <div role="group" aria-label={t("view")} className="inline-flex min-h-10 w-full overflow-hidden rounded-md border border-gray-700 bg-gray-800 sm:w-auto">
                <button type="button" aria-pressed={view === "roles"} onClick={() => setView("roles")} className={`flex-1 px-3 text-sm font-semibold sm:flex-none ${view === "roles" ? "bg-blue-600 text-white" : "text-gray-300 hover:bg-gray-700"}`}>
                  {t("byRole")}
                </button>
                <button type="button" aria-pressed={view === "combined"} onClick={() => setView("combined")} className={`flex-1 px-3 text-sm font-semibold sm:flex-none ${view === "combined" ? "bg-blue-600 text-white" : "text-gray-300 hover:bg-gray-700"}`}>
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
            {view === "combined" ? (
              <CharacterTierBoard characters={characters} showSpecIcons emptyMessage={t("noScoredCharacters")} />
            ) : (
              <div className="grid gap-5 xl:grid-cols-3">
                <CharacterTierBoard title={t("tank")} characters={roleGroups.tank} showSpecIcons emptyMessage={t("noScoredCharacters")} />
                <CharacterTierBoard title={t("healer")} characters={roleGroups.healer} showSpecIcons emptyMessage={t("noScoredCharacters")} />
                <CharacterTierBoard title={t("dps")} characters={roleGroups.dps} showSpecIcons emptyMessage={t("noScoredCharacters")} />
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
