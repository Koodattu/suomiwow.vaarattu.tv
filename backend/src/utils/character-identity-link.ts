export type CharacterIdentityAlias = {
  name: string;
  realm: string;
  region: string;
  classID: number;
};

export function normalizeCharacterIdentityPart(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]+/gu, "");
}

export function createCharacterIdentityAliasKey(identity: CharacterIdentityAlias): string {
  return [
    normalizeCharacterIdentityPart(identity.region),
    normalizeCharacterIdentityPart(identity.realm),
    normalizeCharacterIdentityPart(identity.name),
    identity.classID,
  ].join(":");
}

export function createReportRankingSourceIdentityKey(identity: CharacterIdentityAlias): string {
  const normalizeSourcePart = (value: string) => value.trim().toLowerCase().replace(/\s+/g, "-");
  return `reportRankings:${normalizeSourcePart(identity.region)}:${normalizeSourcePart(identity.realm)}:${normalizeSourcePart(identity.name)}:${identity.classID}`;
}
