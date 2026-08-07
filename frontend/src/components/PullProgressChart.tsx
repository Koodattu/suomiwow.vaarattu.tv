"use client";

import { useRef, type MouseEvent } from "react";
import { FaExternalLinkAlt } from "react-icons/fa";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PullHistoryEntry } from "@/types";
import { formatPercent, formatPhaseDisplay } from "@/lib/utils";

interface PullProgressChartProps {
  pullHistory: PullHistoryEntry[];
}

const CHART_MARGIN = { top: 8, right: 14, bottom: 0, left: 2 };
const PLOT_LEFT_OFFSET = 44;

type PullTooltipPayload = {
  payload?: PullHistoryEntry;
};

type PullTooltipProps = {
  active?: boolean;
  payload?: PullTooltipPayload[];
};

type PullDotProps = {
  cx?: number;
  cy?: number;
  payload?: PullHistoryEntry;
};

function getPullFromChartState(state: unknown): PullHistoryEntry | null {
  if (!state || typeof state !== "object") return null;

  const activePayload = (state as { activePayload?: PullTooltipPayload[] }).activePayload;
  return activePayload?.[0]?.payload ?? null;
}

function formatPullTimestamp(timestamp?: string) {
  if (!timestamp) return null;

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;

  return date.toLocaleString("fi-FI", {
    day: "numeric",
    month: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(seconds?: number) {
  if (!seconds || seconds <= 0) return null;

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes === 0) return `${remainingSeconds}s`;
  if (remainingSeconds === 0) return `${minutes}m`;
  return `${minutes}m ${remainingSeconds}s`;
}

function getProgressLabel(pull: PullHistoryEntry) {
  if (pull.isKill) return "Kill";
  if (pull.progressDisplay) return formatPhaseDisplay(pull.progressDisplay);
  return pull.progressPercentage === null ? "-" : formatPercent(pull.progressPercentage);
}

function hasUsableBossPercentage(pull: PullHistoryEntry): pull is PullHistoryEntry & { bossPercentage: number } {
  return (
    typeof pull.bossPercentage === "number" &&
    Number.isFinite(pull.bossPercentage) &&
    pull.bossPercentage >= 0 &&
    pull.bossPercentage <= 100 &&
    (pull.isKill || pull.bossPercentage > 0)
  );
}

function PullTooltip({ active, payload }: PullTooltipProps) {
  const pull = payload?.[0]?.payload;
  if (!active || !pull) return null;

  const pullTimestamp = formatPullTimestamp(pull.timestamp);
  const duration = formatDuration(pull.duration);

  return (
    <div className="min-w-44 rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-xs shadow-xl">
      <div className="mb-1 flex items-center justify-between gap-3">
        <span className="font-semibold text-white">Pull {pull.pullNumber}</span>
        <span className={pull.isKill ? "font-semibold text-green-400" : "font-semibold text-blue-300"}>{getProgressLabel(pull)}</span>
      </div>
      <div className="space-y-0.5 text-gray-400">
        {(pull.isKill || pull.progressSource === "fight") && (
          <div>
            Fight progress: <span className="text-gray-200">{formatPercent(pull.progressPercentage ?? 0)}</span>
          </div>
        )}
        {hasUsableBossPercentage(pull) && (
          <div>
            Boss health: <span className="text-gray-200">{formatPercent(pull.bossPercentage)}</span>
          </div>
        )}
        {pull.phase && (
          <div>
            Phase: <span className="text-gray-200">{pull.phase}</span>
          </div>
        )}
        {duration && (
          <div>
            Duration: <span className="text-gray-200">{duration}</span>
          </div>
        )}
        {pullTimestamp && (
          <div>
            Time: <span className="text-gray-200">{pullTimestamp}</span>
          </div>
        )}
      </div>
      {pull.url && (
        <div className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-blue-300">
          Click chart to open WCL
          <FaExternalLinkAlt className="h-2.5 w-2.5" aria-hidden="true" />
        </div>
      )}
    </div>
  );
}

export default function PullProgressChart({ pullHistory }: PullProgressChartProps) {
  const activePullRef = useRef<PullHistoryEntry | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  if (!pullHistory || pullHistory.length === 0) {
    return null;
  }

  const chartData = [...pullHistory].sort((a, b) => a.pullNumber - b.pullNumber);
  const plottablePulls = chartData.filter((pull) => pull.progressPercentage !== null);
  if (plottablePulls.length === 0) {
    return null;
  }

  const bestPull = plottablePulls.reduce((best, pull) =>
    (pull.progressPercentage ?? Number.POSITIVE_INFINITY) < (best.progressPercentage ?? Number.POSITIVE_INFINITY) ? pull : best,
  );
  const showDots = chartData.length <= 90;
  const hasWclLinks = chartData.some((pull) => pull.url);
  const firstPullNumber = chartData[0].pullNumber;
  const lastPullNumber = chartData[chartData.length - 1].pullNumber;

  const openPull = (pull: PullHistoryEntry | null) => {
    if (!pull?.url) return;
    window.open(pull.url, "_blank", "noopener,noreferrer");
  };

  const getNearestPullFromClick = (event: MouseEvent<HTMLDivElement>) => {
    const container = containerRef.current;
    if (!container) return null;
    if (chartData.length === 1) return chartData[0];

    const bounds = container.getBoundingClientRect();
    const plotLeft = bounds.left + PLOT_LEFT_OFFSET;
    const plotRight = bounds.right - CHART_MARGIN.right;
    const plotWidth = Math.max(1, plotRight - plotLeft);
    const ratio = Math.min(1, Math.max(0, (event.clientX - plotLeft) / plotWidth));
    const estimatedPullNumber = firstPullNumber + ratio * (lastPullNumber - firstPullNumber);

    return chartData.reduce((nearest, pull) =>
      Math.abs(pull.pullNumber - estimatedPullNumber) < Math.abs(nearest.pullNumber - estimatedPullNumber) ? pull : nearest,
    );
  };

  const handleChartActivity = (state: unknown) => {
    const pull = getPullFromChartState(state);
    if (pull) {
      activePullRef.current = pull;
    }
  };

  const handleContainerClick = (event: MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
    openPull(getNearestPullFromClick(event) || activePullRef.current);
  };

  const renderDot = ({ cx, cy, payload }: PullDotProps) => {
    if (cx == null || cy == null || !payload) return null;

    const isBest = payload.pullNumber === bestPull.pullNumber;
    const isSpecial = payload.isKill || isBest;
    if (!showDots && !isSpecial) return null;

    const radius = payload.isKill ? 5 : isBest ? 4 : chartData.length > 50 ? 2 : 3;
    const fill = payload.isKill ? "#22C55E" : isBest ? "#F59E0B" : "#60A5FA";

    return (
      <circle
        cx={cx}
        cy={cy}
        r={radius}
        fill={fill}
        stroke="#111827"
        strokeWidth={1.5}
        className={payload.url ? "cursor-pointer" : ""}
        onClick={(event: MouseEvent<SVGCircleElement>) => {
          event.stopPropagation();
          openPull(payload);
        }}
      />
    );
  };

  const renderActiveDot = ({ cx, cy, payload }: PullDotProps) => {
    if (cx == null || cy == null || !payload) return null;

    return (
      <circle
        cx={cx}
        cy={cy}
        r={6}
        fill="#BFDBFE"
        stroke="#1D4ED8"
        strokeWidth={2}
        className={payload.url ? "cursor-pointer" : ""}
        onClick={(event: MouseEvent<SVGCircleElement>) => {
          event.stopPropagation();
          openPull(payload);
        }}
      />
    );
  };

  return (
    <div
      ref={containerRef}
      className={`h-48 w-full px-1 py-0.5 [&_*:focus-visible]:outline-none [&_*:focus]:outline-none [&_.recharts-surface]:outline-none ${
        hasWclLinks ? "cursor-pointer [&_*]:cursor-pointer" : ""
      }`}
      onClick={handleContainerClick}
      onMouseDown={(event) => event.preventDefault()}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={CHART_MARGIN} onMouseMove={handleChartActivity}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.7} />
          <XAxis
            dataKey="pullNumber"
            type="number"
            domain={["dataMin", "dataMax"]}
            allowDecimals={false}
            height={16}
            tickMargin={2}
            tick={{ fill: "#9CA3AF", fontSize: 11 }}
            stroke="#4B5563"
            tickLine={false}
          />
          <YAxis
            domain={[0, 100]}
            ticks={[0, 25, 50, 75, 100]}
            tick={{ fill: "#9CA3AF", fontSize: 11 }}
            stroke="#4B5563"
            width={42}
            tickFormatter={(value: number) => `${value}%`}
          />
          <Tooltip content={<PullTooltip />} cursor={{ stroke: "#6B7280", strokeDasharray: "3 3" }} />
          <Line
            type="linear"
            dataKey="progressPercentage"
            stroke="#60A5FA"
            strokeWidth={2}
            dot={renderDot}
            activeDot={renderActiveDot}
            connectNulls={false}
            isAnimationActive={false}
            name="Progress"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
