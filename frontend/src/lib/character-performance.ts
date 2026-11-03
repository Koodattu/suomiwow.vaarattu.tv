import type { CharacterProfileBossScore, CharacterProfileResponse } from "../types";

export type PerformanceMetric = "all" | "dps" | "hps";
type Profile = Pick<CharacterProfileResponse, "rankings" | "mechanics">;
type Mechanic = Profile["mechanics"][number];

export const performanceBossKey = (zoneId: number, encounterId: number) => `${zoneId}:${encounterId}`;

// Equal pull counts prefer DPS, then healer, then tank. Score quality never
// decides the role, so switching performance tabs cannot change the selection.
const roleOrder = { dps: 0, healer: 1, tank: 2 };
export function selectBossPerformance(rows: CharacterProfileBossScore[], metric: PerformanceMetric) {
  const selected = new Map<number, CharacterProfileBossScore>();
  for (const row of rows) {
    if (metric !== "all" && row.metric !== metric) continue;
    const previous = selected.get(row.encounterId);
    if (!previous || row.pulls > previous.pulls || (row.pulls === previous.pulls && roleOrder[row.role] < roleOrder[previous.role])) {
      selected.set(row.encounterId, row);
    }
  }
  return [...selected.values()].sort((a, b) => a.encounterId - b.encounterId);
}

function mean(values: Array<number | null>) {
  const present = values.filter((value): value is number => value !== null);
  return present.length ? Math.round(present.reduce((sum, value) => sum + value, 0) / present.length * 10) / 10 : null;
}

export function getPerformanceMetrics(profile: Profile | null): Set<string> {
  return new Set([
    ...(profile?.rankings ?? []).map(row => row.metric),
    ...(profile?.mechanics ?? []).flatMap(row => row.profileBossScores?.map(boss => boss.metric) ?? [row.metric]),
  ].filter((metric): metric is string => metric === "dps" || metric === "hps"));
}

export function buildCharacterPerformance(profile: Profile | null, metric: PerformanceMetric) {
  const rankings: Profile["rankings"] = [];
  const mechanics: Profile["mechanics"] = [];
  const selectedBosses = new Map<string, CharacterProfileBossScore>();
  const rebuilt = new Map<number, Mechanic>();
  for (const row of profile?.mechanics ?? []) {
    if (row.encounterId !== null || row.profileBossScores === undefined) continue;
    const previous = rebuilt.get(row.zoneId);
    if (!previous || (row.updatedAt ?? "") > (previous.updatedAt ?? "")) rebuilt.set(row.zoneId, row);
  }

  // Historical raids remain usable until their first rebuild. Never pretend
  // that an old raid-wide score is a newly calculated mixed-role score.
  rankings.push(...(profile?.rankings ?? []).filter(row => !rebuilt.has(row.zoneId) && (metric === "all" || row.metric === metric)));
  mechanics.push(...(profile?.mechanics ?? []).filter(row => !rebuilt.has(row.zoneId) && (metric === "all" || row.metric === metric)));

  for (const parent of rebuilt.values()) {
    const selected = selectBossPerformance(parent.profileBossScores!, metric);
    if (!selected.length) continue;
    const metrics = new Set(selected.map(row => row.metric));
    const roles = new Set(selected.map(row => row.role));
    const summaryMetric = metrics.size > 1 ? "mixed" : selected[0].metric;
    const base = { zoneId: parent.zoneId, raidName: parent.raidName, updatedAt: parent.updatedAt };
    for (const boss of selected) {
      selectedBosses.set(performanceBossKey(parent.zoneId, boss.encounterId), boss);
      rankings.push({ ...base, ...boss, score: boss.allStarsPoints ?? 0, partition: null });
      mechanics.push({ ...base, ...boss, identityMethod: null, identityConfidence: null,
        scoreVersion: parent.scoreVersion, raidFightCoverage: parent.raidFightCoverage });
    }

    const points = selected.filter(row => row.rankPercent !== null && row.allStarsPoints !== null);
    if (points.length) {
      rankings.push({ ...base, encounterId: null, encounterName: null, metric: summaryMetric,
        role: roles.size > 1 ? "mixed" : selected[0].role, specName: null, partition: null,
        rankPercent: mean(selected.map(row => row.rankPercent)), score: points.reduce((sum, row) => sum + row.allStarsPoints!, 0) });
    }
    const sum = (key: "pulls" | "evaluatedPulls" | "deaths" | "survivedPulls" | "earlyDeaths") => selected.reduce((total, row) => total + row[key], 0);
    mechanics.push({ ...base, encounterId: null, encounterName: null, metric: summaryMetric,
      role: roles.size > 1 ? "mixed" : selected[0].role, specName: null,
      rankPercent: mean(selected.map(row => row.rankPercent)), parseScore: mean(selected.map(row => row.parseScore)),
      score: mean(selected.map(row => row.score)), survivalScore: mean(selected.map(row => row.survivalScore)),
      survivalPercentile: mean(selected.map(row => row.survivalPercentile)),
      pulls: sum("pulls"), evaluatedPulls: sum("evaluatedPulls"), deaths: sum("deaths"),
      survivedPulls: sum("survivedPulls"), earlyDeaths: sum("earlyDeaths"), averageDeathPercent: null,
      deathDataAvailable: selected.some(row => row.deathDataAvailable), identityMethod: null, identityConfidence: null,
      scoreVersion: parent.scoreVersion, raidFightCoverage: parent.raidFightCoverage });
  }
  return { rankings, mechanics, selectedBosses, rebuiltZones: new Set(rebuilt.keys()) };
}
