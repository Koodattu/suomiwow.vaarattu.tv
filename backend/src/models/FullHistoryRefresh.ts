import mongoose, { Document, Schema } from "mongoose";

export type FullHistoryRefreshStatus = "running" | "completed" | "failed";
export type FullHistoryRefreshStage =
  | "queue_fight_details"
  | "fight_details"
  | "queue_rankings"
  | "rankings"
  | "mechanics_and_tier_lists"
  | "ccg_snapshots"
  | "completed"
  | "failed";

export interface IFullHistoryRefresh extends Document {
  key: "all-raids";
  runId: string;
  status: FullHistoryRefreshStatus;
  stage: FullHistoryRefreshStage;
  startedAt: Date;
  stageStartedAt: Date;
  lastActivityAt: Date;
  completedAt?: Date | null;
  lastError?: string | null;
  progress: Record<string, unknown>;
}

const FullHistoryRefreshSchema = new Schema<IFullHistoryRefresh>(
  {
    key: { type: String, required: true, unique: true, default: "all-raids" },
    runId: { type: String, required: true },
    status: { type: String, enum: ["running", "completed", "failed"], required: true, index: true },
    stage: {
      type: String,
      enum: ["queue_fight_details", "fight_details", "queue_rankings", "rankings", "mechanics_and_tier_lists", "ccg_snapshots", "completed", "failed"],
      required: true,
    },
    startedAt: { type: Date, required: true },
    stageStartedAt: { type: Date, required: true },
    lastActivityAt: { type: Date, required: true },
    completedAt: { type: Date, default: null },
    lastError: { type: String, default: null },
    progress: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: false },
);

const FullHistoryRefresh = mongoose.model<IFullHistoryRefresh>("FullHistoryRefresh", FullHistoryRefreshSchema);
export default FullHistoryRefresh;
