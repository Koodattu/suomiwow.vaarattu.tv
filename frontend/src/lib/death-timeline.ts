import type { DeathAnalysisPull } from "../types/character-deaths";

export const deathPullKey = (pull: DeathAnalysisPull) => `${pull.reportCode}:${pull.fightId}`;
export const deathTimeLabel = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
export const deathPosition = (time: number, duration: number, axis: string) => axis === "percent" ? time / duration * 100 : time;

export function buildDeathTimeline(pulls: DeathAnalysisPull[], session: string, focus: string, axis: string, cluster: number | null) {
  const sessions = new Map<string, { code: string; date: string; pulls: number }>();
  for (const pull of pulls) {
    const entry = sessions.get(pull.reportCode) ?? { code: pull.reportCode, date: pull.date, pulls: 0 };
    entry.pulls++;
    sessions.set(pull.reportCode, entry);
  }
  const scoped = pulls.filter((pull) => !session || pull.reportCode === session);
  const focused = scoped.filter((pull) => {
    if (focus === "early") return pull.complete && pull.deaths.some((death) => death.order !== null && death.order <= 3);
    if (focus === "repeat") return pull.complete && pull.deaths.length > 1;
    if (focus === "survived") return pull.complete && pull.deaths.length === 0;
    if (focus === "missing") return !pull.complete;
    return true;
  });
  const maximum = axis === "percent" ? 100 : Math.max(60000, Math.ceil(scoped.reduce((max, pull) => Math.max(max, pull.duration), 0) / 60000) * 60000);
  const binIndex = (time: number, duration: number) => Math.min(15, Math.floor(deathPosition(time, duration, axis) / maximum * 16));
  const bins = Array<number>(16).fill(0);
  for (const pull of focused) for (const death of pull.deaths) bins[binIndex(death.deathTime, pull.duration)]++;
  const activeCluster = cluster !== null && Number.isInteger(cluster) && cluster >= 0 && cluster < 16 ? cluster : null;
  const visible = activeCluster === null ? focused : focused.filter((pull) => pull.deaths.some((death) => binIndex(death.deathTime, pull.duration) === activeCluster));
  return {
    sessions: [...sessions.values()].sort((a, b) => b.date.localeCompare(a.date)),
    scoped, visible, bins, maximum,
    start: activeCluster === null ? 0 : activeCluster / 16 * maximum,
    end: activeCluster === null ? maximum : (activeCluster + 1) / 16 * maximum,
    activeCluster,
  };
}
