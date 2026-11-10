import mongoose, { Schema, Document } from "mongoose";

// Individual request log (for detailed analysis, auto-expires after 30 days)
export interface IRequestLog extends Document {
  endpoint: string;
  method: string;
  statusCode: number;
  responseTime: number; // in milliseconds
  responseSize: number; // in bytes
  visitorHash?: string;
  userAgent?: string;
  referer?: string;
  endpointVersion?: number;
  automated?: boolean;
  timestamp: Date;
}

const RequestLogSchema: Schema = new Schema(
  {
    endpoint: { type: String, required: true },
    method: { type: String, required: true },
    statusCode: { type: Number, required: true },
    responseTime: { type: Number, required: true },
    responseSize: { type: Number, required: true },
    visitorHash: { type: String },
    userAgent: { type: String },
    referer: { type: String },
    timestamp: { type: Date, required: true, default: Date.now },
    endpointVersion: Number,
    automated: Boolean,
  },
  {
    timestamps: false,
  },
);

// TTL index: automatically delete logs older than 30 days
RequestLogSchema.index({ timestamp: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });
// Index for querying
RequestLogSchema.index({ endpoint: 1, timestamp: -1 });
RequestLogSchema.index({ timestamp: -1 });
RequestLogSchema.index({ visitorHash: 1, timestamp: -1 });

// Hourly aggregated stats (for long-term storage)
export interface IHourlyStats extends Document {
  hour: Date; // Rounded to hour (e.g., 2025-12-01T14:00:00Z)
  totalRequests: number;
  totalResponseTime: number;
  totalDataTransferred: number;
  endpoints: Map<
    string,
    {
      count: number;
      totalResponseTime: number;
      totalSize: number;
      statusCodes: Map<string, number>;
    }
  >;
  statusCodes: Map<string, number>;
}

interface EndpointStats {
  endpoint: string;
  count: number;
  totalResponseTime: number;
  totalSize: number;
  errorCount: number;
  canonicalCount: number;
  methods: string[];
  lastCalled?: Date;
  lastErrorAt?: Date;
  statusCodes: Map<string, number>;
}

const EndpointStatsSchema = new Schema(
  {
    endpoint: { type: String, required: true },
    count: { type: Number, default: 0 },
    totalResponseTime: { type: Number, default: 0 },
    totalSize: { type: Number, default: 0 },
    errorCount: { type: Number, default: 0 },
    canonicalCount: { type: Number, default: 0 },
    methods: [{ type: String }],
    lastCalled: { type: Date },
    lastErrorAt: { type: Date },
    statusCodes: { type: Map, of: Number, default: {} },
  },
  { _id: false },
);

const HourlyStatsSchema: Schema = new Schema(
  {
    hour: { type: Date, required: true, unique: true },
    totalRequests: { type: Number, required: true, default: 0 },
    totalResponseTime: { type: Number, required: true, default: 0 },
    totalDataTransferred: { type: Number, required: true, default: 0 },
    endpoints: {
      type: Map,
      of: {
        count: { type: Number, default: 0 },
        totalResponseTime: { type: Number, default: 0 },
        totalSize: { type: Number, default: 0 },
        statusCodes: { type: Map, of: Number },
      },
      default: {},
    },
    statusCodes: { type: Map, of: Number, default: {} },
  },
  {
    timestamps: false,
  },
);

HourlyStatsSchema.index({ hour: -1 });

// Daily aggregated stats (for dashboard view)
export interface IDailyStats extends Document {
  date: Date; // Rounded to day (e.g., 2025-12-01T00:00:00Z)
  totalRequests: number;
  totalResponseTime: number;
  totalDataTransferred: number;
  uniqueVisitors: number;
  uniqueEndpoints: number;
  endpointStats: Map<string, EndpointStats>;
  topEndpoints: Array<{
    endpoint: string;
    count: number;
    avgResponseTime: number;
  }>;
  statusCodeSummary: Map<string, number>;
  hourlyBreakdown: Array<{
    hour: number;
    requests: number;
  }>;
}

const DailyStatsSchema: Schema = new Schema(
  {
    date: { type: Date, required: true, unique: true },
    totalRequests: { type: Number, required: true, default: 0 },
    totalResponseTime: { type: Number, required: true, default: 0 },
    totalDataTransferred: { type: Number, required: true, default: 0 },
    uniqueVisitors: { type: Number, required: true, default: 0 },
    uniqueEndpoints: { type: Number, default: 0 },
    endpointStats: { type: Map, of: EndpointStatsSchema, default: {} },
    topEndpoints: [
      {
        endpoint: { type: String },
        count: { type: Number },
        avgResponseTime: { type: Number },
      },
    ],
    statusCodeSummary: { type: Map, of: Number, default: {} },
    hourlyBreakdown: [
      {
        hour: { type: Number },
        requests: { type: Number },
      },
    ],
  },
  {
    timestamps: false,
  },
);

DailyStatsSchema.index({ date: -1 });

export interface IDailyUniqueVisitor extends Document {
  date: Date;
  visitorHash: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

const DailyUniqueVisitorSchema: Schema = new Schema(
  {
    date: { type: Date, required: true },
    visitorHash: { type: String, required: true },
    firstSeenAt: { type: Date, required: true },
    lastSeenAt: { type: Date, required: true },
  },
  {
    timestamps: false,
  },
);

DailyUniqueVisitorSchema.index({ date: 1, visitorHash: 1 }, { unique: true });
// Only needed while the day can still receive more requests. DailyStats keeps the final count forever.
DailyUniqueVisitorSchema.index({ date: 1 }, { expireAfterSeconds: 3 * 24 * 60 * 60 });

export const RequestLog = mongoose.model<IRequestLog>("RequestLog", RequestLogSchema);
export const HourlyStats = mongoose.model<IHourlyStats>("HourlyStats", HourlyStatsSchema);
export const DailyStats = mongoose.model<IDailyStats>("DailyStats", DailyStatsSchema);
export const DailyUniqueVisitor = mongoose.model<IDailyUniqueVisitor>("DailyUniqueVisitor", DailyUniqueVisitorSchema);
