"use client";

import { use, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import CharacterTierBoard, { CharacterTierBoardItem } from "@/components/character-tier-lists/CharacterTierBoard";
import CustomCharacterTierListMaker from "@/components/character-tier-lists/CustomCharacterTierListMaker";
import { useCustomCharacterTierList, useGuildCharacterTierList } from "@/lib/queries";
import { getAllClasses } from "@/lib/utils";
import type { CharacterTierListCharacter, CharacterTierListRole } from "@/types";

interface PageProps {
  params: Promise<{ realm: string; name: string; raidId: string }>;
}

type Tab = "generated" | "custom";
type GeneratedView = "roles" | "combined";

function toBoardItem(character: CharacterTierListCharacter): CharacterTierBoardItem {
  return {
    characterKey: character.characterKey,
    name: character.name,
    realm: character.realm,
    region: character.region,
    classID: character.classID,
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
  };
}

export default function GuildCharacterTierListPage({ params }: PageProps) {
  const resolvedParams = use(params);
  const t = useTranslations("characterTierListsPage");
  const realm = decodeURIComponent(resolvedParams.realm);
  const name = decodeURIComponent(resolvedParams.name);
  const raidId = parseInt(resolvedParams.raidId, 10);

  const [tab, setTab] = useState<Tab>("generated");
  const [view, setView] = useState<GeneratedView>("roles");
  const [minReports, setMinReports] = useState(1);
  const [classId, setClassId] = useState<number | "all">("all");
  const classes = useMemo(() => getAllClasses(), []);

  const filters = useMemo(
    () => ({
      minReports,
      role: null as CharacterTierListRole | null,
      classId: classId === "all" ? null : classId,
      limit: 1000,
    }),
    [classId, minReports],
  );

  const { data, isLoading, error } = useGuildCharacterTierList(realm, name, Number.isFinite(raidId) ? raidId : null, filters, tab === "generated");
  const { data: customData, isLoading: customLoading, error: customError } = useCustomCharacterTierList(realm, name, Number.isFinite(raidId) ? raidId : null, tab === "custom");
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
        <div>
          <p className="text-sm text-gray-400">
            {name} / {realm}
          </p>
          <h1 className="text-3xl font-bold">{t("guildTitle")}</h1>
          <p className="mt-2 max-w-3xl text-sm text-gray-400">{t("guildSubtitle")}</p>
        </div>

        <div className="flex flex-wrap gap-2 border-b border-gray-800">
          <button
            type="button"
            onClick={() => setTab("generated")}
            className={`min-h-10 border-b-2 px-4 text-sm font-semibold transition-colors ${
              tab === "generated" ? "border-blue-400 text-white" : "border-transparent text-gray-400 hover:text-gray-200"
            }`}
          >
            {t("generated")}
          </button>
          <button
            type="button"
            onClick={() => setTab("custom")}
            className={`min-h-10 border-b-2 px-4 text-sm font-semibold transition-colors ${
              tab === "custom" ? "border-blue-400 text-white" : "border-transparent text-gray-400 hover:text-gray-200"
            }`}
          >
            {t("myTierList")}
          </button>
        </div>

        {tab === "generated" && (
          <>
            <div className="grid gap-3 rounded-lg border border-gray-800 bg-gray-900/70 p-3 sm:grid-cols-2 md:grid-cols-[auto_auto_auto] md:items-end">
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-400">{t("minReports")}</label>
                <input
                  type="number"
                  min={1}
                  max={999}
                  value={minReports}
                  onChange={(event) => setMinReports(Math.max(1, Number(event.target.value) || 1))}
                  className="min-h-10 w-full rounded-md border border-gray-700 bg-gray-800 px-3 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 md:w-28"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-400">{t("class")}</label>
                <select
                  value={classId}
                  onChange={(event) => setClassId(event.target.value === "all" ? "all" : Number(event.target.value))}
                  className="min-h-10 w-full rounded-md border border-gray-700 bg-gray-800 px-3 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 md:w-44"
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
                <div className="inline-flex min-h-10 overflow-hidden rounded-md border border-gray-700 bg-gray-800">
                  <button type="button" onClick={() => setView("roles")} className={`px-3 text-sm font-semibold ${view === "roles" ? "bg-blue-600 text-white" : "text-gray-300 hover:bg-gray-700"}`}>
                    {t("byRole")}
                  </button>
                  <button type="button" onClick={() => setView("combined")} className={`px-3 text-sm font-semibold ${view === "combined" ? "bg-blue-600 text-white" : "text-gray-300 hover:bg-gray-700"}`}>
                    {t("combined")}
                  </button>
                </div>
              </div>
            </div>

            {isLoading && <div className="rounded-lg border border-gray-800 bg-gray-900 px-4 py-8 text-center text-gray-400">{t("loading")}</div>}
            {error && <div className="rounded-lg border border-red-900 bg-red-950/40 px-4 py-8 text-center text-red-200">{t("error")}</div>}
            {!isLoading && !error && data && (
              <div className="space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-gray-400">
                  <span>{t("characterCount", { visible: data.characters.length, total: data.total })}</span>
                  {data.generatedAt && <span>{t("lastCalculated", { date: new Date(data.generatedAt).toLocaleString() })}</span>}
                </div>
                {view === "combined" ? (
                  <CharacterTierBoard characters={characters} emptyMessage={t("noScoredCharacters")} />
                ) : (
                  <div className="grid gap-5 xl:grid-cols-3">
                    <CharacterTierBoard title={t("tank")} characters={roleGroups.tank} emptyMessage={t("noScoredCharacters")} />
                    <CharacterTierBoard title={t("healer")} characters={roleGroups.healer} emptyMessage={t("noScoredCharacters")} />
                    <CharacterTierBoard title={t("dps")} characters={roleGroups.dps} emptyMessage={t("noScoredCharacters")} />
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {tab === "custom" && (
          <>
            {customLoading && <div className="rounded-lg border border-gray-800 bg-gray-900 px-4 py-8 text-center text-gray-400">{t("loading")}</div>}
            {customError && <div className="rounded-lg border border-red-900 bg-red-950/40 px-4 py-8 text-center text-red-200">{t("error")}</div>}
            {!customLoading && !customError && customData && <CustomCharacterTierListMaker realm={realm} name={name} raidId={raidId} data={customData} />}
          </>
        )}
      </div>
    </main>
  );
}
