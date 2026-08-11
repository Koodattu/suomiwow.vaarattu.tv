import mongoose from "mongoose";
import { CCG_FINISH_ORDER, CcgArtVariant, CcgFinish } from "../config/ccg";
import CcgCard, { ICcgCard } from "../models/CcgCard";
import CcgGameRun from "../models/CcgGameRun";
import CcgOwnership from "../models/CcgOwnership";
import CcgRaceEntry, { ICcgRaceEntry } from "../models/CcgRaceEntry";
import CcgRaidLockout from "../models/CcgRaidLockout";
import CcgSeriesOwnership from "../models/CcgSeriesOwnership";
import CcgSet from "../models/CcgSet";
import CcgStyleSubmission from "../models/CcgStyleSubmission";
import CcgStyleVote from "../models/CcgStyleVote";
import User from "../models/User";
import {
  CCG_EXPEDITION_ENCOUNTERS,
  CCG_GAME_RULES_VERSION,
  CCG_RAID_ENCOUNTERS,
  CcgGameAssignments,
  CcgGameCard,
  CcgGameSimulationResult,
  CcgGameStrategy,
  getCcgGameRosterCost,
  getCcgGameGradeCost,
  resolveCcgGameUtilities,
  simulateCcgEncounter,
} from "../utils/ccg-game-engine";
import { CcgServiceError, resolveCcgRaidCardMechanicsScore } from "./ccg.service";

export type CcgGameOwner = {
  ownerType: "user" | "guest";
  ownerId: mongoose.Types.ObjectId;
  dateKey: string;
};

type ExpeditionInput = {
  idempotencyKey?: unknown;
  cardIds?: unknown;
  route?: unknown;
  pullSize?: unknown;
  boon?: unknown;
  assignments?: unknown;
};

type RaidPullInput = {
  idempotencyKey?: unknown;
  rosterCardIds?: unknown;
  activeCardIds?: unknown;
  difficulty?: unknown;
  assignments?: unknown;
};

const STYLE_THEMES = [
  "Void",
  "Fire",
  "Royalty",
  "Villain Arc",
  "Old Gods",
  "Raid Leader Energy",
  "Most Finnish",
  "Best Legacy Look",
  "Accidental Fashion Icon",
  "Final Boss Material",
] as const;

const EXPEDITION_TIMER_SECONDS = 15 * 60;
export const CCG_RACE_ROSTER_BUDGET = 110;

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === 11000;
}

function requireIdempotencyKey(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{8,100}$/.test(value)) {
    throw new CcgServiceError(400, "invalid_idempotency_key", "Use a valid idempotency key");
  }
  return value;
}

function requireStringArray(value: unknown, label: string, maximum: number): string[] {
  if (!Array.isArray(value) || value.length > maximum || !value.every((item) => typeof item === "string" && item.length <= 100)) {
    throw new CcgServiceError(400, "invalid_roster", `Choose a valid ${label}`);
  }
  return [...new Set(value as string[])];
}

function requireChoice<T extends string>(value: unknown, choices: readonly T[], fallback: T, label: string): T {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "string" || !choices.includes(value as T)) {
    throw new CcgServiceError(400, "invalid_game_option", `Choose a valid ${label}`);
  }
  return value as T;
}

function parseAssignments(value: unknown, activeIds: ReadonlySet<string>): CcgGameAssignments {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { strategy: "standard" };
  const input = value as Record<string, unknown>;
  const validateIds = (candidate: unknown, maximum: number): string[] => {
    const ids = requireStringArray(candidate ?? [], "assignment", maximum);
    if (ids.some((id) => !activeIds.has(id))) throw new CcgServiceError(400, "invalid_assignment", "Assignments must use active roster cards");
    return ids;
  };
  const singleId = (candidate: unknown): string | null => {
    if (candidate === null || candidate === undefined || candidate === "") return null;
    if (typeof candidate !== "string" || !activeIds.has(candidate)) {
      throw new CcgServiceError(400, "invalid_assignment", "Assignments must use active roster cards");
    }
    return candidate;
  };
  const phase = (candidate: unknown): string | null => {
    if (candidate === null || candidate === undefined || candidate === "") return null;
    if (typeof candidate !== "string" || candidate.length > 80) throw new CcgServiceError(400, "invalid_assignment", "Choose a valid phase assignment");
    return candidate;
  };
  return {
    interruptCardIds: validateIds(input.interruptCardIds, 8),
    soakCardIds: validateIds(input.soakCardIds, 10),
    dispelCardId: singleId(input.dispelCardId),
    heroismPhase: phase(input.heroismPhase),
    defensivePhase: phase(input.defensivePhase),
    strategy: requireChoice(input.strategy, ["safe", "standard", "aggressive"] as const, "standard", "strategy") as CcgGameStrategy,
  };
}

function getWeeklyKey(dateKey: string): string {
  const date = new Date(`${dateKey}T12:00:00.000Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function getStyleTheme(dateKey: string): string {
  const days = Math.floor(Date.parse(`${dateKey}T00:00:00.000Z`) / 86_400_000);
  return STYLE_THEMES[Math.abs(days) % STYLE_THEMES.length];
}

function getMercenary(id: string): CcgGameCard {
  const match = /^merc:(tank|healer|dps):(\d{1,2})$/.exec(id);
  if (!match) throw new CcgServiceError(400, "invalid_mercenary", "Choose a valid PUG mercenary");
  const role = match[1] as CcgGameCard["role"];
  const classID = role === "tank" ? 1 : role === "healer" ? 5 : 3;
  const specName = role === "tank" ? "Protection" : role === "healer" ? "Holy" : "Marksmanship";
  const card: CcgGameCard = {
    id,
    identityId: id,
    name: role === "tank" ? "PUG Vanguard" : role === "healer" ? "PUG Mender" : "PUG Striker",
    role,
    classID,
    specName,
    performance: 56,
    mechanics: 62,
    mythicPlus: 50,
    tierGrade: "C",
    utilities: [],
    mercenary: true,
  };
  card.utilities = resolveCcgGameUtilities(card);
  return card;
}

function assertUniqueIdentities(roster: CcgGameCard[]): void {
  const identities = new Set<string>();
  for (const card of roster) {
    if (identities.has(card.identityId)) throw new CcgServiceError(400, "duplicate_identity", "Use only one snapshot of each character");
    identities.add(card.identityId);
  }
}

function assertFormation(roster: CcgGameCard[], expected: Record<CcgGameCard["role"], number>): void {
  const counts = roster.reduce((result, card) => {
    result[card.role] += 1;
    return result;
  }, { tank: 0, healer: 0, dps: 0 });
  if (counts.tank !== expected.tank || counts.healer !== expected.healer || counts.dps !== expected.dps) {
    throw new CcgServiceError(
      400,
      "invalid_formation",
      `Formation requires ${expected.tank} tank, ${expected.healer} healer, and ${expected.dps} damage cards`,
    );
  }
}

function scoreExpedition(encounters: CcgGameSimulationResult[], route: string, time: number, deaths: number): number {
  const kills = encounters.filter((encounter) => encounter.killed).length;
  return Math.max(0, Math.round(kills * 25_000 + (route === "score" ? 2_000 : 0) + Math.max(0, 20_000 - time * 10) - deaths * 500));
}

function compareRaceResults(left: Record<string, any>, right: Record<string, any>): number {
  if (Boolean(left.killed) !== Boolean(right.killed)) return left.killed ? -1 : 1;
  if (left.killed && Number(left.durationSeconds) !== Number(right.durationSeconds)) return Number(left.durationSeconds) - Number(right.durationSeconds);
  if (Number(left.bossHealthRemaining) !== Number(right.bossHealthRemaining)) return Number(left.bossHealthRemaining) - Number(right.bossHealthRemaining);
  if (Number(left.deaths) !== Number(right.deaths)) return Number(left.deaths) - Number(right.deaths);
  return Number(left.failedChecks) - Number(right.failedChecks);
}

class CcgGameService {
  private async resolveCards(owner: CcgGameOwner, ids: string[], allowMercenaries: boolean): Promise<CcgGameCard[]> {
    const mercenaryIds = ids.filter((id) => id.startsWith("merc:"));
    if (mercenaryIds.length > 0 && !allowMercenaries) throw new CcgServiceError(400, "mercenaries_not_allowed", "PUG mercenaries are not allowed in this mode");
    const cardIds = ids.filter((id) => !id.startsWith("merc:"));
    if (cardIds.some((id) => !mongoose.Types.ObjectId.isValid(id))) throw new CcgServiceError(400, "invalid_card", "Choose valid owned cards");
    const objectIds = cardIds.map((id) => new mongoose.Types.ObjectId(id));
    const cards = objectIds.length > 0 ? await CcgCard.find({ _id: { $in: objectIds } }).lean<ICcgCard[]>() : [];
    if (cards.length !== objectIds.length) throw new CcgServiceError(404, "card_not_found", "One of the selected cards no longer exists");
    const setIds = [...new Set(cards.map((card) => String(card.setId)))].map((id) => new mongoose.Types.ObjectId(id));
    const [sets, ownership, normalizationRows] = await Promise.all([
      CcgSet.find({ _id: { $in: setIds }, enabledAt: { $ne: null } }).select("kind").lean(),
      cards.length > 0 ? CcgSeriesOwnership.find({
        ownerType: owner.ownerType,
        ownerId: owner.ownerId,
        $or: cards.map((card) => ({ setId: card.setId, characterId: card.characterId })),
      }).select("setId characterId unlockedSnapshotVersions").lean() : [],
      setIds.length > 0 ? CcgCard.find({ setId: { $in: setIds }, mythicPlusScore: { $gt: 0 } }).select("setId mythicPlusScore -_id").lean() : [],
    ]);
    const setKind = new Map(sets.map((set) => [String(set._id), set.kind]));
    const owned = new Map(ownership.map((row) => [`${row.setId}:${row.characterId}`, row.unlockedSnapshotVersions]));
    const normalizedBySet = new Map<string, number[]>();
    for (const row of normalizationRows) {
      const key = String(row.setId);
      const values = normalizedBySet.get(key) ?? [];
      if (typeof row.mythicPlusScore === "number") values.push(row.mythicPlusScore);
      normalizedBySet.set(key, values);
    }
    for (const values of normalizedBySet.values()) values.sort((left, right) => left - right);

    const gameCards = cards.map((card): CcgGameCard => {
      const snapshots = owned.get(`${card.setId}:${card.characterId}`);
      if (!snapshots?.includes(card.snapshotVersion)) throw new CcgServiceError(403, "card_not_owned", "Your roster contains a card snapshot you do not own");
      if (setKind.get(String(card.setId)) !== "raid") throw new CcgServiceError(400, "community_card_not_combatant", "Community cards can be mascots, but not active combatants");
      const values = normalizedBySet.get(String(card.setId)) ?? [];
      const rawMythicPlus = typeof card.mythicPlusScore === "number" && card.mythicPlusScore > 0 ? card.mythicPlusScore : null;
      const rank = rawMythicPlus === null ? -1 : values.findIndex((value) => value >= rawMythicPlus);
      const mythicPlus = rank < 0 || values.length < 2 ? 50 : Math.round((rank / (values.length - 1)) * 1000) / 10;
      const mechanics = resolveCcgRaidCardMechanicsScore(card) ?? 50;
      const result: CcgGameCard = {
        id: String(card._id),
        identityId: String(card.characterId),
        name: card.name,
        role: card.role,
        classID: card.classID,
        specName: card.specName,
        performance: typeof card.parseScore === "number" ? card.parseScore : 50,
        mechanics,
        mythicPlus,
        tierGrade: card.tierGrade,
        utilities: [],
      };
      result.utilities = resolveCcgGameUtilities(result);
      return result;
    });
    const resultById = new Map(gameCards.map((card) => [card.id, card]));
    const result = ids.map((id) => id.startsWith("merc:") ? getMercenary(id) : resultById.get(id)).filter((card): card is CcgGameCard => Boolean(card));
    assertUniqueIdentities(result);
    return result;
  }

  private async createRun(fields: Record<string, unknown>): Promise<Record<string, any>> {
    try {
      const run = await CcgGameRun.create(fields);
      return run.toObject();
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      const existing = await CcgGameRun.findOne({
        ownerType: String(fields.ownerType) as "user" | "guest",
        ownerId: fields.ownerId as mongoose.Types.ObjectId,
        mode: String(fields.mode) as "expedition" | "raid" | "race",
        idempotencyKey: String(fields.idempotencyKey),
      }).lean();
      if (existing) return existing;
      throw error;
    }
  }

  async getState(owner: CcgGameOwner): Promise<Record<string, unknown>> {
    const weeklyKey = getWeeklyKey(owner.dateKey);
    const theme = getStyleTheme(owner.dateKey);
    const [raidLockout, raceEntry, styleSubmission] = await Promise.all([
      CcgRaidLockout.findOne({ ownerType: owner.ownerType, ownerId: owner.ownerId, weeklyKey }).lean(),
      CcgRaceEntry.findOne({ ownerType: owner.ownerType, ownerId: owner.ownerId, weeklyKey }).sort({ createdAt: -1 }).lean(),
      CcgStyleSubmission.findOne({ ownerType: owner.ownerType, ownerId: owner.ownerId, dateKey: owner.dateKey, theme }).lean(),
    ]);
    return {
      rulesVersion: CCG_GAME_RULES_VERSION,
      weeklyKey,
      weeklySeed: `raid-director:${weeklyKey}`,
      gradeCosts: Object.fromEntries(["H", "S", "A", "B", "C", "D", "E", "F"].map((grade) => [grade, getCcgGameGradeCost(grade)])),
      expedition: { timerSeconds: EXPEDITION_TIMER_SECONDS, keyLevel: 2, encounters: CCG_EXPEDITION_ENCOUNTERS.map(({ id, name, phases }) => ({ id, name, phases })) },
      raid: {
        encounters: CCG_RAID_ENCOUNTERS.map(({ id, name, phases }) => ({ id, name, phases })),
        lockout: raidLockout ? {
          difficulty: raidLockout.difficulty,
          rosterCardIds: raidLockout.rosterCardIds.map(String),
          activeCardIds: raidLockout.activeCardIds.map(String),
          bossIndex: raidLockout.bossIndex,
          bossKills: raidLockout.bossKills,
          pullCount: raidLockout.pullCount,
        } : null,
      },
      race: { rosterBudget: CCG_RACE_ROSTER_BUDGET, encounterId: CCG_RAID_ENCOUNTERS[0].id, entry: raceEntry ? await this.serializeRaceEntry(raceEntry) : null },
      style: { dateKey: owner.dateKey, theme, submission: styleSubmission ? this.serializeStyleSubmission(styleSubmission) : null },
    };
  }

  async runExpedition(owner: CcgGameOwner, input: ExpeditionInput): Promise<Record<string, unknown>> {
    const idempotencyKey = requireIdempotencyKey(input.idempotencyKey);
    const existing = await CcgGameRun.findOne({ ownerType: owner.ownerType, ownerId: owner.ownerId, mode: "expedition", idempotencyKey }).lean();
    if (existing) return existing.result;
    const cardIds = requireStringArray(input.cardIds, "party", 5);
    if (cardIds.length !== 5) throw new CcgServiceError(400, "invalid_formation", "Expeditions require exactly five active cards");
    const roster = await this.resolveCards(owner, cardIds, true);
    assertFormation(roster, { tank: 1, healer: 1, dps: 3 });
    const route = requireChoice(input.route, ["safe", "score"] as const, "safe", "route");
    const pullSize = requireChoice(input.pullSize, ["small", "standard", "large"] as const, "standard", "pull size");
    const boon = requireChoice(input.boon, ["refreshing-kick", "guardian-echo", "farshot"] as const, "refreshing-kick", "run boon");
    const assignments = parseAssignments(input.assignments, new Set(cardIds));
    const weeklyKey = getWeeklyKey(owner.dateKey);
    const weeklySeed = `raid-director:${weeklyKey}`;
    const enhancedRoster = roster.map((card) => ({ ...card, utilities: [...card.utilities] }));
    if (boon === "refreshing-kick") enhancedRoster.filter((card) => card.utilities.includes("interrupt")).forEach((card) => { card.mechanics = Math.min(100, card.mechanics + 4); });
    if (boon === "guardian-echo") enhancedRoster.filter((card) => card.role === "healer").forEach((card) => { card.performance = Math.min(100, card.performance + 5); });
    if (boon === "farshot") enhancedRoster.filter((card) => card.utilities.includes("ranged")).forEach((card) => { card.performance = Math.min(100, card.performance + 4); });
    const pullModifier = pullSize === "small" ? -3 : pullSize === "large" ? 4 : 0;
    const encounters = CCG_EXPEDITION_ENCOUNTERS.map((encounter, index) => simulateCcgEncounter(encounter, {
      seed: `${weeklySeed}:expedition:${route}:${index}`,
      roster: enhancedRoster,
      assignments,
      difficultyModifier: index < 2 ? pullModifier + (route === "score" ? 2 : -1) : 0,
    }));
    const deaths = encounters.reduce((total, encounter) => total + encounter.deaths, 0);
    const routeTime = route === "safe" ? 55 : -20;
    const pullTime = pullSize === "small" ? 70 : pullSize === "large" ? -45 : 0;
    const durationSeconds = Math.max(1, encounters.reduce((total, encounter) => total + encounter.durationSeconds, 0) + routeTime + pullTime);
    const completed = encounters.every((encounter) => encounter.killed);
    const result = {
      mode: "expedition",
      rulesVersion: CCG_GAME_RULES_VERSION,
      weeklyKey,
      seed: weeklySeed,
      route,
      pullSize,
      boon,
      completed,
      timed: completed && durationSeconds <= EXPEDITION_TIMER_SECONDS,
      keyLevel: 2,
      durationSeconds,
      timerSeconds: EXPEDITION_TIMER_SECONDS,
      deaths,
      score: scoreExpedition(encounters, route, durationSeconds, deaths),
      encounters,
    };
    const run = await this.createRun({
      ownerType: owner.ownerType,
      ownerId: owner.ownerId,
      mode: "expedition",
      idempotencyKey,
      weeklyKey,
      encounterId: "midnight-expedition",
      seed: weeklySeed,
      rosterCardIds: cardIds,
      activeCardIds: cardIds,
      assignments,
      result,
    });
    return run.result;
  }

  async getExpeditionLeaderboard(owner: CcgGameOwner): Promise<Record<string, unknown>> {
    const weeklyKey = getWeeklyKey(owner.dateKey);
    const rows = await CcgGameRun.find({ mode: "expedition", weeklyKey }).sort({ "result.score": -1, createdAt: 1 }).limit(50).lean();
    const bestByOwner = new Map<string, typeof rows[number]>();
    for (const row of rows) {
      const key = `${row.ownerType}:${row.ownerId}`;
      if (!bestByOwner.has(key)) bestByOwner.set(key, row);
    }
    const entries = [...bestByOwner.values()].slice(0, 20);
    const userIds = entries.filter((entry) => entry.ownerType === "user").map((entry) => entry.ownerId);
    const users = await User.find({ _id: { $in: userIds } }).select("discord.username").lean();
    const names = new Map(users.map((user) => [String(user._id), user.discord.username]));
    return {
      weeklyKey,
      entries: entries.map((entry, index) => ({
        rank: index + 1,
        collector: entry.ownerType === "user" ? names.get(String(entry.ownerId)) ?? "Collector" : "Guest collector",
        score: Number((entry.result as Record<string, unknown>).score ?? 0),
        timed: Boolean((entry.result as Record<string, unknown>).timed),
        durationSeconds: Number((entry.result as Record<string, unknown>).durationSeconds ?? 0),
        deaths: Number((entry.result as Record<string, unknown>).deaths ?? 0),
        isMe: entry.ownerType === owner.ownerType && String(entry.ownerId) === String(owner.ownerId),
      })),
    };
  }

  async pullRaid(owner: CcgGameOwner, input: RaidPullInput): Promise<Record<string, unknown>> {
    const idempotencyKey = requireIdempotencyKey(input.idempotencyKey);
    const previous = await CcgGameRun.findOne({ ownerType: owner.ownerType, ownerId: owner.ownerId, mode: "raid", idempotencyKey }).lean();
    if (previous) return previous.result;
    const rosterCardIds = requireStringArray(input.rosterCardIds, "lockout roster", 25);
    const activeCardIds = requireStringArray(input.activeCardIds, "active raid", 20);
    if (rosterCardIds.length < 20 || rosterCardIds.length > 25 || activeCardIds.length !== 20 || activeCardIds.some((id) => !rosterCardIds.includes(id))) {
      throw new CcgServiceError(400, "invalid_raid_roster", "Choose 20 active cards from a lockout roster of 20 to 25 cards");
    }
    const difficulty = requireChoice(input.difficulty, ["story", "normal", "heroic"] as const, "normal", "raid difficulty");
    const allowMercenaries = difficulty !== "heroic";
    const roster = await this.resolveCards(owner, rosterCardIds, allowMercenaries);
    const activeSet = new Set(activeCardIds);
    const activeRoster = roster.filter((card) => activeSet.has(card.id));
    assertFormation(activeRoster, { tank: 2, healer: 4, dps: 14 });
    const assignments = parseAssignments(input.assignments, activeSet);
    const weeklyKey = getWeeklyKey(owner.dateKey);
    let lockout = await CcgRaidLockout.findOne({ ownerType: owner.ownerType, ownerId: owner.ownerId, weeklyKey });
    if (!lockout) {
      lockout = await CcgRaidLockout.create({
        ownerType: owner.ownerType,
        ownerId: owner.ownerId,
        weeklyKey,
        difficulty,
        seed: `raid-director:${weeklyKey}:${owner.ownerType}:${owner.ownerId}`,
        rosterCardIds,
        activeCardIds,
        bossIndex: 0,
        bossKills: [],
        pullCount: 0,
      });
    } else {
      lockout.rosterCardIds = rosterCardIds;
      lockout.activeCardIds = activeCardIds;
      lockout.difficulty = difficulty;
    }
    const encounter = CCG_RAID_ENCOUNTERS[Math.min(lockout.bossIndex, CCG_RAID_ENCOUNTERS.length - 1)];
    if (!encounter || lockout.bossIndex >= CCG_RAID_ENCOUNTERS.length) throw new CcgServiceError(409, "raid_complete", "This week's raid is already complete");
    const pullNumber = lockout.pullCount + 1;
    const seed = `${lockout.seed}:${encounter.id}:pull-${pullNumber}`;
    const difficultyModifier = difficulty === "story" ? -9 : difficulty === "heroic" ? 7 : 0;
    const simulation = simulateCcgEncounter(encounter, { seed, roster: activeRoster, assignments, difficultyModifier });
    lockout.pullCount = pullNumber;
    if (simulation.killed && !lockout.bossKills.includes(encounter.id)) {
      lockout.bossKills.push(encounter.id);
      lockout.bossIndex += 1;
    }
    await lockout.save();
    const result = {
      mode: "raid",
      weeklyKey,
      difficulty,
      pullNumber,
      bossIndex: Math.min(lockout.bossIndex, CCG_RAID_ENCOUNTERS.length),
      bossKills: lockout.bossKills,
      raidComplete: lockout.bossIndex >= CCG_RAID_ENCOUNTERS.length,
      simulation,
    };
    const run = await this.createRun({
      ownerType: owner.ownerType,
      ownerId: owner.ownerId,
      mode: "raid",
      idempotencyKey,
      weeklyKey,
      encounterId: encounter.id,
      seed,
      rosterCardIds,
      activeCardIds,
      assignments,
      result,
    });
    return run.result;
  }

  async enterRace(owner: CcgGameOwner, input: RaidPullInput): Promise<Record<string, unknown>> {
    const idempotencyKey = requireIdempotencyKey(input.idempotencyKey);
    const previous = await CcgRaceEntry.findOne({ ownerType: owner.ownerType, ownerId: owner.ownerId, idempotencyKey });
    if (previous) return this.serializeRaceEntry(previous);
    const activeCardIds = requireStringArray(input.activeCardIds, "race roster", 20);
    if (activeCardIds.length !== 20) throw new CcgServiceError(400, "invalid_formation", "Raid Race requires exactly 20 cards");
    const roster = await this.resolveCards(owner, activeCardIds, false);
    assertFormation(roster, { tank: 2, healer: 4, dps: 14 });
    const rosterCost = getCcgGameRosterCost(roster);
    if (rosterCost > CCG_RACE_ROSTER_BUDGET) throw new CcgServiceError(400, "roster_budget_exceeded", `Raid Race roster cost must be ${CCG_RACE_ROSTER_BUDGET} or lower`);
    const assignments = parseAssignments(input.assignments, new Set(activeCardIds));
    const weeklyKey = getWeeklyKey(owner.dateKey);
    const seed = `raid-director:${weeklyKey}:race`;
    const result = simulateCcgEncounter(CCG_RAID_ENCOUNTERS[0], { seed, roster, assignments, difficultyModifier: 5 });
    let entry: ICcgRaceEntry;
    try {
      entry = await CcgRaceEntry.create({
        ownerType: owner.ownerType,
        ownerId: owner.ownerId,
        weeklyKey,
        idempotencyKey,
        status: "queued",
        rosterCost,
        result,
      });
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      const duplicate = await CcgRaceEntry.findOne({ ownerType: owner.ownerType, ownerId: owner.ownerId, idempotencyKey });
      if (!duplicate) throw error;
      return this.serializeRaceEntry(duplicate);
    }
    const opponent = await CcgRaceEntry.findOneAndUpdate(
      {
        weeklyKey,
        status: "queued",
        _id: { $ne: entry._id },
        $nor: [{ ownerType: owner.ownerType, ownerId: owner.ownerId }],
      },
      { $set: { status: "matched", opponentEntryId: entry._id } },
      { sort: { createdAt: 1 }, returnDocument: "after" },
    );
    if (opponent) {
      const comparison = compareRaceResults(result, opponent.result as Record<string, any>);
      const outcome = comparison < 0 ? "win" : comparison > 0 ? "loss" : "draw";
      entry.status = "matched";
      entry.opponentEntryId = opponent._id;
      entry.outcome = outcome;
      opponent.outcome = outcome === "win" ? "loss" : outcome === "loss" ? "win" : "draw";
      await Promise.all([entry.save(), opponent.save()]);
    }
    return this.serializeRaceEntry(entry);
  }

  private async serializeRaceEntry(entry: Pick<ICcgRaceEntry, "_id" | "status" | "rosterCost" | "result" | "opponentEntryId" | "outcome" | "createdAt">): Promise<Record<string, unknown>> {
    const opponent = entry.opponentEntryId ? await CcgRaceEntry.findById(entry.opponentEntryId).select("result rosterCost createdAt").lean() : null;
    return {
      id: String(entry._id),
      status: entry.status,
      rosterCost: entry.rosterCost,
      result: entry.result,
      outcome: entry.outcome ?? null,
      opponent: opponent ? { rosterCost: opponent.rosterCost, result: opponent.result, submittedAt: opponent.createdAt } : null,
      submittedAt: entry.createdAt,
    };
  }

  async submitStyle(owner: CcgGameOwner, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (typeof input.cardId !== "string" || !mongoose.Types.ObjectId.isValid(input.cardId)) throw new CcgServiceError(400, "invalid_card", "Choose a valid owned card");
    if (typeof input.finish !== "string" || !CCG_FINISH_ORDER.includes(input.finish as CcgFinish)) throw new CcgServiceError(400, "invalid_finish", "Choose a finish you own");
    if (input.artVariant !== "standard" && input.artVariant !== "alternative") throw new CcgServiceError(400, "invalid_artwork", "Choose valid card artwork");
    const card = await CcgCard.findById(input.cardId).select("setId characterId snapshotVersion").lean();
    if (!card) throw new CcgServiceError(404, "card_not_found", "Card not found");
    const [series, finish] = await Promise.all([
      CcgSeriesOwnership.findOne({ ownerType: owner.ownerType, ownerId: owner.ownerId, setId: card.setId, characterId: card.characterId }).select("unlockedSnapshotVersions").lean(),
      CcgOwnership.findOne({ ownerType: owner.ownerType, ownerId: owner.ownerId, setId: card.setId, characterId: card.characterId, finish: input.finish as CcgFinish }).select("alternativeQuantity").lean(),
    ]);
    if (!series?.unlockedSnapshotVersions.includes(card.snapshotVersion) || !finish) throw new CcgServiceError(403, "card_not_owned", "Choose a card and finish you own");
    if (input.artVariant === "alternative" && finish.alternativeQuantity <= 0) throw new CcgServiceError(403, "artwork_not_owned", "Choose artwork you own");
    const theme = getStyleTheme(owner.dateKey);
    const submission = await CcgStyleSubmission.findOneAndUpdate(
      { ownerType: owner.ownerType, ownerId: owner.ownerId, dateKey: owner.dateKey, theme },
      { $set: { cardId: card._id, finish: input.finish as CcgFinish, artVariant: input.artVariant as CcgArtVariant } },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
    );
    if (!submission) throw new CcgServiceError(503, "style_unavailable", "The runway entry could not be saved");
    return this.serializeStyleSubmission(submission);
  }

  async getStylePair(owner: CcgGameOwner): Promise<Record<string, unknown>> {
    const theme = getStyleTheme(owner.dateKey);
    const candidates = await CcgStyleSubmission.find({
      dateKey: owner.dateKey,
      theme,
      $nor: [{ ownerType: owner.ownerType, ownerId: owner.ownerId }],
    }).sort({ createdAt: 1 }).limit(30).lean();
    if (candidates.length < 2) return { theme, pair: null };
    const voted = await CcgStyleVote.find({ voterType: owner.ownerType, voterId: owner.ownerId, dateKey: owner.dateKey }).select("pairKey -_id").lean();
    const votedPairs = new Set(voted.map((vote) => vote.pairKey));
    for (let left = 0; left < candidates.length - 1; left += 1) {
      for (let right = left + 1; right < candidates.length; right += 1) {
        const pair = [candidates[left], candidates[right]].sort((a, b) => String(a._id).localeCompare(String(b._id)));
        const pairKey = `${pair[0]._id}:${pair[1]._id}`;
        if (!votedPairs.has(pairKey)) return { theme, pairKey, pair: pair.map((entry) => this.serializeStyleSubmission(entry)) };
      }
    }
    return { theme, pair: null };
  }

  async voteStyle(owner: CcgGameOwner, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    const submissionIds = requireStringArray(input.submissionIds, "runway pair", 2);
    if (submissionIds.length !== 2 || submissionIds.some((id) => !mongoose.Types.ObjectId.isValid(id)) || typeof input.winnerSubmissionId !== "string" || !submissionIds.includes(input.winnerSubmissionId)) {
      throw new CcgServiceError(400, "invalid_style_vote", "Choose one of the two runway entries");
    }
    const theme = getStyleTheme(owner.dateKey);
    const submissions = await CcgStyleSubmission.find({ _id: { $in: submissionIds }, dateKey: owner.dateKey, theme }).lean();
    if (submissions.length !== 2) throw new CcgServiceError(404, "style_pair_not_found", "This runway pair is no longer available");
    if (submissions.some((entry) => entry.ownerType === owner.ownerType && String(entry.ownerId) === String(owner.ownerId))) {
      throw new CcgServiceError(403, "self_vote_not_allowed", "You cannot vote for your own runway entry");
    }
    const pair = [...submissions].sort((a, b) => String(a._id).localeCompare(String(b._id)));
    const pairKey = `${pair[0]._id}:${pair[1]._id}`;
    const winner = submissions.find((entry) => String(entry._id) === input.winnerSubmissionId)!;
    const loser = submissions.find((entry) => String(entry._id) !== input.winnerSubmissionId)!;
    try {
      await CcgStyleVote.create({
        voterType: owner.ownerType,
        voterId: owner.ownerId,
        dateKey: owner.dateKey,
        theme,
        pairKey,
        winnerSubmissionId: winner._id,
        loserSubmissionId: loser._id,
      });
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      throw new CcgServiceError(409, "style_pair_already_voted", "You already voted on this runway pair");
    }
    return { accepted: true };
  }

  async getStyleLeaderboard(owner: CcgGameOwner): Promise<Record<string, unknown>> {
    const theme = getStyleTheme(owner.dateKey);
    const votes = await CcgStyleVote.find({ dateKey: owner.dateKey, theme }).select("winnerSubmissionId loserSubmissionId -_id").lean();
    const scores = new Map<string, { wins: number; votes: number }>();
    for (const vote of votes) {
      const winner = String(vote.winnerSubmissionId);
      const loser = String(vote.loserSubmissionId);
      scores.set(winner, { wins: (scores.get(winner)?.wins ?? 0) + 1, votes: (scores.get(winner)?.votes ?? 0) + 1 });
      scores.set(loser, { wins: scores.get(loser)?.wins ?? 0, votes: (scores.get(loser)?.votes ?? 0) + 1 });
    }
    const eligibleIds = [...scores].filter(([, score]) => score.votes >= 3).map(([id]) => new mongoose.Types.ObjectId(id));
    const submissions = eligibleIds.length > 0 ? await CcgStyleSubmission.find({ _id: { $in: eligibleIds } }).lean() : [];
    const entries = submissions.map((submission) => {
      const score = scores.get(String(submission._id))!;
      return { ...this.serializeStyleSubmission(submission), wins: score.wins, votes: score.votes, winRate: score.wins / score.votes };
    }).sort((left, right) => right.winRate - left.winRate || right.wins - left.wins).slice(0, 10);
    return { theme, minimumVotes: 3, entries };
  }

  private serializeStyleSubmission(submission: { _id: unknown; cardId: unknown; finish: CcgFinish; artVariant: CcgArtVariant }): Record<string, unknown> {
    return { id: String(submission._id), cardId: String(submission.cardId), finish: submission.finish, artVariant: submission.artVariant };
  }
}

export default new CcgGameService();
