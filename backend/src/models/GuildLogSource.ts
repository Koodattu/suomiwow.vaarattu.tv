import mongoose, { Document, Schema } from "mongoose";

const CASE_INSENSITIVE_COLLATION = { locale: "en", strength: 2 } as const;

export type GuildLogSourceStatus = "active" | "not_found" | "unclaimed" | "unknown";
export type GuildLogSourceSyncPolicy = "active" | "historical";

export interface IGuildLogSource extends Document {
  guildId: mongoose.Types.ObjectId;
  name: string;
  realm: string;
  region: string;
  warcraftlogsId?: number;
  isPrimary: boolean;
  syncPolicy: GuildLogSourceSyncPolicy;
  enabled: boolean;
  wclStatus: GuildLogSourceStatus;
  wclStatusUpdatedAt?: Date;
  wclNotFoundCount: number;
  initialFetchCompleted: boolean;
  initialFetchCompletedAt?: Date;
  lastFetched?: Date;
  lastLogEndTime?: Date;
  legacyGuildId?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const GuildLogSourceSchema = new Schema<IGuildLogSource>(
  {
    guildId: { type: Schema.Types.ObjectId, ref: "Guild", required: true, index: true },
    name: { type: String, required: true, trim: true },
    realm: { type: String, required: true, trim: true },
    region: { type: String, required: true, uppercase: true, trim: true },
    warcraftlogsId: { type: Number },
    isPrimary: { type: Boolean, required: true, default: false },
    syncPolicy: { type: String, enum: ["active", "historical"], required: true, default: "historical" },
    enabled: { type: Boolean, required: true, default: true },
    wclStatus: { type: String, enum: ["active", "not_found", "unclaimed", "unknown"], required: true, default: "unknown" },
    wclStatusUpdatedAt: { type: Date },
    wclNotFoundCount: { type: Number, required: true, default: 0 },
    initialFetchCompleted: { type: Boolean, required: true, default: false },
    initialFetchCompletedAt: { type: Date },
    lastFetched: { type: Date },
    lastLogEndTime: { type: Date },
    legacyGuildId: { type: Schema.Types.ObjectId, ref: "Guild" },
  },
  { timestamps: true },
);

GuildLogSourceSchema.index({ region: 1, realm: 1, name: 1 }, { unique: true, collation: CASE_INSENSITIVE_COLLATION });
GuildLogSourceSchema.index({ guildId: 1, isPrimary: 1 }, { unique: true, partialFilterExpression: { isPrimary: true } });
GuildLogSourceSchema.index({ guildId: 1, enabled: 1, syncPolicy: 1 });
GuildLogSourceSchema.index({ guildId: 1, lastFetched: 1 });
GuildLogSourceSchema.index({ legacyGuildId: 1 }, { sparse: true });

export default mongoose.model<IGuildLogSource>("GuildLogSource", GuildLogSourceSchema);
