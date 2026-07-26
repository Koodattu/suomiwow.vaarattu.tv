export type CharacterIdentity = {
  name: string;
  realm: string;
  region: string;
  blizzardIdentityOverride?: {
    name: string;
    realm: string;
    updatedAt: Date | string;
  } | null;
};

export type ObservedCharacterIdentity = Pick<CharacterIdentity, "name" | "realm" | "region"> & {
  observedAt?: Date | string | null;
};

function timestamp(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

export function isBlizzardIdentityOverrideActive(character: CharacterIdentity, latestObservedIdentity?: ObservedCharacterIdentity | null): boolean {
  const override = character.blizzardIdentityOverride;
  if (!override) return false;

  const observedAt = timestamp(latestObservedIdentity?.observedAt);
  if (observedAt === null) return true;

  const overrideAt = timestamp(override.updatedAt);
  return overrideAt !== null && overrideAt >= observedAt;
}

export function resolveBlizzardCharacterIdentity(
  character: CharacterIdentity,
  latestObservedIdentity?: ObservedCharacterIdentity | null,
): Pick<CharacterIdentity, "name" | "realm" | "region"> {
  const override = character.blizzardIdentityOverride;
  if (override && isBlizzardIdentityOverrideActive(character, latestObservedIdentity)) {
    return {
      name: override.name,
      realm: override.realm,
      region: character.region,
    };
  }

  if (latestObservedIdentity) {
    return {
      name: latestObservedIdentity.name,
      realm: latestObservedIdentity.realm,
      region: latestObservedIdentity.region,
    };
  }

  return { name: character.name, realm: character.realm, region: character.region };
}
