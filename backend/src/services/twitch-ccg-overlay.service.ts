import crypto, { randomUUID } from "crypto";
import TwitchChannelPointsAuth from "../models/TwitchChannelPointsAuth";
import TwitchCcgOverlayEvent from "../models/TwitchCcgOverlayEvent";
import ccgService from "./ccg.service";

const AUTH_KEY = "global";
const LEASE_MS = 45 * 1000;
const HEARTBEAT_WRITE_INTERVAL_MS = 30 * 1000;

export class TwitchCcgOverlayError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: "unauthorized" | "overlay_disabled" | "lease_not_found",
    message: string,
  ) {
    super(message);
    this.name = "TwitchCcgOverlayError";
  }
}

class TwitchCcgOverlayService {
  async leaseNext(token: string): Promise<Record<string, unknown> | null> {
    const auth = await this.authenticate(token);
    if (!auth.cardRewardEnabled) {
      throw new TwitchCcgOverlayError(410, "overlay_disabled", "The card reveal overlay is disabled");
    }

    const now = new Date();
    await Promise.all([
      TwitchChannelPointsAuth.updateOne(
        {
          key: AUTH_KEY,
          $or: [
            { overlayLastSeenAt: { $exists: false } },
            { overlayLastSeenAt: { $lte: new Date(now.getTime() - HEARTBEAT_WRITE_INTERVAL_MS) } },
          ],
        },
        { $set: { overlayLastSeenAt: now } },
      ),
      TwitchCcgOverlayEvent.updateMany(
        { status: { $in: ["queued", "leased"] }, expiresAt: { $lte: now } },
        { $set: { status: "expired" }, $unset: { leaseId: 1, leaseUntil: 1 } },
      ),
    ]);

    const leaseId = randomUUID();
    const event = await TwitchCcgOverlayEvent.findOneAndUpdate(
      {
        expiresAt: { $gt: now },
        $or: [{ status: "queued" }, { status: "leased", leaseUntil: { $lte: now } }],
      },
      {
        $set: { status: "leased", leaseId, leaseUntil: new Date(now.getTime() + LEASE_MS) },
        $inc: { attempts: 1 },
      },
      { new: true, sort: { createdAt: 1 } },
    ).lean();
    if (!event) return null;

    const stillEnabled = await TwitchChannelPointsAuth.exists({ key: AUTH_KEY, cardRewardEnabled: true });
    if (!stillEnabled) {
      await TwitchCcgOverlayEvent.updateOne(
        { _id: event._id, leaseId },
        { $set: { status: "expired" }, $unset: { leaseId: 1, leaseUntil: 1 } },
      );
      throw new TwitchCcgOverlayError(410, "overlay_disabled", "The card reveal overlay is disabled");
    }

    return {
      eventId: String(event._id),
      leaseId,
      source: event.source,
      viewer: { login: event.twitchUserLogin, displayName: event.twitchUserDisplayName },
      finish: event.finish,
      artVariant: event.artVariant,
      tierGrade: event.tierGrade,
      card: await ccgService.getCard(String(event.cardId)),
    };
  }

  async acknowledge(token: string, eventId: string, leaseId: string): Promise<void> {
    const auth = await this.authenticate(token);
    if (!auth.cardRewardEnabled) {
      throw new TwitchCcgOverlayError(410, "overlay_disabled", "The card reveal overlay is disabled");
    }
    const event = await TwitchCcgOverlayEvent.findOneAndUpdate(
      { _id: eventId, status: "leased", leaseId },
      { $set: { status: "played", playedAt: new Date() }, $unset: { leaseId: 1, leaseUntil: 1 } },
      { new: true },
    );
    if (!event) throw new TwitchCcgOverlayError(409, "lease_not_found", "The overlay event lease is no longer active");
  }

  private async authenticate(token: string) {
    const auth = await TwitchChannelPointsAuth.findOne({ key: AUTH_KEY })
      .select("cardRewardEnabled overlayTokenHash")
      .lean();
    const actual = crypto.createHash("sha256").update(token).digest();
    const expected = auth?.overlayTokenHash ? Buffer.from(auth.overlayTokenHash, "hex") : Buffer.alloc(actual.length);
    if (!auth?.overlayTokenHash || expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
      throw new TwitchCcgOverlayError(401, "unauthorized", "The OBS overlay token is invalid");
    }
    return auth;
  }
}

export default new TwitchCcgOverlayService();
