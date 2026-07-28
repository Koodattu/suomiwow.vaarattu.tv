export type CharacterContinuityEdge = {
  sourceCharacterId: unknown;
  targetCharacterId: unknown;
};

export type CharacterContinuityGraph = {
  resolveRoot(characterId: unknown): string;
  getMemberIds(characterId: unknown): string[];
  getTargetId(characterId: unknown): string | null;
};

export function buildCharacterContinuityGraph(edges: CharacterContinuityEdge[]): CharacterContinuityGraph {
  const targetBySourceId = new Map<string, string>();
  const allIds = new Set<string>();

  for (const edge of edges) {
    const sourceId = String(edge.sourceCharacterId);
    const targetId = String(edge.targetCharacterId);
    targetBySourceId.set(sourceId, targetId);
    allIds.add(sourceId);
    allIds.add(targetId);
  }

  const rootById = new Map<string, string>();
  const resolveRoot = (rawCharacterId: unknown): string => {
    const characterId = String(rawCharacterId);
    const cached = rootById.get(characterId);
    if (cached) return cached;

    const path: string[] = [];
    const visited = new Set<string>();
    let currentId = characterId;
    while (targetBySourceId.has(currentId)) {
      if (visited.has(currentId)) {
        throw new Error("Character continuity links contain a cycle");
      }
      visited.add(currentId);
      path.push(currentId);
      currentId = targetBySourceId.get(currentId)!;
    }

    rootById.set(currentId, currentId);
    for (const pathId of path) rootById.set(pathId, currentId);
    return currentId;
  };

  for (const characterId of allIds) resolveRoot(characterId);

  return {
    resolveRoot,
    getMemberIds(rawCharacterId: unknown) {
      const characterId = String(rawCharacterId);
      const rootId = resolveRoot(characterId);
      const memberIds = new Set<string>([characterId, rootId]);
      for (const candidateId of allIds) {
        if (resolveRoot(candidateId) === rootId) memberIds.add(candidateId);
      }
      return [...memberIds].sort();
    },
    getTargetId(rawCharacterId: unknown) {
      return targetBySourceId.get(String(rawCharacterId)) ?? null;
    },
  };
}
