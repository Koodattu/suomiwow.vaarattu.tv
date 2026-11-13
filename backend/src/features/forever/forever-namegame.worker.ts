import { randomUUID } from "node:crypto";
import mongoose, { Schema } from "mongoose";
import OpenAI from "openai";
import { meteredFetch } from "../ai-usage/ai-usage";
import logger from "../../utils/logger";
import { ForeverCharacter, ForeverWorker } from "./forever.models";
import { namegamePopulation } from "./forever-namegame";
import { NAMEGAME_BATCH_SIZE, NAMEGAME_MODEL, readNamegameRatings, submitNamegameBatch } from "./forever-namegame-rating";

const batchSchema = new Schema({
  _id: { type: String, required: true }, responseId: String, error: String,
  items: { type: [new Schema({ characterId: { type: Schema.Types.ObjectId, required: true },
    name: { type: String, required: true }, guild: { type: String, default: null } }, { _id: false })], required: true },
}, { timestamps: true, collection: "forever_namegame_batches" });
export const NamegameBatch = mongoose.model("ForeverNamegameBatch", batchSchema);

async function claimBatch() {
  const population = await namegamePopulation();
  const eligible = { ...population.filter, namegameBatch: null, nameRating: null };
  const candidates = await ForeverCharacter.find(eligible).sort({ _id: 1 }).limit(NAMEGAME_BATCH_SIZE).select("_id").lean();
  if (!candidates.length) return null;
  const token = randomUUID();
  return mongoose.connection.transaction(async session => {
    const ids = candidates.map(row => row._id);
    await ForeverCharacter.updateMany({ ...eligible, _id: { $in: ids } }, { $set: { namegameBatch: token } }, { session, timestamps: false });
    const claimed = await ForeverCharacter.find({ _id: { $in: ids }, namegameBatch: token }).sort({ _id: 1 })
      .select("name region slug guild.name").session(session).lean();
    if (!claimed.length) return null;
    const items = claimed.map(row => {
      const member = population.roster.get(row.region + "/" + row.slug);
      return { characterId: row._id, name: row.name || member?.name || row.slug.replace(/-/g, " "),
        guild: row.guild?.name || member?.guild || null };
    });
    const [batch] = await NamegameBatch.create([{ _id: token, items }], { session });
    return batch.toObject();
  });
}

const IDLE = 60_000, POLL = 5_000, LEASE = 120_000;
const workerId = "namegame";
export class NamegameWorker {
  private timer?: NodeJS.Timeout;
  private active?: Promise<void>;
  private stopped = true;

  start() {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!this.stopped || !apiKey) return;
    this.stopped = false;
    const client = new OpenAI({ apiKey, timeout: 30_000, maxRetries: 0, fetch: meteredFetch("namegame", NAMEGAME_MODEL) });
    const schedule = (delay: number) => {
      if (this.stopped) return;
      this.timer = setTimeout(() => {
        this.active = this.tick(client).catch(() => {
          logger.error("[Forever] Namegame worker failed; pending batch retained");
        }).finally(() => { this.active = undefined; schedule(POLL); });
      }, delay);
    };
    schedule(0);
  }

  async stop() { this.stopped = true; clearTimeout(this.timer); await this.active; }

  async tick(client: OpenAI) {
    const now = new Date(), leaseToken = randomUUID();
    const lease = await ForeverWorker.findOneAndUpdate({ _id: workerId, nextRequestAt: { $lte: now },
      $or: [{ leaseUntil: null }, { leaseUntil: { $lte: now } }] },
      { $set: { leaseToken, leaseUntil: new Date(now.getTime() + LEASE) } });
    if (!lease) return;
    let delay = POLL;
    try {
      const pending = await NamegameBatch.findOne({ responseId: { $type: "string" }, error: null }).sort({ createdAt: 1 }).lean();
      if (pending) {
        // Restarting/polling only retrieves the original generation. Scores and removal of this job commit together.
        let response;
        try { response = await client.responses.retrieve(pending.responseId!); }
        catch (error) {
          if (!(error instanceof OpenAI.NotFoundError)) throw error;
          await NamegameBatch.updateOne({ _id: pending._id }, { $set: { error: "response_expired" } });
          logger.error(`[Forever] Namegame response expired for batch ${pending._id}`);
          return;
        }
        if (response.status === "queued" || response.status === "in_progress") return;
        let ratings;
        try {
          if (response.status !== "completed" || response.output.some(item => item.type === "message" && item.content.some(part => part.type === "refusal"))) {
            throw new Error("No completed ratings");
          }
          ratings = readNamegameRatings(response.output_text, pending.items.length);
        } catch {
          await NamegameBatch.updateOne({ _id: pending._id }, { $set: { error: "invalid_response" } });
          logger.error(`[Forever] Namegame batch ${pending._id} returned no usable ratings`);
          return;
        }
        const writes = pending.items.map((item, i) => ({ updateOne: {
          filter: { _id: item.characterId, namegameBatch: pending._id, nameRating: null },
          update: { $set: { nameRating: { name: item.name, ...ratings[i] } }, $unset: { namegameBatch: 1 as const } }, timestamps: false,
        } }));
        await mongoose.connection.transaction(async session => {
          await ForeverCharacter.bulkWrite(writes, { session });
          await NamegameBatch.deleteOne({ _id: pending._id }, { session });
        });
        return;
      }
      const batch = await claimBatch();
      if (!batch) { delay = IDLE; return; }
      try {
        const response = await submitNamegameBatch(client, batch.items.map(item => ({ name: item.name, guild: item.guild ?? null })), batch._id);
        await NamegameBatch.updateOne({ _id: batch._id }, { $set: { responseId: response.id } });
      } catch (error) {
        if (error instanceof OpenAI.APIError && [400, 401, 403, 404, 429].includes(error.status ?? 0)) {
          // An explicit rejection did not start a generation. Release only this claim and back off globally.
          await mongoose.connection.transaction(async session => {
            await ForeverCharacter.updateMany({ namegameBatch: batch._id }, { $unset: { namegameBatch: 1 } }, { session, timestamps: false });
            await NamegameBatch.deleteOne({ _id: batch._id }, { session });
          });
          delay = 5 * IDLE;
        } else {
          // Provider logs can be matched to this batch through its namegame_batch metadata.
          await NamegameBatch.updateOne({ _id: batch._id, responseId: null }, { $set: { error: "submission_unknown" } });
        }
        logger.error(`[Forever] Namegame submission failed for batch ${batch._id} (HTTP ${error instanceof OpenAI.APIError ? error.status ?? "unknown" : "unknown"})`);
      }
    } finally {
      await ForeverWorker.updateOne({ _id: workerId, leaseToken }, { $set: { nextRequestAt: new Date(Date.now() + delay) },
        $unset: { leaseToken: 1, leaseUntil: 1 } });
    }
  }
}

export default new NamegameWorker();
