import mongoose, { Schema } from "mongoose";
import { DamageTotals } from "../utils/avoidable-damage";

export interface MechanicPlayer extends DamageTotals {
  identity: string;
  name: string;
  realm: string;
  region: string;
  classId: number;
  actorId: number;
  canonicalCharacterId?: number;
}
export type MechanicFetchStatus = "pending" | "fetched" | "failed" | "archived" | "unavailable" | "duplicate";
export interface IAvoidableDamageFight {
  guildId: mongoose.Types.ObjectId;
  sourceFightId: mongoose.Types.ObjectId;
  reportCode: string;
  fightId: number;
  mechanicKey: string;
  version: number;
  zoneId: number;
  encounterId: number;
  timestamp: Date;
  duration: number;
  isKill: boolean;
  status: MechanicFetchStatus;
  players: MechanicPlayer[];
  fetchedAt?: Date;
  retryAt?: Date;
  error?: string;
  duplicateOf?: mongoose.Types.ObjectId;
}

const PlayerSchema = new Schema<MechanicPlayer>({
  identity: { type: String, required: true }, name: { type: String, required: true },
  realm: String, region: String, classId: Number, actorId: Number, canonicalCharacterId: Number,
  damage: Number, hits: Number, directHits: Number, ticks: Number,
}, { _id: false });
const schema = new Schema<IAvoidableDamageFight>({
  guildId: { type: Schema.Types.ObjectId, ref: "Guild", required: true },
  sourceFightId: { type: Schema.Types.ObjectId, ref: "Fight", required: true },
  reportCode: { type: String, required: true }, fightId: { type: Number, required: true },
  mechanicKey: { type: String, required: true }, version: { type: Number, required: true },
  zoneId: Number, encounterId: Number, timestamp: Date, duration: Number, isKill: Boolean,
  status: { type: String, enum: ["pending", "fetched", "failed", "archived", "unavailable", "duplicate"], default: "pending" },
  players: { type: [PlayerSchema], default: [] }, fetchedAt: Date, retryAt: Date, error: String,
  duplicateOf: { type: Schema.Types.ObjectId, ref: "Fight" },
}, { timestamps: true });
schema.index({ sourceFightId: 1, mechanicKey: 1, version: 1 }, { unique: true });
schema.index({ guildId: 1, status: 1, retryAt: 1, reportCode: 1 });
schema.index({ mechanicKey: 1, version: 1, guildId: 1, isKill: 1, timestamp: 1 });
export default mongoose.model<IAvoidableDamageFight>("AvoidableDamageFight", schema);
