"use client";

import Link from "next/link";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import GuildCrest from "@/components/GuildCrest";
import { formatPercent, formatPhaseDisplay } from "@/lib/utils";
import { useHorseRaceMode, HorseRaceMode, HorseRaceVisibility } from "@/lib/horse-race-preferences";
import { isUmaImage, UMA_IMAGES, UmaImage } from "@/lib/uma-images";
import { GuildCrest as GuildCrestType, GuildListItem, RaidProgressSummary } from "@/types";

interface HorseRaceProps {
  guilds: GuildListItem[];
  selectedRaidId: number | null;
  currentRaidId: number | null;
  reservedUmaImages?: string[];
}

interface RaceEntry {
  id: string;
  name: string;
  realm: string;
  faction?: string;
  crest?: GuildCrestType;
  horseRaceUmaImage?: string;
  progress: RaidProgressSummary;
  bossHealth: number;
  trackProgress: number;
  displayProgress: number;
  labelPosition: "above" | "below";
  isFinished: boolean;
}

type BaseRaceEntry = Omit<RaceEntry, "displayProgress" | "labelPosition">;
type HorseRaceDisplayMode = Exclude<HorseRaceMode, "random">;
type RandomHorseRaceMode = HorseRaceDisplayMode;

const TRACK_MIN = 3;
const TRACK_MAX = 97;
const DENSE_GAP_THRESHOLD = 4.75;
const EMPTY_GAP_THRESHOLD = 13;
const DENSE_GAP_STRETCH = 0.58;
const EMPTY_GAP_TIGHTEN = 0.1;
const MIN_VISUAL_GAP = 2.4;
const LABEL_COLLISION_THRESHOLD = 8;
const FINISHED_SLOT_WIDTH = 58;
const START_WIDTH = 34;
const MIN_TRACK_WIDTH = 680;
const HORSE_RACER_SRC = "/horse/racer.png";
const RANDOM_HORSE_RACE_MODES: RandomHorseRaceMode[] = ["crest", "japanese", "uma"];
const AUTO_SHOW_MIN_GUILDS = 2;
const AUTO_HIDE_MIN_CLEARS = 11;
const AUTO_HIDE_MAX_CONTENDERS = 2;
const EMPTY_RESERVED_UMA_IMAGES: string[] = [];
const tintedRacerCache = new Map<string, string>();
let racerImagePromise: Promise<HTMLImageElement> | null = null;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getMythicProgress(guild: GuildListItem, selectedRaidId: number): RaidProgressSummary | undefined {
  return guild.progress.find((progress) => progress.raidId === selectedRaidId && progress.difficulty === "mythic");
}

function getBossHealth(progress: RaidProgressSummary, isFinished: boolean) {
  if (isFinished) return 0;
  if (progress.currentBossPulls <= 0) return 100;
  return clamp(progress.bestPullPercent, 0, 100);
}

function compareRaceOrder(a: BaseRaceEntry, b: BaseRaceEntry) {
  if (a.isFinished && b.isFinished) {
    const aTime = a.progress.lastKillTime ? new Date(a.progress.lastKillTime).getTime() : Number.MAX_SAFE_INTEGER;
    const bTime = b.progress.lastKillTime ? new Date(b.progress.lastKillTime).getTime() : Number.MAX_SAFE_INTEGER;
    if (aTime !== bTime) return aTime - bTime;
  }

  if (a.trackProgress !== b.trackProgress) return b.trackProgress - a.trackProgress;
  return (a.progress.guildRank ?? 99999) - (b.progress.guildRank ?? 99999);
}

function compareTrackPosition(a: BaseRaceEntry, b: BaseRaceEntry) {
  if (a.trackProgress !== b.trackProgress) return a.trackProgress - b.trackProgress;
  return (b.progress.guildRank ?? 99999) - (a.progress.guildRank ?? 99999);
}

function getVisualTrackGap(rawGap: number) {
  const denseStretch = Math.max(0, DENSE_GAP_THRESHOLD - rawGap) * DENSE_GAP_STRETCH;
  const emptyTighten = Math.max(0, rawGap - EMPTY_GAP_THRESHOLD) * EMPTY_GAP_TIGHTEN;
  return Math.max(MIN_VISUAL_GAP, rawGap + denseStretch - emptyTighten);
}

function getMaxDenseStackDepth(sortedEntries: BaseRaceEntry[]) {
  let maxStackDepth = 1;
  let stackDepth = 1;

  for (let index = 1; index < sortedEntries.length; index += 1) {
    if (sortedEntries[index].trackProgress - sortedEntries[index - 1].trackProgress <= DENSE_GAP_THRESHOLD) {
      stackDepth += 1;
      maxStackDepth = Math.max(maxStackDepth, stackDepth);
    } else {
      stackDepth = 1;
    }
  }

  return maxStackDepth;
}

// Keep the race mostly linear, but borrow a little space from empty gaps so dense packs read separately.
function spreadRaceEntries(entries: BaseRaceEntry[]): { entries: RaceEntry[]; maxStackDepth: number } {
  if (entries.length === 0) return { entries: [], maxStackDepth: 1 };

  const sortedEntries = [...entries].sort(compareTrackPosition);
  const maxStackDepth = getMaxDenseStackDepth(sortedEntries);

  if (sortedEntries.length === 1) {
    return {
      entries: [
        {
          ...sortedEntries[0],
          displayProgress: clamp(sortedEntries[0].trackProgress, TRACK_MIN, TRACK_MAX),
          labelPosition: "below",
        },
      ],
      maxStackDepth,
    };
  }

  const visualGaps = sortedEntries.slice(1).map((entry, index) => getVisualTrackGap(entry.trackProgress - sortedEntries[index].trackProgress));
  const visualSpan = visualGaps.reduce((sum, gap) => sum + gap, 0);
  const maxVisualSpan = TRACK_MAX - TRACK_MIN;
  const scale = visualSpan > maxVisualSpan ? maxVisualSpan / visualSpan : 1;
  const scaledGaps = visualGaps.map((gap) => gap * scale);
  const scaledSpan = scaledGaps.reduce((sum, gap) => sum + gap, 0);
  const rawCenter = (sortedEntries[0].trackProgress + sortedEntries[sortedEntries.length - 1].trackProgress) / 2;
  let nextPosition = clamp(rawCenter - scaledSpan / 2, TRACK_MIN, TRACK_MAX - scaledSpan);

  return {
    entries: sortedEntries.map((entry, index) => {
      const displayProgress = nextPosition;
      nextPosition += scaledGaps[index] ?? 0;

      return {
        ...entry,
        displayProgress: clamp(displayProgress, TRACK_MIN, TRACK_MAX),
        labelPosition: "below",
      };
    }),
    maxStackDepth,
  };
}

function assignLabelPositions(entries: RaceEntry[]): RaceEntry[] {
  const sortedEntries = [...entries].sort((a, b) => a.displayProgress - b.displayProgress);
  const positionedEntries: RaceEntry[] = [];

  for (let index = 0; index < sortedEntries.length; ) {
    const group = [sortedEntries[index]];
    let nextIndex = index + 1;

    while (nextIndex < sortedEntries.length && sortedEntries[nextIndex].displayProgress - group[group.length - 1].displayProgress <= LABEL_COLLISION_THRESHOLD) {
      group.push(sortedEntries[nextIndex]);
      nextIndex += 1;
    }

    group.forEach((entry, groupIndex) => {
      positionedEntries.push({
        ...entry,
        labelPosition: group.length > 1 && groupIndex % 2 === 1 ? "above" : "below",
      });
    });

    index = nextIndex;
  }

  return positionedEntries.sort((a, b) => a.displayProgress - b.displayProgress);
}

function buildEntries(guilds: GuildListItem[], selectedRaidId: number) {
  const entries = guilds.reduce<BaseRaceEntry[]>((result, guild) => {
    const progress = getMythicProgress(guild, selectedRaidId);
    if (!progress || progress.totalBosses <= 0 || progress.bossesDefeated < progress.totalBosses - 1) return result;

    const isFinished = progress.bossesDefeated >= progress.totalBosses;
    const bossHealth = getBossHealth(progress, isFinished);

    result.push({
      id: guild._id,
      name: guild.name,
      realm: guild.realm,
      faction: guild.faction,
      crest: guild.crest,
      horseRaceUmaImage: guild.horseRaceUmaImage,
      progress,
      bossHealth,
      trackProgress: 100 - bossHealth,
      isFinished,
    });

    return result;
  }, []);

  const sortedEntries = entries.sort(compareRaceOrder);
  const notStarted = sortedEntries.filter((entry) => !entry.isFinished && entry.progress.currentBossPulls <= 0);
  const unfinished = sortedEntries.filter((entry) => !entry.isFinished && entry.progress.currentBossPulls > 0);
  const finished = sortedEntries.filter((entry) => entry.isFinished);
  const positionedUnfinished = spreadRaceEntries(unfinished);

  const positionedFinished = finished.map((entry, index) => ({
    ...entry,
    displayProgress: 100,
    labelPosition: "below" as const,
    finishOrder: index,
  }));

  return {
    notStarted: notStarted.map((entry) => ({
      ...entry,
      displayProgress: 0,
      labelPosition: "below" as const,
    })),
    unfinished: assignLabelPositions(positionedUnfinished.entries),
    finished: positionedFinished,
    maxStackDepth: positionedUnfinished.maxStackDepth,
  };
}

function shouldShowRace(visibility: HorseRaceVisibility, contenderCount: number, finishedCount: number) {
  if (visibility === "hide") return false;
  if (visibility === "show") return true;

  const entryCount = contenderCount + finishedCount;
  const raceHasStarted = entryCount >= AUTO_SHOW_MIN_GUILDS;
  const raceHasEnded = finishedCount >= AUTO_HIDE_MIN_CLEARS && contenderCount <= AUTO_HIDE_MAX_CONTENDERS;
  return raceHasStarted && !raceHasEnded;
}

function colorFromCrest(crest?: GuildCrestType, fallback = "84 168 247") {
  const color = crest?.background?.color ?? crest?.emblem?.color;
  if (!color) return fallback;
  return `${Math.round(color.r)} ${Math.round(color.g)} ${Math.round(color.b)}`;
}

function colorObjectFromCrest(crest?: GuildCrestType) {
  return crest?.background?.color ?? crest?.emblem?.color ?? { r: 84, g: 168, b: 247 };
}

function getRacerImage() {
  if (racerImagePromise) return racerImagePromise;

  racerImagePromise = new Promise((resolve, reject) => {
    const image = new Image();
    image.src = HORSE_RACER_SRC;
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to load horse racer image"));
  });

  return racerImagePromise;
}

function isImageBackground(r: number, g: number, b: number) {
  return r > 238 && g > 238 && b > 238;
}

function isPurplePixel(r: number, g: number, b: number) {
  return b > 70 && r > 45 && b >= g * 1.25 && r >= g * 1.15 && Math.abs(r - b) < 95;
}

function mixChannel(source: number, target: number) {
  const shade = clamp(source / 180, 0.25, 1.3);
  return clamp(Math.round(target * shade), 0, 255);
}

function TintedHorseRacer({ crest }: { crest?: GuildCrestType }) {
  const color = colorObjectFromCrest(crest);
  const cacheKey = `shirt-${Math.round(color.r)}-${Math.round(color.g)}-${Math.round(color.b)}`;
  const [src, setSrc] = useState(() => tintedRacerCache.get(cacheKey) ?? HORSE_RACER_SRC);

  useEffect(() => {
    const cached = tintedRacerCache.get(cacheKey);
    if (cached) {
      setSrc(cached);
      return;
    }

    let isMounted = true;

    getRacerImage()
      .then((image) => {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;

        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return;

        ctx.drawImage(image, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;

        for (let index = 0; index < data.length; index += 4) {
          const r = data[index];
          const g = data[index + 1];
          const b = data[index + 2];
          const alpha = data[index + 3];

          if (alpha === 0) continue;

          if (isImageBackground(r, g, b)) {
            data[index + 3] = 0;
            continue;
          }

          if (isPurplePixel(r, g, b)) {
            data[index] = mixChannel(r, color.r);
            data[index + 1] = mixChannel(r, color.g);
            data[index + 2] = mixChannel(r, color.b);
          }
        }

        ctx.putImageData(imageData, 0, 0);
        const tintedSrc = canvas.toDataURL("image/png");
        tintedRacerCache.set(cacheKey, tintedSrc);

        if (isMounted) {
          setSrc(tintedSrc);
        }
      })
      .catch(() => {
        if (isMounted) setSrc(HORSE_RACER_SRC);
      });

    return () => {
      isMounted = false;
    };
  }, [cacheKey, color.b, color.g, color.r]);

  return <img src={src} alt="" className="h-10 w-10 object-contain" aria-hidden="true" />;
}

function RacerSprite({ entry, mode, umaImage }: { entry: RaceEntry; mode: HorseRaceDisplayMode; umaImage: string }) {
  if (mode === "crest") {
    return (
      <div className="h-8 w-8 shrink-0">
        <GuildCrest crest={entry.crest} faction={entry.faction} size={128} className="scale-[0.25] origin-top-left" drawFactionCircle={false} />
      </div>
    );
  }

  if (mode === "japanese") {
    return (
      <div className="h-10 w-10 shrink-0">
        <TintedHorseRacer crest={entry.crest} />
      </div>
    );
  }

  if (mode === "uma") {
    return (
      <div className="h-12 w-12 shrink-0" aria-hidden="true">
        <img src={`/uma/${umaImage}`} alt="" className="h-12 w-12 object-contain" />
      </div>
    );
  }

  return null;
}

function getProgressLabel(entry: RaceEntry) {
  if (entry.isFinished) return "0%";
  return entry.progress.bestPullPhase?.displayString ? formatPhaseDisplay(entry.progress.bestPullPhase.displayString) : formatPercent(entry.bossHealth);
}

function RaceLabel({ entry, className = "w-24" }: { entry: RaceEntry; className?: string }) {
  return (
    <div className={`${className} px-1 text-center text-[10px] font-semibold leading-[11px] text-gray-100 drop-shadow-[0_1px_2px_rgba(0,0,0,0.95)]`}>
      <div
        className="wrap-break-word"
        style={{
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {entry.name}
      </div>
      <div className="text-[9px] font-medium text-amber-100">{getProgressLabel(entry)}</div>
    </div>
  );
}

function ChuteGuildName({ entry, className }: { entry: RaceEntry; className: string }) {
  return (
    <div
      className={`wrap-break-word text-[10px] font-semibold leading-[11px] ${className}`}
      style={{
        display: "-webkit-box",
        WebkitLineClamp: 2,
        WebkitBoxOrient: "vertical",
        overflow: "hidden",
      }}
    >
      {entry.name}
    </div>
  );
}

function getGuildProfileHref(entry: RaceEntry) {
  return `/guilds/${encodeURIComponent(entry.realm)}/${encodeURIComponent(entry.name)}`;
}

function getRacerHitboxClass(mode: HorseRaceDisplayMode) {
  if (mode === "crest") return "h-8 w-8";
  return "h-9 w-9";
}

function RacerLink({ entry, mode, title, children }: { entry: RaceEntry; mode: HorseRaceDisplayMode; title?: string; children: ReactNode }) {
  return (
    <Link
      href={getGuildProfileHref(entry)}
      className={`pointer-events-auto inline-flex cursor-pointer items-center justify-center overflow-visible rounded-full transition-all duration-150 hover:scale-125 hover:brightness-125 hover:saturate-125 focus-visible:outline-2 focus-visible:outline-yellow-300 ${getRacerHitboxClass(mode)}`}
      title={title ?? `${entry.name}-${entry.realm}`}
      aria-label={`Open ${entry.name}-${entry.realm} guild profile`}
    >
      {children}
    </Link>
  );
}

function shuffleUmaImages(): UmaImage[] {
  const images = [...UMA_IMAGES];
  for (let index = images.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [images[index], images[swapIndex]] = [images[swapIndex], images[index]];
  }
  return images;
}

function getRandomHorseRaceMode(): RandomHorseRaceMode {
  return RANDOM_HORSE_RACE_MODES[Math.floor(Math.random() * RANDOM_HORSE_RACE_MODES.length)];
}

function assignUmaImages(entries: RaceEntry[], umaDeck: UmaImage[], reservedUmaImages: string[]) {
  const reservedImages = new Set([...reservedUmaImages.filter(isUmaImage), ...entries.map((entry) => entry.horseRaceUmaImage).filter(isUmaImage)]);
  const randomDeck = umaDeck.filter((image) => !reservedImages.has(image));
  const availableDeck = randomDeck.length > 0 ? randomDeck : umaDeck;
  const assignments = new Map<string, UmaImage>();
  let randomIndex = 0;

  entries.forEach((entry) => {
    if (isUmaImage(entry.horseRaceUmaImage)) {
      assignments.set(entry.id, entry.horseRaceUmaImage);
      return;
    }

    assignments.set(entry.id, availableDeck[randomIndex % availableDeck.length]);
    randomIndex += 1;
  });

  return assignments;
}

export default function HorseRace({ guilds, selectedRaidId, currentRaidId, reservedUmaImages = EMPTY_RESERVED_UMA_IMAGES }: HorseRaceProps) {
  const { mode, visibility, showCharacters, showBackground } = useHorseRaceMode();
  const [randomMode] = useState<RandomHorseRaceMode>(() => getRandomHorseRaceMode());
  const activeMode: HorseRaceDisplayMode = mode === "random" ? randomMode : mode;
  const [umaDeck, setUmaDeck] = useState(() => shuffleUmaImages());

  useEffect(() => {
    if (activeMode === "uma") {
      setUmaDeck(shuffleUmaImages());
    }
  }, [activeMode]);

  const race = useMemo(() => {
    if (!selectedRaidId || selectedRaidId !== currentRaidId) return { notStarted: [], unfinished: [], finished: [], maxStackDepth: 1 };
    return buildEntries(guilds, selectedRaidId);
  }, [currentRaidId, guilds, selectedRaidId]);
  const umaAssignments = useMemo(() => assignUmaImages([...race.notStarted, ...race.unfinished, ...race.finished], umaDeck, reservedUmaImages), [race, reservedUmaImages, umaDeck]);

  const isCurrentRaid = selectedRaidId !== null && selectedRaidId === currentRaidId;
  const contenderCount = race.notStarted.length + race.unfinished.length;
  const finishedCount = race.finished.length;

  if (!isCurrentRaid || !shouldShowRace(visibility, contenderCount, finishedCount)) return null;

  const startWidth = Math.max(START_WIDTH, 28 + race.notStarted.length * FINISHED_SLOT_WIDTH);
  const finishWidth = Math.max(92, 28 + race.finished.length * FINISHED_SLOT_WIDTH);
  const minWidth = startWidth + MIN_TRACK_WIDTH + finishWidth;
  const raceHeight = 112;
  const trackTop = Math.floor(raceHeight / 2) - 10;
  const markerTop = trackTop - 16;
  const labelAboveTop = trackTop - 44;
  const labelBelowTop = trackTop + 25;
  const getUmaImage = (entry: RaceEntry) => umaAssignments.get(entry.id) ?? umaDeck[0];

  return (
    <section className="relative mt-3 mb-2 hidden px-3 md:px-4 lg:block" aria-label="Final boss race">
      {showCharacters && (
        <>
          <div className="pointer-events-none absolute left-2 top-[-10%] z-0 flex -translate-y-1/2 items-center gap-1" aria-hidden="true">
            <img src="/yolobolt.png" alt="" className="h-[118px] w-auto object-contain opacity-95" />
            <div className="-ml-6 mt-2 text-[11px] font-semibold leading-3 text-purple-200 drop-shadow-[0_1px_2px_rgba(0,0,0,0.95)]">Yolobolt&apos;s Horses</div>
          </div>
          <div className="pointer-events-none absolute right-2 top-[-10%] z-0 flex -translate-y-1/2 items-center gap-1" aria-hidden="true">
            <div className="z-20 -mr-7 mt-2 text-[11px] font-semibold leading-3 text-cyan-200 drop-shadow-[0_1px_2px_rgba(0,0,0,0.95)]">LakuClap Lovewatching</div>
            <img src="/lakuclap.png" alt="" className="z-10 h-40 w-auto object-contain opacity-95" />
          </div>
        </>
      )}
      <div className="relative z-10 w-full overflow-x-auto">
        <div
          className={`grid overflow-hidden rounded-md ${showBackground ? "border border-emerald-800/60 bg-[#20301f]/75" : "border border-transparent bg-transparent"}`}
          style={{ gridTemplateColumns: `${startWidth}px minmax(${MIN_TRACK_WIDTH}px, 1fr) ${finishWidth}px`, minWidth: `${minWidth}px`, height: `${raceHeight}px` }}
        >
          <div className="relative bg-emerald-950/15">
            {race.notStarted.length > 0 && (
              <div
                className="absolute left-2 right-0 h-5 rounded-l-full border-y border-l border-amber-700/70 bg-[#6f4526] shadow-inner shadow-black/50"
                style={{ top: `${trackTop}px` }}
              >
                <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-amber-200/35" />
              </div>
            )}
            <div
              className="absolute right-[-7px] z-30 flex w-5 items-center justify-center rounded-sm border border-emerald-300/50 bg-black/70 text-[8px] font-bold uppercase tracking-wide text-emerald-100 shadow shadow-black/40"
              style={{ top: `${trackTop - 25}px`, height: "70px", writingMode: "vertical-rl", textOrientation: "mixed" }}
              aria-hidden="true"
            >
              Start
            </div>

            {race.notStarted.map((entry, index) => (
              <div
                key={entry.id}
                className="pointer-events-none absolute flex w-[63px] flex-col items-center"
                style={{ right: `${26 + index * FINISHED_SLOT_WIDTH}px`, top: `${markerTop}px`, zIndex: 30 + index }}
              >
                <RacerLink entry={entry} mode={activeMode} title={`${entry.name}-${entry.realm}: 0 pulls`}>
                  <div className="drop-shadow-[0_2px_5px_rgba(0,0,0,0.7)]">
                    <RacerSprite entry={entry} mode={activeMode} umaImage={getUmaImage(entry)} />
                  </div>
                </RacerLink>
                <div className="mt-0.5 max-w-[63px] px-1 text-center text-gray-100 drop-shadow-[0_1px_2px_rgba(0,0,0,0.95)]">
                  <ChuteGuildName entry={entry} className="text-gray-100" />
                </div>
              </div>
            ))}
          </div>

          <div className="relative">
            <div className="absolute inset-x-0 h-5 rounded-l-full border-y border-l border-amber-700/70 bg-[#6f4526] shadow-inner shadow-black/50" style={{ top: `${trackTop}px` }}>
              <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-amber-200/35" />
            </div>

            {race.unfinished.map((entry, index) => (
              <div key={entry.id}>
                <div
                  className="pointer-events-none absolute flex w-[72px] -translate-x-1/2 justify-center"
                  style={{ left: `${entry.displayProgress}%`, top: `${markerTop}px`, zIndex: 20 + index }}
                >
                  <RacerLink entry={entry} mode={activeMode} title={`${entry.name}-${entry.realm}: ${getProgressLabel(entry)}`}>
                    <div className="drop-shadow-[0_2px_5px_rgba(0,0,0,0.7)]">
                      <RacerSprite entry={entry} mode={activeMode} umaImage={getUmaImage(entry)} />
                    </div>
                  </RacerLink>
                </div>
                <div
                  className="pointer-events-none absolute flex w-24 -translate-x-1/2 justify-center"
                  style={{ left: `${entry.displayProgress}%`, top: `${entry.labelPosition === "above" ? labelAboveTop : labelBelowTop}px`, zIndex: 40 + index }}
                >
                  <RaceLabel entry={entry} />
                </div>
              </div>
            ))}
          </div>

          <div className="relative bg-yellow-950/15">
            <div
              className="absolute left-[-7] z-50 flex w-5 items-center justify-center rounded-sm border border-yellow-100/60 bg-black/80 text-[8px] font-bold uppercase tracking-wide text-yellow-100 shadow shadow-black/50"
              style={{ top: `${trackTop - 27}px`, height: "74px", writingMode: "vertical-rl", textOrientation: "mixed" }}
              aria-hidden="true"
            >
              Finish
            </div>
            <div
              className="absolute left-0 right-2 h-5 rounded-r-full border-y border-r border-amber-700/70 bg-[#6f4526] shadow-inner shadow-black/50"
              style={{ top: `${trackTop}px` }}
            >
              <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-amber-200/35" />
            </div>

            {race.finished.map((entry, index) => (
              <div
                key={entry.id}
                className="pointer-events-none absolute flex w-[66px] flex-col items-center"
                style={{ right: `${10 + index * FINISHED_SLOT_WIDTH}px`, top: `${markerTop}px`, zIndex: 30 + index }}
              >
                <RacerLink entry={entry} mode={activeMode} title={`${index + 1}. ${entry.name}-${entry.realm}: finished`}>
                  <div className="drop-shadow-[0_2px_5px_rgba(0,0,0,0.7)]">
                    <RacerSprite entry={entry} mode={activeMode} umaImage={getUmaImage(entry)} />
                  </div>
                </RacerLink>
                <div className="mt-0.5 max-w-[66px] px-1 text-center text-[10px] font-semibold leading-1.5 text-gray-100 drop-shadow-[0_1px_2px_rgba(0,0,0,0.95)]">
                  <div>#{index + 1}</div>
                  <ChuteGuildName entry={entry} className="text-amber-100" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
