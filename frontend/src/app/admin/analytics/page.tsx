"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import {
  AnalyticsOverview,
  AnalyticsDaily,
  AnalyticsEndpoint,
  AnalyticsStatusCode,
  AnalyticsRealtime,
  AnalyticsPeakHours,
  AnalyticsTrends,
  AnalyticsSlowEndpoint,
  AnalyticsErrors,
} from "@/types";

type TabType = "overview" | "endpoints" | "performance" | "errors";

type DailyChartPoint = AnalyticsDaily & {
  timestamp: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function formatChartDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatFullChartDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function DailyTrafficChart({ data }: { data: DailyChartPoint[] }) {
  if (data.length === 0) {
    return <div className="flex h-72 items-center justify-center text-sm text-slate-500">No daily traffic data yet</div>;
  }

  const onlyPoint = data.length === 1;
  const timestamp = data[0].timestamp;
  const xDomain = onlyPoint ? ([timestamp - DAY_MS, timestamp + DAY_MS] as [number, number]) : (["dataMin", "dataMax"] as const);

  return (
    <div className="h-72 w-full px-1 py-1 [&_*:focus-visible]:outline-none [&_*:focus]:outline-none [&_.recharts-surface]:outline-none">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.7} />
          <XAxis
            dataKey="timestamp"
            type="number"
            domain={xDomain}
            tickFormatter={formatChartDate}
            tick={{ fill: "#9CA3AF", fontSize: 11 }}
            stroke="#4B5563"
            tickLine={false}
          />
          <YAxis
            yAxisId="requests"
            tick={{ fill: "#F59E0B", fontSize: 11 }}
            stroke="#F59E0B"
            width={56}
            tickLine={false}
            tickFormatter={(value: number) => value.toLocaleString()}
          />
          <YAxis
            yAxisId="uniqueVisitors"
            orientation="right"
            tick={{ fill: "#34D399", fontSize: 11 }}
            stroke="#34D399"
            width={48}
            tickLine={false}
            allowDecimals={false}
            tickFormatter={(value: number) => value.toLocaleString()}
          />
          <Tooltip
            contentStyle={{ backgroundColor: "#1F2937", border: "1px solid #374151", borderRadius: "0.5rem" }}
            labelStyle={{ color: "#9CA3AF" }}
            labelFormatter={(value: string | number) => formatFullChartDate(Number(value))}
            formatter={(value: string | number | undefined, name: string | number | undefined) => {
              const label = name === "requests" ? "Requests" : "Unique visitors";
              const numericValue = typeof value === "number" ? value : Number(value || 0);
              return [numericValue.toLocaleString(), label];
            }}
          />
          <Line yAxisId="requests" type="linear" dataKey="requests" stroke="#F59E0B" strokeWidth={2} dot={{ r: 3, fill: "#F59E0B" }} activeDot={{ r: 5 }} name="requests" />
          <Line yAxisId="uniqueVisitors" type="linear" dataKey="uniqueVisitors" stroke="#34D399" strokeWidth={2} dot={{ r: 3, fill: "#34D399" }} activeDot={{ r: 5 }} name="uniqueVisitors" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function AdminAnalyticsPage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();

  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [daily, setDaily] = useState<AnalyticsDaily[]>([]);
  const [endpoints, setEndpoints] = useState<AnalyticsEndpoint[]>([]);
  const [statusCodes, setStatusCodes] = useState<AnalyticsStatusCode[]>([]);
  const [realtime, setRealtime] = useState<AnalyticsRealtime | null>(null);
  const [peakHours, setPeakHours] = useState<AnalyticsPeakHours | null>(null);
  const [trends, setTrends] = useState<AnalyticsTrends | null>(null);
  const [slowEndpoints, setSlowEndpoints] = useState<AnalyticsSlowEndpoint[]>([]);
  const [errors, setErrors] = useState<AnalyticsErrors | null>(null);
  const [baseLoading, setBaseLoading] = useState(true);
  const [rangeLoading, setRangeLoading] = useState(true);
  const [baseError, setBaseError] = useState<string | null>(null);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [selectedDays, setSelectedDays] = useState(7);
  const [activeTab, setActiveTab] = useState<TabType>("overview");

  // Endpoint filtering
  const [endpointFilter, setEndpointFilter] = useState("");
  const [endpointSortBy, setEndpointSortBy] = useState<"count" | "avgResponseTime" | "errorCount">("count");
  const [endpointSortOrder, setEndpointSortOrder] = useState<"asc" | "desc">("desc");

  // Redirect non-admin users
  useEffect(() => {
    if (!authLoading && (!user || !user.isAdmin)) {
      router.push("/");
    }
  }, [user, authLoading, router]);

  useEffect(() => {
    if (!user?.isAdmin) return;

    let cancelled = false;

    const fetchBaseData = async () => {
      try {
        setBaseLoading(true);
        setBaseError(null);

        const overviewData = await api.getAnalyticsOverview();
        if (cancelled) return;
        setOverview(overviewData);

        const realtimeData = await api.getAnalyticsRealtime();
        if (cancelled) return;
        setRealtime(realtimeData);

        const trendsData = await api.getAnalyticsTrends();
        if (cancelled) return;
        setTrends(trendsData);
      } catch (err) {
        if (!cancelled) setBaseError("Failed to load analytics data");
        console.error(err);
      } finally {
        if (!cancelled) setBaseLoading(false);
      }
    };

    void fetchBaseData();
    return () => {
      cancelled = true;
    };
  }, [user?.isAdmin]);

  useEffect(() => {
    if (!user?.isAdmin) return;

    let cancelled = false;

    const fetchRangeData = async () => {
      try {
        setRangeLoading(true);
        setRangeError(null);

        if (activeTab === "overview") {
          const dailyData = await api.getAnalyticsDaily(selectedDays);
          if (cancelled) return;
          setDaily(dailyData);

          const statusCodesData = await api.getAnalyticsStatusCodes(selectedDays);
          if (cancelled) return;
          setStatusCodes(statusCodesData);

          const peakHoursData = await api.getAnalyticsPeakHours(selectedDays);
          if (cancelled) return;
          setPeakHours(peakHoursData);
        } else if (activeTab === "endpoints") {
          const endpointsData = await api.getAnalyticsEndpoints(selectedDays);
          if (!cancelled) setEndpoints(endpointsData);
        } else if (activeTab === "performance") {
          const slowData = await api.getAnalyticsSlowEndpoints(selectedDays);
          if (!cancelled) setSlowEndpoints(slowData);
        } else {
          const errorsData = await api.getAnalyticsErrors(selectedDays);
          if (!cancelled) setErrors(errorsData);
        }
      } catch (err) {
        if (!cancelled) setRangeError("Failed to load analytics data");
        console.error(err);
      } finally {
        if (!cancelled) setRangeLoading(false);
      }
    };

    void fetchRangeData();
    return () => {
      cancelled = true;
    };
  }, [activeTab, selectedDays, user?.isAdmin]);

  // Refresh realtime data every 30 seconds
  useEffect(() => {
    if (!user?.isAdmin) return;

    const interval = setInterval(async () => {
      try {
        const realtimeData = await api.getAnalyticsRealtime();
        setRealtime(realtimeData);
      } catch (err) {
        console.error("Failed to refresh realtime data:", err);
      }
    }, 30000);

    return () => clearInterval(interval);
  }, [user?.isAdmin]);

  // Filter and sort endpoints
  const filteredEndpoints = useMemo(() => {
    let filtered = endpoints;

    // Apply text filter
    if (endpointFilter.trim()) {
      const searchTerm = endpointFilter.toLowerCase();
      filtered = endpoints.filter((e) => e.endpoint.toLowerCase().includes(searchTerm));
    }

    // Apply sorting
    filtered = [...filtered].sort((a, b) => {
      const aVal = a[endpointSortBy];
      const bVal = b[endpointSortBy];
      return endpointSortOrder === "desc" ? bVal - aVal : aVal - bVal;
    });

    return filtered;
  }, [endpoints, endpointFilter, endpointSortBy, endpointSortOrder]);

  const dailyChartData = useMemo(
    () =>
      daily
        .map((day) => ({
          ...day,
          timestamp: new Date(day.date).getTime(),
        }))
        .filter((day) => Number.isFinite(day.timestamp))
        .sort((a, b) => a.timestamp - b.timestamp),
    [daily],
  );

  const dailyTotals = useMemo(
    () =>
      daily.reduce(
        (totals, day) => ({
          requests: totals.requests + day.requests,
          uniqueVisitors: totals.uniqueVisitors + day.uniqueVisitors,
          dataTransferred: totals.dataTransferred + day.dataTransferred,
        }),
        { requests: 0, uniqueVisitors: 0, dataTransferred: 0 },
      ),
    [daily],
  );

  // Show loading state while checking auth
  if (authLoading) {
    return (
      <div className="min-h-screen bg-linear-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center">
        <div className="text-amber-400 text-xl">Loading...</div>
      </div>
    );
  }

  // Don't render if not admin
  if (!user?.isAdmin) {
    return null;
  }

  if (baseLoading || rangeLoading) {
    return (
      <div className="min-h-screen bg-linear-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center">
        <div className="text-amber-400 text-xl">Loading analytics...</div>
      </div>
    );
  }

  const error = baseError || rangeError;
  if (error) {
    return (
      <div className="min-h-screen bg-linear-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center">
        <div className="text-red-400 text-xl">{error}</div>
      </div>
    );
  }

  const getStatusCodeColor = (code: number) => {
    if (code >= 500) return "text-red-400";
    if (code >= 400) return "text-yellow-400";
    if (code >= 300) return "text-blue-400";
    return "text-green-400";
  };

  const getResponseTimeColor = (ms: number) => {
    if (ms > 1000) return "text-red-400";
    if (ms > 500) return "text-yellow-400";
    if (ms > 200) return "text-amber-400";
    return "text-green-400";
  };

  const getTrendIcon = (change: number) => {
    if (change > 0) return "↑";
    if (change < 0) return "↓";
    return "→";
  };

  const getTrendColor = (change: number) => {
    if (change > 10) return "text-green-400";
    if (change < -10) return "text-red-400";
    return "text-slate-400";
  };

  const tabs: { id: TabType; label: string; icon: string }[] = [
    { id: "overview", label: "Overview", icon: "📊" },
    { id: "endpoints", label: "Endpoints", icon: "🔗" },
    { id: "performance", label: "Performance", icon: "⚡" },
    { id: "errors", label: "Errors", icon: "⚠️" },
  ];

  return (
    <div className="min-h-screen bg-linear-to-br from-slate-950 via-slate-900 to-slate-950 p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <a href="/admin" className="text-slate-400 hover:text-white transition-colors">
              ← Back to Admin
            </a>
          </div>
          <h1 className="text-3xl font-bold text-amber-400 mb-2">📊 Site Analytics</h1>
          <p className="text-slate-400 text-pretty">Usage statistics, endpoint counts, and durable daily aggregates (Admin Only)</p>
        </div>

        {/* Controls Row */}
        <div className="flex flex-wrap gap-4 mb-6 items-center justify-between">
          {/* Tabs */}
          <div className="flex gap-1 bg-slate-800/50 rounded-lg p-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2 rounded-lg transition-colors text-sm font-medium ${
                  activeTab === tab.id ? "bg-amber-500 text-slate-900" : "text-slate-300 hover:bg-slate-700"
                }`}
              >
                {tab.icon} {tab.label}
              </button>
            ))}
          </div>

          {/* Time Range */}
          <div className="flex gap-2">
            {[7, 14, 30, 90, 365].map((days) => (
              <button
                key={days}
                onClick={() => setSelectedDays(days)}
                className={`min-h-10 px-3 py-1.5 rounded-lg transition-[background-color,color,transform] text-sm active:scale-[0.96] ${
                  selectedDays === days ? "bg-blue-600 text-white font-semibold" : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                }`}
              >
                {days}d
              </button>
            ))}
          </div>
        </div>

        {/* Realtime Stats Bar */}
        {realtime && (
          <div className="mb-6 bg-slate-800/50 rounded-xl p-4 border border-slate-700">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
                <span className="text-sm font-medium text-slate-400">Live</span>
              </div>
              <div className="flex gap-8">
                <div className="text-center">
                  <div className="text-xl font-bold tabular-nums text-white">{realtime.requestsPerMinute}</div>
                  <div className="text-xs text-slate-400">req/min</div>
                </div>
                <div className="text-center">
                  <div className="text-xl font-bold tabular-nums text-white">{realtime.currentHour.requests}</div>
                  <div className="text-xs text-slate-400">this hour</div>
                </div>
                <div className="text-center">
                  <div className={`text-xl font-bold tabular-nums ${getResponseTimeColor(realtime.currentHour.avgResponseTime)}`}>{realtime.currentHour.avgResponseTime}ms</div>
                  <div className="text-xs text-slate-400">avg response</div>
                </div>
                {trends && (
                  <>
                    <div className="text-center">
                      <div className={`text-xl font-bold tabular-nums ${getTrendColor(trends.dayOverDay.change)}`}>
                        {getTrendIcon(trends.dayOverDay.change)} {Math.abs(trends.dayOverDay.change)}%
                      </div>
                      <div className="text-xs text-slate-400">vs yesterday</div>
                    </div>
                    <div className="text-center">
                      <div className={`text-xl font-bold tabular-nums ${getTrendColor(trends.weekOverWeek.change)}`}>
                        {getTrendIcon(trends.weekOverWeek.change)} {Math.abs(trends.weekOverWeek.change)}%
                      </div>
                      <div className="text-xs text-slate-400">vs last week</div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Tab Content */}
        {activeTab === "overview" && (
          <div className="space-y-6">
            {/* Overview Cards */}
            {overview && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[
                  { label: "Last 24 Hours", data: overview.last24Hours },
                  { label: "Last 7 Days", data: overview.last7Days },
                  { label: "Last 30 Days", data: overview.last30Days },
                ].map(({ label, data }) => (
                  <div key={label} className="bg-slate-800/50 rounded-xl p-4 border border-slate-700">
                    <h3 className="text-sm font-medium text-slate-400 mb-3">{label}</h3>
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-slate-300">Requests</span>
                        <span className="text-xl font-bold tabular-nums text-white">{data.totalRequests.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-slate-300">Avg Response</span>
                        <span className={`font-semibold tabular-nums ${getResponseTimeColor(data.avgResponseTime)}`}>{data.avgResponseTime}ms</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-slate-300">Data Transferred</span>
                        <span className="font-semibold tabular-nums text-blue-400">{data.formattedData}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-slate-300">Unique Visitors</span>
                        <span className="font-semibold tabular-nums text-emerald-400">{data.uniqueVisitors.toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Daily and Peak Hours */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Daily Stats */}
              <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700">
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-amber-400 text-balance">Daily Traffic</h2>
                    <p className="text-sm text-slate-500 text-pretty">Requests and unique visitors per day for the selected range.</p>
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-right text-xs">
                    <div>
                      <div className="text-slate-500">Requests</div>
                      <div className="text-base font-bold tabular-nums text-white">{dailyTotals.requests.toLocaleString()}</div>
                    </div>
                    <div>
                      <div className="text-slate-500">Avg Unique</div>
                      <div className="text-base font-bold tabular-nums text-emerald-400">
                        {daily.length > 0 ? Math.round(dailyTotals.uniqueVisitors / daily.length).toLocaleString() : "0"}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500">Data</div>
                      <div className="text-base font-bold tabular-nums text-blue-400">{formatBytes(dailyTotals.dataTransferred)}</div>
                    </div>
                  </div>
                </div>
                <DailyTrafficChart data={dailyChartData} />
              </div>

              {/* Peak Hours */}
              {peakHours && (
                <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700">
                  <h2 className="text-lg font-semibold text-amber-400 mb-4">
                    🕐 Peak Hours <span className="text-sm font-normal text-slate-400">(peak: {peakHours.peakHour?.hourLabel || "N/A"})</span>
                  </h2>
                  <div className="space-y-1 max-h-80 overflow-y-auto">
                    {peakHours.hours.map((hour) => {
                      const maxAvg = Math.max(...peakHours.hours.map((h) => h.avgRequests));
                      const percentage = maxAvg > 0 ? (hour.avgRequests / maxAvg) * 100 : 0;
                      const isPeak = hour.hour === peakHours.peakHour?.hour;
                      return (
                        <div key={hour.hour} className="flex items-center gap-2">
                          <span className={`w-12 text-xs font-mono ${isPeak ? "text-amber-400 font-bold" : "text-slate-400"}`}>{hour.hourLabel}</span>
                          <div className="flex-1 h-4 bg-slate-700 rounded overflow-hidden">
                            <div className={`h-full rounded ${isPeak ? "bg-amber-500" : "bg-blue-500"}`} style={{ width: `${percentage}%` }} />
                          </div>
                          <span className="w-16 text-right text-xs text-slate-300">{hour.avgRequests} avg</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Status Codes */}
            <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700">
              <h2 className="text-lg font-semibold text-amber-400 mb-4">🔢 Status Code Distribution</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                {statusCodes.map((status) => {
                  const total = statusCodes.reduce((sum, s) => sum + s.count, 0);
                  const percentage = total > 0 ? (status.count / total) * 100 : 0;
                  return (
                    <div key={status.statusCode} className="bg-slate-700/50 rounded-lg p-3">
                      <div className={`text-2xl font-bold font-mono ${getStatusCodeColor(status.statusCode)}`}>{status.statusCode}</div>
                      <div className="text-sm text-slate-300">{status.count.toLocaleString()}</div>
                      <div className="text-xs text-slate-500">{percentage.toFixed(1)}%</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {activeTab === "endpoints" && (
          <div className="space-y-4">
            {/* Filters */}
            <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700">
              <div className="flex flex-wrap gap-4 items-center">
                <div className="flex-1 min-w-[200px]">
                  <input
                    type="text"
                    placeholder="Filter endpoints... (e.g., 'guilds', 'raids', 'events')"
                    value={endpointFilter}
                    onChange={(e) => setEndpointFilter(e.target.value)}
                    className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-amber-500"
                  />
                </div>
                <div className="flex gap-2 items-center">
                  <span className="text-sm text-slate-400">Sort:</span>
                  <select
                    value={endpointSortBy}
                    onChange={(e) => setEndpointSortBy(e.target.value as typeof endpointSortBy)}
                    className="px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-amber-500"
                  >
                    <option value="count">Request Count</option>
                    <option value="avgResponseTime">Response Time</option>
                    <option value="errorCount">Error Count</option>
                  </select>
                  <button
                    onClick={() => setEndpointSortOrder((o) => (o === "asc" ? "desc" : "asc"))}
                    className="px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white hover:bg-slate-600"
                  >
                    {endpointSortOrder === "desc" ? "↓" : "↑"}
                  </button>
                </div>
                <div className="text-sm text-slate-400">
                  Showing {filteredEndpoints.length} of {endpoints.length} endpoints
                </div>
              </div>
            </div>

            {/* Endpoints Table */}
            <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="text-slate-400 text-sm border-b border-slate-700">
                      <th className="text-left py-2 px-2">Endpoint</th>
                      <th className="text-left py-2 px-2">Methods</th>
                      <th className="text-right py-2 px-2">Requests</th>
                      <th className="text-right py-2 px-2">Avg ms</th>
                      <th className="text-right py-2 px-2">Data</th>
                      <th className="text-right py-2 px-2">Success</th>
                      <th className="text-right py-2 px-2">Errors</th>
                      <th className="text-right py-2 px-2">Last Called</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEndpoints.map((endpoint) => (
                      <tr key={endpoint.endpoint} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                        <td className="py-2 px-2 font-mono text-sm text-slate-300" title={endpoint.endpoint}>
                          {endpoint.endpoint}
                        </td>
                        <td className="py-2 px-2">
                          <div className="flex gap-1">
                            {endpoint.methods?.map((m) => (
                              <span
                                key={m}
                                className={`text-xs px-1.5 py-0.5 rounded font-mono ${
                                  m === "GET" ? "bg-green-900 text-green-300" : m === "POST" ? "bg-blue-900 text-blue-300" : "bg-slate-600 text-slate-300"
                                }`}
                              >
                                {m}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="py-2 px-2 text-right font-mono text-white">{endpoint.count.toLocaleString()}</td>
                        <td className={`py-2 px-2 text-right font-mono ${getResponseTimeColor(endpoint.avgResponseTime)}`}>{endpoint.avgResponseTime}</td>
                        <td className="py-2 px-2 text-right text-blue-400 text-sm">{endpoint.formattedSize}</td>
                        <td className="py-2 px-2 text-right">
                          <span className={endpoint.successRate >= 95 ? "text-green-400" : endpoint.successRate >= 80 ? "text-yellow-400" : "text-red-400"}>
                            {endpoint.successRate}%
                          </span>
                        </td>
                        <td className="py-2 px-2 text-right">
                          {endpoint.errorCount > 0 ? <span className="text-red-400">{endpoint.errorCount}</span> : <span className="text-slate-500">0</span>}
                        </td>
                        <td className="py-2 px-2 text-right text-xs text-slate-400">{endpoint.lastCalled ? new Date(endpoint.lastCalled).toLocaleString() : "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredEndpoints.length === 0 && <div className="text-center py-8 text-slate-400">No endpoints match your filter</div>}
              </div>
            </div>
          </div>
        )}

        {activeTab === "performance" && (
          <div className="space-y-6">
            {/* Slow Endpoints */}
            <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700">
              <h2 className="text-lg font-semibold text-amber-400 mb-4">🐢 Slowest Endpoints</h2>
              {slowEndpoints.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="text-slate-400 text-sm border-b border-slate-700">
                        <th className="text-left py-2 px-2">Endpoint</th>
                        <th className="text-right py-2 px-2">Requests</th>
                        <th className="text-right py-2 px-2">Avg ms</th>
                        <th className="text-right py-2 px-2">P95 ms</th>
                        <th className="text-right py-2 px-2">Max ms</th>
                        <th className="text-right py-2 px-2">Min ms</th>
                      </tr>
                    </thead>
                    <tbody>
                      {slowEndpoints.map((endpoint) => (
                        <tr key={endpoint.endpoint} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                          <td className="py-2 px-2 font-mono text-sm text-slate-300">{endpoint.endpoint}</td>
                          <td className="py-2 px-2 text-right font-mono text-white">{endpoint.count.toLocaleString()}</td>
                          <td className={`py-2 px-2 text-right font-mono font-bold ${getResponseTimeColor(endpoint.avgResponseTime)}`}>{endpoint.avgResponseTime}</td>
                          <td className={`py-2 px-2 text-right font-mono ${getResponseTimeColor(endpoint.p95ResponseTime)}`}>{endpoint.p95ResponseTime}</td>
                          <td className="py-2 px-2 text-right font-mono text-red-400">{endpoint.maxResponseTime}</td>
                          <td className="py-2 px-2 text-right font-mono text-green-400">{endpoint.minResponseTime}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-center py-8 text-slate-400">No slow endpoints detected (minimum 10 requests required)</div>
              )}
            </div>

            {/* Response Time Tips */}
            <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700">
              <h2 className="text-lg font-semibold text-amber-400 mb-4">💡 Performance Legend</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-green-400"></span>
                  <span className="text-sm text-slate-300">{"< 200ms - Excellent"}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-amber-400"></span>
                  <span className="text-sm text-slate-300">{"200-500ms - Good"}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-yellow-400"></span>
                  <span className="text-sm text-slate-300">{"500-1000ms - Slow"}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-red-400"></span>
                  <span className="text-sm text-slate-300">{"> 1000ms - Critical"}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "errors" && (
          <div className="space-y-6">
            {/* Error Summary */}
            {errors && errors.summary.length > 0 ? (
              <>
                <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700">
                  <h2 className="text-lg font-semibold text-amber-400 mb-4">📋 Error Summary by Endpoint</h2>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="text-slate-400 text-sm border-b border-slate-700">
                          <th className="text-left py-2 px-2">Endpoint</th>
                          <th className="text-right py-2 px-2">Total Errors</th>
                          <th className="text-left py-2 px-2">Status Codes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {errors.summary.map((err) => (
                          <tr key={err.endpoint} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                            <td className="py-2 px-2 font-mono text-sm text-slate-300">{err.endpoint}</td>
                            <td className="py-2 px-2 text-right font-mono text-red-400 font-bold">{err.totalErrors}</td>
                            <td className="py-2 px-2">
                              <div className="flex gap-2 flex-wrap">
                                {Object.entries(err.statusCodes).map(([code, count]) => (
                                  <span key={code} className={`text-xs px-2 py-1 rounded ${getStatusCodeColor(parseInt(code))} bg-slate-700`}>
                                    {code}: {count}
                                  </span>
                                ))}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Error Details */}
                <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700">
                  <h2 className="text-lg font-semibold text-amber-400 mb-4">🔍 Error Details</h2>
                  <div className="overflow-x-auto max-h-96">
                    <table className="w-full">
                      <thead className="sticky top-0 bg-slate-800">
                        <tr className="text-slate-400 text-sm border-b border-slate-700">
                          <th className="text-left py-2 px-2">Endpoint</th>
                          <th className="text-right py-2 px-2">Status</th>
                          <th className="text-right py-2 px-2">Count</th>
                          <th className="text-right py-2 px-2">Last Occurred</th>
                        </tr>
                      </thead>
                      <tbody>
                        {errors.details.map((err, i) => (
                          <tr key={`${err.endpoint}-${err.statusCode}-${i}`} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                            <td className="py-2 px-2 font-mono text-sm text-slate-300">{err.endpoint}</td>
                            <td className={`py-2 px-2 text-right font-mono font-bold ${getStatusCodeColor(err.statusCode)}`}>{err.statusCode}</td>
                            <td className="py-2 px-2 text-right font-mono text-white">{err.count}</td>
                            <td className="py-2 px-2 text-right text-xs text-slate-400">{new Date(err.lastOccurred).toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            ) : (
              <div className="bg-slate-800/50 rounded-xl p-8 border border-slate-700 text-center">
                <div className="text-4xl mb-4">🎉</div>
                <h2 className="text-xl font-semibold text-green-400 mb-2">No Errors!</h2>
                <p className="text-slate-400">No errors recorded in the last {selectedDays} days</p>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="mt-8 text-center text-slate-500 text-sm">
          <p>Detailed request logs auto-expire after 30 days • Daily aggregate counts are retained indefinitely • Live stats update every 30 seconds</p>
        </div>
      </div>
    </div>
  );
}
