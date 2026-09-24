import type { AccountRaidTimeline, RegionDates } from "../types/index";

export type TimelineRaid = AccountRaidTimeline[number] & { start: number | null; end: number | null };
export type TimelineSegment = { type: "raid"; raid: TimelineRaid } | { type: "gap"; raids: TimelineRaid[] };

function timestamp(value?: string) {
  const time = value ? Date.parse(value) : NaN;
  return Number.isFinite(time) && time > 0 ? time : null;
}

function regionDate(dates: RegionDates | undefined, region: string) {
  return timestamp(dates?.[region.toLowerCase() as keyof RegionDates]);
}

export function buildAccountTimeline(raids: AccountRaidTimeline, region: string, now = Date.now()): TimelineSegment[] {
  const datedRaids = raids.map((raid) => ({ id: raid.id, start: regionDate(raid.starts, region) }))
    .filter((raid): raid is { id: number; start: number } => raid.start !== null)
    .sort((a, b) => a.id - b.id);
  // Keep undated legacy raids near their neighboring zones, rather than putting
  // them at the end of history or dating them by a much later farming report.
  const sortDate = (raid: TimelineRaid) => {
    if (raid.start !== null) return raid.start;
    const neighbor = datedRaids.find((candidate) => candidate.id > raid.id) ?? datedRaids.at(-1);
    return neighbor ? neighbor.start + raid.id - neighbor.id : raid.id;
  };
  const ordered: TimelineRaid[] = raids.map((raid) => ({
    ...raid,
    start: regionDate(raid.starts, region),
    end: regionDate(raid.ends, region),
  })).filter((raid) => raid.start === null || raid.start <= now || raid.characters.length > 0)
    .sort((a, b) => sortDate(a) - sortDate(b) || a.id - b.id);

  const segments: TimelineSegment[] = [];
  for (const raid of ordered) {
    if (raid.characters.length) {
      segments.push({ type: "raid", raid });
    } else {
      const previous = segments.at(-1);
      if (previous?.type === "gap") previous.raids.push(raid);
      else segments.push({ type: "gap", raids: [raid] });
    }
  }
  return segments;
}

// Each tier has its own date scale. A single observation remains visible as a dot.
export function getActivityPosition(raid: TimelineRaid, firstSeenAt: string, lastSeenAt: string, now = Date.now()) {
  const first = timestamp(firstSeenAt);
  const last = timestamp(lastSeenAt);
  if (first === null || last === null || raid.start === null) return null;
  const end = raid.end ?? now;
  if (end <= raid.start || last < raid.start || first > end) return null;
  const left = Math.max(0, Math.min(100, (first - raid.start) / (end - raid.start) * 100));
  const right = Math.max(left, Math.min(100, (last - raid.start) / (end - raid.start) * 100));
  return { left, width: right - left };
}
