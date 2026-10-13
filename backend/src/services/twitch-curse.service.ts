import OpenAI from "openai";
import RateLimitState from "../models/RateLimitState";
import { getNextHelsinkiReset } from "../utils/helsinki-time";
import logger from "../utils/logger";
import { buildCurseInstructions, CURSE_EXAMPLES, formatCurse, type CurseStyle } from "../features/twitch-curse/curse-content";

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
    const curatedFallback = () => {
      const examples = CURSE_EXAMPLES[style];
      return formatCurse(examples[Math.floor(Math.random() * examples.length)], userName, style);
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
        instructions: buildCurseInstructions(style),
        input: JSON.stringify(inspiration ? { inspiration } : {}),
      });
      if (response.status === "completed") {
        const message = formatCurse(response.output_text, userName, style);
        if (message) return message;
      }
      logger.warn("[TwitchBot] Curse generation returned incomplete or invalid content; using a curated curse");
    } catch {
      // Provider errors can include request details; do not log credentials or payloads.
      logger.warn("[TwitchBot] Curse generation unavailable; using a curated curse");
    }

    // Failed calls still consume the reservation: retries must not bypass the cost cap.
    return curatedFallback();
  }
}

export default new TwitchCurseService();
