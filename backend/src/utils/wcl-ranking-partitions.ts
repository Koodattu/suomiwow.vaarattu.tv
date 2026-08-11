type RaidPartitionLike = {
  id?: unknown;
};

export function getWclRankingPartitionIds(partitions: readonly RaidPartitionLike[] | null | undefined): number[] {
  return Array.from(
    new Set(
      (partitions ?? [])
        .map((partition) => partition.id)
        .filter((partitionId): partitionId is number => typeof partitionId === "number" && Number.isInteger(partitionId) && partitionId > 0),
    ),
  ).sort((a, b) => a - b);
}

export function toWclPartitionRankingAlias(baseAlias: string, partition: number): string {
  return `${baseAlias}Partition${partition}`;
}
