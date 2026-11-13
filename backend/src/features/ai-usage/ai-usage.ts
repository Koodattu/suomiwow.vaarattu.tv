import mongoose, { Schema } from "mongoose";
import { randomUUID } from "node:crypto";
import logger from "../../utils/logger";
import { REPORTER_CONFIG } from "../reporter/reporter.config";
import { priceUsage, type RawUsage } from "./pricing";

export const AI_FEATURES = ["namegame", "guildLanguage", "twitchCurse", "supporterArt", "reporterFi", "reporterEn"] as const;
export type AiFeature = typeof AI_FEATURES[number];
const schema = new Schema({
  _id: { type: String, required: true }, at: { type: Date, required: true }, feature: { type: String, required: true },
  endpoint: { type: String, required: true }, model: String, tier: String, status: String, httpStatus: Number, requestId: String,
  inputTokens: Number, cachedInputTokens: Number, cacheWriteTokens: Number, outputTokens: Number, reasoningTokens: Number, totalTokens: Number,
  costNanoUsd: Number,
}, { collection: "ai_usage_calls", versionKey: false, bufferCommands: false });
schema.index({ at: -1, _id: -1 });
schema.index({ feature: 1, at: -1, _id: -1 });
export const AiCall = mongoose.model("AiUsageCall", schema);

interface ProviderBody {
  id?: string; status?: string; model?: string; service_tier?: string; usage?: RawUsage;
}
type Call = { at: Date; feature: AiFeature; endpoint: "responses" | "decisions" | "poll"; host: string;
  model: string; responseId?: string; requestId?: string; httpStatus?: number; body: ProviderBody };

async function record(call: Call) {
  const { at, feature, endpoint, httpStatus, requestId, body } = call;
  const ok = httpStatus !== undefined && httpStatus >= 200 && httpStatus < 300;
  const model = body.model || call.model, tier = body.service_tier || "default";
  const responseId = call.responseId || body.id;
  const status = ok ? body.status || (endpoint === "decisions" && body.usage ? "completed" : "unknown") : "failed";
  const measured = body.usage && !["queued", "in_progress"].includes(status)
    ? priceUsage(body.usage, model, endpoint === "decisions", tier, call.host, feature.startsWith("reporter") ? REPORTER_CONFIG.pricing : undefined) : null;
  const metadata = { at, feature, endpoint, model, httpStatus, requestId, status, tier };
  if (endpoint === "poll") {
    // Each HTTP retrieval appears in the log. Its cumulative usage belongs to the original POST.
    await AiCall.create({ _id: randomUUID(), ...metadata, status: ok ? "completed" : "failed", costNanoUsd: 0 });
    if (ok && responseId && body.status && !["queued", "in_progress"].includes(status)) {
      await AiCall.updateOne({ _id: responseId, feature, endpoint: "responses" }, {
        $set: { status, model, tier, ...(measured ?? {}) },
      });
    }
    return;
  }
  const id = ok && endpoint === "responses" && responseId ? responseId : requestId || randomUUID();
  await AiCall.updateOne({ _id: id }, { $setOnInsert: { ...metadata, ...(measured ?? {}) } }, { upsert: true });
}

// Wrap the transport so HTTP errors, client timeouts and responses later rejected by application validation still count.
// Only the whitelisted accounting fields above are persisted. A monitoring failure must never retry paid work.
export function meteredFetch(feature: AiFeature, model: string, transport: typeof fetch = globalThis.fetch): typeof fetch {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    const poll = method.toUpperCase() === "GET";
    const call: Call = { at: new Date(), feature, model, host: url.hostname, body: {},
      endpoint: poll ? "poll" : url.pathname.endsWith("/decisions") ? "decisions" : "responses",
      responseId: poll ? url.pathname.split("/").pop() : undefined };
    try {
      const response = await transport(input, init);
      call.httpStatus = response.status;
      call.requestId = response.headers.get("x-request-id") ?? undefined;
      try { call.body = await response.clone().json() as ProviderBody || {}; } catch { /* No provider usage in this response. */ }
      return response;
    } finally {
      try { await record(call); }
      catch { logger.error("[AI usage] Could not record provider call", { feature, endpoint: call.endpoint, requestId: call.requestId }); }
    }
  };
}
