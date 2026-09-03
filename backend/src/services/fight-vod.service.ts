import mongoose from "mongoose";
import FightVodLink from "../models/FightVodLink";
import Fight from "../models/Fight";
import Guild from "../models/Guild";
import TwitchVodProfile, { TwitchBroadcasterType, TwitchVodRetentionSource } from "../models/TwitchVodProfile";
import type { IBossProgress, IGuild, IRaidProgress } from "../models/Guild";
import type { IStreamer } from "../models/Streamer";
import twitchService, { TwitchUserData, TwitchVideoData } from "./twitch.service";
import logger from "../utils/logger";

const DAY_MS = 24 * 60 * 60 * 1000;
const NORMAL_VOD_RETENTION_DAYS = 7;
const AFFILIATE_VOD_RETENTION_DAYS = 14;
const EXTENDED_VOD_RETENTION_DAYS = 60;
const MAX_VOD_RETENTION_DAYS = EXTENDED_VOD_RETENTION_DAYS;
const RESOLUTION_RETRY_MS = 30 * 60 * 1000;
const VOD_PUBLICATION_GRACE_MS = DAY_MS;
const MAX_RESOLUTION_ATTEMPTS = 4;
const STREAM_END_TOLERANCE_MS = 30 * 60 * 1000;
const VOD_LINK_PREROLL_SECONDS = 10;
const HISTORICAL_MATCH_START_TOLERANCE_MS = 2 * 60 * 1000;
const HISTORICAL_MATCH_END_TOLERANCE_MS = 2 * 60 * 1000;
const HISTORICAL_VIDEO_LOOKUP_MAX_PAGES = 5;

interface StreamSnapshot {
  channelName: string;
  twitchUserId: string;
  streamId: string;
  streamStartedAt: Date;
  streamEndedAt?: Date;
}

interface BackfillCandidate {
  guild: IGuild;
  raidProgress: IRaidProgress;
  boss: IBossProgress;
  fight: any;
}

interface HistoricalVodMatch {
  video: TwitchVideoData;
  streamStartedAt: Date;
  offsetSeconds: number;
  durationSeconds: number;
  confidence: number;
}

interface BackfillStreamer {
  channelName: string;
  twitchUserId: string;
  user: TwitchUserData | undefined;
}

interface VodRetentionSnapshot {
  twitchUserId: string;
  channelName: string;
  broadcasterType: TwitchBroadcasterType;
  expectedVodRetentionDays: number;
  retentionSource: TwitchVodRetentionSource;
}

interface VodAvailabilityFields {
  expectedExpiresAt: Date;
  hardExpiresAt: Date;
  expiresAt: Date;
  nextAvailabilityCheckAt?: Date;
}

interface FightVodCandidate {
  reportCode: string;
  fightId: number;
  timestamp: Date;
}

export interface FightVodBackfillResult {
  guildsChecked: number;
  streamersChecked: number;
  userIdsResolved: number;
  fightsConsidered: number;
  skippedExisting: number;
  matched: number;
  ambiguous: number;
  noVodMatch: number;
  expired: number;
  errors: number;
}

export interface FightVodAvailabilityResult {
  checked: number;
  stillAvailable: number;
  unavailable: number;
  errors: number;
}

export interface FightVodCleanupResult {
  deleted: number;
  availability: FightVodAvailabilityResult;
}

class FightVodService {
  private toDate(value: Date | string | undefined): Date | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private getDateAfterDays(date: Date, days: number): Date {
    return new Date(date.getTime() + days * DAY_MS);
  }

  private getHardExpiresAt(streamStartedAt: Date): Date {
    return this.getDateAfterDays(streamStartedAt, MAX_VOD_RETENTION_DAYS);
  }

  private normalizeBroadcasterType(value: string | undefined): TwitchBroadcasterType {
    if (value === "partner" || value === "affiliate") return value;
    return "";
  }

  private getDefaultRetentionDays(broadcasterType: TwitchBroadcasterType): number {
    if (broadcasterType === "partner") return EXTENDED_VOD_RETENTION_DAYS;
    if (broadcasterType === "affiliate") return AFFILIATE_VOD_RETENTION_DAYS;
    return NORMAL_VOD_RETENTION_DAYS;
  }

  private getDefaultRetentionSource(broadcasterType: TwitchBroadcasterType): TwitchVodRetentionSource {
    if (broadcasterType === "partner") return "partner";
    if (broadcasterType === "affiliate") return "affiliate-default";
    return "normal-default";
  }

  private getOldestArchiveCreatedAt(videos: TwitchVideoData[]): Date | undefined {
    return videos.reduce<Date | undefined>((oldest, video) => {
      const createdAt = this.toDate(video.created_at);
      if (!createdAt) return oldest;
      if (!oldest || createdAt.getTime() < oldest.getTime()) return createdAt;
      return oldest;
    }, undefined);
  }

  private hasObservedExtendedRetention(videos: TwitchVideoData[], broadcasterType: TwitchBroadcasterType, now: Date): boolean {
    if (broadcasterType === "partner") return true;

    const threshold = now.getTime() - (this.getDefaultRetentionDays(broadcasterType) + 1) * DAY_MS;
    return videos.some((video) => {
      const createdAt = this.toDate(video.created_at);
      return Boolean(createdAt && createdAt.getTime() <= threshold);
    });
  }

  private async getStoredRetentionSnapshot(twitchUserId: string, channelName: string): Promise<VodRetentionSnapshot> {
    const profile = await TwitchVodProfile.findOne({ twitchUserId }).lean();
    if (profile) {
      const broadcasterType = this.normalizeBroadcasterType(profile.broadcasterType);
      return {
        twitchUserId,
        channelName: profile.channelName || channelName,
        broadcasterType,
        expectedVodRetentionDays: profile.expectedVodRetentionDays || this.getDefaultRetentionDays(broadcasterType),
        retentionSource: profile.retentionSource || this.getDefaultRetentionSource(broadcasterType),
      };
    }

    const broadcasterType = this.normalizeBroadcasterType(undefined);
    return {
      twitchUserId,
      channelName,
      broadcasterType,
      expectedVodRetentionDays: this.getDefaultRetentionDays(broadcasterType),
      retentionSource: this.getDefaultRetentionSource(broadcasterType),
    };
  }

  private async refreshRetentionSnapshot(channelName: string, twitchUserId: string, user: TwitchUserData | undefined, videos: TwitchVideoData[], now: Date): Promise<VodRetentionSnapshot> {
    const existingProfile = await TwitchVodProfile.findOne({ twitchUserId }).lean();
    const broadcasterType = this.normalizeBroadcasterType(user?.broadcaster_type || existingProfile?.broadcasterType);
    const oldestArchiveCreatedAt = this.getOldestArchiveCreatedAt(videos);

    let expectedVodRetentionDays = this.getDefaultRetentionDays(broadcasterType);
    let retentionSource = this.getDefaultRetentionSource(broadcasterType);

    if (existingProfile?.retentionSource === "manual") {
      expectedVodRetentionDays = existingProfile.expectedVodRetentionDays;
      retentionSource = "manual";
    } else if (this.hasObservedExtendedRetention(videos, broadcasterType, now)) {
      expectedVodRetentionDays = EXTENDED_VOD_RETENTION_DAYS;
      retentionSource = broadcasterType === "partner" ? "partner" : "observed-extended";
    }

    await TwitchVodProfile.updateOne(
      { twitchUserId },
      {
        $set: {
          twitchUserId,
          channelName,
          broadcasterType,
          expectedVodRetentionDays,
          retentionSource,
          retentionObservedAt: now,
          oldestArchiveCreatedAt,
          lastArchiveCheckedAt: now,
          nextRetentionRefreshAt: this.getDateAfterDays(now, 1),
        },
      },
      { upsert: true },
    );

    return {
      twitchUserId,
      channelName,
      broadcasterType,
      expectedVodRetentionDays,
      retentionSource,
    };
  }

  private getAvailabilityFields(retention: VodRetentionSnapshot, streamStartedAt: Date, now: Date): VodAvailabilityFields {
    const hardExpiresAt = this.getHardExpiresAt(streamStartedAt);
    const expectedExpiresAt = this.getDateAfterDays(streamStartedAt, retention.expectedVodRetentionDays);
    let nextAvailabilityCheckAt: Date | undefined;

    if (retention.broadcasterType !== "partner") {
      const defaultCheckAt = this.getDateAfterDays(streamStartedAt, this.getDefaultRetentionDays(retention.broadcasterType) + 1);
      if (defaultCheckAt.getTime() > now.getTime() && defaultCheckAt.getTime() < hardExpiresAt.getTime()) {
        nextAvailabilityCheckAt = defaultCheckAt;
      }
    }

    return {
      expectedExpiresAt,
      hardExpiresAt,
      expiresAt: hardExpiresAt,
      nextAvailabilityCheckAt,
    };
  }

  private getKnownStreamSnapshot(streamer: IStreamer, fightStartedAt: Date): StreamSnapshot | null {
    const channelName = streamer.channelName.toLowerCase();

    const currentStartedAt = this.toDate(streamer.streamStartedAt);
    if (streamer.isLive && streamer.currentStreamId && streamer.twitchUserId && currentStartedAt) {
      if (fightStartedAt.getTime() >= currentStartedAt.getTime() - STREAM_END_TOLERANCE_MS) {
        return {
          channelName,
          twitchUserId: streamer.twitchUserId,
          streamId: streamer.currentStreamId,
          streamStartedAt: currentStartedAt,
        };
      }
    }

    const lastStartedAt = this.toDate(streamer.lastStreamStartedAt);
    const lastEndedAt = this.toDate(streamer.lastStreamEndedAt);
    if (streamer.lastStreamId && streamer.twitchUserId && lastStartedAt && lastEndedAt) {
      const fightTime = fightStartedAt.getTime();
      if (fightTime >= lastStartedAt.getTime() - STREAM_END_TOLERANCE_MS && fightTime <= lastEndedAt.getTime() + STREAM_END_TOLERANCE_MS) {
        return {
          channelName,
          twitchUserId: streamer.twitchUserId,
          streamId: streamer.lastStreamId,
          streamStartedAt: lastStartedAt,
          streamEndedAt: lastEndedAt,
        };
      }
    }

    return null;
  }

  private getStreamSnapshots(guild: IGuild, fightStartedAt: Date): StreamSnapshot[] {
    if (!guild.streamers || guild.streamers.length === 0) return [];

    const now = Date.now();
    return guild.streamers
      .map((streamer) => this.getKnownStreamSnapshot(streamer, fightStartedAt))
      .filter((snapshot): snapshot is StreamSnapshot => Boolean(snapshot))
      .filter((snapshot) => this.getHardExpiresAt(snapshot.streamStartedAt).getTime() > now);
  }

  async enqueueForFights(guild: IGuild, raidProgress: IRaidProgress, boss: IBossProgress, fights: FightVodCandidate[]): Promise<void> {
    if (!guild.streamers || guild.streamers.length === 0 || fights.length === 0) return;

    for (const fight of fights) {
      const snapshots = this.getStreamSnapshots(guild, fight.timestamp);
      if (snapshots.length === 0) continue;

      for (const snapshot of snapshots) {
        const retention = await this.getStoredRetentionSnapshot(snapshot.twitchUserId, snapshot.channelName);
        const availability = this.getAvailabilityFields(retention, snapshot.streamStartedAt, new Date());

        await FightVodLink.updateOne(
          {
            reportCode: fight.reportCode,
            fightId: fight.fightId,
            channelName: snapshot.channelName,
          },
          {
            $setOnInsert: {
              guildId: guild._id as mongoose.Types.ObjectId,
              raidId: raidProgress.raidId,
              bossId: boss.bossId,
              bossName: boss.bossName,
              difficulty: raidProgress.difficulty,
              reportCode: fight.reportCode,
              fightId: fight.fightId,
              fightStartedAt: fight.timestamp,
              channelName: snapshot.channelName,
              twitchUserId: snapshot.twitchUserId,
              streamId: snapshot.streamId,
              streamStartedAt: snapshot.streamStartedAt,
              status: "pending",
              availabilityStatus: "active",
              expectedExpiresAt: availability.expectedExpiresAt,
              hardExpiresAt: availability.hardExpiresAt,
              nextAvailabilityCheckAt: availability.nextAvailabilityCheckAt,
              attempts: 0,
              expiresAt: availability.expiresAt,
            },
          },
          { upsert: true },
        );
      }
    }
  }

  parseTwitchDuration(duration: string): number {
    const match = duration.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
    if (!match) return 0;

    const hours = parseInt(match[1] || "0", 10);
    const minutes = parseInt(match[2] || "0", 10);
    const seconds = parseInt(match[3] || "0", 10);
    return hours * 3600 + minutes * 60 + seconds;
  }

  private formatTwitchOffset(totalSeconds: number): string {
    const seconds = Math.max(0, Math.floor(totalSeconds));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainder = seconds % 60;

    if (hours > 0) return `${hours}h${minutes}m${remainder}s`;
    if (minutes > 0) return `${minutes}m${remainder}s`;
    return `${remainder}s`;
  }

  buildTwitchVodUrl(videoId: string, offsetSeconds: number): string {
    const linkOffsetSeconds = Math.max(0, offsetSeconds - VOD_LINK_PREROLL_SECONDS);
    return `https://www.twitch.tv/videos/${videoId}?t=${this.formatTwitchOffset(linkOffsetSeconds)}`;
  }

  private findMatchingVideo(videos: TwitchVideoData[], streamId: string): TwitchVideoData | undefined {
    return videos.find((video) => video.stream_id === streamId);
  }

  private shouldStopResolving(attempts: number, fightStartedAt: Date, now: Date): boolean {
    return attempts >= MAX_RESOLUTION_ATTEMPTS && now.getTime() - fightStartedAt.getTime() >= VOD_PUBLICATION_GRACE_MS;
  }

  private getDifficultyId(difficulty: "mythic" | "heroic"): number {
    return difficulty === "mythic" ? 5 : 4;
  }

  private getFightDate(fight: any): Date {
    return fight.timestamp instanceof Date ? fight.timestamp : new Date(fight.timestamp);
  }

  private getDuplicateKey(fight: any): string {
    const timestamp = this.getFightDate(fight).getTime();
    const roundedTimestamp = Math.round(timestamp / 1000);
    const roundedDuration = Math.round((fight.duration || 0) / 100);
    const bossPercentage = Number(fight.bossPercentage || 0).toFixed(1);
    const fightPercentage = Number(fight.isKill ? 0 : fight.fightPercentage || 0).toFixed(1);
    return `${roundedTimestamp}:${roundedDuration}:${bossPercentage}:${fightPercentage}:${fight.isKill ? 1 : 0}`;
  }

  private async getFirstKillTime(guildId: mongoose.Types.ObjectId, raidProgress: IRaidProgress, boss: IBossProgress): Promise<Date | null> {
    const cachedFirstKillTime = this.toDate(boss.firstKillTime);
    if (cachedFirstKillTime) return cachedFirstKillTime;
    if (!boss.kills || boss.kills <= 0) return null;

    const firstKill = await Fight.findOne({
      guildId,
      zoneId: raidProgress.raidId,
      encounterID: boss.bossId,
      difficulty: this.getDifficultyId(raidProgress.difficulty),
      isKill: true,
    })
      .select("timestamp")
      .sort({ timestamp: 1 })
      .lean();

    return firstKill?.timestamp ? this.toDate(firstKill.timestamp) : null;
  }

  private async getRecentBestPullFights(guildId: mongoose.Types.ObjectId, raidProgress: IRaidProgress, boss: IBossProgress, cutoff: Date): Promise<any[]> {
    const firstKillTime = await this.getFirstKillTime(guildId, raidProgress, boss);
    if (firstKillTime && firstKillTime.getTime() < cutoff.getTime()) {
      return [];
    }

    const timestampQuery: Record<string, Date> = { $gte: cutoff };
    if (firstKillTime) {
      timestampQuery.$lte = firstKillTime;
    }

    const candidateLimit = Math.max(25, Math.min((boss.pullCount || 25) * 2, 250));
    const candidates = await Fight.find({
      guildId,
      zoneId: raidProgress.raidId,
      encounterID: boss.bossId,
      difficulty: this.getDifficultyId(raidProgress.difficulty),
      timestamp: timestampQuery,
    })
      .select("reportCode fightId timestamp duration bossPercentage fightPercentage isKill")
      .sort({ fightPercentage: 1, timestamp: -1 })
      .limit(candidateLimit)
      .lean();

    const seen = new Set<string>();
    const bestFights: any[] = [];

    for (const fight of candidates) {
      const duplicateKey = this.getDuplicateKey(fight);
      if (seen.has(duplicateKey)) continue;
      seen.add(duplicateKey);
      bestFights.push(fight);
      if (bestFights.length === 5) break;
    }

    return bestFights;
  }

  private findHistoricalVideoMatch(videos: TwitchVideoData[], fight: any): HistoricalVodMatch | "ambiguous" | null {
    const fightStartedAt = this.getFightDate(fight);
    if (Number.isNaN(fightStartedAt.getTime())) return null;

    const fightStartMs = fightStartedAt.getTime();
    const fightDurationMs = Math.max(0, fight.duration || 0);
    const fightEndMs = fightStartMs + fightDurationMs;
    const matches: HistoricalVodMatch[] = [];

    for (const video of videos) {
      if (video.type !== "archive") continue;

      const streamStartedAt = this.toDate(video.created_at);
      const durationSeconds = this.parseTwitchDuration(video.duration);
      if (!streamStartedAt || durationSeconds <= 0) continue;

      const streamStartMs = streamStartedAt.getTime();
      const streamEndMs = streamStartMs + durationSeconds * 1000;

      if (fightStartMs < streamStartMs - HISTORICAL_MATCH_START_TOLERANCE_MS) continue;
      if (fightEndMs > streamEndMs + HISTORICAL_MATCH_END_TOLERANCE_MS) continue;

      const rawOffsetSeconds = Math.floor((fightStartMs - streamStartMs) / 1000);
      const isInsideVodWindow = fightStartMs >= streamStartMs && fightEndMs <= streamEndMs;

      matches.push({
        video,
        streamStartedAt,
        offsetSeconds: Math.max(0, rawOffsetSeconds),
        durationSeconds,
        confidence: isInsideVodWindow ? 0.85 : 0.65,
      });
    }

    if (matches.length === 0) return null;
    if (matches.length > 1) return "ambiguous";
    return matches[0];
  }

  private async getBackfillCandidates(guild: IGuild, cutoff: Date): Promise<BackfillCandidate[]> {
    const candidates: BackfillCandidate[] = [];

    for (const raidProgress of guild.progress || []) {
      if (raidProgress.difficulty !== "mythic" && raidProgress.difficulty !== "heroic") continue;

      for (const boss of raidProgress.bosses || []) {
        const fights = await this.getRecentBestPullFights(guild._id as mongoose.Types.ObjectId, raidProgress, boss, cutoff);
        fights.forEach((fight) => {
          candidates.push({ guild, raidProgress, boss, fight });
        });
      }
    }

    return candidates;
  }

  async backfillRecentBestPullLinks(): Promise<FightVodBackfillResult> {
    const result: FightVodBackfillResult = {
      guildsChecked: 0,
      streamersChecked: 0,
      userIdsResolved: 0,
      fightsConsidered: 0,
      skippedExisting: 0,
      matched: 0,
      ambiguous: 0,
      noVodMatch: 0,
      expired: 0,
      errors: 0,
    };

    if (!twitchService.isEnabled()) {
      return result;
    }

    const now = new Date();
    const cutoff = new Date(now.getTime() - MAX_VOD_RETENTION_DAYS * DAY_MS);
    const guilds = await Guild.find({
      streamers: { $exists: true, $ne: [] },
      progress: { $exists: true, $ne: [] },
    }).select("name realm streamers progress");

    result.guildsChecked = guilds.length;

    const allLogins = new Set<string>();
    guilds.forEach((guild) => {
      guild.streamers?.forEach((streamer) => {
        const login = streamer.channelName.trim().toLowerCase();
        if (login) allLogins.add(login);
      });
    });

    const usersByLogin = await twitchService.getUsersByLogins(Array.from(allLogins));
    result.userIdsResolved = usersByLogin.size;

    const videosByUser = new Map<string, TwitchVideoData[]>();
    const retentionByUser = new Map<string, VodRetentionSnapshot>();
    const userIdsChecked = new Set<string>();

    const getVideosForUser = async (twitchUserId: string): Promise<TwitchVideoData[]> => {
      if (!videosByUser.has(twitchUserId)) {
        try {
          const videos = await twitchService.getArchiveVideosSince(twitchUserId, cutoff, HISTORICAL_VIDEO_LOOKUP_MAX_PAGES);
          videosByUser.set(
            twitchUserId,
            videos.filter((video) => {
              const createdAt = this.toDate(video.created_at);
              return Boolean(createdAt && this.getHardExpiresAt(createdAt).getTime() > now.getTime());
            }),
          );
        } catch (error) {
          result.errors += 1;
          logger.warn(`[Fight VOD Backfill] Failed to fetch videos for Twitch user ${twitchUserId}: ${error instanceof Error ? error.message : String(error)}`);
          videosByUser.set(twitchUserId, []);
        }
      }

      return videosByUser.get(twitchUserId) || [];
    };

    const getStreamerContext = async (streamer: BackfillStreamer) => {
      const videos = await getVideosForUser(streamer.twitchUserId);
      if (!retentionByUser.has(streamer.twitchUserId)) {
        retentionByUser.set(streamer.twitchUserId, await this.refreshRetentionSnapshot(streamer.channelName, streamer.twitchUserId, streamer.user, videos, now));
      }

      return {
        videos,
        retention: retentionByUser.get(streamer.twitchUserId)!,
      };
    };

    for (const guild of guilds) {
      const streamers = (guild.streamers || [])
        .map((streamer) => {
          const channelName = streamer.channelName.trim().toLowerCase();
          const user = usersByLogin.get(channelName);
          const twitchUserId = streamer.twitchUserId || user?.id;
          return twitchUserId ? { channelName, twitchUserId, user } : null;
        })
        .filter((streamer): streamer is BackfillStreamer => Boolean(streamer));

      if (streamers.length === 0) continue;
      streamers.forEach((streamer) => userIdsChecked.add(streamer.twitchUserId));

      const candidates = await this.getBackfillCandidates(guild, cutoff);

      for (const candidate of candidates) {
        const fightStartedAt = this.getFightDate(candidate.fight);
        if (Number.isNaN(fightStartedAt.getTime())) continue;

        const existingLinks = await FightVodLink.find({
          reportCode: candidate.fight.reportCode,
          fightId: candidate.fight.fightId,
          channelName: { $in: streamers.map((streamer) => streamer.channelName) },
        })
          .select("channelName status streamId -_id")
          .lean();
        const existingLinksByChannel = new Map(existingLinks.map((link) => [link.channelName, link]));

        for (const streamer of streamers) {
          result.fightsConsidered += 1;

          const existingLink = existingLinksByChannel.get(streamer.channelName);
          if (existingLink?.status === "resolved") {
            result.skippedExisting += 1;
            continue;
          }

          const context = await getStreamerContext(streamer);
          const match = this.findHistoricalVideoMatch(context.videos, candidate.fight);

          if (match === "ambiguous") {
            result.ambiguous += 1;
            continue;
          }

          if (!match) {
            result.noVodMatch += 1;
            continue;
          }

          const availability = this.getAvailabilityFields(context.retention, match.streamStartedAt, now);
          if (availability.hardExpiresAt.getTime() <= now.getTime()) {
            result.expired += 1;
            continue;
          }

          await FightVodLink.updateOne(
            {
              reportCode: candidate.fight.reportCode,
              fightId: candidate.fight.fightId,
              channelName: streamer.channelName,
            },
            {
              $setOnInsert: {
                guildId: candidate.guild._id as mongoose.Types.ObjectId,
                raidId: candidate.raidProgress.raidId,
                bossId: candidate.boss.bossId,
                bossName: candidate.boss.bossName,
                difficulty: candidate.raidProgress.difficulty,
                reportCode: candidate.fight.reportCode,
                fightId: candidate.fight.fightId,
                fightStartedAt,
                channelName: streamer.channelName,
                attempts: 1,
              },
              $set: {
                twitchUserId: streamer.twitchUserId,
                streamId: match.video.stream_id || existingLink?.streamId || `video:${match.video.id}`,
                streamStartedAt: match.streamStartedAt,
                videoId: match.video.id,
                vodUrl: this.buildTwitchVodUrl(match.video.id, match.offsetSeconds),
                offsetSeconds: match.offsetSeconds,
                status: "resolved",
                availabilityStatus: "active",
                matchMethod: "vod-window",
                matchConfidence: match.confidence,
                videoCreatedAt: match.streamStartedAt,
                videoDurationSeconds: match.durationSeconds,
                backfilledAt: now,
                expectedExpiresAt: availability.expectedExpiresAt,
                hardExpiresAt: availability.hardExpiresAt,
                nextAvailabilityCheckAt: availability.nextAvailabilityCheckAt,
                lastCheckedAt: now,
                expiresAt: availability.expiresAt,
              },
            },
            { upsert: true },
          );
          result.matched += 1;
        }
      }
    }

    result.streamersChecked = userIdsChecked.size;
    return result;
  }

  async resolvePendingLinks(limit: number = 100): Promise<{ checked: number; resolved: number; unavailable: number }> {
    if (!twitchService.isEnabled()) {
      return { checked: 0, resolved: 0, unavailable: 0 };
    }

    const now = new Date();
    const retryBefore = new Date(now.getTime() - RESOLUTION_RETRY_MS);
    const legacyHardCutoff = new Date(now.getTime() - MAX_VOD_RETENTION_DAYS * DAY_MS);
    const pendingLinks = await FightVodLink.find({
      status: "pending",
      $and: [
        { $or: [{ hardExpiresAt: { $gt: now } }, { hardExpiresAt: { $exists: false }, streamStartedAt: { $gt: legacyHardCutoff } }] },
        { $or: [{ lastCheckedAt: { $exists: false } }, { lastCheckedAt: { $lte: retryBefore } }] },
      ],
    })
      .sort({ lastCheckedAt: 1, createdAt: 1 })
      .limit(limit);

    if (pendingLinks.length === 0) {
      return { checked: 0, resolved: 0, unavailable: 0 };
    }

    const videosByUser = new Map<string, TwitchVideoData[]>();
    let resolved = 0;
    let unavailable = 0;

    for (const link of pendingLinks) {
      try {
        if (!videosByUser.has(link.twitchUserId)) {
          videosByUser.set(link.twitchUserId, await twitchService.getRecentArchiveVideos(link.twitchUserId, 100));
        }

        const videos = videosByUser.get(link.twitchUserId) || [];
        const video = this.findMatchingVideo(videos, link.streamId);

        link.attempts += 1;
        link.lastCheckedAt = now;

        if (!video) {
          if (this.shouldStopResolving(link.attempts, link.fightStartedAt, now)) {
            link.status = "unavailable";
            link.availabilityStatus = "unavailable";
            unavailable += 1;
          }
          await link.save();
          continue;
        }

        const offsetSeconds = Math.max(0, Math.floor((link.fightStartedAt.getTime() - link.streamStartedAt.getTime()) / 1000));
        const durationSeconds = this.parseTwitchDuration(video.duration);

        if (durationSeconds > 0 && offsetSeconds > durationSeconds + 60) {
          if (this.shouldStopResolving(link.attempts, link.fightStartedAt, now)) {
            link.status = "unavailable";
            link.availabilityStatus = "unavailable";
            unavailable += 1;
          }
          await link.save();
          continue;
        }

        link.videoId = video.id;
        link.offsetSeconds = offsetSeconds;
        link.vodUrl = this.buildTwitchVodUrl(video.id, offsetSeconds);
        link.status = "resolved";
        link.availabilityStatus = "active";
        link.matchMethod = "stream-id";
        link.matchConfidence = 1;
        link.videoCreatedAt = this.toDate(video.created_at) || undefined;
        link.videoDurationSeconds = durationSeconds || undefined;
        const retention = await this.getStoredRetentionSnapshot(link.twitchUserId, link.channelName);
        const availability = this.getAvailabilityFields(retention, link.streamStartedAt, now);
        link.expectedExpiresAt = availability.expectedExpiresAt;
        link.hardExpiresAt = availability.hardExpiresAt;
        link.nextAvailabilityCheckAt = availability.nextAvailabilityCheckAt;
        link.expiresAt = availability.expiresAt;
        await link.save();
        resolved += 1;
      } catch (error) {
        logger.warn(`[Fight VOD] Failed to resolve ${link.channelName} VOD for ${link.reportCode}#${link.fightId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return { checked: pendingLinks.length, resolved, unavailable };
  }

  async refreshDueLinkAvailability(limit: number = 500): Promise<FightVodAvailabilityResult> {
    const result: FightVodAvailabilityResult = {
      checked: 0,
      stillAvailable: 0,
      unavailable: 0,
      errors: 0,
    };

    if (!twitchService.isEnabled()) {
      return result;
    }

    const now = new Date();
    const legacyCheckCutoff = new Date(now.getTime() - (NORMAL_VOD_RETENTION_DAYS + 1) * DAY_MS);
    const dueLinks = await FightVodLink.find({
      status: "resolved",
      videoId: { $exists: true, $ne: "" },
      $and: [
        { $or: [{ availabilityStatus: "active" }, { availabilityStatus: { $exists: false } }] },
        {
          $or: [
            { nextAvailabilityCheckAt: { $lte: now } },
            { hardExpiresAt: { $exists: false }, streamStartedAt: { $lte: legacyCheckCutoff } },
          ],
        },
      ],
    })
      .sort({ nextAvailabilityCheckAt: 1, streamStartedAt: 1 })
      .limit(limit);

    if (dueLinks.length === 0) {
      return result;
    }

    let videosById = new Map<string, TwitchVideoData>();
    let usersByLogin = new Map<string, TwitchUserData>();

    try {
      videosById = await twitchService.getVideosByIds(dueLinks.map((link) => link.videoId).filter((videoId): videoId is string => Boolean(videoId)));
      usersByLogin = await twitchService.getUsersByLogins(Array.from(new Set(dueLinks.map((link) => link.channelName))));
    } catch (error) {
      logger.warn(`[Fight VOD] Failed to fetch availability batch: ${error instanceof Error ? error.message : String(error)}`);
      result.errors += dueLinks.length;
      return result;
    }

    for (const link of dueLinks) {
      result.checked += 1;

      try {
        link.lastAvailabilityCheckedAt = now;

        const video = link.videoId ? videosById.get(link.videoId) : undefined;
        if (!video) {
          link.availabilityStatus = "unavailable";
          link.status = "unavailable";
          await link.save();
          result.unavailable += 1;
          continue;
        }

        const user = usersByLogin.get(link.channelName);
        const retention = await this.refreshRetentionSnapshot(link.channelName, link.twitchUserId, user, [video], now);
        const availability = this.getAvailabilityFields(retention, link.streamStartedAt, now);

        link.availabilityStatus = "active";
        link.expectedExpiresAt = availability.expectedExpiresAt;
        link.hardExpiresAt = availability.hardExpiresAt;
        link.nextAvailabilityCheckAt = availability.nextAvailabilityCheckAt;
        link.expiresAt = availability.expiresAt;
        link.videoCreatedAt = this.toDate(video.created_at) || link.videoCreatedAt;
        link.videoDurationSeconds = this.parseTwitchDuration(video.duration) || link.videoDurationSeconds;
        await link.save();

        result.stillAvailable += 1;
      } catch (error) {
        result.errors += 1;
        logger.warn(`[Fight VOD] Failed to refresh VOD availability for ${link.videoId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return result;
  }

  async cleanupExpiredLinks(): Promise<FightVodCleanupResult> {
    const now = new Date();
    const legacyHardCutoff = new Date(now.getTime() - MAX_VOD_RETENTION_DAYS * DAY_MS);
    const availability = await this.refreshDueLinkAvailability();
    const deleteResult = await FightVodLink.deleteMany({
      $or: [
        { availabilityStatus: "unavailable" },
        { hardExpiresAt: { $lte: now } },
        { hardExpiresAt: { $exists: false }, streamStartedAt: { $lte: legacyHardCutoff } },
      ],
    });

    return {
      deleted: deleteResult.deletedCount || 0,
      availability,
    };
  }
}

export default new FightVodService();
