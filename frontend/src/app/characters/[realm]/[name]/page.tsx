"use client";

import { type KeyboardEvent, use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { Boss, CharacterProfileChoice, CharacterProfileLookupResponse, CharacterProfileResponse, CharacterRaidReportsResponse, RaidInfo } from "@/types";
import { useRaids } from "@/lib/queries";
import { buildRaidOrderIndex, compareRaidIdsByListOrder } from "@/lib/raid-priority";
import { formatRealmName, formatSpecName, formatTime, getClassInfoById, getGuildProfileUrl, getParseColor, getSpecIconUrl } from "@/lib/utils";
import IconImage from "@/components/IconImage";
import CharacterAvatar from "@/components/CharacterAvatar";
import { RaidAchievementMetric } from "@/components/RaidAchievementMetric";

interface PageProps {
  params: Promise<{ realm: string; name: string }>;
}

const CLASS_COLORS: Record<string, string> = {
  "Death Knight": "#C41E3A",
  "Demon Hunter": "#A330C9",
  Druid: "#FF7C0A",
  Evoker: "#33937F",
  Hunter: "#AAD372",
  Mage: "#3FC7EB",
  Monk: "#00FF98",
  Paladin: "#F48CBA",
  Priest: "#FFFFFF",
  Rogue: "#FFF468",
  Shaman: "#0070DD",
  Warlock: "#8788EE",
  Warrior: "#C69B6D",
};

type CharacterRaidTimelineRow = CharacterProfileResponse["raidTimeline"][number];
type CharacterRanking = CharacterProfileResponse["rankings"][number];
type CharacterMechanic = CharacterProfileResponse["mechanics"][number];

type DisplayRaidTimelineRow =
  | {
      type: "appearance";
      raid: RaidInfo;
      rows: CharacterRaidTimelineRow[];
      reportCount: number;
      firstSeenAt: string;
      lastSeenAt: string;
    }
  | {
      type: "missing";
      raid: RaidInfo;
    };

type SelectedTimelineReports = {
  raid: RaidInfo;
  rows: CharacterRaidTimelineRow[];
  row: CharacterRaidTimelineRow;
};

type BossRankingColumn = {
  encounterId: number;
  encounterName: string;
  boss?: Boss;
  bestRanking?: CharacterRanking;
};

type RankingRaidGroup = {
  zoneId: number;
  raidName: string;
  raid?: RaidInfo;
  bestAllStars?: CharacterRanking;
  bossColumns: BossRankingColumn[];
};

type MechanicsBossColumn = {
  encounterId: number;
  encounterName: string;
  boss?: Boss;
  bestMechanic?: CharacterMechanic;
};

type MechanicsRaidGroup = {
  zoneId: number;
  raidName: string;
  raid?: RaidInfo;
  bestOverall?: CharacterMechanic;
  bossColumns: MechanicsBossColumn[];
};

type CharacterPerformanceTab = "rankings" | "mechanics" | "combined";
type MechanicsScoreKind = "survival" | "combined";

const CHARACTER_PERFORMANCE_TABS: Array<{
  id: CharacterPerformanceTab;
  label: string;
  description: string;
}> = [
  {
    id: "rankings",
    label: "Rankings",
    description: "Best available parses grouped by raid and boss.",
  },
  {
    id: "mechanics",
    label: "Mechanics",
    description: "Survival score with early-death context.",
  },
  {
    id: "combined",
    label: "Combined",
    description: "Combined Mythic score with early-death context.",
  },
];

function formatShortDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getTime() <= 0) return "-";

  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}.${month}.${date.getFullYear()}`;
}

function getNullableDateTime(value?: string | null) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isNaN(time) || time <= 0 ? 0 : time;
}

function formatReportDateTime(value?: number | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";

  return date.toLocaleString("fi-FI", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatRealmSlug(value: string) {
  return value.toLowerCase().replace(/\s+/g, "-");
}

function getCharacterExternalUrls(region: string, realm: string, name: string) {
  const encodedRegion = encodeURIComponent(region.toLowerCase());
  const encodedRealm = encodeURIComponent(formatRealmSlug(realm));
  const encodedName = encodeURIComponent(name);

  return {
    wcl: `https://www.warcraftlogs.com/character/${encodedRegion}/${encodedRealm}/${encodedName}`,
    raiderIo: `https://raider.io/characters/${encodedRegion}/${encodedRealm}/${encodedName}`,
    armory: `https://worldofwarcraft.blizzard.com/en-gb/character/${encodedRegion}/${encodedRealm}/${encodedName}`,
  };
}

function getClassColor(className: string) {
  return CLASS_COLORS[className] ?? "#D1D5DB";
}

function formatScore(value: number) {
  return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function formatNullableScore(value?: number | null) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function formatEarlyDeaths(row?: Pick<CharacterMechanic, "deathDataAvailable" | "earlyDeaths" | "pulls">) {
  if (!row?.deathDataAvailable || row.pulls <= 0) return "-";
  return `${row.earlyDeaths}/${row.pulls}`;
}

function getBossKey(zoneId: number, encounterId: number) {
  return `${zoneId}:${encounterId}`;
}

function getCharacterProfileHref(realm: string, name: string, classID: number) {
  return `/characters/${encodeURIComponent(realm)}/${encodeURIComponent(name)}?class=${encodeURIComponent(String(classID))}`;
}

function getAccountHref(account: NonNullable<CharacterProfileResponse["character"]["account"]>) {
  return `/accounts/${encodeURIComponent(account.slug || account.groupId)}`;
}

function getRankingParse(row: CharacterRanking) {
  return row.rankPercent ?? -1;
}

function getBetterRanking(a: CharacterRanking, b: CharacterRanking) {
  const parseDiff = getRankingParse(b) - getRankingParse(a);
  if (parseDiff !== 0) return parseDiff;
  return b.score - a.score;
}

function getTimelineDateTime(value: string) {
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function sortTimelineGuildRows(a: CharacterRaidTimelineRow, b: CharacterRaidTimelineRow) {
  const reportDiff = b.reportCount - a.reportCount;
  if (reportDiff !== 0) return reportDiff;

  const lastSeenDiff = getTimelineDateTime(b.lastSeenAt) - getTimelineDateTime(a.lastSeenAt);
  if (lastSeenDiff !== 0) return lastSeenDiff;

  return a.guildName.localeCompare(b.guildName);
}

function getTimelineFirstSeen(rows: CharacterRaidTimelineRow[]) {
  return rows.reduce((earliest, row) => (getTimelineDateTime(row.firstSeenAt) < getTimelineDateTime(earliest) ? row.firstSeenAt : earliest), rows[0]?.firstSeenAt ?? "");
}

function getTimelineLastSeen(rows: CharacterRaidTimelineRow[]) {
  return rows.reduce((latest, row) => (getTimelineDateTime(row.lastSeenAt) > getTimelineDateTime(latest) ? row.lastSeenAt : latest), rows[0]?.lastSeenAt ?? "");
}

function getMetricIcon(metric: string | null) {
  if (metric === "hps") return "/icons/roleicon_healer.png";
  return "/icons/roleicon_damage.png";
}

function RankingsMetricCell({ row, compact = false }: { row: Pick<CharacterRanking, "metric">; compact?: boolean }) {
  const metric = row.metric?.toUpperCase() ?? "DPS";

  return (
    <div className={`flex items-center text-gray-300 ${compact ? "justify-end gap-1.5" : "gap-2"}`}>
      <Image src={getMetricIcon(row.metric)} alt={metric} width={18} height={18} className={`${compact ? "h-4 w-4" : "h-[18px] w-[18px]"} shrink-0`} />
      <span className="font-semibold">{metric}</span>
    </div>
  );
}

function getMechanicsScoreValue(row: CharacterMechanic, scoreKind: MechanicsScoreKind) {
  return scoreKind === "survival" ? row.survivalScore : row.score;
}

function compareMechanicsRows(scoreKind: MechanicsScoreKind) {
  return (a: CharacterMechanic, b: CharacterMechanic) => {
    const scoreA = getMechanicsScoreValue(a, scoreKind) ?? -1;
    const scoreB = getMechanicsScoreValue(b, scoreKind) ?? -1;
    const scoreDiff = scoreB - scoreA;
    if (scoreDiff !== 0) return scoreDiff;
    return (b.rankPercent ?? -1) - (a.rankPercent ?? -1);
  };
}

function MechanicsScoreCell({ row, scoreKind, compact = false }: { row?: CharacterMechanic; scoreKind: MechanicsScoreKind; compact?: boolean }) {
  if (!row) return <span className="text-gray-600">-</span>;

  const value = getMechanicsScoreValue(row, scoreKind);
  const colorValue = value === null || value === undefined ? 0 : Math.round(value);

  return (
    <span className={`inline-flex items-center justify-end font-semibold tabular-nums ${compact ? "text-sm" : ""}`} style={{ color: getParseColor(colorValue) }}>
      {formatNullableScore(value)}
    </span>
  );
}

function MechanicsBossScoreCell({ row, scoreKind, compact = false }: { row?: CharacterMechanic; scoreKind: MechanicsScoreKind; compact?: boolean }) {
  if (!row) return <span className="text-gray-600">-</span>;

  return (
    <span className="inline-flex flex-col items-center gap-0.5 tabular-nums">
      <MechanicsScoreCell row={row} scoreKind={scoreKind} compact={compact} />
      <span className="text-[11px] font-medium leading-none text-gray-500">{formatEarlyDeaths(row)}</span>
    </span>
  );
}

function RankingsBossParseCell({ row, classId, compact = false }: { row?: CharacterRanking; classId: number; compact?: boolean }) {
  if (!row || row.rankPercent === null) return <span className="text-gray-600">-</span>;

  const parsePercent = Math.floor(row.rankPercent);
  const specIcon = row.specName ? getSpecIconUrl(classId, row.specName) : undefined;

  return (
    <span className={`inline-flex items-center justify-end gap-1 font-semibold tabular-nums ${compact ? "text-sm" : ""}`} style={{ color: getParseColor(parsePercent) }}>
      {parsePercent}
      {specIcon ? (
        <IconImage
          iconFilename={specIcon}
          alt={`${formatSpecName(row.specName!)} icon`}
          width={compact ? 14 : 16}
          height={compact ? 14 : 16}
          className={`${compact ? "h-3.5 w-3.5" : "h-4 w-4"} rounded`}
        />
      ) : null}
    </span>
  );
}

function buildMechanicsRaidGroups(rows: CharacterMechanic[] | undefined, raids: RaidInfo[], bossesByRaid: Map<number, Boss[]>, scoreKind: MechanicsScoreKind): MechanicsRaidGroup[] {
  if (!rows?.length) return [];

  const raidById = new Map(raids.map((raid) => [raid.id, raid]));
  const raidOrderIndex = buildRaidOrderIndex(raids);
  const compareMechanics = compareMechanicsRows(scoreKind);
  const groups = new Map<number, { zoneId: number; raidName: string; raid?: RaidInfo; overall: CharacterMechanic[]; bossMechanics: Map<number, CharacterMechanic[]> }>();

  rows.forEach((row) => {
    if (!row.deathDataAvailable || row.survivalScore === null) return;

    const group = groups.get(row.zoneId) ?? {
      zoneId: row.zoneId,
      raidName: row.raidName,
      raid: raidById.get(row.zoneId),
      overall: [],
      bossMechanics: new Map<number, CharacterMechanic[]>(),
    };

    if (row.encounterId === null) {
      group.overall.push(row);
    } else {
      const mechanics = group.bossMechanics.get(row.encounterId) ?? [];
      mechanics.push(row);
      group.bossMechanics.set(row.encounterId, mechanics);
    }

    groups.set(row.zoneId, group);
  });

  return Array.from(groups.values())
    .sort((a, b) => compareRaidIdsByListOrder(a.zoneId, b.zoneId, raidOrderIndex))
    .map((group) => {
      const bosses = bossesByRaid.get(group.zoneId) ?? [];
      const bossEntries =
        bosses.length > 0
          ? bosses.map((boss) => [boss.id, boss.name, boss] as const)
          : Array.from(group.bossMechanics.entries()).map(([encounterId, mechanics]) => {
              const bestMechanic = [...mechanics].sort(compareMechanics)[0];
              return [encounterId, bestMechanic.encounterName ?? `Encounter ${encounterId}`, undefined] as const;
            });

      return {
        zoneId: group.zoneId,
        raidName: group.raidName,
        raid: group.raid,
        bestOverall: [...group.overall].sort(compareMechanics)[0],
        bossColumns: bossEntries.map(([encounterId, encounterName, boss]) => ({
          encounterId,
          encounterName,
          boss,
          bestMechanic: [...(group.bossMechanics.get(encounterId) ?? [])].sort(compareMechanics)[0],
        })),
      };
    });
}

function RaidNameCell({ raid, muted = false }: { raid: RaidInfo; muted?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <IconImage iconFilename={raid.iconUrl} alt={`${raid.name} icon`} width={24} height={24} className="h-6 w-6 shrink-0 rounded object-cover" />
      <span className={`truncate font-semibold ${muted ? "" : "text-gray-100"}`}>{raid.name}</span>
    </div>
  );
}

function CharacterExternalLink({ href, title, src, alt, imageClassName = "" }: { href: string; title: string; src: string; alt: string; imageClassName?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={title}
      title={title}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md opacity-80 transition-[opacity,transform] hover:opacity-100 focus-visible:outline focus-visible:outline-blue-400 active:scale-[0.96] md:h-8 md:w-8"
    >
      <Image src={src} alt={alt} width={24} height={24} className={`h-5 w-5 object-contain md:h-6 md:w-6 ${imageClassName}`} />
    </a>
  );
}

function AccountCharactersDropdown({
  account,
  current,
}: {
  account?: CharacterProfileResponse["character"]["account"];
  current: Pick<CharacterProfileResponse["character"], "name" | "realm" | "classID">;
}) {
  const [isOpen, setIsOpen] = useState(false);

  if (!account || account.characters.length <= 1) return null;

  const sortedCharacters = [...account.characters].sort((a, b) => {
    const currentA = a.name === current.name && a.realm === current.realm && a.classID === current.classID;
    const currentB = b.name === current.name && b.realm === current.realm && b.classID === current.classID;
    if (currentA !== currentB) return currentA ? -1 : 1;
    const lastSeenA = getNullableDateTime(a.lastSeenAt ?? a.lastMythicSeenAt);
    const lastSeenB = getNullableDateTime(b.lastSeenAt ?? b.lastMythicSeenAt);
    return lastSeenB - lastSeenA || a.name.localeCompare(b.name);
  });

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        className="inline-flex min-h-8 items-center gap-1.5 rounded-md px-2 text-xs font-semibold text-gray-400 ring-1 ring-gray-800 transition-[background-color,color,transform] hover:bg-gray-900 hover:text-gray-200 focus-visible:outline focus-visible:outline-blue-400 active:scale-[0.96] md:min-h-9 md:px-2.5"
        aria-label="Show inferred same-account characters"
        aria-expanded={isOpen}
      >
        <span>Account</span>
        <span className="text-gray-500 tabular-nums">{account.characters.length}</span>
        <span className={`text-gray-500 transition-transform ${isOpen ? "rotate-180" : ""}`}>v</span>
      </button>

      {isOpen ? (
        <div className="absolute right-0 top-10 z-20 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg bg-gray-950 shadow-[0_18px_55px_rgba(0,0,0,0.45)] ring-1 ring-gray-700">
          <div className="flex items-center justify-between border-b border-gray-800 px-3 py-2 text-xs">
            <span className="font-semibold text-gray-300">{account.displayName || "Account"} characters</span>
            <Link href={getAccountHref(account)} onClick={() => setIsOpen(false)} className="font-semibold text-blue-300 transition-colors hover:text-blue-200">
              View account
            </Link>
          </div>
          <div className="max-h-96 overflow-y-auto py-1">
            {sortedCharacters.map((member) => {
              const classInfo = getClassInfoById(member.classID);
              const isCurrent = member.name === current.name && member.realm === current.realm && member.classID === current.classID;

              return (
                <Link
                  key={member.characterId}
                  href={getCharacterProfileHref(member.realm, member.name, member.classID)}
                  onClick={() => setIsOpen(false)}
                  className={`flex min-w-0 items-center gap-3 px-3 py-2 transition-colors hover:bg-gray-900 focus-visible:bg-gray-900 focus-visible:outline focus-visible:outline-blue-400 ${
                    isCurrent ? "bg-cyan-950/30" : ""
                  }`}
                >
                  <span className="relative h-8 w-8 shrink-0 overflow-hidden rounded">
                    <IconImage iconFilename={classInfo.iconUrl} alt={classInfo.name} fill style={{ objectFit: "cover" }} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-baseline gap-2">
                      <span className="truncate text-sm font-semibold" style={{ color: getClassColor(classInfo.name) }}>
                        {member.name}
                      </span>
                      <span className="shrink-0 text-xs font-semibold text-gray-500">{formatRealmName(member.realm)}</span>
                    </span>
                    <span className="flex min-w-0 items-center justify-between gap-3 text-xs text-gray-500">
                      <span className="truncate">{member.guildName ?? "No guild"}</span>
                      <span className="shrink-0 tabular-nums">{formatShortDate(member.lastSeenAt ?? member.lastMythicSeenAt)}</span>
                    </span>
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CharacterRaidReportsDialog({
  selected,
  reports,
  loading,
  error,
  onSelectGuild,
  onClose,
}: {
  selected: SelectedTimelineReports;
  reports: CharacterRaidReportsResponse | null;
  loading: boolean;
  error: string | null;
  onSelectGuild: (row: CharacterRaidTimelineRow) => void;
  onClose: () => void;
}) {
  function handleGuildRowKeyDown(event: KeyboardEvent<HTMLTableRowElement>, row: CharacterRaidTimelineRow) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onSelectGuild(row);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="w-full max-w-5xl overflow-hidden rounded-lg bg-gray-900 shadow-[0_18px_70px_rgba(0,0,0,0.55)] ring-1 ring-gray-700"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-gray-700 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <IconImage iconFilename={selected.raid.iconUrl} alt={`${selected.raid.name} icon`} width={32} height={32} className="h-8 w-8 shrink-0 rounded object-cover" />
            <div className="min-w-0">
              <h2 className="truncate text-lg font-semibold text-white">{selected.raid.name} Reports</h2>
              <p className="truncate text-sm text-gray-400">{selected.row.guildName}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-md bg-gray-800 text-lg leading-none text-gray-200 transition-colors hover:bg-gray-700 focus-visible:outline focus-visible:outline-blue-400 active:scale-[0.96]"
            aria-label="Close reports dialog"
          >
            x
          </button>
        </div>

        <div className="max-h-[72vh] overflow-y-auto">
          <div className="border-b border-gray-800 bg-gray-950/35">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] border-collapse">
                <thead>
                  <tr className="text-left text-xs font-semibold uppercase text-gray-500">
                    <th className="px-4 py-2.5">Guild</th>
                    <th className="px-4 py-2.5 text-right">Reports</th>
                    <th className="px-4 py-2.5">First Seen</th>
                    <th className="px-4 py-2.5">Last Seen</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.rows.map((row) => {
                    const isSelected = row.guildId === selected.row.guildId;
                    return (
                      <tr
                        key={`${row.zoneId}-${row.guildId}`}
                        role="button"
                        tabIndex={0}
                        title={`Show ${row.reportCount} reports for ${row.guildName}`}
                        onClick={() => onSelectGuild(row)}
                        onKeyDown={(event) => handleGuildRowKeyDown(event, row)}
                        className={`cursor-pointer border-t border-gray-800 transition-colors first:border-t-0 focus-visible:bg-blue-950/35 focus-visible:outline-2 focus-visible:outline-blue-500 ${
                          isSelected ? "bg-blue-950/35 text-gray-100" : "text-gray-400 hover:bg-gray-800/45"
                        }`}
                      >
                        <td className="px-4 py-3 font-semibold">
                          <Link
                            href={getGuildProfileUrl(row.guildRealm, row.guildName)}
                            onClick={(event) => event.stopPropagation()}
                            className={`${isSelected ? "text-blue-200" : "text-blue-300"} transition-colors hover:text-blue-100`}
                          >
                            {row.guildName}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-right font-semibold tabular-nums">{row.reportCount}</td>
                        <td className="px-4 py-3 text-sm tabular-nums">{formatShortDate(row.firstSeenAt)}</td>
                        <td className="px-4 py-3 text-sm tabular-nums">{formatShortDate(row.lastSeenAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {loading ? (
            <div className="px-4 py-10 text-center text-gray-300">Loading reports...</div>
          ) : error ? (
            <div className="px-4 py-10 text-center text-red-300">{error}</div>
          ) : reports?.reports.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] border-collapse">
                <thead className="sticky top-0 z-10 bg-gray-900 shadow-[0_1px_0_rgba(55,65,81,1)]">
                  <tr className="text-left text-xs font-semibold uppercase text-gray-400">
                    <th className="px-4 py-3">Report</th>
                    <th className="px-4 py-3">Started</th>
                    <th className="px-4 py-3 text-right">Duration</th>
                    <th className="px-4 py-3 text-right">Pulls</th>
                    <th className="px-4 py-3 text-right">Kills</th>
                    <th className="px-4 py-3 text-right">Wipes</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">WCL</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.reports.map((report) => (
                    <tr key={report.code} className="border-b border-gray-800/80 last:border-0 hover:bg-gray-800/45">
                      <td className="px-4 py-3 font-mono text-sm font-semibold text-gray-100">{report.code}</td>
                      <td className="px-4 py-3 text-sm tabular-nums text-gray-300">{formatReportDateTime(report.startTime)}</td>
                      <td className="px-4 py-3 text-right text-sm tabular-nums text-gray-300">{report.durationSeconds !== undefined ? formatTime(report.durationSeconds) : "-"}</td>
                      <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums text-gray-200">{report.fightCount}</td>
                      <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums text-green-300">{report.kills}</td>
                      <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums text-red-300">{report.wipes}</td>
                      <td className="px-4 py-3 text-sm">
                        {report.isOngoing ? (
                          <span className="inline-flex rounded bg-green-900/60 px-2 py-1 text-xs font-semibold uppercase text-green-300">Live</span>
                        ) : (
                          <span className="text-gray-500">Complete</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <a
                          href={report.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex min-h-10 items-center justify-center rounded-md bg-gray-800 px-3 text-sm font-semibold text-blue-300 transition-colors hover:bg-gray-700 hover:text-blue-200 focus-visible:outline focus-visible:outline-blue-400 active:scale-[0.96]"
                        >
                          Open
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="px-4 py-10 text-center text-gray-400">No report appearances were found for this timeline row.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function CharacterChoiceCard({ choice }: { choice: CharacterProfileChoice }) {
  const classInfo = getClassInfoById(choice.classID);

  return (
    <Link
      href={getCharacterProfileHref(choice.realm, choice.name, choice.classID)}
      className="group flex min-h-[136px] flex-col justify-between rounded-lg bg-gray-900 p-4 shadow-[0_10px_30px_rgba(0,0,0,0.24)] ring-1 ring-gray-700 transition-[background-color,box-shadow,transform] hover:bg-gray-800/80 hover:shadow-[0_16px_42px_rgba(0,0,0,0.34)] focus-visible:outline focus-visible:outline-blue-400 active:scale-[0.96]"
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="relative h-12 w-12 shrink-0 overflow-hidden rounded-md shadow-sm shadow-black/35 ring-1 ring-white/10">
          <IconImage iconFilename={classInfo.iconUrl} alt={classInfo.name} fill style={{ objectFit: "cover" }} />
        </span>
        <div className="min-w-0">
          <div className="truncate text-lg font-bold" style={{ color: getClassColor(classInfo.name) }}>
            {choice.name}
          </div>
          <div className="truncate text-sm font-semibold text-gray-400">
            {classInfo.name} <span className="text-gray-600">{formatRealmName(choice.realm)}</span>
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
        <div>
          <div className="text-xs text-gray-500">Reports</div>
          <div className="font-bold tabular-nums text-gray-100">{choice.reportCount}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">Guilds</div>
          <div className="font-bold tabular-nums text-gray-100">{choice.guildCount}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">Last Seen</div>
          <div className="font-bold tabular-nums text-gray-100">{formatShortDate(choice.lastSeenAt)}</div>
        </div>
      </div>

      {choice.latestGuild ? (
        <div className="mt-3 truncate text-xs font-semibold text-gray-500">
          {choice.latestGuild.name} <span className="text-gray-700">{formatRealmName(choice.latestGuild.realm)}</span>
        </div>
      ) : null}
    </Link>
  );
}

function formatMythicPlusTime(ms?: number | null) {
  if (!ms || !Number.isFinite(ms) || ms <= 0) return "-";
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function MythicPlusRunTile({ run }: { run: CharacterProfileResponse["mythicPlus"]["seasons"][number]["dungeonRuns"][number] }) {
  const content = (
    <>
      <IconImage iconFilename={run.dungeonIconUrl ?? undefined} alt={run.dungeonName} width={26} height={26} className="h-[26px] w-[26px] rounded object-cover" />
      <div className="max-w-full truncate text-xs font-semibold text-gray-300">{run.dungeonShortName || run.dungeonName}</div>
      <div className="text-sm font-bold tabular-nums text-gray-100">+{run.mythicLevel}</div>
      <div className="text-[11px] font-semibold tabular-nums text-gray-500">{formatMythicPlusTime(run.clearTimeMs)}</div>
    </>
  );
  const className = `flex min-w-0 flex-col items-center justify-start gap-1 rounded-md px-2 py-2 ring-1 ring-gray-800 ${run.url ? "transition-colors hover:bg-gray-800" : ""}`;

  if (!run.url) {
    return (
      <div className={className} title={run.dungeonName}>
        {content}
      </div>
    );
  }

  return (
    <a href={run.url} target="_blank" rel="noopener noreferrer" className={className} title={run.dungeonName}>
      {content}
    </a>
  );
}

function CharacterMythicPlusSection({ mythicPlus, classId }: { mythicPlus: CharacterProfileResponse["mythicPlus"]; classId: number }) {
  const seasons = mythicPlus?.seasons ?? [];

  return (
    <section className="rounded-lg border border-gray-700 bg-gray-900">
      <div className="border-b border-gray-700 px-4 py-3">
        <h2 className="text-lg font-semibold text-white">Mythic+</h2>
        <p className="text-sm text-gray-400">Season score and best dungeon runs from Raider.IO.</p>
      </div>
      {seasons.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1120px] border-collapse">
            <colgroup>
              <col className="w-[220px]" />
              <col className="w-[112px]" />
              <col className="w-[150px]" />
              <col className="w-[190px]" />
              <col />
            </colgroup>
            <thead>
              <tr className="border-b border-gray-800 text-left text-xs font-semibold text-gray-400">
                <th className="px-4 py-2.5">Season</th>
                <th className="px-3 py-2.5 text-right">Score</th>
                <th className="px-3 py-2.5 text-right">Best spec</th>
                <th className="px-3 py-2.5 text-right">Roles</th>
                <th className="px-3 py-2.5">Dungeons</th>
              </tr>
            </thead>
            <tbody>
              {seasons.map((season) => (
                <tr key={season.season} className="border-b border-gray-800 last:border-0">
                  <td className="px-4 py-4">
                    <div className="font-semibold text-gray-100">{season.shortName || season.seasonName}</div>
                    <div className="mt-0.5 text-xs text-gray-500">{season.season}</div>
                  </td>
                  <td className="px-3 py-4 text-right font-bold tabular-nums text-cyan-300">{formatNullableScore(season.scores.all)}</td>
                  <td className="px-3 py-4 text-right">
                    {season.bestSpec?.name ? (
                      <span className="inline-flex items-center justify-end gap-1.5 font-semibold text-gray-200">
                        <span>{season.bestSpec.name}</span>
                        <span className="tabular-nums text-gray-500">{formatNullableScore(season.bestSpec.score)}</span>
                        <IconImage
                          iconFilename={season.bestSpec.slug ? getSpecIconUrl(classId, season.bestSpec.slug) : undefined}
                          alt={season.bestSpec.name}
                          width={18}
                          height={18}
                          className="h-[18px] w-[18px] rounded"
                        />
                      </span>
                    ) : (
                      <span className="text-gray-600">-</span>
                    )}
                  </td>
                  <td className="px-3 py-4 text-right text-xs font-semibold tabular-nums text-gray-300">
                    <div>DPS {formatNullableScore(season.scores.dps)}</div>
                    <div>Heal {formatNullableScore(season.scores.healer)}</div>
                    <div>Tank {formatNullableScore(season.scores.tank)}</div>
                  </td>
                  <td className="px-3 py-3">
                    {season.dungeonRuns.length ? (
                      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.max(season.dungeonRuns.length, 1)}, minmax(92px, 1fr))` }}>
                        {season.dungeonRuns.map((run) => (
                          <MythicPlusRunTile key={`${season.season}-${run.dungeonId}`} run={run} />
                        ))}
                      </div>
                    ) : (
                      <span className="text-gray-600">No dungeon runs fetched</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="px-4 py-8 text-center text-gray-400">No Mythic+ data has been fetched for this character.</div>
      )}
    </section>
  );
}

function CharacterChoicesView({ name, realm, choices }: { name: string; realm: string; choices: CharacterProfileChoice[] }) {
  return (
    <main className="min-h-screen px-4 py-8">
      <div className="mx-auto max-w-5xl space-y-5">
        <header className="py-2">
          <h1 className="text-3xl font-bold text-white md:text-4xl">{name}</h1>
          <p className="mt-1 text-lg font-semibold text-gray-500">{formatRealmName(realm)}</p>
        </header>

        <section className="rounded-lg bg-gray-950/35 p-4 shadow-[0_1px_0_rgba(255,255,255,0.06)_inset] ring-1 ring-gray-800">
          <h2 className="text-lg font-semibold text-white">Select Character</h2>
          <p className="text-sm text-gray-400">Multiple classes have appeared with this character name and realm in raid reports.</p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {choices.map((choice) => (
              <CharacterChoiceCard key={`${choice.region}-${choice.realm}-${choice.name}-${choice.classID}`} choice={choice} />
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

export default function CharacterProfilePage({ params }: PageProps) {
  const resolvedParams = use(params);
  const router = useRouter();
  const tRaidAchievements = useTranslations("raidAchievements");
  const tCharacterProfile = useTranslations("characterProfile");
  const realm = decodeURIComponent(resolvedParams.realm);
  const name = decodeURIComponent(resolvedParams.name);
  const searchParams = useSearchParams();
  const classParam = searchParams.get("class");
  const selectedClassId = useMemo(() => {
    if (!classParam) return undefined;
    const parsed = Number(classParam);
    return Number.isFinite(parsed) ? parsed : undefined;
  }, [classParam]);
  const [lookup, setLookup] = useState<CharacterProfileLookupResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bossesByRaid, setBossesByRaid] = useState<Map<number, Boss[]>>(new Map());
  const [selectedTimelineReports, setSelectedTimelineReports] = useState<SelectedTimelineReports | null>(null);
  const [timelineReports, setTimelineReports] = useState<CharacterRaidReportsResponse | null>(null);
  const [timelineReportsLoading, setTimelineReportsLoading] = useState(false);
  const [timelineReportsError, setTimelineReportsError] = useState<string | null>(null);
  const [isNameHistoryOpen, setIsNameHistoryOpen] = useState(false);
  const [activePerformanceTab, setActivePerformanceTab] = useState<CharacterPerformanceTab>("rankings");
  const timelineReportsRequestId = useRef(0);
  const { data: raids = [], isLoading: isLoadingRaids, error: raidsError } = useRaids();
  const profile = lookup?.type === "profile" ? lookup : null;
  const choices = lookup?.type === "choices" ? lookup : null;

  useEffect(() => {
    let cancelled = false;

    async function loadProfile() {
      setLoading(true);
      setError(null);

      try {
        const response = await api.getCharacterProfileByRealmName(realm, name, selectedClassId);
        if (!cancelled && response.canonicalPath) {
          router.replace(selectedClassId ? `${response.canonicalPath}?class=${encodeURIComponent(selectedClassId)}` : response.canonicalPath);
          return;
        }
        if (!cancelled) setLookup(response);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load character profile");
          setLookup(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadProfile();

    return () => {
      cancelled = true;
    };
  }, [realm, name, router, selectedClassId]);

  useEffect(() => {
    if (!profile?.rankings.length && !profile?.mechanics?.length) {
      setBossesByRaid(new Map());
      return;
    }

    let cancelled = false;
    const rankedRaidIds = Array.from(new Set([...(profile.rankings ?? []).map((row) => row.zoneId), ...(profile.mechanics ?? []).map((row) => row.zoneId)]));
    if (!rankedRaidIds.length) return;
    setBossesByRaid(new Map());

    async function loadBosses() {
      const entries = await Promise.all(
        rankedRaidIds.map(async (zoneId) => {
          try {
            return [zoneId, await api.getBosses(zoneId)] as const;
          } catch {
            return [zoneId, [] as Boss[]] as const;
          }
        }),
      );

      if (cancelled) return;
      setBossesByRaid((current) => {
        const next = new Map(current);
        entries.forEach(([zoneId, bosses]) => next.set(zoneId, bosses));
        return next;
      });
    }

    loadBosses();

    return () => {
      cancelled = true;
    };
  }, [profile]);

  const handleCloseTimelineReports = useCallback(() => {
    timelineReportsRequestId.current += 1;
    setSelectedTimelineReports(null);
    setTimelineReports(null);
    setTimelineReportsError(null);
    setTimelineReportsLoading(false);
  }, []);

  useEffect(() => {
    if (!selectedTimelineReports) return;

    function handleEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        handleCloseTimelineReports();
      }
    }

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [selectedTimelineReports, handleCloseTimelineReports]);

  async function handleOpenTimelineReports(raid: RaidInfo, row: CharacterRaidTimelineRow, rows: CharacterRaidTimelineRow[] = [row]) {
    const requestId = timelineReportsRequestId.current + 1;
    timelineReportsRequestId.current = requestId;
    setSelectedTimelineReports({ raid, rows, row });
    setTimelineReports(null);
    setTimelineReportsError(null);
    setTimelineReportsLoading(true);

    try {
      const response = await api.getCharacterRaidReportsByRealmName(row.characterRealm, row.characterName, row.zoneId, row.guildId, profile?.character.classID);
      if (timelineReportsRequestId.current === requestId) {
        setTimelineReports(response);
      }
    } catch (err) {
      if (timelineReportsRequestId.current === requestId) {
        setTimelineReportsError(err instanceof Error ? err.message : "Failed to load reports");
      }
    } finally {
      if (timelineReportsRequestId.current === requestId) {
        setTimelineReportsLoading(false);
      }
    }
  }

  function handleOpenTimelineGroup(raid: RaidInfo, rows: CharacterRaidTimelineRow[]) {
    const [primaryRow] = rows;
    if (!primaryRow) return;
    handleOpenTimelineReports(raid, primaryRow, rows);
  }

  function handleSelectTimelineReportsGuild(row: CharacterRaidTimelineRow) {
    if (!selectedTimelineReports) return;
    handleOpenTimelineReports(selectedTimelineReports.raid, row, selectedTimelineReports.rows);
  }

  function handleTimelineReportKeyDown(event: KeyboardEvent<HTMLTableRowElement>, raid: RaidInfo, rows: CharacterRaidTimelineRow[]) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    handleOpenTimelineGroup(raid, rows);
  }

  const raidTimelineRows = useMemo<DisplayRaidTimelineRow[]>(() => {
    if (!profile) return [];

    const raidById = new Map(raids.map((raid) => [raid.id, raid]));
    const raidOrderIndex = buildRaidOrderIndex(raids);
    const trackedTimelineRows = profile.raidTimeline
      .filter((row) => raidById.has(row.zoneId))
      .sort((a, b) => {
        if (a.zoneId !== b.zoneId) return compareRaidIdsByListOrder(a.zoneId, b.zoneId, raidOrderIndex);
        return new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime();
      });

    if (trackedTimelineRows.length === 0) return [];

    const rowsByRaidId = new Map<number, CharacterRaidTimelineRow[]>();
    trackedTimelineRows.forEach((row) => {
      const rows = rowsByRaidId.get(row.zoneId) ?? [];
      rows.push(row);
      rowsByRaidId.set(row.zoneId, rows);
    });

    const presentRaidIndexes = trackedTimelineRows.map((row) => raids.findIndex((raid) => raid.id === row.zoneId)).filter((index) => index !== -1);
    const firstIndex = Math.min(...presentRaidIndexes);
    const lastIndex = Math.max(...presentRaidIndexes);

    return raids.slice(firstIndex, lastIndex + 1).flatMap((raid): DisplayRaidTimelineRow[] => {
      const rows = rowsByRaidId.get(raid.id);
      if (!rows?.length) return [{ type: "missing", raid }];
      const sortedRows = [...rows].sort(sortTimelineGuildRows);
      return [
        {
          type: "appearance",
          raid,
          rows: sortedRows,
          reportCount: sortedRows.reduce((total, row) => total + row.reportCount, 0),
          firstSeenAt: getTimelineFirstSeen(sortedRows),
          lastSeenAt: getTimelineLastSeen(sortedRows),
        },
      ];
    });
  }, [profile, raids]);
  const raidReportCount = raidTimelineRows.reduce((total, row) => (row.type === "appearance" ? total + row.reportCount : total), 0);
  const rankingRaidGroups = useMemo<RankingRaidGroup[]>(() => {
    if (!profile?.rankings.length) return [];

    const raidById = new Map(raids.map((raid) => [raid.id, raid]));
    const raidOrderIndex = buildRaidOrderIndex(raids);
    const groups = new Map<number, { zoneId: number; raidName: string; raid?: RaidInfo; allStars: CharacterRanking[]; bossRankings: Map<number, CharacterRanking[]> }>();

    profile.rankings.forEach((row) => {
      const group = groups.get(row.zoneId) ?? {
        zoneId: row.zoneId,
        raidName: row.raidName,
        raid: raidById.get(row.zoneId),
        allStars: [],
        bossRankings: new Map<number, CharacterRanking[]>(),
      };

      if (row.encounterId === null) {
        group.allStars.push(row);
      } else {
        const rankings = group.bossRankings.get(row.encounterId) ?? [];
        rankings.push(row);
        group.bossRankings.set(row.encounterId, rankings);
      }

      groups.set(row.zoneId, group);
    });

    return Array.from(groups.values())
      .sort((a, b) => compareRaidIdsByListOrder(a.zoneId, b.zoneId, raidOrderIndex))
      .map((group) => {
        const bosses = bossesByRaid.get(group.zoneId) ?? [];
        const bossEntries =
          bosses.length > 0
            ? bosses.map((boss) => [boss.id, boss.name, boss] as const)
            : Array.from(group.bossRankings.entries()).map(([encounterId, rankings]) => {
                const bestRanking = [...rankings].sort(getBetterRanking)[0];
                return [encounterId, bestRanking.encounterName ?? `Encounter ${encounterId}`, undefined] as const;
              });

        return {
          zoneId: group.zoneId,
          raidName: group.raidName,
          raid: group.raid,
          bestAllStars: [...group.allStars].sort(getBetterRanking)[0],
          bossColumns: bossEntries.map(([encounterId, encounterName, boss]) => ({
            encounterId,
            encounterName,
            boss,
            bestRanking: [...(group.bossRankings.get(encounterId) ?? [])].sort(getBetterRanking)[0],
          })),
        };
      });
  }, [profile, raids, bossesByRaid]);

  const survivalRaidGroups = useMemo<MechanicsRaidGroup[]>(() => buildMechanicsRaidGroups(profile?.mechanics, raids, bossesByRaid, "survival"), [profile, raids, bossesByRaid]);
  const combinedRaidGroups = useMemo<MechanicsRaidGroup[]>(() => buildMechanicsRaidGroups(profile?.mechanics, raids, bossesByRaid, "combined"), [profile, raids, bossesByRaid]);

  if (loading || isLoadingRaids) {
    return (
      <main className="min-h-screen px-4 py-8">
        <div className="mx-auto max-w-[1500px] text-center text-gray-300">Loading character...</div>
      </main>
    );
  }

  if (choices) {
    return <CharacterChoicesView name={choices.character.name} realm={choices.character.realm} choices={choices.choices} />;
  }

  if (error || raidsError || !profile) {
    return (
      <main className="min-h-screen px-4 py-8">
        <div className="mx-auto max-w-[1500px] rounded-lg border border-gray-700 bg-gray-900 p-8 text-center">
          <h1 className="text-xl font-semibold text-white">Character not found</h1>
          <p className="mt-2 text-sm text-gray-400">{error ?? (raidsError instanceof Error ? raidsError.message : "No character profile exists for this realm and name.")}</p>
        </div>
      </main>
    );
  }

  const character = profile.character;
  const classInfo = getClassInfoById(character.classID);
  const characterAchievements = character.raidAchievements?.achievements ?? [];
  const externalUrls = getCharacterExternalUrls(character.region, character.realm, character.name);
  const nameHistory = character.nameHistory ?? [];
  const activePerformanceConfig = CHARACTER_PERFORMANCE_TABS.find((tab) => tab.id === activePerformanceTab) ?? CHARACTER_PERFORMANCE_TABS[0];
  const activeMechanicsScoreKind: MechanicsScoreKind = activePerformanceTab === "mechanics" ? "survival" : "combined";
  const activeMechanicsRaidGroups = activePerformanceTab === "mechanics" ? survivalRaidGroups : combinedRaidGroups;
  const activeMechanicsScoreLabel = activePerformanceTab === "mechanics" ? "Survival" : "Score";
  const activeMechanicsBossLabel = activePerformanceTab === "mechanics" ? "Boss survival" : "Boss scores";
  const activeMechanicsEmptyLabel =
    activePerformanceTab === "mechanics" ? "No survival scores have been calculated for this character." : "No combined scores have been calculated for this character.";

  return (
    <main className="min-h-screen px-4 py-8">
      <div className="mx-auto max-w-[1500px] space-y-6">
        <header className="py-2">
          <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0 md:pr-6">
              <div className="flex min-w-0 items-center gap-4">
                <CharacterAvatar
                  classIcon={classInfo.iconUrl}
                  characterName={character.name}
                  className="h-14 w-14 md:h-16 md:w-16"
                />
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-1">
                      <h1 className="min-w-0 text-3xl font-bold leading-none md:text-4xl" style={{ color: getClassColor(classInfo.name) }}>
                        {character.name}
                      </h1>
                      {nameHistory.length > 1 ? (
                        <div className="relative shrink-0">
                          <button
                            type="button"
                            onClick={() => setIsNameHistoryOpen((open) => !open)}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-sm font-bold text-gray-500 transition-[background-color,color,transform] hover:bg-gray-900 hover:text-gray-200 focus-visible:outline focus-visible:outline-blue-400 active:scale-[0.96]"
                            aria-label="Show name history"
                            aria-expanded={isNameHistoryOpen}
                          >
                            <span className={`transition-transform ${isNameHistoryOpen ? "rotate-180" : ""}`}>v</span>
                          </button>
                          {isNameHistoryOpen ? (
                            <div className="absolute left-0 top-9 z-20 w-72 overflow-hidden rounded-lg bg-gray-950 shadow-[0_18px_55px_rgba(0,0,0,0.45)] ring-1 ring-gray-700">
                              <div className="max-h-80 overflow-y-auto py-1">
                                {nameHistory.map((entry) => {
                                  const isCurrent = entry.name === character.name && entry.realm === character.realm;
                                  return (
                                    <div key={`${entry.region}-${entry.realm}-${entry.name}`} className="px-3 py-2 text-sm">
                                      <div className="flex items-center justify-between gap-3">
                                        <div className="min-w-0">
                                          <div className={`truncate font-semibold ${isCurrent ? "text-white" : "text-gray-300"}`}>{entry.name}</div>
                                          <div className="truncate text-xs text-gray-500">{formatRealmName(entry.realm)}</div>
                                        </div>
                                        <div className="shrink-0 text-right text-xs text-gray-500">
                                          <div className="tabular-nums">{entry.reportCount}</div>
                                          <div className="tabular-nums">{formatShortDate(entry.lastSeenAt)}</div>
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                      <div className="flex shrink-0 items-center gap-0">
                        <CharacterExternalLink href={externalUrls.wcl} title="View on Warcraft Logs" src="/wcl-logo.png" alt="Warcraft Logs" />
                        <CharacterExternalLink href={externalUrls.raiderIo} title="View on Raider.IO" src="/raiderio-logo.png" alt="Raider.IO" />
                        <CharacterExternalLink href={externalUrls.armory} title="View on World of Warcraft Armory" src="/wow_logo.png" alt="World of Warcraft" />
                      </div>
                      <AccountCharactersDropdown account={character.account} current={character} />
                    </div>
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="text-lg font-semibold leading-none text-gray-500 md:text-xl">{formatRealmName(character.realm)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-3 text-sm md:ml-auto md:justify-end md:text-right md:text-base">
              <div>
                <div className="text-gray-500">Reports</div>
                <div className="text-xl font-bold tabular-nums text-gray-100 md:text-2xl">{raidReportCount}</div>
              </div>
              <div>
                <div className="text-gray-500">Guilds</div>
                <div className="text-xl font-bold tabular-nums text-gray-100 md:text-2xl">{profile.character.guildHistory.length}</div>
              </div>
              <div>
                <RaidAchievementMetric
                  type="cutting_edge"
                  title={tRaidAchievements("cuttingEdge")}
                  shortTitle={tRaidAchievements("cuttingEdgeShort")}
                  count={character.raidAchievements?.cuttingEdgeCount}
                  achievements={characterAchievements.filter((achievement) => achievement.type === "cutting_edge")}
                />
              </div>
              <div>
                <RaidAchievementMetric
                  type="ahead_of_the_curve"
                  title={tRaidAchievements("aheadOfTheCurve")}
                  shortTitle={tRaidAchievements("aheadOfTheCurveShort")}
                  count={character.raidAchievements?.aheadOfTheCurveCount}
                  achievements={characterAchievements.filter((achievement) => achievement.type === "ahead_of_the_curve")}
                />
              </div>
              <div>
                <div className="text-gray-500">{tCharacterProfile("firstSeen")}</div>
                <div className="text-lg font-bold tabular-nums text-gray-100 md:text-xl">{formatShortDate(character.firstReportSeenAt)}</div>
              </div>
              <div>
                <div className="text-gray-500">{tCharacterProfile("lastSeen")}</div>
                <div className="text-lg font-bold tabular-nums text-gray-100 md:text-xl">{formatShortDate(character.lastReportSeenAt)}</div>
              </div>
            </div>
          </div>
        </header>

        <section className="rounded-lg border border-gray-700 bg-gray-900">
          <div className="border-b border-gray-700 px-4 py-3">
            <h2 className="text-lg font-semibold text-white">Raid Timeline</h2>
            <p className="text-sm text-gray-400">Guilds and raid tiers where this character appeared in fetched report rosters.</p>
          </div>
          {raidTimelineRows.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] table-fixed border-collapse">
                <colgroup>
                  <col className="w-[30%]" />
                  <col className="w-[34%]" />
                  <col className="w-[12%]" />
                  <col className="w-[12%]" />
                  <col className="w-[12%]" />
                </colgroup>
                <thead>
                  <tr className="border-b border-gray-700 text-left text-xs font-semibold text-gray-400">
                    <th className="px-4 py-3">Raid</th>
                    <th className="px-4 py-3">Guild</th>
                    <th className="px-4 py-3 text-center">Reports</th>
                    <th className="px-4 py-3">First Seen</th>
                    <th className="px-4 py-3">Last Seen</th>
                  </tr>
                </thead>
                <tbody>
                  {raidTimelineRows.map((timelineRow) => {
                    if (timelineRow.type === "missing") {
                      return (
                        <tr key={`missing-${timelineRow.raid.id}`} className="border-b border-gray-800 bg-gray-950/35 text-gray-600 last:border-0">
                          <td className="px-4 py-3">
                            <RaidNameCell raid={timelineRow.raid} muted />
                          </td>
                          <td className="px-4 py-3 text-sm">Did not appear</td>
                          <td className="px-4 py-3 text-center font-semibold tabular-nums">0</td>
                          <td className="px-4 py-3 text-sm">-</td>
                          <td className="px-4 py-3 text-sm">-</td>
                        </tr>
                      );
                    }

                    const [primaryGuild, ...secondaryGuilds] = timelineRow.rows;
                    return (
                      <tr
                        key={`appearance-${timelineRow.raid.id}`}
                        role="button"
                        tabIndex={0}
                        title={`Show reports for ${timelineRow.raid.name}`}
                        onClick={() => handleOpenTimelineGroup(timelineRow.raid, timelineRow.rows)}
                        onKeyDown={(event) => handleTimelineReportKeyDown(event, timelineRow.raid, timelineRow.rows)}
                        className="group cursor-pointer border-b border-gray-800 transition-colors last:border-0 hover:bg-blue-950/35 focus-visible:bg-blue-950/35 focus-visible:outline-2 focus-visible:outline-blue-500"
                      >
                        <td className="px-4 py-3">
                          <RaidNameCell raid={timelineRow.raid} />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                            <span className="font-semibold text-blue-300">{primaryGuild.guildName}</span>
                            {secondaryGuilds.map((guild) => (
                              <span key={`${guild.zoneId}-${guild.guildId}`} className="text-xs font-semibold text-gray-500">
                                {guild.guildName}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center font-semibold tabular-nums text-gray-200">{timelineRow.reportCount}</td>
                        <td className="px-4 py-3 text-sm tabular-nums text-gray-400">{formatShortDate(timelineRow.firstSeenAt)}</td>
                        <td className="px-4 py-3 text-sm tabular-nums text-gray-400">{formatShortDate(timelineRow.lastSeenAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="px-4 py-8 text-center text-gray-400">No tracked raid appearances have been calculated yet.</div>
          )}
        </section>

        {selectedTimelineReports ? (
          <CharacterRaidReportsDialog
            selected={selectedTimelineReports}
            reports={timelineReports}
            loading={timelineReportsLoading}
            error={timelineReportsError}
            onSelectGuild={handleSelectTimelineReportsGuild}
            onClose={handleCloseTimelineReports}
          />
        ) : null}

        <section className="rounded-lg border border-gray-700 bg-gray-900">
          <div className="flex flex-col gap-3 border-b border-gray-700 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-white">Performance</h2>
              <p className="text-sm text-gray-400">{activePerformanceConfig.description}</p>
            </div>
            <div className="inline-flex self-start rounded-md bg-gray-950/70 p-1 ring-1 ring-white/10">
              {CHARACTER_PERFORMANCE_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActivePerformanceTab(tab.id)}
                  className={`min-h-10 rounded px-3 py-2 text-sm font-semibold transition-[background-color,color,transform] active:scale-[0.96] ${
                    activePerformanceTab === tab.id ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {activePerformanceTab === "rankings" ? (
            rankingRaidGroups.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1180px] border-collapse">
                  <colgroup>
                    <col className="w-[300px]" />
                    <col className="w-[104px]" />
                    <col className="w-[112px]" />
                    <col />
                  </colgroup>
                  <thead>
                    <tr className="border-b border-gray-800 text-left text-xs font-semibold text-gray-400">
                      <th className="px-4 py-2.5">Raid</th>
                      <th className="px-3 py-2.5 text-right">Metric</th>
                      <th className="px-3 py-2.5 text-right">Score</th>
                      <th className="px-3 py-2.5">Boss parses</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rankingRaidGroups.map((group) => (
                      <tr key={group.zoneId} className="border-b border-gray-800 last:border-0">
                        <td className="px-4 py-4">
                          <div className="flex min-w-0 items-center gap-3">
                            <IconImage
                              iconFilename={group.raid?.iconUrl}
                              alt={`${group.raidName} icon`}
                              width={32}
                              height={32}
                              className="h-8 w-8 shrink-0 rounded object-cover ring-1 ring-white/10"
                            />
                            <div className="min-w-0">
                              <div className="truncate font-semibold leading-tight text-gray-100">{group.raidName}</div>
                              <div className="mt-0.5 text-xs tabular-nums text-gray-500">{group.bossColumns.length} bosses</div>
                            </div>
                          </div>
                        </td>
                        {group.bestAllStars ? (
                          <>
                            <td className="px-3 py-4">
                              <RankingsMetricCell row={group.bestAllStars} compact />
                            </td>
                            <td className="px-3 py-4 text-right font-semibold tabular-nums text-gray-100">{formatScore(group.bestAllStars.score)}</td>
                          </>
                        ) : (
                          <>
                            <td className="px-3 py-4 text-right text-gray-600">-</td>
                            <td className="px-3 py-4 text-right text-gray-600">-</td>
                          </>
                        )}
                        <td className="px-3 py-3">
                          <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.max(group.bossColumns.length, 1)}, minmax(56px, 1fr))` }}>
                            {group.bossColumns.map((bossColumn) => (
                              <div
                                key={getBossKey(group.zoneId, bossColumn.encounterId)}
                                className="flex min-w-0 flex-col items-center justify-start gap-1"
                                title={bossColumn.encounterName}
                                aria-label={`${bossColumn.encounterName} parse`}
                              >
                                <IconImage
                                  iconFilename={bossColumn.boss?.iconUrl}
                                  alt=""
                                  width={28}
                                  height={28}
                                  className="h-7 w-7 shrink-0 rounded object-cover ring-1 ring-white/10"
                                />
                                <RankingsBossParseCell row={bossColumn.bestRanking} classId={character.classID} compact />
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="px-4 py-8 text-center text-gray-400">No rankings have been fetched for this character.</div>
            )
          ) : activeMechanicsRaidGroups.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1100px] border-collapse">
                <colgroup>
                  <col className="w-[300px]" />
                  <col className="w-[104px]" />
                  <col className="w-[96px]" />
                  <col className="w-[104px]" />
                  <col />
                </colgroup>
                <thead>
                  <tr className="border-b border-gray-800 text-left text-xs font-semibold text-gray-400">
                    <th className="px-4 py-2.5">Raid</th>
                    <th className="px-3 py-2.5 text-right">Metric</th>
                    <th className="px-3 py-2.5 text-right">{activeMechanicsScoreLabel}</th>
                    <th className="px-3 py-2.5 text-right">Early deaths</th>
                    <th className="px-3 py-2.5">{activeMechanicsBossLabel}</th>
                  </tr>
                </thead>
                <tbody>
                  {activeMechanicsRaidGroups.map((group) => (
                    <tr key={`${activePerformanceTab}-${group.zoneId}`} className="border-b border-gray-800 last:border-0">
                      <td className="px-4 py-4">
                        <div className="flex min-w-0 items-center gap-3">
                          <IconImage
                            iconFilename={group.raid?.iconUrl}
                            alt={`${group.raidName} icon`}
                            width={32}
                            height={32}
                            className="h-8 w-8 shrink-0 rounded object-cover ring-1 ring-white/10"
                          />
                          <div className="min-w-0">
                            <div className="truncate font-semibold leading-tight text-gray-100">{group.raidName}</div>
                            <div className="mt-0.5 text-xs tabular-nums text-gray-500">{group.bossColumns.length} bosses</div>
                          </div>
                        </div>
                      </td>
                      {group.bestOverall ? (
                        <>
                          <td className="px-3 py-4">
                            <RankingsMetricCell row={group.bestOverall} compact />
                          </td>
                          <td className="px-3 py-4 text-right">
                            <MechanicsScoreCell row={group.bestOverall} scoreKind={activeMechanicsScoreKind} />
                          </td>
                          <td className="px-3 py-4 text-right font-semibold tabular-nums text-gray-100">{formatEarlyDeaths(group.bestOverall)}</td>
                        </>
                      ) : (
                        <>
                          <td className="px-3 py-4 text-right text-gray-600">-</td>
                          <td className="px-3 py-4 text-right text-gray-600">-</td>
                          <td className="px-3 py-4 text-right text-gray-600">-</td>
                        </>
                      )}
                      <td className="px-3 py-3">
                        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.max(group.bossColumns.length, 1)}, minmax(64px, 1fr))` }}>
                          {group.bossColumns.map((bossColumn) => (
                            <div
                              key={getBossKey(group.zoneId, bossColumn.encounterId)}
                              className="flex min-w-0 flex-col items-center justify-start gap-1"
                              title={bossColumn.encounterName}
                              aria-label={`${bossColumn.encounterName} ${activePerformanceTab === "mechanics" ? "survival score" : "combined score"}`}
                            >
                              <IconImage
                                iconFilename={bossColumn.boss?.iconUrl}
                                alt=""
                                width={28}
                                height={28}
                                className="h-7 w-7 shrink-0 rounded object-cover ring-1 ring-white/10"
                              />
                              <MechanicsBossScoreCell row={bossColumn.bestMechanic} scoreKind={activeMechanicsScoreKind} compact />
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="px-4 py-8 text-center text-gray-400">{activeMechanicsEmptyLabel}</div>
          )}
        </section>

        <CharacterMythicPlusSection mythicPlus={profile.mythicPlus} classId={character.classID} />
      </div>
    </main>
  );
}
