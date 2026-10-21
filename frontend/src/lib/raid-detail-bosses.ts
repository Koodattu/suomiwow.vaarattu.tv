import type { Boss, BossProgress, RaidProgress } from "../types/index";

/** Number main progression separately; parentheses show a lair's overall kill position. */
export function raidDetailBossNumbers(sortedBosses: readonly BossProgress[], bosses: readonly Boss[]): Map<number, string> {
  const lairIds = new Set(bosses.filter(boss => boss.isLair).map(boss => boss.id));
  const numbers = new Map<number, string>();
  let mainPosition = 0;
  let killPosition = 0;
  for (const boss of [...sortedBosses].reverse()) {
    if (boss.kills > 0) killPosition++;
    numbers.set(boss.bossId, lairIds.has(boss.bossId)
      ? boss.kills > 0 ? `(${killPosition})` : "-"
      : String(++mainPosition));
  }
  return numbers;
}

/** Combine encounter rows for display without changing the main raid's totals. */
export function raidDetailBosses(progress: RaidProgress, bosses: readonly Boss[], lairProgress: readonly RaidProgress[] = []): BossProgress[] {
  const encounters = new Map(progress.bosses.map(boss => [boss.bossId, boss]));
  for (const lair of lairProgress) {
    if (lair.raidId === progress.raidId && lair.difficulty === progress.difficulty) {
      for (const boss of lair.bosses) encounters.set(boss.bossId, boss);
    }
  }

  const order = new Map(bosses.map((boss, index) => [boss.id, index]));
  const lairIds = new Set(bosses.filter(boss => boss.isLair).map(boss => boss.id));
  const rows = bosses.map(boss => encounters.get(boss.id) ?? {
    bossId: boss.id,
    bossName: boss.name,
    kills: 0,
    bestPercent: 100,
    pullCount: 0,
    timeSpent: 0,
    lastUpdated: progress.lastUpdated,
  });

  // Unkilled main bosses first, then all kills by date, then unkilled lairs.
  const group = (boss: BossProgress) => boss.kills > 0 ? 1 : lairIds.has(boss.bossId) ? 2 : 0;
  return rows.sort((a, b) => {
    const groupDifference = group(a) - group(b);
    if (groupDifference) return groupDifference;
    if (a.kills > 0 && b.kills > 0) {
      const aTime = Date.parse(a.firstKillTime ?? "") || 0;
      const bTime = Date.parse(b.firstKillTime ?? "") || 0;
      return bTime - aTime || (b.killOrder ?? 0) - (a.killOrder ?? 0);
    }
    return order.get(b.bossId)! - order.get(a.bossId)!;
  });
}
