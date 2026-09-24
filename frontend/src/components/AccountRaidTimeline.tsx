"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { FiMinus, FiPlus, FiMaximize2 } from "react-icons/fi";
import type { CharacterAccountResponse } from "@/types";
import { accountTimelineActivity, createAccountTimeline, packTimelineRanges, timelineRange, timelineTicks, timelineZoomViewport, type TimelineRaid } from "@/lib/account-raid-timeline";
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
  const [minimumDays, setMinimumDays] = useState(14);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(1);
  const pendingScroll = useRef<number | null>(null);
  const drag = useRef<{ id: number; x: number; scrollLeft: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const scale = useMemo(() => createAccountTimeline(account.raidTimeline ?? [], account.characters[0]?.region ?? "eu", !expanded), [account, expanded]);
  const hasTimeline = scale !== null;
  const bars = useMemo(() => scale ? accountTimelineActivity(scale, account.characters, minimumDays) : [], [scale, account.characters, minimumDays]);
  const activityHeight = Math.max(1, ...bars.map((bar) => bar.lane + 1)) * 24 + 8;

  const changeZoom = useCallback((requestedZoom: number, anchor?: number) => {
    const viewport = scrollRef.current;
    if (!viewport) return;
    const next = timelineZoomViewport(zoomRef.current, requestedZoom, pendingScroll.current ?? viewport.scrollLeft, viewport.clientWidth, anchor ?? viewport.clientWidth / 2);
    if (next.zoom === zoomRef.current) return;
    zoomRef.current = next.zoom;
    pendingScroll.current = next.scrollLeft;
    setZoom(next.zoom);
  }, []);

  useLayoutEffect(() => {
    if (scrollRef.current && pendingScroll.current !== null) scrollRef.current.scrollLeft = pendingScroll.current;
    pendingScroll.current = null;
  }, [zoom]);

  useEffect(() => {
    const viewport = scrollRef.current;
    if (!viewport) return;
    const wheel = (event: WheelEvent) => {
      // Horizontal trackpad gestures keep their native pan behavior.
      if (!event.deltaY || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      event.preventDefault();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1);
      changeZoom(zoomRef.current * Math.exp(-Math.max(-120, Math.min(120, delta)) * 0.003), event.clientX - viewport.getBoundingClientRect().left);
    };
    viewport.addEventListener("wheel", wheel, { passive: false });
    return () => viewport.removeEventListener("wheel", wheel);
  }, [hasTimeline, changeZoom]);

  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || event.button !== 0) return;
    suppressClick.current = false;
    drag.current = { id: event.pointerId, x: event.clientX, scrollLeft: event.currentTarget.scrollLeft, moved: false };
  };
  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    const distance = event.clientX - current.x;
    if (!current.moved && Math.abs(distance) < 5) return;
    if (!current.moved) {
      current.moved = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      event.currentTarget.dataset.dragging = "true";
    }
    event.preventDefault();
    suppressClick.current = true;
    event.currentTarget.scrollLeft = current.scrollLeft - distance;
  };
  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null;
    delete event.currentTarget.dataset.dragging;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const inspect = (next: Inspection) => {
    if (!drag.current?.moved) setInspection(next);
  };
  const fitHistory = () => {
    const wasZoomed = zoomRef.current !== 1;
    changeZoom(1, 0);
    pendingScroll.current = wasZoomed ? 0 : null;
    if (scrollRef.current) scrollRef.current.scrollLeft = 0;
  };
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
  const raidColor = (id: number) => `hsl(${(id * 137.508) % 360} 65% 62%)`;

  return (
    <section aria-labelledby="account-timeline-title" className={styles.timeline}>
      <div className={styles.toolbar}>
        <div className={styles.heading}>
          <h2 id="account-timeline-title">{t("title")}</h2>
          <span>{t("activeRaids", { count: activeCount })}</span>
        </div>
        {scale && <div className={styles.controls}>
          <label className={styles.filter}>
            <span>{t("minimumSpan")}</span>
            <select value={minimumDays} onChange={(event) => { setMinimumDays(Number(event.target.value)); setInspection(null); }}>
              <option value={0}>{t("allAppearances")}</option>
              <option value={14}>{t("minimumDays", { count: 14 })}</option>
              <option value={30}>{t("minimumDays", { count: 30 })}</option>
            </select>
          </label>
          <button type="button" aria-pressed={expanded} onClick={() => setExpanded(!expanded)}>{t(expanded ? "compress" : "expand")}</button>
          <span className={styles.controlDivider} />
          <button type="button" aria-label={t("zoomOut")} title={t("zoomOut")} disabled={zoom === 1} onClick={() => changeZoom(zoom / 1.5)}><FiMinus /></button>
          <button type="button" aria-label={t("fit")} title={t("fit")} onClick={fitHistory}><FiMaximize2 /><span>{t("fit")}</span></button>
          <button type="button" aria-label={t("zoomIn")} title={t("zoomIn")} disabled={zoom === 16} onClick={() => changeZoom(zoom * 1.5)}><FiPlus /></button>
        </div>}
      </div>
      {!scale ? <p className={styles.empty}>{t("empty")}</p> : <>
        <p id="account-timeline-gestures" className={styles.gestureHint}>{t("gestures")}</p>
        <div ref={scrollRef} className={styles.scroll} role="region" aria-label={t("title")} aria-describedby="account-timeline-gestures" tabIndex={0}
          onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag}
          onPointerLeave={(event) => { if (!drag.current?.moved) endDrag(event); }}
          onDragStart={(event) => event.preventDefault()}
          onClickCapture={(event) => { if (suppressClick.current && event.detail !== 0) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; } }}>
          <div className={styles.canvas} style={{ width: `${zoom * 100}%`, minWidth: 640 * zoom }}>
              <div className={styles.raidAxis} style={{ height: raidHeight }}>
                {raidBands.map(({ raid, left, width, lane }) => <button
                  key={raid.id}
                  type="button"
                  className={styles.raidBand}
                  style={{ ...rangeStyle(left, width), top: lane * 24 + 4, "--raid-color": raidColor(raid.id) } as CSSProperties}
                  title={`${raid.name} · ${date(raid.start)} – ${date(raid.end)}`}
                  aria-label={`${raid.name} · ${date(raid.start)} – ${date(raid.end)}`}
                  onMouseEnter={() => inspect({ raid })}
                  onFocus={() => inspect({ raid })}
                  onClick={() => inspect({ raid })}
                ><IconImage iconFilename={raid.iconUrl} alt="" width={16} height={16} /><span>{raid.name}</span></button>)}
              </div>
              <div className={styles.ruler}>
                {ticks.map((tick) => <span key={tick.time} className={tick.major ? styles.yearTick : styles.monthTick} style={{ left: `${tick.left}%` }}>
                  {tickLabels.has(tick.time) ? <span>{tick.major ? new Date(tick.time).getUTCFullYear() : month(tick.time)}</span> : null}
                </span>)}
                {gaps.map((gap) => <span key={gap.start} className={styles.axisBreak} style={{ left: `${timelineRange(scale, gap.start, gap.end).left}%` }} title={`${t("gap")} · ${date(gap.start)} – ${date(gap.end)}`}>{"//"}</span>)}
              </div>
                <div className={styles.track} style={{ height: activityHeight }}>
                  {ticks.filter((tick) => tick.major).map((tick) => <span key={tick.time} className={styles.guide} style={{ left: `${tick.left}%` }} />)}
                  {gaps.map((gap) => <span key={gap.start} className={styles.gap} style={rangeStyle(timelineRange(scale, gap.start, gap.end).left, timelineRange(scale, gap.start, gap.end).width)} />)}
                  {bars.map(({ raid, activity, character, left, width, lane }) => {
                    const label = `${character.name} · ${raid.name} · ${activity.specs.map(formatSpecName).join(", ") || t("unknownSpec")} · ${date(activity.firstSeenAt)} – ${date(activity.lastSeenAt)} · ${t("reports", { count: activity.reportCount })}`;
                    return <button
                      key={`${raid.id}-${character.characterId}`}
                      type="button"
                      className={styles.bar}
                      style={{ ...rangeStyle(left, width), top: lane * 24 + 4, "--class-color": getClassColor(getClassInfoById(character.classID).name) } as CSSProperties}
                      title={label}
                      aria-label={label}
                      onMouseEnter={() => inspect({ raid, activity, character })}
                      onFocus={() => inspect({ raid, activity, character })}
                      onClick={() => inspect({ raid, activity, character })}
                    ><span className={styles.barContent}>
                      {activity.specs.slice(0, 2).map((spec) => <IconImage key={spec} iconFilename={getSpecIconUrl(character.classID, spec)} alt="" width={18} height={18} />)}
                      {!activity.specs.length && <IconImage iconFilename={getClassInfoById(character.classID).iconUrl} alt="" width={18} height={18} />}
                      <span>{character.name}</span>
                    </span></button>;
                  })}
                </div>
          </div>
        </div>
        {!bars.length && <p className={styles.empty}>{t("noMatchingActivity")}</p>}
        <div className={styles.inspection} aria-live="polite">
          {inspection ? <>
            <IconImage iconFilename={inspection.raid.iconUrl} alt="" width={24} height={24} className="rounded" />
            {inspection.character ? <Link style={{ color: inspectedColor }} title={formatRealmName(inspection.character.realm)} href={`/characters/${encodeURIComponent(inspection.character.realm)}/${encodeURIComponent(inspection.character.name)}?class=${inspection.character.classID}`}>{inspection.character.name}</Link> : <strong style={{ color: raidColor(inspection.raid.id) }}>{inspection.raid.name}</strong>}
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
