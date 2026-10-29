import OpenAI from "openai";
import RateLimitState from "../models/RateLimitState";
import TwitchChatAuditEvent from "../models/TwitchChatAuditEvent";
import { getNextHelsinkiReset } from "../utils/helsinki-time";
import logger from "../utils/logger";
import { buildCurseInstructions, formatCurse, getCursePhrases, selectCurseExamples, type CurseStyle } from "../features/twitch-curse/curse-content";

const DAILY_LIMIT = 100;
const DAILY_LIMIT_KEY = "twitch:curse:daily";

export async function reserveCurseGeneration(now = new Date()): Promise<boolean> {
  const expiredWindow = { $lte: [{ $ifNull: ["$resetAt", new Date(0)] }, now] };
  try {
    // The unique key and conditional update make admission atomic across workers.
    // An unmatched upsert at the cap hits that unique key and is denied below.
    const result = await RateLimitState.findOneAndUpdate(
      { key: DAILY_LIMIT_KEY, $or: [{ resetAt: { $lte: now } }, { pointsUsed: { $lt: DAILY_LIMIT } }] },
      [{ $set: {
        key: DAILY_LIMIT_KEY,
        pointsUsed: { $cond: [
          expiredWindow,
          1,
          { $add: ["$pointsUsed", 1] },
        ] },
        pointsMax: DAILY_LIMIT,
        // A request delayed across midnight must not move a newer window backwards.
        resetAt: { $cond: [expiredWindow, getNextHelsinkiReset(now), "$resetAt"] },
        lastUpdated: now,
        manualPause: false,
      } }],
      { upsert: true, returnDocument: "after", updatePipeline: true },
    ).lean();
    return Boolean(result);
  } catch (error) {
    if ((error as { code?: number })?.code === 11000) return false;
    throw error;
  }
}

class TwitchCurseService {
  async generate(userName: string, loadInspiration: () => Promise<string | undefined>): Promise<string | null> {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey || !/^[a-z0-9_]{1,25}$/i.test(userName)) return null;
    const style: CurseStyle = Math.random() < 0.5 ? "chinese" : "hieroglyphs";
    let recentPhrases: string[] = [];
    try {
      const recentReplies = await TwitchChatAuditEvent.find({
        direction: "outbound",
        kind: "command_reply",
        deliveryStatus: "sent",
        commandName: { $in: ["curse", "kirous"] },
      }).sort({ createdAt: -1 }).limit(12).select("message -_id").lean();
      recentPhrases = [...new Set(recentReplies.flatMap(({ message }) => getCursePhrases(message)))];
    } catch {
      logger.warn("[TwitchBot] Curse history unavailable; using randomized examples without history");
    }
    const curatedFallback = () => {
      const [example] = selectCurseExamples(style, recentPhrases, 1);
      return formatCurse(example, userName, style);
    };
    if (!(await reserveCurseGeneration())) return curatedFallback();

    let inspiration: string | undefined;
    try {
      inspiration = await loadInspiration();
    } catch {
      logger.warn("[TwitchBot] Curse progression lookup failed; using generic inspiration");
    }

    try {
      const openai = new OpenAI({ apiKey, timeout: 15_000, maxRetries: 0 });
      const response = await openai.responses.create({
        model: "gpt-6-luna",
        reasoning: { effort: "low" },
        store: false,
        max_output_tokens: 1200,
        instructions: buildCurseInstructions(style, recentPhrases),
        input: JSON.stringify({ ...(inspiration ? { inspiration } : {}), avoidPhrases: recentPhrases }),
      });
      if (response.status === "completed") {
        const message = formatCurse(response.output_text, userName, style);
        if (message && !getCursePhrases(message).some((phrase) => recentPhrases.includes(phrase))) return message;
      }
      logger.warn("[TwitchBot] Curse generation returned incomplete, invalid or repeated content; using a curated curse");
    } catch {
      // Provider errors can include request details; do not log credentials or payloads.
      logger.warn("[TwitchBot] Curse generation unavailable; using a curated curse");
    }

    // Failed calls still consume the reservation: retries must not bypass the cost cap.
    return curatedFallback();
  }
}

export default new TwitchCurseService();
