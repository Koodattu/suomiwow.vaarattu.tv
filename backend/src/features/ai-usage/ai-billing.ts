import OpenAI from "openai";

type Billing = { status: "available"; usd: number } | { status: "unconfigured" | "unavailable" };
const cache = new Map<string, { until: number; value: Promise<Billing> }>();

export async function billedProjectCost(start: Date, days: number): Promise<Billing> {
  const key = process.env.OPENAI_ADMIN_KEY?.trim(), project = process.env.OPENAI_BILLING_PROJECT_ID?.trim();
  if (!key || !project) return { status: "unconfigured" };
  const now = Date.now(), cacheKey = project + "/" + start.toISOString();
  for (const [id, entry] of cache) if (entry.until <= now) cache.delete(id);
  const cached = cache.get(cacheKey);
  if (cached) return cached.value;
  const read = async (): Promise<Billing> => {
    const client = new OpenAI({ baseURL: "https://api.openai.com/v1", adminAPIKey: key, timeout: 8000, maxRetries: 0 });
    let usd = 0, page: string | undefined;
    do {
      const result = await client.admin.organization.usage.costs({ start_time: start.getTime() / 1000,
        end_time: Math.floor(now / 1000) + 1, project_ids: [project], limit: days, page });
      for (const bucket of result.data) for (const row of bucket.results) {
        if (row.object !== "organization.costs.result" || row.amount?.currency !== "usd" || !Number.isFinite(row.amount.value)) {
          throw new Error("Invalid billing amount");
        }
        usd += row.amount.value!;
      }
      if (result.has_more && (!result.next_page || result.next_page === page)) throw new Error("Missing billing cursor");
      page = result.has_more ? result.next_page! : undefined;
    } while (page);
    return { status: "available", usd };
  };
  const value = read().catch((): Billing => ({ status: "unavailable" }));
  cache.set(cacheKey, { value, until: now + 60_000 });
  return value;
}
