import { ROLE_BY_CLASS_AND_SPEC, Role } from "../config/specs";
import { RAIDER_IO_SPEC_SLOTS_BY_BLIZZARD_CLASS_ID } from "../config/raiderio-specs";

type BlizzardSpecIdentity = {
  specID: number;
  specName: string;
};

const SPEC_BY_BLIZZARD_ID = new Map<number, BlizzardSpecIdentity>();

for (const classMap of Object.values(RAIDER_IO_SPEC_SLOTS_BY_BLIZZARD_CLASS_ID)) {
  for (const spec of Object.values(classMap.specs)) {
    if (!spec) continue;
    SPEC_BY_BLIZZARD_ID.set(spec.blizzardSpecId, {
      specID: spec.blizzardSpecId,
      specName: spec.specSlug,
    });
  }
}

export function slugifySpecName(specName: string): string {
  return specName
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/\s+/g, "-");
}

export function resolveRole(classID: number, specName: string): Role {
  return tryResolveRole(classID, specName) ?? "dps";
}

export function tryResolveRole(classID: number, specName: string | null | undefined): Role | null {
  if (!specName) return null;
  const slug = slugifySpecName(specName);
  const classMap = ROLE_BY_CLASS_AND_SPEC[classID];
  if (!classMap) return null;
  return classMap[slug] ?? null;
}

export function resolveSpecByBlizzardSpecId(specID: number): BlizzardSpecIdentity | null {
  return SPEC_BY_BLIZZARD_ID.get(specID) ?? null;
}
