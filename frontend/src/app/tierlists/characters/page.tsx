"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import RaidSelector from "@/components/RaidSelector";
import CharacterTierBoard, { CharacterTierBoardItem } from "@/components/character-tier-lists/CharacterTierBoard";
import { useCharacterTierListRaids, useGlobalCharacterTierList, useRaids } from "@/lib/queries";
import { getAllClasses } from "@/lib/utils";
import type { CharacterTierListRole } from "@/types";

const ROLE_OPTIONS: Array<{ value: CharacterTierListRole | "all"; labelKey: string }> = [
  { value: "all", labelKey: "allRoles" },
  { value: "tank", labelKey: "tank" },
  { value: "healer", labelKey: "healer" },
  { value: "dps", labelKey: "dps" },
];

function toBoardItem(character: {
  characterKey: string;
  name: string;
  realm: string;
  region: string;
  classID: number;
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
}): CharacterTierBoardItem {
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

export default function CharacterTierListsPage() {
  const t = useTranslations("characterTierListsPage");
  const [selectedRaidId, setSelectedRaidId] = useState<number | null>(null);
  const [minReports, setMinReports] = useState(3);
  const [role, setRole] = useState<CharacterTierListRole | "all">("all");
  const [classId, setClassId] = useState<number | "all">("all");

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
      role: role === "all" ? null : role,
      classId: classId === "all" ? null : classId,
      limit: 600,
    }),
    [classId, minReports, role],
  );

  const { data, isLoading, error } = useGlobalCharacterTierList(selectedRaidId, filters, selectedRaidId !== null);
  const characters = useMemo(() => data?.characters.map(toBoardItem) ?? [], [data]);

  return (
    <main className="min-h-screen bg-gray-950 px-4 py-6 text-white md:px-6 md:py-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div>
          <h1 className="text-3xl font-bold">{t("globalTitle")}</h1>
          <p className="mt-2 max-w-3xl text-sm text-gray-400">{t("globalSubtitle")}</p>
        </div>

        <div className="grid gap-3 rounded-lg border border-gray-800 bg-gray-900/70 p-3 md:grid-cols-[minmax(260px,420px)_auto_auto_auto] md:items-end">
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
              className="min-h-10 w-full rounded-md border border-gray-700 bg-gray-800 px-3 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 md:w-28"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-400">{t("role")}</label>
            <select
              value={role}
              onChange={(event) => setRole(event.target.value as CharacterTierListRole | "all")}
              className="min-h-10 w-full rounded-md border border-gray-700 bg-gray-800 px-3 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 md:w-36"
            >
              {ROLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {t(option.labelKey)}
                </option>
              ))}
            </select>
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
        </div>

        {isLoading && <div className="rounded-lg border border-gray-800 bg-gray-900 px-4 py-8 text-center text-gray-400">{t("loading")}</div>}
        {error && <div className="rounded-lg border border-red-900 bg-red-950/40 px-4 py-8 text-center text-red-200">{t("error")}</div>}
        {!isLoading && !error && data && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-gray-400">
              <span>{t("characterCount", { visible: data.characters.length, total: data.total })}</span>
              {data.generatedAt && <span>{t("lastCalculated", { date: new Date(data.generatedAt).toLocaleString() })}</span>}
            </div>
            <CharacterTierBoard characters={characters} emptyMessage={t("noScoredCharacters")} />
          </div>
        )}
      </div>
    </main>
  );
}
