"use client";

import { GuildListItem, RaidProgressSummary } from "@/types";
import {
  formatTime,
  getWorldRankColor,
  getBestWorldRank,
  getLeaderboardRankColor,
  getRaiderIOGuildUrl,
  getEffectiveProgress,
} from "@/lib/utils";
import { getEffectivePullProgress } from "@/lib/raid-progress-display";
import GuildCrest from "./GuildCrest";
import BestPullValue from "./BestPullValue";
import Image from "next/image";
import Link from "next/link";
import { useState, memo, useCallback, useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { FaRegQuestionCircle, FaTwitch } from "react-icons/fa";

type BestVodLink = NonNullable<GuildListItem["bestVodLinks"]>[number];
type VodPhaseLink = {
  label: string;
  url: string;
  offsetSeconds?: number;
};

const VOD_POPUP_WIDTH = 256;
const VOD_POPUP_MARGIN = 8;
const VOD_POPUP_GAP = 4;

function formatOptionalTime(seconds?: number | null) {
  return seconds && seconds > 0 ? formatTime(seconds) : "-";
}

function StackedTimeValue({ primary, secondary }: { primary?: number | null; secondary?: number | null }) {
  return (
    <div className="flex flex-col items-center leading-tight">
      <div>{formatOptionalTime(primary)}</div>
      <div className="mt-0.5 text-[11px] text-gray-500">({formatOptionalTime(secondary)})</div>
    </div>
  );
}

function getLiveStreamerChannelNames(guild: GuildListItem) {
  return Array.from(new Set(guild.streamers?.filter((streamer) => streamer.isLive && streamer.channelName).map((streamer) => streamer.channelName) ?? []));
}

function GuildLiveBadge({ guild, label, compact = false }: { guild: GuildListItem; label: string; compact?: boolean }) {
  const liveStreamers = getLiveStreamerChannelNames(guild);

  if (!guild.isStreaming && liveStreamers.length === 0) return null;

  const dot = <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-purple-400 animate-pulse" />;

  if (liveStreamers.length === 0) {
    return compact ? (
      dot
    ) : (
      <span className="flex items-center gap-1 rounded bg-purple-900/50 px-2 py-0.5 text-xs font-semibold text-purple-300">
        {dot}
        {label}
      </span>
    );
  }

  const streamsParam = liveStreamers.join(",");
  const title = `${label}: ${liveStreamers.join(", ")}`;

  return (
    <Link
      href={`/livestreams?streams=${encodeURIComponent(streamsParam)}`}
      onClick={(event) => event.stopPropagation()}
      className={
        compact
          ? "inline-flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-purple-900/50 active:bg-purple-800/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
          : "inline-flex cursor-pointer items-center gap-1 rounded bg-purple-900/50 px-2 py-0.5 text-xs font-semibold text-purple-300 transition-colors hover:bg-purple-800/70 hover:text-purple-100 active:bg-purple-700/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
      }
      title={title}
      aria-label={title}
    >
      {dot}
      {!compact && label}
    </Link>
  );
}

function GuildRaidingBadge({ guild, label, compact = false }: { guild: GuildListItem; label: string; compact?: boolean }) {
  if (!guild.isCurrentlyRaiding) return null;

  const reportUrl = guild.latestReport?.url || (guild.latestReport?.code ? `https://www.warcraftlogs.com/reports/${guild.latestReport.code}` : null);
  const title = reportUrl ? `Open latest Warcraft Logs report for ${guild.name}` : label;
  const compactDot = <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-green-400" />;

  if (compact) {
    if (!reportUrl) return compactDot;

    return (
      <a
        href={reportUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(event) => event.stopPropagation()}
        className="inline-flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-green-900/50 active:bg-green-800/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-400 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
        title={title}
        aria-label={title}
      >
        {compactDot}
      </a>
    );
  }

  if (!reportUrl) {
    return <span className="rounded bg-green-900/50 px-2 py-0.5 text-xs font-semibold text-green-300">{label}</span>;
  }

  return (
    <a
      href={reportUrl}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(event) => event.stopPropagation()}
      className="inline-flex cursor-pointer items-center rounded bg-green-900/50 px-2 py-0.5 text-xs font-semibold text-green-300 transition-colors hover:bg-green-800/70 hover:text-green-100 active:bg-green-700/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-400 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
      title={title}
      aria-label={title}
    >
      {label}
    </a>
  );
}

function formatVodPhaseLabel(label: string) {
  return label.trim().toLowerCase() === "reaction" ? "🎉" : label;
}

function getVodPhaseLinks(vod: BestVodLink): VodPhaseLink[] {
  return vod.phaseLinks && vod.phaseLinks.length > 0 ? vod.phaseLinks : [{ label: "VOD", url: vod.url, offsetSeconds: vod.offsetSeconds || 0 }];
}

function VodPhaseLinkRow({ vod }: { vod: BestVodLink }) {
  const phaseLinks = getVodPhaseLinks(vod);

  return (
    <div className="min-w-0 space-y-1">
      <a
        href={`https://www.twitch.tv/${encodeURIComponent(vod.channelName)}`}
        target="_blank"
        rel="noopener noreferrer"
        className="flex min-w-0 items-center gap-1 text-[10px] font-medium text-purple-200 transition-colors hover:text-purple-100 hover:underline"
        title={`Open ${vod.channelName} on Twitch`}
      >
        <FaTwitch className="h-3 w-3 shrink-0" aria-hidden="true" />
        <span className="truncate">{vod.channelName}</span>
      </a>
      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${phaseLinks.length}, minmax(0, 1fr))` }}>
        {phaseLinks.map((phase, index) => (
          <a
            key={`${vod.channelName}-${phase.label}-${phase.offsetSeconds ?? index}`}
            href={phase.url}
            target="_blank"
            rel="noopener noreferrer"
            className="min-w-0 rounded bg-purple-600/20 px-1.5 py-1 text-center text-[11px] font-semibold text-purple-100 transition-colors hover:bg-purple-600/40 hover:text-white"
            title={`Watch ${vod.channelName} ${phase.label}`}
          >
            <span className="block truncate">{formatVodPhaseLabel(phase.label)}</span>
          </a>
        ))}
      </div>
    </div>
  );
}

interface GuildTableProps {
  guilds: GuildListItem[];
  onGuildClick: (guild: GuildListItem) => void;
  onRaidProgressClick: (guild: GuildListItem) => void;
  selectedRaidId: number | null;
}

function VodPopup({ vod, anchor, onMouseEnter, onMouseLeave }: { vod: BestVodLink; anchor: HTMLElement; onMouseEnter: () => void; onMouseLeave: () => void }) {
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    const updatePosition = () => {
      const rect = anchor.getBoundingClientRect();
      const estimatedHeight = 96;
      const maxLeft = window.innerWidth - VOD_POPUP_WIDTH - VOD_POPUP_MARGIN;
      const left = Math.max(VOD_POPUP_MARGIN, Math.min(rect.left + rect.width / 2 - VOD_POPUP_WIDTH / 2, maxLeft));
      const belowTop = rect.bottom + VOD_POPUP_GAP;
      const top = belowTop + estimatedHeight > window.innerHeight - VOD_POPUP_MARGIN && rect.top > estimatedHeight ? rect.top - estimatedHeight - VOD_POPUP_GAP : belowTop;

      setPosition({ left, top: Math.max(VOD_POPUP_MARGIN, top) });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [anchor]);

  if (typeof document === "undefined" || !position) return null;

  return createPortal(
    <div
      className="fixed z-70 pt-1 text-left"
      style={{ left: position.left, top: position.top, width: VOD_POPUP_WIDTH }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onFocus={onMouseEnter}
      onBlur={onMouseLeave}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="rounded border border-gray-700 bg-gray-900 p-2 shadow-xl">
        <div className="min-w-0">
          <VodPhaseLinkRow vod={vod} />
        </div>
      </div>
    </div>,
    document.body,
  );
}

function MobileStat({ label, children, className = "text-gray-300" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className="min-w-0 rounded bg-gray-900/35 px-1.5 py-1 text-center">
      <div className={`truncate text-xs font-bold leading-tight ${className}`}>{children}</div>
      <div className="mt-0.5 truncate text-[9px] font-medium uppercase leading-none text-gray-500">{label}</div>
    </div>
  );
}

function HeaderWithTooltip({ label, tooltip, tooltipId }: { label: ReactNode; tooltip: string; tooltipId: string }) {
  return (
    <span className="inline-flex items-center justify-center gap-1.5">
      {label}
      <button
        type="button"
        className="group relative inline-flex h-5 w-5 items-center justify-center rounded-full text-gray-500 transition-colors after:absolute after:left-1/2 after:top-1/2 after:h-10 after:w-10 after:-translate-x-1/2 after:-translate-y-1/2 after:content-[''] hover:text-gray-300 focus:outline-none focus-visible:text-gray-300 focus-visible:ring-2 focus-visible:ring-gray-500/60"
        aria-label={tooltip}
        aria-describedby={tooltipId}
      >
        <FaRegQuestionCircle className="h-3.5 w-3.5" aria-hidden="true" />
        <span
          id={tooltipId}
          role="tooltip"
          className="pointer-events-none absolute left-1/2 top-full z-50 mt-2 w-64 -translate-x-1/2 translate-y-1 rounded bg-gray-950 px-3 py-2 text-left text-xs font-normal leading-snug text-gray-200 opacity-0 shadow-xl ring-1 ring-white/10 transition-[opacity,transform] duration-150 group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100"
        >
          {tooltip}
        </span>
      </button>
    </span>
  );
}

function BestVodLinks({ links, compact = false }: { links?: GuildListItem["bestVodLinks"]; compact?: boolean }) {
  const [activeVodIndex, setActiveVodIndex] = useState<number | null>(null);
  const [popupAnchor, setPopupAnchor] = useState<HTMLElement | null>(null);
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = useCallback(() => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  }, []);

  const openVod = useCallback(
    (index: number, anchor: HTMLElement) => {
      cancelClose();
      setActiveVodIndex(index);
      setPopupAnchor(anchor);
    },
    [cancelClose],
  );

  const closeVod = useCallback(() => {
    cancelClose();
    setActiveVodIndex(null);
    setPopupAnchor(null);
  }, [cancelClose]);

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimeoutRef.current = setTimeout(() => {
      setActiveVodIndex(null);
      setPopupAnchor(null);
    }, 120);
  }, [cancelClose]);

  useEffect(() => {
    return () => cancelClose();
  }, [cancelClose]);

  if (!links || links.length === 0) {
    return compact ? null : <span className="text-gray-500">-</span>;
  }

  return (
    <div className="inline-flex items-center justify-center gap-1" onClick={(event) => event.stopPropagation()}>
      {links.map((vod, index) => {
        const isActive = activeVodIndex === index;
        const vodKey = `${vod.channelName}-${vod.videoId || vod.url}`;
        const iconOnly = compact || links.length > 1;

        return (
          <div
            key={vodKey}
            className="relative inline-flex justify-center"
            onMouseEnter={compact ? undefined : (event) => openVod(index, event.currentTarget)}
            onMouseLeave={compact ? undefined : scheduleClose}
            onFocus={compact ? undefined : (event) => openVod(index, event.currentTarget)}
            onBlur={compact ? undefined : scheduleClose}
          >
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                if (compact && isActive) {
                  closeVod();
                  return;
                }
                openVod(index, event.currentTarget);
              }}
              className={
                !iconOnly
                  ? "inline-flex max-w-[110px] items-center justify-center gap-1.5 rounded bg-purple-600/15 px-1.5 py-1 text-[11px] font-medium text-purple-200 transition-colors hover:bg-purple-600/30 hover:text-white"
                  : compact
                    ? "inline-flex h-8 w-8 items-center justify-center rounded bg-purple-600/15 text-purple-200 transition-colors hover:bg-purple-600/35 hover:text-white active:scale-[0.96] active:bg-purple-600/45"
                    : "inline-flex h-6 w-6 items-center justify-center rounded bg-purple-600/15 text-purple-200 transition-colors hover:bg-purple-600/35 hover:text-white"
              }
              title={`Show ${vod.channelName} VOD links`}
              aria-label={iconOnly ? `Show ${vod.channelName} VOD links` : undefined}
              aria-haspopup="true"
              aria-expanded={isActive}
            >
              <FaTwitch className={!iconOnly ? "h-3 w-3 shrink-0" : compact ? "h-4 w-4" : "h-3.5 w-3.5"} aria-hidden="true" />
              {!iconOnly && <span className="truncate">{vod.channelName}</span>}
            </button>
            {isActive && popupAnchor && <VodPopup vod={vod} anchor={popupAnchor} onMouseEnter={cancelClose} onMouseLeave={scheduleClose} />}
          </div>
        );
      })}
    </div>
  );
}

// Memoized table row to prevent re-renders when other rows are hovered
const GuildTableRow = memo(
  ({
    guild,
    index,
    selectedRaidId,
    onGuildClick,
    onRaidProgressClick,
    getLatestProgress,
    t,
  }: {
    guild: GuildListItem;
    index: number;
    selectedRaidId: number | null;
    onGuildClick: (guild: GuildListItem) => void;
    onRaidProgressClick: (guild: GuildListItem) => void;
    getLatestProgress: (guild: GuildListItem, difficulty: "mythic" | "heroic") => RaidProgressSummary | null;
    t: ReturnType<typeof useTranslations<"guildTable">>;
  }) => {
    const mythicProgress = getLatestProgress(guild, "mythic");
    const heroicProgress = getLatestProgress(guild, "heroic");
    const { pullDisplay: effectivePullDisplay, progress: effectiveTimeProgress, isHeroicFallback } = getEffectivePullProgress(mythicProgress, heroicProgress);
    const guildRank = mythicProgress?.guildRank || heroicProgress?.guildRank || index + 1;
    const worldRank = getBestWorldRank(mythicProgress) || getBestWorldRank(heroicProgress);
    const official = guild.officialProgress?.[0];
    const mythicDisplay = getEffectiveProgress(mythicProgress, official, "mythic");
    const heroicDisplay = getEffectiveProgress(heroicProgress, official, "heroic");

    const fallbackTextColor = isHeroicFallback ? "text-purple-400" : "text-gray-300";

    return (
      <tr key={guild._id} className={`guild-table-row border-b border-gray-800 ${guild.isCurrentlyRaiding ? "border-l-4 border-l-green-500" : ""}`}>
        {/* First clickable area: Rank, World Rank, and Guild Name */}
        <td className="guild-table-guild-cell px-4 py-3 text-center cursor-pointer transition-colors" onClick={() => onGuildClick(guild)}>
          <span className={`font-semibold ${getLeaderboardRankColor(guildRank)}`}>{guildRank}</span>
        </td>
        <td className="guild-table-guild-cell px-4 py-3 cursor-pointer transition-colors" onClick={() => onGuildClick(guild)}>
          {worldRank ? (
            <span className="font-semibold" style={{ color: getWorldRankColor(worldRank) }}>
              {worldRank}
            </span>
          ) : (
            <span className="text-gray-500">-</span>
          )}
        </td>
        <td className="guild-table-guild-cell px-4 py-3 cursor-pointer transition-colors" onClick={() => onGuildClick(guild)}>
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 shrink-0">
              <GuildCrest crest={guild.crest} faction={guild.faction} size={128} className="scale-[0.33] origin-top-left" />
            </div>
            <span className="font-semibold text-white">
              {guild.parent_guild ? (
                <>
                  {guild.name}
                  <span className="text-gray-400 font-thin text-sm">
                    {" "}
                    ({guild.parent_guild}-{guild.realm}){" "}
                  </span>
                </>
              ) : (
                <>
                  {guild.name}
                  <span className="text-gray-400 font-thin text-sm">-{guild.realm}</span>
                </>
              )}
            </span>
            {guild.warcraftlogsId && (
              <a
                href={`https://www.warcraftlogs.com/guild/id/${guild.warcraftlogsId}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center justify-center w-5 h-5 hover:opacity-80 transition-opacity"
                title={t("viewOnWarcraftLogs")}
              >
                <Image src="/wcl-logo.png" alt="WCL" width={20} height={20} className="w-full h-full object-contain" />
              </a>
            )}
            <a
              href={getRaiderIOGuildUrl(guild.region, guild.realm, guild.name)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center justify-center w-5 h-5 hover:opacity-80 transition-opacity"
              title={t("viewOnRaiderIO")}
            >
              <Image src="/raiderio-logo.png" alt="Raider.IO" width={20} height={20} className="w-full h-full object-contain" />
            </a>
            <GuildLiveBadge guild={guild} label={t("live")} />
            <GuildRaidingBadge guild={guild} label={t("raiding")} />
          </div>
        </td>
        {/* Second clickable area: Schedule and Raid Progress columns */}
        <td
          className="guild-table-progress-cell px-4 py-3 text-center text-sm text-gray-300 cursor-pointer transition-colors border-l-2 border-gray-700"
          onClick={() => onRaidProgressClick(guild)}
        >
          {guild.scheduleDisplay ? `${guild.scheduleDisplay.totalDays}D x ${guild.scheduleDisplay.averageHours}h` : "-"}
        </td>
        <td className="guild-table-progress-cell px-4 py-3 text-center cursor-pointer transition-colors" onClick={() => onRaidProgressClick(guild)}>
          <span className="text-orange-500 font-semibold" title={mythicDisplay.isOfficial ? t("officialProgressTooltip") : undefined}>
            {mythicDisplay.text}
            {mythicDisplay.isOfficial && <span className="text-[10px] text-orange-400/60 ml-0.5">*</span>}
          </span>
        </td>
        <td className="guild-table-progress-cell px-4 py-3 text-center cursor-pointer transition-colors" onClick={() => onRaidProgressClick(guild)}>
          <span className="text-purple-500 font-semibold" title={heroicDisplay.isOfficial ? t("officialProgressTooltip") : undefined}>
            {heroicDisplay.text}
            {heroicDisplay.isOfficial && <span className="text-[10px] text-purple-400/60 ml-0.5">*</span>}
          </span>
        </td>
        <td className={`guild-table-progress-cell px-4 py-3 text-center text-sm tabular-nums ${fallbackTextColor} cursor-pointer transition-colors`} onClick={() => onRaidProgressClick(guild)}>
          {effectivePullDisplay.pulls > 0 ? effectivePullDisplay.pulls : "-"}
        </td>
        <td className={`guild-table-progress-cell px-4 py-3 text-center text-sm tabular-nums ${fallbackTextColor} cursor-pointer transition-colors`} onClick={() => onRaidProgressClick(guild)}>
          <BestPullValue display={effectivePullDisplay} compactPhase />
        </td>
        <td className={`guild-table-progress-cell px-4 py-3 text-center text-sm ${fallbackTextColor} cursor-pointer transition-colors`} onClick={() => onRaidProgressClick(guild)}>
          <StackedTimeValue primary={effectiveTimeProgress?.totalTimeSpent} secondary={effectiveTimeProgress?.progressRaidTimeSpent} />
        </td>
        <td className={`guild-table-progress-cell px-4 py-3 text-center text-sm ${fallbackTextColor} cursor-pointer transition-colors`} onClick={() => onRaidProgressClick(guild)}>
          <StackedTimeValue primary={effectiveTimeProgress?.totalCombatTimeSpent} secondary={effectiveTimeProgress?.totalRaidTimeSpent} />
        </td>
        <td className="guild-table-progress-cell px-3 py-3 text-center text-sm cursor-pointer transition-colors" onClick={() => onRaidProgressClick(guild)}>
          <BestVodLinks links={guild.bestVodLinks} />
        </td>
      </tr>
    );
  },
);

GuildTableRow.displayName = "GuildTableRow";

export default function GuildTable({ guilds, onGuildClick, onRaidProgressClick, selectedRaidId }: GuildTableProps) {
  const t = useTranslations("guildTable");

  const getLatestProgress = useCallback(
    (guild: GuildListItem, difficulty: "mythic" | "heroic"): RaidProgressSummary | null => {
      if (!selectedRaidId) return null;
      return guild.progress.find((p) => p.difficulty === difficulty && p.raidId === selectedRaidId) || null;
    },
    [selectedRaidId],
  );

  // Mobile card component for each guild
  const MobileGuildCard = ({ guild, index }: { guild: GuildListItem; index: number }) => {
    const mythicProgress = getLatestProgress(guild, "mythic");
    const heroicProgress = getLatestProgress(guild, "heroic");
    const { pullDisplay: effectivePullDisplay, progress: effectiveTimeProgress, isHeroicFallback } = getEffectivePullProgress(mythicProgress, heroicProgress);
    const guildRank = mythicProgress?.guildRank || heroicProgress?.guildRank || index + 1;
    const worldRank = getBestWorldRank(mythicProgress) || getBestWorldRank(heroicProgress);
    const official = guild.officialProgress?.[0];
    const mythicDisplay = getEffectiveProgress(mythicProgress, official, "mythic");
    const heroicDisplay = getEffectiveProgress(heroicProgress, official, "heroic");

    const fallbackTextColor = isHeroicFallback ? "text-purple-400" : "text-gray-300";
    const progressTime = effectiveTimeProgress?.totalTimeSpent;

    return (
      <div className={`mb-1.5 overflow-hidden rounded-lg bg-gray-800/50 ${guild.isCurrentlyRaiding ? "border-l-2 border-l-green-500" : ""}`}>
        <div className="grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 p-2 active:bg-gray-700/50" onClick={() => onGuildClick(guild)}>
          <div className="grid w-15 shrink-0 grid-cols-2 gap-1 tabular-nums">
            <div className="rounded bg-gray-900/35 px-1 py-1 text-center">
              <div className="text-[8px] font-medium uppercase leading-none text-gray-500">FI</div>
              <div className={`mt-0.5 text-sm font-bold leading-none ${getLeaderboardRankColor(guildRank)}`}>{guildRank}</div>
            </div>
            <div className="rounded bg-gray-900/35 px-1 py-1 text-center">
              <div className="text-[8px] font-medium uppercase leading-none text-gray-500">WR</div>
              <div className="mt-0.5 text-sm font-bold leading-none" style={worldRank ? { color: getWorldRankColor(worldRank) } : undefined}>
                {worldRank || "-"}
              </div>
            </div>
          </div>

          <div className="flex min-w-0 items-center gap-2">
            <div className="h-9 w-9 shrink-0">
              <GuildCrest crest={guild.crest} faction={guild.faction} size={128} className="scale-[0.28] origin-top-left" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-1">
                <span className="truncate text-sm font-semibold text-white">{guild.name}</span>
                <GuildLiveBadge guild={guild} label={t("live")} compact />
                <GuildRaidingBadge guild={guild} label={t("raiding")} compact />
              </div>
              <div className="truncate text-[10px] text-gray-500">
                {guild.realm}
                {guild.parent_guild ? ` - ${guild.parent_guild}` : ""}
              </div>
            </div>
          </div>

          <BestVodLinks links={guild.bestVodLinks} compact />
        </div>

        <div className="grid cursor-pointer grid-cols-5 gap-1 border-t border-gray-700/70 p-1.5 tabular-nums active:bg-gray-700/50" onClick={() => onRaidProgressClick(guild)}>
          <MobileStat label="M" className="text-orange-500">
            {mythicDisplay.text}
            {mythicDisplay.isOfficial && <span className="text-[8px] text-orange-400/60">*</span>}
          </MobileStat>
          <MobileStat label="H" className="text-purple-500">
            {heroicDisplay.text}
            {heroicDisplay.isOfficial && <span className="text-[8px] text-purple-400/60">*</span>}
          </MobileStat>
          <MobileStat label={t("pulls")} className={fallbackTextColor}>
            {effectivePullDisplay.pulls > 0 ? effectivePullDisplay.pulls : "-"}
          </MobileStat>
          <MobileStat label="%" className={fallbackTextColor}>
            <BestPullValue display={effectivePullDisplay} compactPhase />
          </MobileStat>
          <MobileStat label={t("time")} className={fallbackTextColor}>
            {formatOptionalTime(progressTime)}
          </MobileStat>
        </div>
      </div>
    );
  };

  return (
    <>
      {/* Mobile View - Card Layout */}
      <div className="md:hidden">
        {guilds.map((guild, index) => (
          <MobileGuildCard key={guild._id} guild={guild} index={index} />
        ))}
        {guilds.length === 0 && <div className="text-center py-12 text-gray-500">No guilds found.</div>}
      </div>

      {/* Desktop View - Table Layout */}
      <div className="hidden md:block overflow-x-auto bg-gray-900 rounded-lg border border-gray-700">
        <table className="w-full min-w-[980px] border-collapse">
          <thead>
            <tr className="border-b border-gray-700 bg-gray-800/50">
              <th className="px-4 py-3 text-center text-sm font-semibold text-gray-300">{t("rank")}</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-gray-300">{t("world")}</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-gray-300">{t("guild")}</th>
              <th className="px-4 py-3 text-center text-sm font-semibold text-gray-300 border-l-2 border-gray-700">{t("schedule")}</th>
              <th className="px-4 py-3 text-center text-sm font-semibold text-orange-500">{t("mythic")}</th>
              <th className="px-4 py-3 text-center text-sm font-semibold text-purple-500">{t("heroic")}</th>
              <th className="px-4 py-3 text-center text-sm font-semibold text-gray-300">
                <HeaderWithTooltip label={t("pulls")} tooltip={t("pullsTooltip")} tooltipId="guild-pulls-tooltip" />
              </th>
              <th className="px-4 py-3 text-center text-sm font-semibold text-gray-300">%</th>
              <th className="px-4 py-3 text-center text-sm font-semibold text-gray-300">
                <HeaderWithTooltip label={t("progress")} tooltip={t("progressTooltip")} tooltipId="guild-progress-tooltip" />
              </th>
              <th className="px-4 py-3 text-center text-sm font-semibold text-gray-300">
                <HeaderWithTooltip label={t("total")} tooltip={t("totalTooltip")} tooltipId="guild-total-tooltip" />
              </th>
              <th className="px-3 py-3 text-center text-sm font-semibold text-gray-300">VOD</th>
            </tr>
          </thead>
          <tbody>
            {guilds.map((guild, index) => (
              <GuildTableRow
                key={guild._id}
                guild={guild}
                index={index}
                selectedRaidId={selectedRaidId}
                onGuildClick={onGuildClick}
                onRaidProgressClick={onRaidProgressClick}
                getLatestProgress={getLatestProgress}
                t={t}
              />
            ))}
          </tbody>
        </table>
        {guilds.length === 0 && <div className="text-center py-12 text-gray-500">No guilds found.</div>}
      </div>
    </>
  );
}
