import dotenv from "dotenv";
import { ROLE_BY_CLASS_AND_SPEC } from "../config/specs";

(dotenv.config as (options?: { quiet?: boolean }) => void)({ quiet: true });

type Metric = "dps" | "hps";

type RateLimitData = {
  limitPerHour: number;
  pointsSpentThisHour: number;
  pointsResetIn: number;
};

type TestCase = {
  characterId: number;
  classID: number;
  zoneId: number;
  partitions: number[];
};

type AliasContext = {
  alias: string;
  metric: Metric;
  partition: number;
  spec?: string;
};

type RankingRow = {
  encounterId: number;
  spec: string;
  bestAmount: number;
  rankPercent: number;
  medianPercent: number;
  totalKills: number;
  allStarsPoints: number;
};

type QueryResult = {
  data: any;
  aliases: AliasContext[];
};

const RATE_LIMIT_PROBE_COST = 1;

function getArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}

function parseCases(value: string | undefined): TestCase[] {
  if (!value) {
    throw new Error("Pass --cases=<characterId>:<classID>:<zoneId>:<partition+partition>,...");
  }

  return value.split(",").map((entry) => {
    const [characterIdRaw, classIDRaw, zoneIdRaw, partitionsRaw] = entry.split(":");
    const characterId = Number(characterIdRaw);
    const classID = Number(classIDRaw);
    const zoneId = Number(zoneIdRaw);
    const partitions = Array.from(
      new Set(
        (partitionsRaw || "")
          .split("+")
          .map(Number)
          .filter((partition) => Number.isInteger(partition) && partition > 0),
      ),
    ).sort((a, b) => a - b);

    if (![characterId, classID, zoneId].every((number) => Number.isInteger(number) && number > 0) || partitions.length === 0) {
      throw new Error(`Invalid case "${entry}"`);
    }

    return { characterId, classID, zoneId, partitions };
  });
}

function toWclSpecName(specSlug: string): string {
  return specSlug
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
}

function toAliasPart(value: string): string {
  const parts = value.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  return parts
    .map((part, index) => (index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join("");
}

async function authenticate(): Promise<string> {
  const clientId = process.env.WCL_CLIENT_ID;
  const clientSecret = process.env.WCL_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("WCL credentials are not configured");

  const response = await fetch("https://www.warcraftlogs.com/oauth/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!response.ok) throw new Error(`WCL authentication failed: ${response.status} ${response.statusText}`);
  const result = (await response.json()) as { access_token?: string };
  if (!result.access_token) throw new Error("WCL authentication returned no access token");
  return result.access_token;
}

async function queryWcl<T>(token: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch("https://www.warcraftlogs.com/api/v2/client", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (response.status === 429) {
    throw new Error(`WCL quota exhausted (HTTP 429, retry-after=${response.headers.get("retry-after") || "unknown"})`);
  }
  if (!response.ok) throw new Error(`WCL request failed: ${response.status} ${response.statusText}`);

  const result = (await response.json()) as { data?: T; errors?: unknown };
  if (result.errors) throw new Error(`WCL GraphQL error: ${JSON.stringify(result.errors)}`);
  if (!result.data) throw new Error("WCL returned no data");
  return result.data;
}

async function probeRateLimit(token: string): Promise<RateLimitData> {
  const result = await queryWcl<{ rateLimitData?: RateLimitData }>(
    token,
    `query { rateLimitData { limitPerHour pointsSpentThisHour pointsResetIn } }`,
  );
  if (!result.rateLimitData) throw new Error("WCL returned no rate-limit data");
  return result.rateLimitData;
}

function buildQuery(testCase: TestCase, mode: "explicit" | "unfiltered"): { query: string; aliases: AliasContext[] } {
  const classSpecs = ROLE_BY_CLASS_AND_SPEC[testCase.classID] ?? {};
  const specs = Object.entries(classSpecs);
  if (specs.length === 0) throw new Error(`No specs configured for class ${testCase.classID}`);

  const aliases: AliasContext[] = [];
  const fields: string[] = [];
  const addField = (metric: Metric, partition: number, spec?: string) => {
    const alias = spec
      ? `${toAliasPart(spec)}${metric.toUpperCase()}Partition${partition}`
      : `${metric}Partition${partition}`;
    const specArgument = spec ? `, specName: "${toWclSpecName(spec)}"` : "";
    aliases.push({ alias, metric, partition, spec });
    fields.push(
      `${alias}: zoneRankings(zoneID: $zoneID, difficulty: 5, metric: ${metric}, compare: Rankings, timeframe: Historical, partition: ${partition}${specArgument})`,
    );
  };

  for (const partition of testCase.partitions) {
    if (mode === "explicit") {
      for (const [spec, role] of specs) {
        addField("dps", partition, spec);
        if (role === "healer") addField("hps", partition, spec);
      }
    } else {
      addField("dps", partition);
      if (specs.some(([, role]) => role === "healer")) addField("hps", partition);
    }
  }

  return {
    aliases,
    query: `
      query($characterId: Int!, $zoneID: Int!) {
        characterData {
          character(id: $characterId) {
            id
            canonicalID
            name
            classID
            hidden
            ${fields.join("\n            ")}
          }
        }
      }
    `,
  };
}

async function fetchRankings(token: string, testCase: TestCase, mode: "explicit" | "unfiltered"): Promise<QueryResult> {
  const { query, aliases } = buildQuery(testCase, mode);
  const data = await queryWcl<any>(token, query, {
    characterId: testCase.characterId,
    zoneID: testCase.zoneId,
  });
  return { data, aliases };
}

function finite(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function normalizeSpec(value: unknown): string {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function rowsForAlias(result: QueryResult, alias: AliasContext): RankingRow[] {
  const character = result.data?.characterData?.character;
  const rankings = Array.isArray(character?.[alias.alias]?.rankings) ? character[alias.alias].rankings : [];
  return rankings
    .map((ranking: any) => ({
      encounterId: finite(ranking?.encounter?.id),
      spec: normalizeSpec(ranking?.spec || alias.spec),
      bestAmount: finite(ranking?.bestAmount),
      rankPercent: finite(ranking?.rankPercent),
      medianPercent: finite(ranking?.medianPercent),
      totalKills: finite(ranking?.totalKills),
      allStarsPoints: finite(ranking?.allStars?.points),
    }))
    .filter((ranking: RankingRow) =>
      ranking.encounterId > 0
      && (ranking.bestAmount > 0 || ranking.rankPercent > 0 || ranking.medianPercent > 0 || ranking.totalKills > 0 || ranking.allStarsPoints > 0),
    );
}

function compareRows(a: RankingRow, b: RankingRow): number {
  return b.rankPercent - a.rankPercent
    || b.bestAmount - a.bestAmount
    || b.totalKills - a.totalKills
    || b.allStarsPoints - a.allStarsPoints;
}

function nearlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(0.001, Math.abs(a) * 0.000001);
}

function compareResults(explicit: QueryResult, unfiltered: QueryResult): Record<string, unknown> {
  const comparisons = [];

  for (const aggregateAlias of unfiltered.aliases) {
    const matchingExplicitAliases = explicit.aliases.filter(
      (alias) => alias.partition === aggregateAlias.partition && alias.metric === aggregateAlias.metric,
    );
    const explicitRows = matchingExplicitAliases.flatMap((alias) => rowsForAlias(explicit, alias));
    const aggregateRows = rowsForAlias(unfiltered, aggregateAlias);
    const encounterIds = Array.from(new Set(explicitRows.map((row) => row.encounterId))).sort((a, b) => a - b);
    const aggregateOnlyRows = aggregateRows.filter((row) => !encounterIds.includes(row.encounterId));
    let exactBestMatches = 0;
    const mismatches = [];

    for (const encounterId of encounterIds) {
      const explicitBest = explicitRows.filter((row) => row.encounterId === encounterId).sort(compareRows)[0];
      const aggregate = aggregateRows.find((row) => row.encounterId === encounterId);
      const matches = Boolean(
        explicitBest
        && aggregate
        && explicitBest.spec === aggregate.spec
        && nearlyEqual(explicitBest.bestAmount, aggregate.bestAmount)
        && nearlyEqual(explicitBest.rankPercent, aggregate.rankPercent),
      );
      if (matches) {
        exactBestMatches += 1;
      } else {
        mismatches.push({ encounterId, explicitBest: explicitBest ?? null, unfiltered: aggregate ?? null });
      }
    }

    comparisons.push({
      partition: aggregateAlias.partition,
      metric: aggregateAlias.metric,
      explicitEncounterCount: encounterIds.length,
      unfilteredEncounterCount: aggregateRows.length,
      exactBestMatches,
      aggregateOnlyRows,
      mismatches,
    });
  }

  const totalEncounters = comparisons.reduce((sum, comparison) => sum + comparison.explicitEncounterCount, 0);
  const exactBestMatches = comparisons.reduce((sum, comparison) => sum + comparison.exactBestMatches, 0);
  return {
    totalEncounters,
    exactBestMatches,
    exactBestMatchPercent: totalEncounters > 0 ? (exactBestMatches / totalEncounters) * 100 : 100,
    comparisons,
  };
}

function measuredCost(before: RateLimitData, after: RateLimitData): number | null {
  if (after.pointsResetIn > before.pointsResetIn) return null;
  const delta = after.pointsSpentThisHour - before.pointsSpentThisHour - RATE_LIMIT_PROBE_COST;
  return delta >= 0 ? delta : null;
}

async function main(): Promise<void> {
  const testCases = parseCases(getArg("cases"));
  const maxCases = Math.max(1, Math.min(testCases.length, Number(getArg("maxCases") || testCases.length)));
  const token = await authenticate();
  const results = [];

  for (const testCase of testCases.slice(0, maxCases)) {
    const beforeExplicit = await probeRateLimit(token);
    const explicit = await fetchRankings(token, testCase, "explicit");
    const afterExplicit = await probeRateLimit(token);
    const unfiltered = await fetchRankings(token, testCase, "unfiltered");
    const afterUnfiltered = await probeRateLimit(token);
    const explicitCost = measuredCost(beforeExplicit, afterExplicit);
    const unfilteredCost = measuredCost(afterExplicit, afterUnfiltered);

    results.push({
      testCase,
      character: explicit.data?.characterData?.character
        ? {
            id: explicit.data.characterData.character.id,
            canonicalID: explicit.data.characterData.character.canonicalID,
            name: explicit.data.characterData.character.name,
            classID: explicit.data.characterData.character.classID,
            hidden: explicit.data.characterData.character.hidden === true,
          }
        : null,
      explicit: {
        aliasCount: explicit.aliases.length,
        measuredCost: explicitCost,
      },
      unfiltered: {
        aliasCount: unfiltered.aliases.length,
        measuredCost: unfilteredCost,
      },
      measuredSavingsPercent:
        explicitCost !== null && unfilteredCost !== null && explicitCost > 0
          ? ((explicitCost - unfilteredCost) / explicitCost) * 100
          : null,
      equivalence: compareResults(explicit, unfiltered),
      quota: {
        limitPerHour: afterUnfiltered.limitPerHour,
        pointsSpentThisHour: afterUnfiltered.pointsSpentThisHour + RATE_LIMIT_PROBE_COST,
        pointsResetIn: afterUnfiltered.pointsResetIn,
      },
    });
  }

  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
