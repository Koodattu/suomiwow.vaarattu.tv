"use client";

import { useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { FiMinus, FiPlus, FiMaximize2 } from "react-icons/fi";
import type { CharacterAccountResponse } from "@/types";
import { createAccountTimeline, packTimelineRanges, timelineRange, timelineTicks, type TimelineRaid } from "@/lib/account-raid-timeline";
import { formatRealmName, formatSpecName, getClassInfoById, getSpecIconUrl } from "@/lib/utils";
import IconImage from "@/components/IconImage";
import styles from "./AccountRaidTimeline.module.css";

interface Props {
  account: CharacterAccountResponse;
  getClassColor: (className: string) => string;
}
type Inspection = { raid: TimelineRaid; character?: CharacterAccountResponse["characters"][number]; activity?: TimelineRaid["characters"][number] };

export default function AccountRaidTimeline({ account, getClassColor }: Props) {
  const t = useTranslations("accountProfile.timeline");
  const locale = useLocale();
  const [expanded, setExpanded] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const scale = useMemo(() => createAccountTimeline(account.raidTimeline ?? [], account.characters[0]?.region ?? "eu", !expanded), [account, expanded]);
  const date = (value: number | string) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(value));
  const month = (value: number) => new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" }).format(value);
  const raidBands = scale ? packTimelineRanges(scale.raids
    .filter((raid) => expanded || raid.characters.length)
    .map((raid) => ({ raid, ...timelineRange(scale, raid.start, raid.end) }))) : [];
  const raidHeight = Math.max(1, ...raidBands.map((band) => band.lane + 1)) * 24 + 8;
  const ticks = scale ? timelineTicks(scale) : [];
  const tickLabels = new Set<number>();
  let lastLabelPosition = -Infinity;
  for (const tick of ticks) {
    const showLabel = tick.major || (zoom >= 3 && new Date(tick.time).getUTCMonth() % 3 === 0);
    if (showLabel && tick.left < 97 && tick.left - lastLabelPosition >= 5 / zoom) {
      tickLabels.add(tick.time);
      lastLabelPosition = tick.left;
    }
  }
  const gaps = scale?.sections.filter((section) => section.compressed) ?? [];
  const activeCount = scale?.raids.filter((raid) => raid.characters.length).length ?? 0;
  const inspectedColor = inspection?.character ? getClassColor(getClassInfoById(inspection.character.classID).name) : undefined;
  const rangeStyle = (left: number, width: number): CSSProperties => ({ left: `${left}%`, width: `${width}%` });

  return (
    <section aria-labelledby="account-timeline-title" className={styles.timeline}>
      <div className={styles.toolbar}>
        <div className={styles.heading}>
          <h2 id="account-timeline-title">{t("title")}</h2>
          <span>{t("activeRaids", { count: activeCount })}</span>
        </div>
        {scale && <div className={styles.controls}>
          <button type="button" aria-pressed={expanded} onClick={() => setExpanded(!expanded)}>{t(expanded ? "compress" : "expand")}</button>
          <span className={styles.controlDivider} />
          <button type="button" aria-label={t("zoomOut")} title={t("zoomOut")} disabled={zoom === 1} onClick={() => setZoom(Math.max(1, zoom - 1))}><FiMinus /></button>
          <button type="button" aria-label={t("fit")} title={t("fit")} onClick={() => setZoom(1)}><FiMaximize2 /><span>{t("fit")}</span></button>
          <button type="button" aria-label={t("zoomIn")} title={t("zoomIn")} disabled={zoom === 6} onClick={() => setZoom(Math.min(6, zoom + 1))}><FiPlus /></button>
        </div>}
      </div>
      {!scale ? <p className={styles.empty}>{t("empty")}</p> : <>
        <div className={styles.scroll} role="region" aria-label={t("title")} tabIndex={0}>
          <div className={styles.canvas} style={{ width: `${zoom * 100}%` }}>
            <div className={styles.timelineRow}>
              <div className={styles.axisLabel}>{t("raids")}</div>
              <div className={styles.raidAxis} style={{ height: raidHeight }}>
                {raidBands.map(({ raid, left, width, lane }) => <button
                  key={raid.id}
                  type="button"
                  className={styles.raidBand}
                  style={{ ...rangeStyle(left, width), top: lane * 24 + 4 }}
                  title={`${raid.name} · ${date(raid.start)} – ${date(raid.end)}`}
                  aria-label={`${raid.name} · ${date(raid.start)} – ${date(raid.end)}`}
                  onMouseEnter={() => setInspection({ raid })}
                  onFocus={() => setInspection({ raid })}
                  onClick={() => setInspection({ raid })}
                ><IconImage iconFilename={raid.iconUrl} alt="" width={16} height={16} /><span>{raid.name}</span></button>)}
              </div>
            </div>
            <div className={styles.timelineRow}>
              <div className={styles.axisLabel}>{new Date(scale.start).getUTCFullYear()} – {new Date(scale.end).getUTCFullYear()}</div>
              <div className={styles.ruler}>
                {ticks.map((tick) => <span key={tick.time} className={tick.major ? styles.yearTick : styles.monthTick} style={{ left: `${tick.left}%` }}>
                  {tickLabels.has(tick.time) ? <span>{tick.major ? new Date(tick.time).getUTCFullYear() : month(tick.time)}</span> : null}
                </span>)}
                {gaps.map((gap) => <span key={gap.start} className={styles.axisBreak} style={{ left: `${timelineRange(scale, gap.start, gap.end).left}%` }} title={`${t("gap")} · ${date(gap.start)} – ${date(gap.end)}`}>{"//"}</span>)}
              </div>
            </div>
            {account.characters.map((character) => {
              const classInfo = getClassInfoById(character.classID);
              const color = getClassColor(classInfo.name);
              const bars = packTimelineRanges(scale.raids.flatMap((raid) => {
                const activity = raid.characters.find((entry) => entry.characterId === character.characterId);
                if (!activity) return [];
                const start = Date.parse(activity.firstSeenAt);
                const end = Date.parse(activity.lastSeenAt);
                if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];
                return [{ raid, activity, ...timelineRange(scale, start, end) }];
              }));
              if (!bars.length) return null;
              const height = Math.max(...bars.map((bar) => bar.lane + 1)) * 22 + 8;
              return <div key={character.characterId} className={styles.timelineRow}>
                <Link
                  className={styles.character}
                  href={`/characters/${encodeURIComponent(character.realm)}/${encodeURIComponent(character.name)}?class=${character.classID}`}
                  title={`${character.name} · ${formatRealmName(character.realm)}`}
                  style={{ color }}
                ><IconImage iconFilename={classInfo.iconUrl} alt="" width={20} height={20} /><span>{character.name}</span></Link>
                <div className={styles.track} style={{ height }}>
                  {ticks.filter((tick) => tick.major).map((tick) => <span key={tick.time} className={styles.guide} style={{ left: `${tick.left}%` }} />)}
                  {gaps.map((gap) => <span key={gap.start} className={styles.gap} style={rangeStyle(timelineRange(scale, gap.start, gap.end).left, timelineRange(scale, gap.start, gap.end).width)} />)}
                  {bars.map(({ raid, activity, left, width, lane }) => {
                    const label = `${character.name} · ${raid.name} · ${activity.specs.map(formatSpecName).join(", ") || t("unknownSpec")} · ${date(activity.firstSeenAt)} – ${date(activity.lastSeenAt)} · ${t("reports", { count: activity.reportCount })}`;
                    return <button
                      key={raid.id}
                      type="button"
                      className={styles.bar}
                      style={{ ...rangeStyle(left, width), top: lane * 22 + 4, "--class-color": color } as CSSProperties}
                      title={label}
                      aria-label={label}
                      onMouseEnter={() => setInspection({ raid, activity, character })}
                      onFocus={() => setInspection({ raid, activity, character })}
                      onClick={() => setInspection({ raid, activity, character })}
                    ><span className={styles.barContent}>
                      {activity.specs.slice(0, 2).map((spec) => <IconImage key={spec} iconFilename={getSpecIconUrl(character.classID, spec)} alt="" width={18} height={18} />)}
                      <span>{activity.specs.map(formatSpecName).join(" / ") || t("unknownSpec")}</span>
                    </span></button>;
                  })}
                </div>
              </div>;
            })}
          </div>
        </div>
        <div className={styles.inspection} aria-live="polite">
          {inspection ? <>
            <IconImage iconFilename={inspection.raid.iconUrl} alt="" width={24} height={24} className="rounded" />
            <strong style={{ color: inspectedColor }}>{inspection.character?.name ?? inspection.raid.name}</strong>
            {inspection.character && <span>{inspection.raid.name}</span>}
            {inspection.activity && <span className={styles.specs}>{inspection.activity.specs.map((spec) => <span key={spec}><IconImage iconFilename={getSpecIconUrl(inspection.character!.classID, spec)} alt="" width={16} height={16} />{formatSpecName(spec)}</span>)}{!inspection.activity.specs.length && t("unknownSpec")}</span>}
            <span>{date(inspection.activity?.firstSeenAt ?? inspection.raid.start)} – {date(inspection.activity?.lastSeenAt ?? inspection.raid.end)}</span>
            {inspection.activity && <span>{t("reports", { count: inspection.activity.reportCount })}</span>}
          </> : <span>{t("inspect")}</span>}
        </div>
        <p className={styles.legend}>{t("legend")}</p>
      </>}
    </section>
  );
}
