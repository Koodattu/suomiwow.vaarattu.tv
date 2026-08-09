import crypto from "crypto";

export class FunRoundUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FunRoundUnavailableError";
  }
}

export function canonicalCharacterKey(wclCanonicalCharacterId: number, classID: number): string {
  return `wcl:${wclCanonicalCharacterId}:${classID}`;
}

export function bossKey(raidId: number, bossId: number): string {
  return `${raidId}:${bossId}`;
}

export function randomItem<T>(items: readonly T[]): T {
  if (items.length === 0) throw new FunRoundUnavailableError("No eligible candidates are available");
  return items[crypto.randomInt(items.length)];
}

export function shuffle<T>(items: readonly T[]): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = crypto.randomInt(index + 1);
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

export function sample<T>(items: readonly T[], count: number): T[] {
  if (items.length < count) throw new FunRoundUnavailableError("Not enough eligible candidates are available");
  return shuffle(items).slice(0, count);
}

export function findDistinctAssignments<T extends { key: string }>(
  cells: ReadonlyArray<{ id: string; candidates: readonly T[] }>,
): Record<string, T> | null {
  const orderedCells = cells
    .map((cell) => ({ ...cell, candidates: Array.from(new Map(cell.candidates.map((candidate) => [candidate.key, candidate])).values()) }))
    .sort((left, right) => left.candidates.length - right.candidates.length);
  const assignments: Record<string, T> = {};
  const usedKeys = new Set<string>();

  const assignCell = (index: number): boolean => {
    const cell = orderedCells[index];
    if (!cell) return true;

    for (const candidate of cell.candidates) {
      if (usedKeys.has(candidate.key)) continue;
      usedKeys.add(candidate.key);
      assignments[cell.id] = candidate;
      if (assignCell(index + 1)) return true;
      usedKeys.delete(candidate.key);
      delete assignments[cell.id];
    }
    return false;
  };

  return assignCell(0) ? assignments : null;
}

export function newRoundBase(): { roundId: string; generatedAt: string } {
  return {
    roundId: crypto.randomUUID(),
    generatedAt: new Date().toISOString(),
  };
}
