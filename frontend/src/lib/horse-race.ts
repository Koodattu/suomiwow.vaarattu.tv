import type { GuildCrest as GuildCrestType, GuildListItem, RaidProgressSummary } from "../types/index";
import type { HorseRaceVisibility } from "./horse-race-preferences";

export interface RaceEntry {
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

const TRACK_MIN = 12;
const TRACK_MAX = 88;
const DENSE_GAP_THRESHOLD = 4.75;
const EMPTY_GAP_THRESHOLD = 13;
const DENSE_GAP_STRETCH = 0.58;
const EMPTY_GAP_TIGHTEN = 0.1;
// Each boss now occupies half a track; leave space for alternating 80px labels.
const MIN_VISUAL_GAP = 12;
const LABEL_COLLISION_THRESHOLD = 24;
const AUTO_SHOW_MIN_GUILDS = 2;
const AUTO_HIDE_MIN_CLEARS = 11;
const AUTO_HIDE_MAX_CONTENDERS = 2;

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

export function buildEntries(guilds: GuildListItem[], selectedRaidId: number, target: "final" | "penultimate" = "final") {
  const entries = guilds.reduce<BaseRaceEntry[]>((result, guild) => {
    const summary = getMythicProgress(guild, selectedRaidId);
    if (!summary || summary.totalBosses <= 0) return result;

    const boss = target === "penultimate" ? summary.penultimateBoss : summary.finalBoss;
    if (boss ? !boss.eligible : target === "penultimate" || summary.bossesDefeated < summary.totalBosses - 1) return result;

    // Use the selected encounter's pull and kill data even after the guild moves on.
    const progress = boss
      ? {
          ...summary,
          currentBossPulls: boss.pullCount,
          bestPullPercent: boss.bestPercent,
          bestPullPhase: boss.bestPullPhase,
          lastKillTime: boss.firstKillTime,
        }
      : summary;
    const isFinished = boss ? boss.kills > 0 : summary.bossesDefeated >= summary.totalBosses;
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

export function shouldShowRace(visibility: HorseRaceVisibility, contenderCount: number, finishedCount: number) {
  if (visibility === "hide") return false;
  if (visibility === "show") return true;

  const entryCount = contenderCount + finishedCount;
  const raceHasStarted = entryCount >= AUTO_SHOW_MIN_GUILDS;
  const raceHasEnded = finishedCount >= AUTO_HIDE_MIN_CLEARS && contenderCount <= AUTO_HIDE_MAX_CONTENDERS;
  return raceHasStarted && !raceHasEnded;
}

// A guild occupies one stage only. Final-boss data wins once it has moved on.
export function buildCombinedRace(guilds: GuildListItem[], selectedRaidId: number | null, currentRaidId: number | null, visibility: HorseRaceVisibility) {
  if (!selectedRaidId || selectedRaidId !== currentRaidId || visibility === "hide") return null;

  const penultimateRace = buildEntries(guilds, selectedRaidId, "penultimate");
  const finalRace = buildEntries(guilds, selectedRaidId, "final");
  const finalGuildIds = new Set([...finalRace.notStarted, ...finalRace.unfinished, ...finalRace.finished].map((entry) => entry.id));
  const stillOnPenultimate = (entry: RaceEntry) => !finalGuildIds.has(entry.id);
  const race = {
    notStarted: penultimateRace.notStarted.filter(stillOnPenultimate),
    penultimate: penultimateRace.unfinished.filter(stillOnPenultimate),
    pitStop: [...finalRace.notStarted, ...penultimateRace.finished.filter(stillOnPenultimate)].map((entry) => ({ ...entry, isFinished: false })),
    final: finalRace.unfinished,
    finished: finalRace.finished,
  };
  const contenderCount = race.notStarted.length + race.penultimate.length + race.pitStop.length + race.final.length;
  return shouldShowRace(visibility, contenderCount, race.finished.length) ? race : null;
}
