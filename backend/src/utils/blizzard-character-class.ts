import { CLASSES } from "../config/classes";
import { RAIDER_IO_SPEC_SLOTS_BY_BLIZZARD_CLASS_ID } from "../config/raiderio-specs";

// These APIs number classes differently (e.g. Rogue is Blizzard 4, WCL 8).
export function getWclClassIdFromBlizzardClassId(blizzardClassId: unknown): number | null {
  if (typeof blizzardClassId !== "number" || !Number.isInteger(blizzardClassId)) return null;
  const className = RAIDER_IO_SPEC_SLOTS_BY_BLIZZARD_CLASS_ID[blizzardClassId]?.className;
  return CLASSES.find((entry) => entry.name === className)?.id ?? null;
}
