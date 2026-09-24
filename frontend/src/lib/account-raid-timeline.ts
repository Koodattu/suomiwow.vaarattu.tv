import type { AccountRaidTimeline, CharacterAccountResponse, RegionDates } from "../types/index";

const DAY = 86_400_000;
type Range = { start: number; end: number };
export type TimelineRaid = AccountRaidTimeline[number] & Range;
export type TimelineScale = {
  raids: TimelineRaid[];
  sections: Array<Range & { offset: number; length: number; compressed: boolean }>;
  length: number;
  start: number;
  end: number;
};

function timestamp(value?: string) {
  const time = value ? Date.parse(value) : NaN;
  return Number.isFinite(time) && time > 0 ? time : null;
}

export function createAccountTimeline(raids: AccountRaidTimeline, region: string, compress = true, now = Date.now()): TimelineScale | null {
  const normalized = raids.flatMap((raid): TimelineRaid[] => {
    const observations = raid.characters.flatMap((character) => [timestamp(character.firstSeenAt), timestamp(character.lastSeenAt)])
      .filter((date): date is number => date !== null);
    const release = timestamp(raid.starts?.[region.toLowerCase() as keyof RegionDates]);
    const start = release ?? (observations.length ? Math.min(...observations) : null);
    if (start === null || start > now) return [];
    const end = timestamp(raid.ends?.[region.toLowerCase() as keyof RegionDates]) ?? (release === null ? Math.max(...observations) : now);
    return [{ ...raid, start, end: Math.max(start + DAY, Math.min(end, now)) }];
  }).sort((a, b) => a.start - b.start || a.id - b.id);
  if (!normalized.length) return null;

  // Active raid windows and observations share one calendar. Keep late farming
  // reports visible and never compress time covered by an overlapping active tier.
  const activeRanges: Range[] = normalized.filter((raid) => raid.characters.length).flatMap((raid) => [
    { start: raid.start, end: raid.end },
    ...raid.characters.flatMap((character) => {
      const start = timestamp(character.firstSeenAt);
      const end = timestamp(character.lastSeenAt);
      return start !== null && end !== null && end >= start && start <= now ? [{ start, end: Math.min(now, end) }] : [];
    }),
  ]).sort((a, b) => a.start - b.start);
  if (!activeRanges.length) return null;

  const start = Math.min(normalized[0].start, activeRanges[0].start);
  const end = Math.max(start + DAY, ...normalized.map((raid) => raid.end), ...activeRanges.map((range) => range.end));
  const merged: Range[] = [];
  for (const range of activeRanges) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }

  const sections: TimelineScale["sections"] = [];
  let length = 0;
  const append = (from: number, to: number, inactive: boolean) => {
    if (to <= from) return;
    const compressed = compress && inactive && to - from > 30 * DAY;
    const sectionLength = compressed ? 30 * DAY : to - from;
    sections.push({ start: from, end: to, offset: length, length: sectionLength, compressed });
    length += sectionLength;
  };
  let cursor = start;
  for (const range of merged) {
    append(cursor, range.start, true);
    append(range.start, range.end, false);
    cursor = range.end;
  }
  append(cursor, end, true);
  return { raids: normalized, sections, length, start, end };
}

export function positionOnTimeline(scale: TimelineScale, time: number) {
  const date = Math.max(scale.start, Math.min(scale.end, time));
  const section = scale.sections.find((part) => date <= part.end) ?? scale.sections[scale.sections.length - 1];
  return (section.offset + (date - section.start) / (section.end - section.start) * section.length) / scale.length * 100;
}

export function timelineRange(scale: TimelineScale, start: number, end: number) {
  const left = positionOnTimeline(scale, start);
  return { left, width: Math.max(0, positionOnTimeline(scale, end) - left) };
}

export function packTimelineRanges<T extends { left: number; width: number }>(ranges: T[]) {
  const laneEnds: number[] = [];
  return [...ranges].sort((a, b) => a.left - b.left).map((range) => {
    let lane = laneEnds.findIndex((end) => end <= range.left);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = range.left + Math.max(range.width, 0.5);
    return { ...range, lane };
  });
}

export function accountTimelineActivity(scale: TimelineScale, characters: CharacterAccountResponse["characters"], minimumDays: number) {
  const byId = new Map(characters.map((character) => [character.characterId, character]));
  return packTimelineRanges(scale.raids.flatMap((raid) => raid.characters.flatMap((activity) => {
    const character = byId.get(activity.characterId);
    const start = timestamp(activity.firstSeenAt);
    const end = timestamp(activity.lastSeenAt);
    if (!character || start === null || end === null || end < start || end - start < minimumDays * DAY) return [];
    return [{ raid, activity, character, ...timelineRange(scale, start, end) }];
  })));
}

// Preserve the calendar position under the cursor while changing the canvas size.
export function timelineZoomViewport(zoom: number, requestedZoom: number, scrollLeft: number, viewportWidth: number, anchor: number) {
  const nextZoom = Math.max(1, Math.min(16, requestedZoom));
  const cursor = Math.max(0, Math.min(viewportWidth, anchor));
  const nextWidth = Math.max(640, viewportWidth) * nextZoom;
  const nextScroll = (scrollLeft + cursor) * nextZoom / zoom - cursor;
  return { zoom: nextZoom, scrollLeft: Math.max(0, Math.min(nextWidth - viewportWidth, nextScroll)) };
}

export function timelineTicks(scale: TimelineScale) {
  const ticks: Array<{ time: number; left: number; major: boolean }> = [];
  const date = new Date(scale.start);
  date.setUTCDate(1);
  date.setUTCHours(0, 0, 0, 0);
  while (date.getTime() <= scale.end) {
    const time = date.getTime();
    if (time >= scale.start && !scale.sections.some((section) => section.compressed && time > section.start && time < section.end)) {
      ticks.push({ time, left: positionOnTimeline(scale, time), major: date.getUTCMonth() === 0 });
    }
    date.setUTCMonth(date.getUTCMonth() + 1);
  }
  return ticks;
}
