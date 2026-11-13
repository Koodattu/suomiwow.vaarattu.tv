import mongoose, { Schema } from "mongoose";

const identity = { region: { type: String, enum: ["eu", "us"], required: true }, slug: { type: String, required: true } };
const polling = {
  nextFetchAt: { type: Date, default: Date.now }, lastAttemptAt: Date, lastFetchedAt: Date,
  failures: { type: Number, default: 0 }, errorCode: String,
};
const member = new Schema({ ...identity, name: String, level: Number, className: String, race: String, faction: String, isOutdated: Boolean }, { _id: false });
const characterSchema = new Schema({
  ...identity, ...polling,
  status: { type: String, enum: ["pending", "tracked", "paused", "rejected"], default: "pending", required: true },
  proposedBy: String, source: { type: String, enum: ["proposal", "admin", "guild", "seed"], required: true },
  independentlyTracked: Boolean,
  namegameBatch: { type: String, select: false },
  nameRating: { type: new Schema({
    name: { type: String, required: true }, score: { type: Number, required: true }, category: { type: String, required: true },
  }, { _id: false }) },
  twitchChannel: String, twitchIsLive: Boolean, twitchCheckedAt: Date, twitchNextCheckAt: Date,
  name: String, level: Number, className: String, race: String, faction: String, ruleset: String, avatarUrl: String,
  sourceUpdatedAt: Date, lastLevelAt: Date, refreshRequestedAt: Date, refreshQueuedAt: Date,
  estimatedLevel60At: Date, level60NextCheckAt: Date,
  profileFetchedAt: Date, profileLevel: Number,
  lowLevelRecheck: Boolean,
  rulesetInferredFromGuild: String,
  rosterObservedAt: Date, rosterLevel: Number, rosterGuildSlug: String, rosterCoverageUntil: Date,
  guild: { type: new Schema({ ...identity, name: String }, { _id: false }), default: null },
  history: { type: [new Schema({ level: { type: Number, required: true }, observedAt: { type: Date, required: true }, sourceUpdatedAt: Date,
    source: { type: String, enum: ["character", "roster"] } }, { _id: false })], default: [] },
}, { timestamps: true, collection: "forever_characters" });
characterSchema.index({ region: 1, slug: 1 }, { unique: true });
characterSchema.index({ "nameRating.score": -1, "nameRating.name": 1, _id: 1 }, { partialFilterExpression: { "nameRating.score": { $exists: true } } });
characterSchema.index({ status: 1, nextFetchAt: 1 });
characterSchema.index({ status: 1, profileFetchedAt: 1, sourceUpdatedAt: 1, nextFetchAt: 1 });
characterSchema.index({ status: 1, refreshRequestedAt: 1 });
characterSchema.index({ status: 1, level: -1, name: 1 });
characterSchema.index({ region: 1, status: 1, level: -1, lastLevelAt: 1, _id: 1 });
characterSchema.index({ level60NextCheckAt: 1, _id: 1 }, { partialFilterExpression: { region: "eu", status: "tracked", level: 60 } });
characterSchema.index({ status: 1, twitchNextCheckAt: 1 });
characterSchema.index({ rosterCoverageUntil: 1 });
characterSchema.index({ status: 1, lowLevelRecheck: 1, rosterCoverageUntil: 1 });
characterSchema.index({ region: 1, rosterGuildSlug: 1 });

const guildSchema = new Schema({
  ...identity, ...polling, name: { type: String, required: true },
  status: { type: String, enum: ["proposed", "pending", "approved", "paused", "rejected"], default: "pending", required: true },
  proposedBy: String, hidden: { type: Boolean, default: false },
  rosterPollingVersion: Number, rosterLaggingMembers: Number,
  profileComparisons: { type: Number, default: 0 }, profileAheadCount: { type: Number, default: 0 },
  rosterAheadCount: { type: Number, default: 0 }, lastComparedAt: Date,
  roster: { type: [member], default: [] },
  languageDueAt: Date, languageLease: { type: String, select: false },
  languageAssessment: { type: new Schema({
    fingerprint: String, assessedAt: Date, nameCount: Number, source: { type: String, enum: ["roster", "profiles"] },
    structured: Number,
    decision: { type: new Schema({
      percent: { type: Number, required: true }, yes: { type: Boolean, required: true },
      confidence: { type: String, enum: ["low", "medium", "high"], required: true },
    }, { _id: false }) },
  }, { _id: false }) },
}, { timestamps: true, collection: "forever_guilds" });
guildSchema.index({ region: 1, slug: 1 }, { unique: true });
guildSchema.index({ status: 1, nextFetchAt: 1 });
guildSchema.index({ status: 1, lastFetchedAt: 1, nextFetchAt: 1 });
guildSchema.index({ languageDueAt: 1 }, { sparse: true });

const workerSchema = new Schema({
  _id: { type: String, default: "armory" }, leaseToken: String, leaseUntil: Date,
  nextRequestAt: { type: Date, default: Date.now }, lastTickAt: Date, lastSuccessAt: Date, errorCode: String,
  failedJobs: { type: [String], default: [] }, failureWindowStartedAt: Date,
  consecutiveGuilds: { type: Number, default: 0 },
  consecutiveNewCharacters: { type: Number, default: 0 },
  consecutiveNewGuilds: { type: Number, default: 0 },
  leaderboardRevision: { type: Number, default: 0 },
}, { collection: "forever_worker" });
const limitSchema = new Schema({ _id: String, count: { type: Number, default: 0 }, expiresAt: Date }, { collection: "forever_request_limits" });
limitSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const ForeverCharacter = mongoose.model("ForeverCharacter", characterSchema);
export const ForeverGuild = mongoose.model("ForeverGuild", guildSchema);
export const ForeverWorker = mongoose.model("ForeverWorker", workerSchema);
export const ForeverRequestLimit = mongoose.model("ForeverRequestLimit", limitSchema);
