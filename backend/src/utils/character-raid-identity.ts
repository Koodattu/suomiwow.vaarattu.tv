import type { Role } from "../config/specs";
import { slugifySpecName, tryResolveRole } from "./spec";

export type RaidIdentityMethod = "fight_roster" | "mythic_kill_bosses" | "parse_quality" | "known_pull_fallback";
export type RaidIdentityConfidence = "exact" | "inferred";

export interface RaidIdentityParseEvidence {
  specName: string;
  metric: "dps" | "hps";
  encounterId: number;
  rankPercent: number;
  totalKills: number;
}

export interface RaidIdentityResolution {
  specName: string;
  role: Role;
  metric: "dps" | "hps";
  method: RaidIdentityMethod;
  confidence: RaidIdentityConfidence;
  knownSpecPulls: number;
  unknownSpecPulls: number;
  killedBosses: number;
}

type Candidate = {
  specName: string;
  role: Role;
  metric: "dps" | "hps";
  knownPulls: number;
  killedBosses: number;
  totalKills: number;
  medianParse: number | null;
};

export function resolveCharacterRaidIdentity(input: {
  classID: number;
  specPulls?: Map<string, number>;
  unknownSpecPulls?: number;
  parseEvidence: RaidIdentityParseEvidence[];
}): RaidIdentityResolution | null {
  const specPulls = new Map(
    Array.from(input.specPulls ?? [], ([specName, pulls]) => [slugifySpecName(specName), Math.max(0, pulls)]),
  );
  const unknownSpecPulls = Math.max(0, input.unknownSpecPulls ?? 0);
  const candidates = buildCandidates(input.classID, specPulls, input.parseEvidence);
  if (candidates.length === 0) return null;

  const pullCandidates = candidates
    .filter((candidate) => candidate.knownPulls > 0)
    .sort(comparePullCandidates);
  const topPull = pullCandidates[0];
  const runnerUpPulls = pullCandidates[1]?.knownPulls ?? 0;

  if (topPull && topPull.knownPulls > runnerUpPulls + unknownSpecPulls) {
    return toResolution(topPull, "fight_roster", unknownSpecPulls === 0 ? "exact" : "inferred", unknownSpecPulls);
  }

  const rankingCandidates = candidates
    .filter((candidate) => candidate.killedBosses > 0)
    .sort(compareRankingCandidates);
  if (rankingCandidates.length > 0) {
    const selected = rankingCandidates[0];
    const runnerUp = rankingCandidates[1];
    const method: RaidIdentityMethod = !runnerUp || selected.killedBosses > runnerUp.killedBosses
      ? "mythic_kill_bosses"
      : "parse_quality";
    return toResolution(selected, method, "inferred", unknownSpecPulls);
  }

  if (topPull) {
    return toResolution(topPull, "known_pull_fallback", "inferred", unknownSpecPulls);
  }

  return null;
}

function buildCandidates(
  classID: number,
  specPulls: Map<string, number>,
  parseEvidence: RaidIdentityParseEvidence[],
): Candidate[] {
  const specNames = new Set<string>(specPulls.keys());
  for (const row of parseEvidence) specNames.add(slugifySpecName(row.specName));

  return Array.from(specNames).flatMap((specName) => {
    const role = tryResolveRole(classID, specName);
    if (!role) return [];
    const metric = role === "healer" ? "hps" : "dps";
    const relevantRows = parseEvidence.filter(
      (row) => slugifySpecName(row.specName) === specName && row.metric === metric && row.totalKills > 0,
    );
    const bossRows = new Map<number, RaidIdentityParseEvidence>();
    for (const row of relevantRows) {
      const current = bossRows.get(row.encounterId);
      if (!current || row.rankPercent > current.rankPercent) bossRows.set(row.encounterId, row);
    }
    const rows = Array.from(bossRows.values());

    return [{
      specName,
      role,
      metric,
      knownPulls: specPulls.get(specName) ?? 0,
      killedBosses: rows.length,
      totalKills: rows.reduce((sum, row) => sum + Math.max(0, row.totalKills), 0),
      medianParse: median(rows.map((row) => row.rankPercent)),
    }];
  });
}

function comparePullCandidates(left: Candidate, right: Candidate): number {
  return right.knownPulls - left.knownPulls
    || right.killedBosses - left.killedBosses
    || (right.medianParse ?? -1) - (left.medianParse ?? -1)
    || right.totalKills - left.totalKills
    || left.specName.localeCompare(right.specName);
}

function compareRankingCandidates(left: Candidate, right: Candidate): number {
  return right.killedBosses - left.killedBosses
    || (right.medianParse ?? -1) - (left.medianParse ?? -1)
    || right.totalKills - left.totalKills
    || right.knownPulls - left.knownPulls
    || left.specName.localeCompare(right.specName);
}

function toResolution(
  candidate: Candidate,
  method: RaidIdentityMethod,
  confidence: RaidIdentityConfidence,
  unknownSpecPulls: number,
): RaidIdentityResolution {
  return {
    specName: candidate.specName,
    role: candidate.role,
    metric: candidate.metric,
    method,
    confidence,
    knownSpecPulls: candidate.knownPulls,
    unknownSpecPulls,
    killedBosses: candidate.killedBosses,
  };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[midpoint - 1] + sorted[midpoint]) / 2 : sorted[midpoint];
}
