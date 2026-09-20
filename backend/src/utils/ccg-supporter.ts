import { CCG_COMMUNITY_SET, CCG_SUPPORTER_SET, CCG_CONFIGURED_SETS, CCG_TIER_GRADES, CcgCustomFinish, CcgTierGrade } from "../config/ccg";
import { CLASSES } from "../config/classes";
import { getHelsinkiDateKey } from "./helsinki-time";
import { slugifySpecName } from "./spec";

export const SUPPORTER_BASE_SLOTS = 2;
export const SUPPORTER_DRAFT_LIMIT = 5;
export const SUPPORTER_RENDER_COOLDOWN_MS = 6 * 60 * 60 * 1000;
export const SUPPORTER_BACKGROUNDS = [CCG_SUPPORTER_SET, CCG_COMMUNITY_SET, ...CCG_CONFIGURED_SETS.filter((set) => set.state !== "locked")]
  .map((set) => ({ id: set.slug, name: set.raidName, path: set.backgroundPath, crop: { x: set.crop.x, y: set.crop.y, scale: set.crop.scale } }));
export const SUPPORTER_CREATOR_FINISHES: CcgCustomFinish[] = [...new Set(CCG_CONFIGURED_SETS
  .filter((set) => set.state !== "locked")
  .flatMap((set) => set.customFinish && set.customFinish.key !== "worldcore" ? [set.customFinish.key] : []))];

export class CcgSupporterError extends Error {
  constructor(public readonly status: number, public readonly code: string, public readonly nextAllowedAt?: Date) {
    super(code);
    this.name = "CcgSupporterError";
  }
}

export function supporterMonth(date = new Date()): string {
  return getHelsinkiDateKey(date).slice(0, 7);
}

export function supporterGrants(following: boolean | null, subscribed: boolean | null, firstMonth: string | null, observedAt: Date) {
  const month = supporterMonth(observedAt);
  const grants: Array<{ kind: "follower" | "subscriber" | "monthly"; period: string; amount: number }> = [];
  if (following) grants.push({ kind: "follower", period: "once", amount: 1 });
  if (subscribed) {
    grants.push({ kind: "subscriber", period: "once", amount: 3 });
    if (firstMonth && month > firstMonth) grants.push({ kind: "monthly", period: month, amount: 1 });
  }
  return grants;
}

export function supporterScores(input: { performance?: unknown; mechanics?: unknown; mythicPlus?: unknown }) {
  const parse = (value: unknown, max: number): number | null => {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > max) {
      throw new CcgSupporterError(400, "invalid_scores");
    }
    return Math.round(value * 10) / 10;
  };
  const performance = parse(input.performance, 100);
  const mechanics = parse(input.mechanics, 100);
  return {
    performance, mechanics,
    combined: performance === null || mechanics === null ? null : Math.round((performance + mechanics) * 5) / 10,
    mythicPlus: parse(input.mythicPlus, 100_000),
  };
}

export function validateSupporterDraft(classID: number, input: Record<string, unknown>) {
  if (typeof input.specName !== "string") throw new CcgSupporterError(400, "invalid_spec");
  const spec = CLASSES.find((entry) => entry.id === classID)?.specs.find((entry) => entry.name === slugifySpecName(input.specName as string));
  if (!spec || (input.role !== undefined && input.role !== spec.role)) throw new CcgSupporterError(400, "invalid_spec");
  if (!CCG_TIER_GRADES.includes(input.tierGrade as CcgTierGrade)) throw new CcgSupporterError(400, "invalid_rarity");
  if (!SUPPORTER_CREATOR_FINISHES.includes(input.creatorFinish as CcgCustomFinish)) throw new CcgSupporterError(400, "invalid_finish");
  const scores = supporterScores(input);
  if (input.backgroundId !== undefined && !SUPPORTER_BACKGROUNDS.some((background) => background.id === input.backgroundId)) {
    throw new CcgSupporterError(400, "invalid_background");
  }
  if (input.backgroundOffsetX !== undefined && (typeof input.backgroundOffsetX !== "number" || !Number.isFinite(input.backgroundOffsetX)
    || input.backgroundOffsetX < 0 || input.backgroundOffsetX > 100)) throw new CcgSupporterError(400, "invalid_background");
  return { specName: spec.name, role: spec.role, tierGrade: input.tierGrade as CcgTierGrade,
    creatorFinish: input.creatorFinish as CcgCustomFinish,
    ...(input.backgroundId !== undefined ? { backgroundId: input.backgroundId as string } : {}),
    ...(input.backgroundOffsetX !== undefined ? { backgroundOffsetX: input.backgroundOffsetX as number } : {}),
    performance: scores.performance, mechanics: scores.mechanics, mythicPlus: scores.mythicPlus };
}
