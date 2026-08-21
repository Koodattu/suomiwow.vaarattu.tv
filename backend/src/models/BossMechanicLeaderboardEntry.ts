import mongoose, { type Document, Schema } from "mongoose";
import { BOSS_MECHANIC_DIFFICULTIES, type BossMechanicDifficulty } from "../features/fun/fun-game.types";

export interface IBossMechanicLeaderboardEntry extends Document {
  userId: mongoose.Types.ObjectId;
  username: string;
  avatarUrl: string;
  difficulty: BossMechanicDifficulty;
  difficultyRank: number;
  pulls: number;
  timeLeftMs: number;
  team: string;
  createdAt: Date;
  updatedAt: Date;
}

const BossMechanicLeaderboardEntrySchema = new Schema<IBossMechanicLeaderboardEntry>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true, index: true },
    username: { type: String, required: true, maxlength: 64 },
    avatarUrl: { type: String, required: true, maxlength: 512 },
    difficulty: { type: String, enum: BOSS_MECHANIC_DIFFICULTIES, required: true },
    difficultyRank: { type: Number, required: true, min: 1, max: 3 },
    pulls: { type: Number, required: true, min: 1, max: 10_000 },
    timeLeftMs: { type: Number, required: true, min: 0, max: 20_000 },
    team: { type: String, required: true, maxlength: 80 },
  },
  { timestamps: true },
);

BossMechanicLeaderboardEntrySchema.index({ difficultyRank: -1, timeLeftMs: -1, pulls: 1, updatedAt: 1 });

export default mongoose.model<IBossMechanicLeaderboardEntry>("BossMechanicLeaderboardEntry", BossMechanicLeaderboardEntrySchema);
