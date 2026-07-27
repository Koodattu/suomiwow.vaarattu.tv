import mongoose, { Schema, Document } from "mongoose";

export interface IDiscordAccount {
  id: string; // Discord user ID
  username: string;
  discriminator: string;
  avatar: string | null;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: Date;
  scope?: string;
}

export interface ITwitchAccount {
  id: string; // Twitch user ID
  login: string; // Twitch login name (lowercase)
  displayName: string;
  profileImageUrl: string | null;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: Date;
  connectedAt: Date;
}

export interface IWoWCharacter {
  id: number; // Character ID from Battle.net
  name: string;
  realm: string;
  realmSlug: string;
  class: string;
  race: string;
  level: number;
  faction: "ALLIANCE" | "HORDE";
  guild?: string;
  guildRealm?: string; // Guild's realm name
  guildRealmSlug?: string; // Guild's realm slug
  selected: boolean; // Whether user has selected this character to display
  inactive?: boolean; // Whether the character is inactive (404 from API)
}

export interface IBattleNetAccount {
  id: string; // Battle.net account ID (sub from OAuth)
  battletag: string;
  accessToken: string;
  refreshToken?: string; // Optional - Battle.net doesn't always return refresh tokens
  tokenExpiresAt: Date;
  connectedAt: Date;
  characters: IWoWCharacter[];
  lastCharacterSync: Date | null;
}

// Pickem prediction for a single guild
export interface IPickemPrediction {
  guildName: string;
  realm: string;
  position: number; // 1-10, the predicted rank
}

// User's pickem entry for a specific season
export interface IPickemEntry {
  pickemId: string; // References PickemConfig.id
  predictions: IPickemPrediction[];
  submittedAt: Date;
  updatedAt: Date;
}

export interface IUser extends Document {
  discord: IDiscordAccount;
  twitch?: ITwitchAccount;
  battlenet?: IBattleNetAccount;
  pickems: IPickemEntry[];
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date;
}

const DiscordAccountSchema = new Schema<IDiscordAccount>(
  {
    id: { type: String, required: true },
    username: { type: String, required: true },
    discriminator: { type: String, default: "0" },
    avatar: { type: String, default: null },
    accessToken: { type: String, required: true },
    refreshToken: { type: String, required: true },
    tokenExpiresAt: { type: Date, required: true },
    scope: { type: String },
  },
  { _id: false },
);

const TwitchAccountSchema = new Schema<ITwitchAccount>(
  {
    id: { type: String, required: true },
    login: { type: String, required: true },
    displayName: { type: String, required: true },
    profileImageUrl: { type: String, default: null },
    accessToken: { type: String, required: true },
    refreshToken: { type: String, required: true },
    tokenExpiresAt: { type: Date, required: true },
    connectedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const WoWCharacterSchema = new Schema<IWoWCharacter>(
  {
    id: { type: Number, required: true },
    name: { type: String, required: true },
    realm: { type: String, required: true },
    realmSlug: { type: String, required: true },
    class: { type: String, required: true },
    race: { type: String, required: true },
    level: { type: Number, required: true },
    faction: { type: String, enum: ["ALLIANCE", "HORDE"], required: true },
    guild: { type: String, required: false },
    guildRealm: { type: String, required: false },
    guildRealmSlug: { type: String, required: false },
    selected: { type: Boolean, default: false },
    inactive: { type: Boolean, default: false },
  },
  { _id: false },
);

const BattleNetAccountSchema = new Schema<IBattleNetAccount>(
  {
    id: { type: String, required: true },
    battletag: { type: String, required: true },
    accessToken: { type: String, required: true },
    refreshToken: { type: String, required: false },
    tokenExpiresAt: { type: Date, required: true },
    connectedAt: { type: Date, default: Date.now },
    characters: { type: [WoWCharacterSchema], default: [] },
    lastCharacterSync: { type: Date, default: null },
  },
  { _id: false },
);

const PickemPredictionSchema = new Schema<IPickemPrediction>(
  {
    guildName: { type: String, required: true },
    realm: { type: String, required: true },
    position: { type: Number, required: true, min: 1, max: 25 },
  },
  { _id: false },
);

const PickemEntrySchema = new Schema<IPickemEntry>(
  {
    pickemId: { type: String, required: true },
    predictions: { type: [PickemPredictionSchema], default: [] },
    submittedAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const UserSchema = new Schema<IUser>(
  {
    discord: { type: DiscordAccountSchema, required: true },
    twitch: { type: TwitchAccountSchema, required: false },
    battlenet: { type: BattleNetAccountSchema, required: false },
    pickems: { type: [PickemEntrySchema], default: [] },
    lastLoginAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
  },
);

// Index for fast lookup by Discord ID
UserSchema.index({ "discord.id": 1 }, { unique: true });
UserSchema.index({ "twitch.id": 1 }, { sparse: true });

// Index for efficient pickem leaderboard queries
UserSchema.index({ "pickems.pickemId": 1 });

export default mongoose.model<IUser>("User", UserSchema);
