import fetch, { Response } from "node-fetch";
import logger from "../utils/logger";

interface TwitchTokenResponse {
  access_token: string;
  expires_in: number; // Seconds until expiration
  token_type: string;
}

interface TwitchStreamData {
  id: string;
  user_id: string;
  user_login: string;
  user_name: string;
  game_id: string;
  game_name: string;
  type: "live" | "";
  title: string;
  viewer_count: number;
  started_at: string;
  language: string;
  thumbnail_url: string;
}

interface TwitchStreamsResponse {
  data: TwitchStreamData[];
}

export interface TwitchVideoData {
  id: string;
  stream_id?: string;
  user_id: string;
  user_login: string;
  user_name: string;
  title: string;
  description: string;
  created_at: string;
  published_at: string;
  url: string;
  thumbnail_url: string;
  viewable: string;
  view_count: number;
  language: string;
  type: "archive" | "highlight" | "upload";
  duration: string;
  muted_segments?: Array<{ duration: number; offset: number }> | null;
}

interface TwitchVideosResponse {
  data: TwitchVideoData[];
  pagination?: {
    cursor?: string;
  };
}

export interface TwitchUserData {
  id: string;
  login: string;
  display_name: string;
  type: string;
  broadcaster_type: string;
  description: string;
  profile_image_url: string;
  offline_image_url: string;
  view_count: number;
  created_at: string;
}

interface TwitchUsersResponse {
  data: TwitchUserData[];
}

export interface StreamStatus {
  isLive: boolean;
  isPlayingWoW: boolean;
  gameName?: string;
  twitchUserId?: string;
  streamId?: string;
  startedAt?: string;
}

class TwitchService {
  private clientId: string;
  private clientSecret: string;
  private accessToken: string | null = null;
  private tokenExpiresAt: number = 0; // Timestamp when token expires

  constructor() {
    this.clientId = process.env.TWITCH_CLIENT_ID || "";
    this.clientSecret = process.env.TWITCH_CLIENT_SECRET || "";

    if (!this.clientId || !this.clientSecret) {
      logger.warn("⚠️  Twitch API credentials not configured. Streamer status updates will be disabled.");
    }
  }

  // Check if Twitch integration is enabled
  isEnabled(): boolean {
    return this.clientId !== "" && this.clientSecret !== "";
  }

  // Get app access token using OAuth Client Credentials flow
  private async getAccessToken(): Promise<string> {
    // If we have a valid token, return it
    if (this.accessToken && Date.now() < this.tokenExpiresAt) {
      return this.accessToken;
    }

    // Request new token
    try {
      logger.info(`[API REQUEST] POST https://id.twitch.tv/oauth2/token`);
      const response = await fetch("https://id.twitch.tv/oauth2/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          grant_type: "client_credentials",
        }).toString(),
      });

      if (!response.ok) {
        throw new Error(`Failed to get Twitch access token: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as TwitchTokenResponse;

      // Store token and calculate expiration time (with 5 minute buffer)
      this.accessToken = data.access_token;
      this.tokenExpiresAt = Date.now() + (data.expires_in - 300) * 1000;

      logger.info(`✅ Twitch access token obtained (expires in ${data.expires_in}s)`);
      return this.accessToken;
    } catch (error) {
      logger.error("Error getting Twitch access token:", error instanceof Error ? error.message : "Unknown error");
      throw error;
    }
  }

  private async fetchWithAccessToken(url: string): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const token = await this.getAccessToken();
      logger.info(`[API REQUEST] GET ${url}`);
      const response = await fetch(url, {
        headers: {
          "Client-ID": this.clientId,
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.status !== 401) return response;

      // A token can become invalid before its advertised expiry. Do not discard
      // a newer token that another request has already obtained.
      if (this.accessToken === token) {
        this.accessToken = null;
        this.tokenExpiresAt = 0;
      }
      if (attempt === 1) return response;
      await response.text();
      logger.warn("Twitch access token rejected; obtaining a new token and retrying once");
    }
  }

  // Check if channels are live and what game they're playing
  // Returns a Map of channel name (lowercase) to StreamStatus
  async getStreamStatus(channelNames: string[]): Promise<Map<string, StreamStatus>> {
    const statusMap = new Map<string, StreamStatus>();

    if (!this.isEnabled()) {
      logger.info("Twitch integration is disabled, returning all streams as offline");
      channelNames.forEach((name) => statusMap.set(name.toLowerCase(), { isLive: false, isPlayingWoW: false }));
      return statusMap;
    }

    if (channelNames.length === 0) {
      return statusMap;
    }

    try {
      // Twitch API supports up to 100 channels per request
      // Build query string with user_login parameters
      const queryParams = channelNames.map((name) => `user_login=${encodeURIComponent(name.toLowerCase())}`).join("&");

      const response = await this.fetchWithAccessToken(`https://api.twitch.tv/helix/streams?${queryParams}`);

      if (!response.ok) {
        throw new Error(`Twitch API error: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as TwitchStreamsResponse;

      // Initialize all channels as offline
      channelNames.forEach((name) => statusMap.set(name.toLowerCase(), { isLive: false, isPlayingWoW: false }));

      // Update status for live channels with game information
      data.data.forEach((stream) => {
        if (stream.type === "live") {
          const isPlayingWoW = stream.game_name.toLowerCase() === "world of warcraft";
          statusMap.set(stream.user_login.toLowerCase(), {
            isLive: true,
            isPlayingWoW: isPlayingWoW,
            gameName: stream.game_name,
            twitchUserId: stream.user_id,
            streamId: stream.id,
            startedAt: stream.started_at,
          });
        }
      });

      const liveCount = data.data.filter((s) => s.type === "live").length;
      const wowCount = data.data.filter((s) => s.type === "live" && s.game_name.toLowerCase() === "world of warcraft").length;
      logger.info(`Twitch: Checked ${channelNames.length} channel(s), ${liveCount} live (${wowCount} playing WoW)`);

      return statusMap;
    } catch (error) {
      logger.error("Error checking Twitch stream status:", error instanceof Error ? error.message : "Unknown error");

      // Let the scheduler fail the task without overwriting stored stream statuses.
      throw error;
    }
  }

  async getRecentArchiveVideos(userId: string, first: number = 10): Promise<TwitchVideoData[]> {
    if (!this.isEnabled()) {
      return [];
    }

    const params = new URLSearchParams({
      user_id: userId,
      type: "archive",
      sort: "time",
      first: Math.min(Math.max(first, 1), 100).toString(),
    });

    const response = await this.fetchWithAccessToken(`https://api.twitch.tv/helix/videos?${params.toString()}`);

    if (!response.ok) {
      throw new Error(`Twitch videos API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as TwitchVideosResponse;
    return data.data || [];
  }

  async getArchiveVideosSince(userId: string, cutoff: Date, maxPages: number = 5): Promise<TwitchVideoData[]> {
    if (!this.isEnabled()) {
      return [];
    }

    const videos: TwitchVideoData[] = [];
    let cursor: string | undefined;

    for (let page = 0; page < maxPages; page++) {
      const params = new URLSearchParams({
        user_id: userId,
        type: "archive",
        sort: "time",
        first: "100",
      });
      if (cursor) params.set("after", cursor);

      const response = await this.fetchWithAccessToken(`https://api.twitch.tv/helix/videos?${params.toString()}`);

      if (!response.ok) {
        throw new Error(`Twitch videos API error: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as TwitchVideosResponse;
      const pageVideos = data.data || [];
      videos.push(...pageVideos);

      const reachedCutoff = pageVideos.some((video) => {
        const createdAt = new Date(video.created_at);
        return !Number.isNaN(createdAt.getTime()) && createdAt.getTime() < cutoff.getTime();
      });
      if (reachedCutoff || !data.pagination?.cursor) break;

      cursor = data.pagination.cursor;
    }

    return videos.filter((video) => {
      const createdAt = new Date(video.created_at);
      return !Number.isNaN(createdAt.getTime()) && createdAt.getTime() >= cutoff.getTime();
    });
  }

  async getVideosByIds(videoIds: string[]): Promise<Map<string, TwitchVideoData>> {
    const videosById = new Map<string, TwitchVideoData>();

    if (!this.isEnabled() || videoIds.length === 0) {
      return videosById;
    }

    const uniqueIds = Array.from(new Set(videoIds.filter(Boolean)));

    for (let i = 0; i < uniqueIds.length; i += 100) {
      const batch = uniqueIds.slice(i, i + 100);
      const params = new URLSearchParams();
      batch.forEach((id) => params.append("id", id));

      const response = await this.fetchWithAccessToken(`https://api.twitch.tv/helix/videos?${params.toString()}`);

      if (!response.ok) {
        throw new Error(`Twitch videos API error: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as TwitchVideosResponse;
      (data.data || []).forEach((video) => {
        videosById.set(video.id, video);
      });
    }

    return videosById;
  }

  async getUsersByLogins(logins: string[]): Promise<Map<string, TwitchUserData>> {
    const usersByLogin = new Map<string, TwitchUserData>();

    if (!this.isEnabled() || logins.length === 0) {
      return usersByLogin;
    }

    const uniqueLogins = Array.from(new Set(logins.map((login) => login.trim().toLowerCase()).filter(Boolean)));

    for (let i = 0; i < uniqueLogins.length; i += 100) {
      const batch = uniqueLogins.slice(i, i + 100);
      const params = new URLSearchParams();
      batch.forEach((login) => params.append("login", login));

      const response = await this.fetchWithAccessToken(`https://api.twitch.tv/helix/users?${params.toString()}`);

      if (!response.ok) {
        throw new Error(`Twitch users API error: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as TwitchUsersResponse;
      (data.data || []).forEach((user) => {
        usersByLogin.set(user.login.toLowerCase(), user);
      });
    }

    return usersByLogin;
  }
}

// Export singleton instance
const twitchService = new TwitchService();
export default twitchService;
