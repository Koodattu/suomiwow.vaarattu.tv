"use client";

import Link from "next/link";
import type { CSSProperties, Ref } from "react";
import type { DraggableAttributes, DraggableSyntheticListeners } from "@dnd-kit/core/dist/hooks/useDraggable";
import IconImage from "@/components/IconImage";
import { getClassInfoById, getParseColor, getSpecIconUrl } from "@/lib/utils";
import type { CharacterTierName, CharacterTierListRole } from "@/types";

export type CharacterTierBoardItem = {
  characterKey: string;
  accountGroupId?: string | null;
  name: string;
  realm: string;
  region: string;
  classID: number;
  guildName?: string | null;
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
  lastSeenAt?: string | Date | null;
};

const TIERS = ["S", "A", "B", "C", "D", "E", "F"] as const;

export const CHARACTER_TIER_COLORS: Record<CharacterTierName, string> = {
  S: "bg-red-400 text-gray-950",
  A: "bg-orange-300 text-gray-950",
  B: "bg-yellow-300 text-gray-950",
  C: "bg-yellow-200 text-gray-950",
  D: "bg-lime-300 text-gray-950",
  E: "bg-green-300 text-gray-950",
  F: "bg-cyan-300 text-gray-950",
};

const TIER_PROPORTIONS: { tier: CharacterTierName; fraction: number }[] = [
  { tier: "S", fraction: 0.1 },
  { tier: "A", fraction: 0.16 },
  { tier: "B", fraction: 0.16 },
  { tier: "C", fraction: 0.16 },
  { tier: "D", fraction: 0.16 },
  { tier: "E", fraction: 0.16 },
  { tier: "F", fraction: 0.1 },
];

function calculateDynamicThresholds(scores: number[]): Record<CharacterTierName, { min: number }> {
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

  const thresholds = {} as Record<CharacterTierName, { min: number }>;
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

function getTierByScore(score: number, thresholds: Record<CharacterTierName, { min: number }>): CharacterTierName {
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

function getRepresentativeKey(character: CharacterTierBoardItem): string {
  return character.accountGroupId ? `account:${character.accountGroupId}` : `character:${character.characterKey}`;
}

function getTime(value: string | Date | null | undefined): number {
  if (!value) return 0;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function isBetterTierRepresentative(candidate: CharacterTierBoardItem, current: CharacterTierBoardItem): boolean {
  if (candidate.reportCount !== current.reportCount) return candidate.reportCount > current.reportCount;

  const candidateLastSeenAt = getTime(candidate.lastSeenAt);
  const currentLastSeenAt = getTime(current.lastSeenAt);
  if (candidateLastSeenAt !== currentLastSeenAt) return candidateLastSeenAt > currentLastSeenAt;

  return candidate.characterKey.localeCompare(current.characterKey) < 0;
}

function sortTierCharacters(a: CharacterTierBoardItem, b: CharacterTierBoardItem): number {
  return (b.score ?? 0) - (a.score ?? 0) || b.reportCount - a.reportCount || a.name.localeCompare(b.name) || a.realm.localeCompare(b.realm);
}

function selectTierRepresentatives(characters: CharacterTierBoardItem[]): CharacterTierBoardItem[] {
  const selectedCharacters = new Map<string, CharacterTierBoardItem>();

  for (const character of characters) {
    const representativeKey = getRepresentativeKey(character);
    const current = selectedCharacters.get(representativeKey);
    if (!current || isBetterTierRepresentative(character, current)) {
      selectedCharacters.set(representativeKey, character);
    }
  }

  return Array.from(selectedCharacters.values()).sort(sortTierCharacters);
}

export function CharacterTierCard({
  item,
  dragAttributes,
  dragListeners,
  dragRef,
  style,
  isDragging,
  isOverlay,
  isStatic,
  showScore = true,
  showSpecIcon = false,
  link = true,
}: {
  item: CharacterTierBoardItem;
  dragAttributes?: DraggableAttributes;
  dragListeners?: DraggableSyntheticListeners;
  dragRef?: (node: HTMLElement | null) => void;
  style?: CSSProperties;
  isDragging?: boolean;
  isOverlay?: boolean;
  isStatic?: boolean;
  showScore?: boolean;
  showSpecIcon?: boolean;
  link?: boolean;
}) {
  const classInfo = getClassInfoById(item.classID);
  const specIcon = showSpecIcon && item.specName ? getSpecIconUrl(item.classID, item.specName) : undefined;
  const combinedScore = item.score;
  const title = showScore && combinedScore !== null && combinedScore !== undefined ? `${item.name} / ${formatScore(combinedScore)}` : item.name;
  const content = (
    <>
      <IconImage iconFilename={specIcon ?? classInfo.iconUrl} alt={specIcon ? item.specName ?? classInfo.name : classInfo.name} fill style={{ objectFit: "cover" }} />
      {showScore && combinedScore !== null && combinedScore !== undefined && (
        <span className="absolute right-1 top-1 rounded-sm bg-black/75 px-1 text-[10px] font-bold tabular-nums shadow-sm" style={{ color: getParseColor(combinedScore) }}>
          {formatScore(combinedScore)}
        </span>
      )}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/70 to-transparent px-1.5 pb-1 pt-5">
        <div className="truncate text-center text-[11px] font-semibold leading-tight text-white">{item.name}</div>
        {item.guildName && <div className="truncate text-center text-[9px] font-medium leading-tight text-gray-300">{item.guildName}</div>}
      </div>
    </>
  );

  const interactionClass = isOverlay ? "cursor-grabbing scale-105 shadow-xl ring-2 ring-blue-300" : isStatic ? "cursor-default" : link ? "cursor-pointer active:scale-[0.96]" : "cursor-grab active:scale-[0.96] active:cursor-grabbing";
  const className = `group relative h-20 w-20 shrink-0 ${link ? "" : "touch-none"} select-none overflow-hidden rounded-sm bg-gray-800 shadow-sm ring-1 ring-white/10 transition-[opacity,scale,transform] duration-150 ease-out ${interactionClass} ${
    isDragging ? "opacity-30 ring-2 ring-blue-400" : ""
  }`;

  if (!link) {
    return (
      <div ref={dragRef as Ref<HTMLDivElement>} style={style} title={title} className={className} {...dragAttributes} {...dragListeners}>
        {content}
      </div>
    );
  }

  return (
    <Link href={getCharacterHref(item)} title={title} className={className}>
      {content}
    </Link>
  );
}

export function groupCharactersIntoTiers(characters: CharacterTierBoardItem[], referenceCharacters: CharacterTierBoardItem[] = characters): Record<CharacterTierName, CharacterTierBoardItem[]> {
  const sorted = [...characters].filter((character) => character.score !== null).sort(sortTierCharacters);
  const groups: Record<CharacterTierName, CharacterTierBoardItem[]> = {
    S: [],
    A: [],
    B: [],
    C: [],
    D: [],
    E: [],
    F: [],
  };

  if (sorted.length === 0) return groups;

  const referenceScores = referenceCharacters.map((character) => character.score).filter((score): score is number => score !== null);
  const thresholds = calculateDynamicThresholds(referenceScores);

  sorted.forEach((character) => {
    groups[getTierByScore(character.score ?? 0, thresholds)].push(character);
  });

  for (const tier of TIERS) {
    groups[tier] = selectTierRepresentatives(groups[tier]);
  }

  return groups;
}

export default function CharacterTierBoard({
  title,
  characters,
  referenceCharacters,
  showSpecIcons = false,
  emptyMessage,
}: {
  title?: string;
  characters: CharacterTierBoardItem[];
  referenceCharacters?: CharacterTierBoardItem[];
  showSpecIcons?: boolean;
  emptyMessage: string;
}) {
  const tierGroups = groupCharactersIntoTiers(characters, referenceCharacters);
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
        {TIERS.map((tier) => (
          <div key={tier} className="flex border-b border-gray-700 last:border-b-0">
            <div className={`flex min-h-20 w-14 shrink-0 items-center justify-center text-base font-black md:w-20 md:text-2xl ${CHARACTER_TIER_COLORS[tier]}`}>{tier}</div>
            <div className="flex min-h-20 flex-1 flex-wrap content-start gap-2 bg-gray-900 p-2">
              {tierGroups[tier].map((character) => (
                <CharacterTierCard key={character.characterKey} item={character} showSpecIcon={showSpecIcons} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
