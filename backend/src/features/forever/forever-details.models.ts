import mongoose, { Schema } from "mongoose";

// Profile sections live beside, not inside, `forever_characters`: leaderboard scans
// over the character collection stay small while profiles carry full gear lists.
const killSchema = new Schema({ at: { type: Date, required: true }, guildSlug: String }, { _id: false });
const bossSchema = new Schema({
  id: { type: Number, required: true }, boss: { type: String, required: true }, instance: { type: String, required: true },
  count: { type: Number, required: true }, lastKillAt: { type: Date, required: true }, firstKillAt: Date,
  kills: { type: [killSchema], default: [] },
}, { _id: false });
const detailSchema = new Schema({
  region: { type: String, enum: ["eu", "us"], required: true }, slug: { type: String, required: true },
  armory: { type: new Schema({
    fetchedAt: { type: Date, required: true }, sourceUpdatedAt: Date,
    gear: { type: [Schema.Types.Mixed], default: [] }, specs: { type: [Schema.Types.Mixed], default: [] },
    professions: { type: [Schema.Types.Mixed], default: [] },
    honorableKills: Number, pvpRank: Number, renderUrl: String,
  }, { _id: false }) },
  blizzard: { type: new Schema({
    fetchedAt: { type: Date, required: true },
    achievementPoints: Number, achievementCount: Number,
    records: { type: Schema.Types.Mixed, default: {} },
    achievements: { type: [new Schema({ id: Number, name: String, completedAt: Date }, { _id: false })], default: [] },
    bosses: { type: [bossSchema], default: [] },
  }, { _id: false }) },
}, { timestamps: true, collection: "forever_character_details" });
detailSchema.index({ region: 1, slug: 1 });

// One row per item ID. Item data never changes, so a resolved level is permanent;
// IDs missing from every catalog are retried weekly as Blizzard publishes new items.
const itemSchema = new Schema({
  _id: { type: Number, required: true }, level: Number, name: String, namespace: String,
  checkedAt: Date, nextCheckAt: Date, misses: { type: Number, default: 0 },
}, { collection: "forever_items" });
itemSchema.index({ nextCheckAt: 1, _id: 1 }, { partialFilterExpression: { nextCheckAt: { $type: "date" } } });

export const ForeverCharacterDetail = mongoose.model("ForeverCharacterDetail", detailSchema);
export const ForeverItem = mongoose.model("ForeverItem", itemSchema);
