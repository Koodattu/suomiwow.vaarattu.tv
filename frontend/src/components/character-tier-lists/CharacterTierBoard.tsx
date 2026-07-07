"use client";

import Link from "next/link";
import type { CSSProperties, Ref } from "react";
import type { DraggableAttributes, DraggableSyntheticListeners } from "@dnd-kit/core/dist/hooks/useDraggable";
import IconImage from "@/components/IconImage";
import { formatRealmName, formatSpecName, getClassInfoById, getParseColor, getSpecIconUrl } from "@/lib/utils";
import type { CharacterTierName, CharacterTierListRole } from "@/types";

export type CharacterTierBoardItem = {
  characterKey: string;
  name: string;
  realm: string;
  region: string;
  classID: number;
  reportCount: number;
  score: number | null;
  parseScore?: number | null;
  survivalScore?: number | null;
  role?: CharacterTierListRole | null;
  metric?: "dps" | "hps" | null;
  specName?: string | null;
  bestSpecName?: string | null;
  pulls?: number | null;
  deaths?: number | null;
};

const TIERS = ["Crown", "S", "A", "B", "C", "D", "E", "F"] as const;
const MANUAL_TIERS = ["S", "A", "B", "C", "D", "E", "F"] as const;

export const CHARACTER_TIER_COLORS: Record<CharacterTierName, string> = {
  Crown: "bg-purple-400 text-gray-950",
  S: "bg-red-400 text-gray-950",
  A: "bg-orange-300 text-gray-950",
  B: "bg-yellow-300 text-gray-950",
  C: "bg-yellow-200 text-gray-950",
  D: "bg-lime-300 text-gray-950",
  E: "bg-green-300 text-gray-950",
  F: "bg-cyan-300 text-gray-950",
};

const TIER_PROPORTIONS: { tier: Exclude<CharacterTierName, "Crown">; fraction: number }[] = [
  { tier: "S", fraction: 0.1 },
  { tier: "A", fraction: 0.16 },
  { tier: "B", fraction: 0.16 },
  { tier: "C", fraction: 0.16 },
  { tier: "D", fraction: 0.16 },
  { tier: "E", fraction: 0.16 },
  { tier: "F", fraction: 0.1 },
];

function calculateDynamicThresholds(scores: number[]): Record<Exclude<CharacterTierName, "Crown">, { min: number }> {
  if (scores.length === 0) {
    return { S: { min: 90 }, A: { min: 74 }, B: { min: 58 }, C: { min: 42 }, D: { min: 26 }, E: { min: 10 }, F: { min: 0 } };
  }

  const maxScore = Math.max(...scores);
  const minScore = Math.min(...scores);
  const range = maxScore - minScore;

  if (range === 0) {
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

  const thresholds = {} as Record<Exclude<CharacterTierName, "Crown">, { min: number }>;
  let cursor = maxScore;

  for (const { tier, fraction } of TIER_PROPORTIONS) {
    const tierSize = range * fraction;
    const tierMin = cursor - tierSize;
    thresholds[tier] = { min: tierMin };
    cursor = tierMin;
  }

  thresholds.F.min = Math.min(thresholds.F.min, minScore);
  return thresholds;
}

function getTierByScore(score: number, thresholds: Record<Exclude<CharacterTierName, "Crown">, { min: number }>): Exclude<CharacterTierName, "Crown"> {
  if (score >= thresholds.S.min) return "S";
  if (score >= thresholds.A.min) return "A";
  if (score >= thresholds.B.min) return "B";
  if (score >= thresholds.C.min) return "C";
  if (score >= thresholds.D.min) return "D";
  if (score >= thresholds.E.min) return "E";
  return "F";
}

function formatScore(value: number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  return value.toFixed(value % 1 === 0 ? 0 : 1);
}

function getCharacterHref(item: CharacterTierBoardItem) {
  return `/characters/${encodeURIComponent(item.realm)}/${encodeURIComponent(item.name)}?class=${encodeURIComponent(String(item.classID))}`;
}

export function CharacterTierCard({
  item,
  dragAttributes,
  dragListeners,
  dragRef,
  style,
  isDragging,
  link = true,
}: {
  item: CharacterTierBoardItem;
  dragAttributes?: DraggableAttributes;
  dragListeners?: DraggableSyntheticListeners;
  dragRef?: (node: HTMLElement | null) => void;
  style?: CSSProperties;
  isDragging?: boolean;
  link?: boolean;
}) {
  const classInfo = getClassInfoById(item.classID);
  const specIcon = item.specName ? getSpecIconUrl(item.classID, item.specName) : undefined;
  const roleLabel = item.role ? item.role.charAt(0).toUpperCase() + item.role.slice(1) : null;
  const specLabel = item.specName ? formatSpecName(item.specName) : roleLabel;
  const content = (
    <>
      <div className="relative h-8 w-8 shrink-0 overflow-hidden rounded-md border border-white/10 bg-gray-950">
        <IconImage iconFilename={specIcon ?? classInfo.iconUrl} alt={specLabel ?? classInfo.name} fill style={{ objectFit: "cover" }} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm font-semibold text-gray-100">{item.name}</span>
          <span className="shrink-0 text-xs tabular-nums" style={{ color: getParseColor(item.score ?? 0) }}>
            {formatScore(item.score)}
          </span>
        </div>
        <div className="flex min-w-0 items-center gap-1 text-xs text-gray-400">
          <span className="truncate">{formatRealmName(item.realm)}</span>
          {specLabel && <span className="truncate text-gray-500">/ {specLabel}</span>}
        </div>
      </div>
      <div className="shrink-0 text-right text-[11px] leading-tight text-gray-400">
        <div>{item.reportCount} rpt</div>
        {item.pulls !== null && item.pulls !== undefined && <div>{item.pulls} pulls</div>}
      </div>
    </>
  );

  const className = `flex min-h-12 w-full items-center gap-2 rounded-md border border-gray-700 bg-gray-800/85 px-2 py-2 shadow-sm transition-colors hover:border-gray-600 hover:bg-gray-750 ${
    isDragging ? "opacity-70 ring-2 ring-blue-400" : ""
  }`;

  if (!link) {
    return (
      <div ref={dragRef as Ref<HTMLDivElement>} style={style} className={className} {...dragAttributes} {...dragListeners}>
        {content}
      </div>
    );
  }

  return (
    <Link href={getCharacterHref(item)} className={className}>
      {content}
    </Link>
  );
}

export function groupCharactersIntoTiers(characters: CharacterTierBoardItem[], showCrown = true): Record<CharacterTierName, CharacterTierBoardItem[]> {
  const sorted = [...characters].filter((character) => character.score !== null).sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || b.reportCount - a.reportCount || a.name.localeCompare(b.name));
  const groups: Record<CharacterTierName, CharacterTierBoardItem[]> = {
    Crown: [],
    S: [],
    A: [],
    B: [],
    C: [],
    D: [],
    E: [],
    F: [],
  };

  if (sorted.length === 0) return groups;

  const thresholdSource = showCrown ? sorted.slice(1) : sorted;
  const thresholds = calculateDynamicThresholds(thresholdSource.map((character) => character.score ?? 0));

  sorted.forEach((character, index) => {
    if (showCrown && index === 0) {
      groups.Crown.push(character);
    } else {
      groups[getTierByScore(character.score ?? 0, thresholds)].push(character);
    }
  });

  return groups;
}

export default function CharacterTierBoard({
  title,
  characters,
  showCrown = true,
  emptyMessage,
}: {
  title?: string;
  characters: CharacterTierBoardItem[];
  showCrown?: boolean;
  emptyMessage: string;
}) {
  const tierGroups = groupCharactersIntoTiers(characters, showCrown);
  const tiers = showCrown ? TIERS : MANUAL_TIERS;
  const hasAnyCharacters = characters.some((character) => character.score !== null);

  if (!hasAnyCharacters) {
    return (
      <section className="min-w-0">
        {title && <h2 className="mb-3 text-center text-lg font-bold text-white">{title}</h2>}
        <div className="rounded-lg border border-gray-700 bg-gray-900 px-4 py-8 text-center text-sm text-gray-400">{emptyMessage}</div>
      </section>
    );
  }

  return (
    <section className="min-w-0">
      {title && <h2 className="mb-3 text-center text-lg font-bold text-white">{title}</h2>}
      <div className="overflow-hidden rounded-lg border border-gray-700">
        {tiers.map((tier) => (
          <div key={tier} className="flex border-b border-gray-700 last:border-b-0">
            <div className={`flex min-h-20 w-14 shrink-0 items-center justify-center text-base font-black md:w-20 md:text-2xl ${CHARACTER_TIER_COLORS[tier]}`}>{tier === "Crown" ? "TOP" : tier}</div>
            <div className="flex min-h-20 flex-1 flex-wrap content-start gap-2 bg-gray-900 p-2">
              {tierGroups[tier].map((character) => (
                <div key={character.characterKey} className="w-full sm:w-[calc(50%-0.25rem)] xl:w-[calc(33.333%-0.34rem)]">
                  <CharacterTierCard item={character} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
