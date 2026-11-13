export interface AiUsageTotals {
  calls: number;
  failures: number;
  polls: number;
  unpriced: number;
  costNanoUsd: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  totalTokens: number;
}

export interface AiUsageReport {
  start: string;
  end: string;
  firstRecordedAt: string | null;
  features: string[];
  totals: AiUsageTotals;
  byFeature: (AiUsageTotals & { _id: string })[];
  billing: { status: "available"; usd: number } | { status: "unconfigured" | "unavailable" };
  pageSize: number;
  calls: {
    _id: string;
    at: string;
    feature: string;
    endpoint: "responses" | "decisions" | "poll";
    model: string;
    tier: string;
    status: string;
    httpStatus?: number;
    requestId?: string;
    inputTokens?: number;
    cachedInputTokens?: number;
    cacheWriteTokens?: number;
    outputTokens?: number;
    reasoningTokens?: number;
    totalTokens?: number;
    costNanoUsd?: number | null;
  }[];
}
