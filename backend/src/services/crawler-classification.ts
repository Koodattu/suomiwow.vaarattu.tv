import { BlockList, isIP } from "node:net";
import logger from "../utils/logger";

const sources = {
  googlebot: "https://developers.google.com/static/crawling/ipranges/common-crawlers.json",
  bingbot: "https://www.bing.com/toolbox/bingbot.json",
};
type Provider = keyof typeof sources;
export type CrawlerCategory = Provider | "suspected" | "other";
export type CrawlerCounts = Record<CrawlerCategory, number>;
const HOUR = 3_600_000;

type ProfileTraffic = {
  since: number;
  requests: number;
  profileReads: number;
  profiles: Set<string>;
  clients: Set<string>;
};

type RequestSignals = {
  agent: string;
  ip?: string;
  method: string;
  path: string;
  referer?: string;
  anonymousIdentity?: string;
};

function readNetworks(data: unknown): BlockList {
  if (!data || typeof data !== "object" || !("prefixes" in data) || !Array.isArray(data.prefixes) || !data.prefixes.length) {
    throw new Error("Missing crawler prefixes");
  }
  const networks = new BlockList();
  for (const prefix of data.prefixes) {
    const cidr = prefix.ipv4Prefix ?? prefix.ipv6Prefix ?? "";
    const match = /^([^/]+)\/(\d+)$/.exec(cidr);
    const family = match && isIP(match[1]);
    if (!match || !family || Number(match[2]) === 0) throw new Error("Invalid crawler prefix");
    networks.addSubnet(match[1], Number(match[2]), family === 4 ? "ipv4" : "ipv6");
  }
  return networks;
}

export class CrawlerClassifier {
  private readonly networks = new Map<Provider, { list: BlockList; expires: number }>();
  private readonly traffic = new Map<string, ProfileTraffic>();

  // Each feed is replaced atomically. A failed refresh never clears the other provider.
  async refresh(fetchFeed: typeof fetch = fetch): Promise<void> {
    await Promise.all((Object.keys(sources) as Provider[]).map(async provider => {
      try {
        const res = await fetchFeed(sources[provider], { signal: AbortSignal.timeout(8000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const list = readNetworks(await res.json());
        this.networks.set(provider, { list, expires: Date.now() + 48 * HOUR });
      } catch (error) {
        logger.warn(`Cannot refresh ${provider} crawler ranges`, error);
      }
    }));
  }

  classify({ agent, ip, method, path, referer, anonymousIdentity }: RequestSignals, now = Date.now()): CrawlerCategory {
    const provider = /\bGooglebot(?:[-/;\s)]|$)/i.test(agent) ? "googlebot"
      : /\bbingbot(?:[/;\s)]|$)/i.test(agent) ? "bingbot" : undefined;
    if (provider) {
      const ranges = this.networks.get(provider);
      const family = ip && isIP(ip);
      return ip && family && ranges && now < ranges.expires && ranges.list.check(ip, family === 4 ? "ipv4" : "ipv6")
        ? provider : "suspected";
    }
    // Known link previews and uptime checks are accounted for as other API traffic.
    if (/Discordbot|Twitterbot|Slackbot|facebookexternalhit|UptimeRobot/i.test(agent)) return "other";
    if (/bot\b|crawler|spider|headless/i.test(agent)) return "suspected";
    if (!anonymousIdentity || !agent || agent.length > 512) return "other";

    // Look for one agent sweeping many profiles from many clients with little other traffic.
    // Keep only enough distinct values to establish the thresholds, for one window per agent.
    let group = this.traffic.get(agent);
    if (!group || now - group.since >= 4 * HOUR) {
      this.traffic.delete(agent);
      if (this.traffic.size >= 512) this.traffic.delete(this.traffic.keys().next().value!);
      group = { since: now, requests: 0, profileReads: 0, profiles: new Set(), clients: new Set() };
      this.traffic.set(agent, group);
    }
    group.requests++;
    if (method !== "GET") return "other";
    const profile = /^\/api\/characters(\/[^/?#]+\/[^/?#]+)\/?(?:[?#]|$)/i.exec(path)?.[1]
      ?? /^https:\/\/suomiwow\.vaarattu\.tv\/characters(\/[^/?#]+\/[^/?#]+)\/?(?:[?#]|$)/i.exec(referer ?? "")?.[1];
    if (!profile || profile.length > 256) return "other";
    group.profileReads++;
    if (group.profiles.size < 16) group.profiles.add(profile.toLowerCase());
    if (group.clients.size < 8) group.clients.add(anonymousIdentity);
    return group.profiles.size >= 16 && group.clients.size >= 8 && group.profileReads >= group.requests * 0.9
      ? "suspected" : "other";
  }
}

export const apiCrawlerClassifier = new CrawlerClassifier();
