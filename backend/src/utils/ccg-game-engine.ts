import { createHash } from "crypto";

export const CCG_GAME_RULES_VERSION = "raid-director-v1";

export type CcgGameRole = "tank" | "healer" | "dps";
export type CcgGameStrategy = "safe" | "standard" | "aggressive";
export type CcgGameUtility =
  | "interrupt"
  | "ranged_interrupt"
  | "dispel"
  | "battle_resurrection"
  | "heroism"
  | "mobility"
  | "raid_defensive"
  | "external_defensive"
  | "immunity"
  | "crowd_control"
  | "melee"
  | "ranged"
  | "burst"
  | "sustained";

export type CcgGameCard = {
  id: string;
  identityId: string;
  name: string;
  role: CcgGameRole;
  classID: number;
  specName: string;
  performance: number;
  mechanics: number;
  mythicPlus: number;
  tierGrade: string;
  utilities: CcgGameUtility[];
  mercenary?: boolean;
};

export type CcgGameAssignments = {
  interruptCardIds?: string[];
  dispelCardId?: string | null;
  soakCardIds?: string[];
  heroismPhase?: string | null;
  defensivePhase?: string | null;
  strategy?: CcgGameStrategy;
};

export type CcgGameCheckType =
  | "damage"
  | "healing"
  | "tank"
  | "execution"
  | "interrupt"
  | "dispel"
  | "soak"
  | "movement"
  | "adds"
  | "composition"
  | "enrage";

export type CcgGameCheck = {
  id: string;
  type: CcgGameCheckType;
  label: string;
  difficulty: number;
  requiredCount?: number;
  requiredUtility?: CcgGameUtility;
  lethal?: number;
};

export type CcgGamePhase = {
  id: string;
  label: string;
  healthShare: number;
  checks: CcgGameCheck[];
};

export type CcgGameEncounter = {
  id: string;
  name: string;
  version: string;
  baseDurationSeconds: number;
  phases: CcgGamePhase[];
};

export type CcgGameCheckResult = {
  id: string;
  type: CcgGameCheckType;
  label: string;
  passed: boolean;
  contribution: number;
  utilityBonus: number;
  assignmentBonus: number;
  strategyBonus: number;
  die: number;
  dieModifier: number;
  total: number;
  difficulty: number;
  margin: number;
  deaths: number;
  explanation: string;
};

export type CcgGamePhaseResult = {
  id: string;
  label: string;
  checks: CcgGameCheckResult[];
  bossHealthBefore: number;
  bossHealthAfter: number;
  deaths: number;
  battleResurrections: number;
  durationSeconds: number;
};

export type CcgGameSimulationResult = {
  rulesVersion: string;
  encounterId: string;
  encounterVersion: string;
  seed: string;
  killed: boolean;
  bossHealthRemaining: number;
  durationSeconds: number;
  deaths: number;
  battleResurrections: number;
  failedChecks: number;
  phaseReached: string;
  phases: CcgGamePhaseResult[];
  suggestions: string[];
};

type SimulationOptions = {
  seed: string;
  roster: CcgGameCard[];
  assignments?: CcgGameAssignments;
  difficultyModifier?: number;
};

const GRADE_COST: Readonly<Record<string, number>> = {
  H: 7,
  S: 7,
  A: 6,
  B: 5,
  C: 4,
  D: 3,
  E: 2,
  F: 1,
};

const RANGED_SPECS = new Set([
  "arcane", "beast mastery", "balance", "demonology", "destruction", "devastation", "discipline",
  "elemental", "fire", "frost", "holy", "marksmanship", "preservation", "restoration", "shadow",
  "affliction", "augmentation",
]);

const BURST_SPECS = new Set([
  "arcane", "assassination", "beast mastery", "devastation", "elemental", "fire", "frost",
  "havoc", "marksmanship", "retribution", "subtlety", "unholy", "windwalker",
]);

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function average(values: number[], fallback = 50): number {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : fallback;
}

function createSeededRandom(seed: string): () => number {
  let state = createHash("sha256").update(seed).digest().readUInt32LE(0) || 0x6d2b79f5;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function getCcgGameGradeCost(grade: string): number {
  return GRADE_COST[grade] ?? 4;
}

export function getCcgGameRosterCost(roster: ReadonlyArray<Pick<CcgGameCard, "tierGrade" | "mercenary">>): number {
  return roster.reduce((total, card) => total + (card.mercenary ? 4 : getCcgGameGradeCost(card.tierGrade)), 0);
}

export function resolveCcgGameUtilities(card: Pick<CcgGameCard, "classID" | "specName" | "role">): CcgGameUtility[] {
  const utilities = new Set<CcgGameUtility>();
  const spec = card.specName.trim().toLowerCase();
  const ranged = card.role === "healer" || RANGED_SPECS.has(spec) || [3, 5, 8, 9, 13].includes(card.classID);
  utilities.add(ranged ? "ranged" : "melee");
  utilities.add(BURST_SPECS.has(spec) ? "burst" : "sustained");

  if (![5].includes(card.classID) || spec === "shadow") utilities.add("interrupt");
  if (ranged && [3, 7, 8, 9, 13].includes(card.classID)) utilities.add("ranged_interrupt");
  if ([2, 5, 7, 8, 10, 11, 13].includes(card.classID)) utilities.add("dispel");
  if ([6, 9, 11].includes(card.classID)) utilities.add("battle_resurrection");
  if ([3, 7, 8, 13].includes(card.classID)) utilities.add("heroism");
  if ([3, 4, 10, 11, 12, 13].includes(card.classID)) utilities.add("mobility");
  if ([2, 5, 7, 10].includes(card.classID)) utilities.add("raid_defensive");
  if ([2, 5, 10, 11].includes(card.classID)) utilities.add("external_defensive");
  if ([2, 3, 4, 8, 12].includes(card.classID)) utilities.add("immunity");
  if ([1, 3, 4, 7, 8, 9, 10, 11, 12, 13].includes(card.classID)) utilities.add("crowd_control");
  return [...utilities];
}

function hasUtility(card: CcgGameCard, utility: CcgGameUtility): boolean {
  return card.utilities.includes(utility);
}

function chooseAssignedCards(roster: CcgGameCard[], ids: string[] | undefined): CcgGameCard[] {
  if (!ids?.length) return [];
  const selected = new Set(ids);
  return roster.filter((card) => selected.has(card.id));
}

function getStrategyBonus(type: CcgGameCheckType, strategy: CcgGameStrategy): number {
  if (strategy === "safe") {
    if (["healing", "tank", "execution", "movement", "soak", "dispel"].includes(type)) return 4;
    if (["damage", "adds", "enrage"].includes(type)) return -4;
  }
  if (strategy === "aggressive") {
    if (["damage", "adds", "enrage"].includes(type)) return 5;
    if (["healing", "tank", "execution", "movement", "soak"].includes(type)) return -4;
  }
  return 0;
}

function getCheckInputs(
  check: CcgGameCheck,
  roster: CcgGameCard[],
  assignments: CcgGameAssignments,
  phaseId: string,
): { contribution: number; utilityBonus: number; assignmentBonus: number } {
  const tanks = roster.filter((card) => card.role === "tank");
  const healers = roster.filter((card) => card.role === "healer");
  const damage = roster.filter((card) => card.role === "dps");
  const mechanics = roster.map((card) => card.mechanics);
  let contribution = 0;
  let utilityBonus = 0;
  let assignmentBonus = 0;

  switch (check.type) {
    case "damage":
    case "enrage":
      contribution = average([
        ...damage.map((card) => card.performance),
        ...tanks.map((card) => card.performance * 0.6),
        ...healers.map((card) => card.performance * 0.25),
      ]);
      utilityBonus = roster.some((card) => hasUtility(card, "burst")) ? 2 : 0;
      break;
    case "healing":
      contribution = average(healers.map((card) => card.performance * 0.72 + card.mechanics * 0.28));
      utilityBonus = Math.min(6, roster.filter((card) => hasUtility(card, "raid_defensive")).length * 2);
      assignmentBonus = assignments.defensivePhase === phaseId && utilityBonus > 0 ? 6 : 0;
      break;
    case "tank":
      contribution = average(tanks.map((card) => card.performance * 0.35 + card.mechanics * 0.65));
      utilityBonus = Math.min(6, roster.filter((card) => hasUtility(card, "external_defensive")).length * 2);
      assignmentBonus = assignments.defensivePhase === phaseId && utilityBonus > 0 ? 4 : 0;
      break;
    case "execution":
      contribution = average(mechanics);
      utilityBonus = roster.some((card) => hasUtility(card, "immunity")) ? 3 : 0;
      break;
    case "movement":
      contribution = average(mechanics);
      utilityBonus = Math.min(8, roster.filter((card) => hasUtility(card, "mobility")).length * 2);
      break;
    case "interrupt": { 
      const assigned = chooseAssignedCards(roster, assignments.interruptCardIds);
      const capable = assigned.filter((card) => hasUtility(card, "interrupt"));
      contribution = average((capable.length > 0 ? capable : roster.filter((card) => hasUtility(card, "interrupt"))).map((card) => card.mechanics), 20);
      utilityBonus = Math.min(10, roster.filter((card) => hasUtility(card, "interrupt")).length * 2);
      assignmentBonus = capable.length >= (check.requiredCount ?? 1) ? 8 : capable.length * 2 - 8;
      break;
    }
    case "dispel": {
      const dispeller = roster.find((card) => card.id === assignments.dispelCardId && hasUtility(card, "dispel"));
      contribution = dispeller?.mechanics ?? average(roster.filter((card) => hasUtility(card, "dispel")).map((card) => card.mechanics), 20);
      utilityBonus = roster.some((card) => hasUtility(card, "dispel")) ? 5 : -10;
      assignmentBonus = dispeller ? 8 : -5;
      break;
    }
    case "soak": {
      const assigned = chooseAssignedCards(roster, assignments.soakCardIds);
      contribution = average((assigned.length > 0 ? assigned : roster).map((card) => card.mechanics));
      const required = check.requiredCount ?? 1;
      assignmentBonus = assigned.length >= required ? 8 : -Math.min(16, (required - assigned.length) * 4);
      utilityBonus = Math.min(5, assigned.filter((card) => hasUtility(card, "immunity")).length * 2.5);
      break;
    }
    case "adds":
      contribution = average(damage.map((card) => card.performance * 0.72 + card.mechanics * 0.28));
      utilityBonus = Math.min(8, roster.filter((card) => hasUtility(card, check.requiredUtility ?? "crowd_control")).length * 2);
      break;
    case "composition": {
      const required = check.requiredCount ?? 1;
      const count = roster.filter((card) => hasUtility(card, check.requiredUtility ?? "ranged")).length;
      contribution = average(mechanics);
      utilityBonus = count >= required ? 8 : -Math.min(16, (required - count) * 4);
      break;
    }
  }

  if ((check.type === "damage" || check.type === "enrage" || check.type === "adds") && assignments.heroismPhase === phaseId) {
    const hasHeroism = roster.some((card) => hasUtility(card, "heroism"));
    assignmentBonus += hasHeroism ? 8 : 0;
    utilityBonus += hasHeroism ? 3 : 0;
  }
  return { contribution, utilityBonus, assignmentBonus };
}

function checkExplanation(check: CcgGameCheck, passed: boolean, total: number, difficulty: number): string {
  const result = passed ? "passed" : "failed";
  return `${check.label} ${result}: ${round(total)} against ${round(difficulty)}.`;
}

function suggestionFor(check: CcgGameCheck): string {
  switch (check.type) {
    case "interrupt": return "interrupt_assignment";
    case "dispel": return "dispel_assignment";
    case "soak": return `soak_${check.requiredCount ?? 1}`;
    case "movement": return "movement_roster";
    case "healing": return "healing_cooldown";
    case "tank": return "tank_defensive";
    case "damage":
    case "adds":
    case "enrage": return "throughput_timing";
    case "composition": return `composition_${check.requiredUtility ?? "required"}`;
    default: return "mechanics_strategy";
  }
}

export function simulateCcgEncounter(encounter: CcgGameEncounter, options: SimulationOptions): CcgGameSimulationResult {
  const random = createSeededRandom(`${CCG_GAME_RULES_VERSION}:${encounter.version}:${options.seed}`);
  const assignments: CcgGameAssignments = { strategy: "standard", ...options.assignments };
  const strategy = assignments.strategy ?? "standard";
  const difficultyModifier = options.difficultyModifier ?? 0;
  const alive = new Set(options.roster.map((card) => card.id));
  let bossHealth = 100;
  let totalDeaths = 0;
  let totalBattleResurrections = 0;
  let battleResAvailable = options.roster.some((card) => hasUtility(card, "battle_resurrection"));
  let elapsed = 0;
  const phases: CcgGamePhaseResult[] = [];

  for (const phase of encounter.phases) {
    const phaseRoster = options.roster.filter((card) => alive.has(card.id));
    if (phaseRoster.length === 0) break;
    const healthBefore = bossHealth;
    const checks: CcgGameCheckResult[] = [];
    let phaseDeaths = 0;
    let phaseResurrections = 0;

    for (const check of phase.checks) {
      const currentRoster = options.roster.filter((card) => alive.has(card.id));
      const inputs = getCheckInputs(check, currentRoster, assignments, phase.id);
      const die = 1 + Math.floor(random() * 20);
      const dieModifier = (die - 10.5) * 0.55;
      const strategyBonus = getStrategyBonus(check.type, strategy);
      const aliveRatio = currentRoster.length / Math.max(1, options.roster.length);
      const cascadePenalty = (1 - aliveRatio) * (check.type === "damage" || check.type === "enrage" ? 34 : 18);
      const difficulty = check.difficulty + difficultyModifier;
      const total = inputs.contribution + inputs.utilityBonus + inputs.assignmentBonus + strategyBonus + dieModifier - cascadePenalty;
      const resolvedTotal = round(total);
      const resolvedDifficulty = round(difficulty);
      const passed = resolvedTotal >= resolvedDifficulty;
      const margin = resolvedTotal - resolvedDifficulty;
      let deaths = 0;

      if (!passed && (check.lethal ?? 0) > 0) {
        const severity = Math.max(1, Math.ceil(Math.abs(margin) / 12));
        deaths = Math.min(currentRoster.length, Math.max(1, Math.min(check.lethal ?? 1, severity)));
        const candidates = currentRoster
          .map((card) => ({ card, survivalRoll: card.mechanics + random() * 20 }))
          .sort((left, right) => left.survivalRoll - right.survivalRoll || left.card.id.localeCompare(right.card.id))
          .map(({ card }) => card);
        for (const card of candidates.slice(0, deaths)) alive.delete(card.id);
        totalDeaths += deaths;
        phaseDeaths += deaths;
        if (battleResAvailable && alive.size > 0 && deaths > 0) {
          const resurrected = candidates[0];
          alive.add(resurrected.id);
          battleResAvailable = false;
          totalBattleResurrections += 1;
          phaseResurrections += 1;
        }
      }

      checks.push({
        id: check.id,
        type: check.type,
        label: check.label,
        passed,
        contribution: round(inputs.contribution),
        utilityBonus: round(inputs.utilityBonus),
        assignmentBonus: round(inputs.assignmentBonus),
        strategyBonus: round(strategyBonus),
        die,
        dieModifier: round(dieModifier),
        total: resolvedTotal,
        difficulty: resolvedDifficulty,
        margin: round(margin),
        deaths,
        explanation: checkExplanation(check, passed, total, difficulty),
      });
    }

    const damageChecks = checks.filter((check) => ["damage", "adds", "enrage"].includes(check.type));
    const damageRatio = damageChecks.length > 0
      ? average(damageChecks.map((check) => clamp(check.total / Math.max(1, check.difficulty), 0.35, 1.12)), 0.55)
      : clamp(average(checks.map((check) => check.total / Math.max(1, check.difficulty)), 0.8), 0.45, 1.05);
    const phaseDamage = phase.healthShare * damageRatio;
    bossHealth = clamp(bossHealth - phaseDamage, 0, 100);
    const failureSeconds = checks.filter((check) => !check.passed).length * 12;
    const phaseDuration = Math.round(encounter.baseDurationSeconds * (phase.healthShare / 100) / clamp(damageRatio, 0.45, 1.1) + failureSeconds);
    elapsed += phaseDuration;
    phases.push({
      id: phase.id,
      label: phase.label,
      checks,
      bossHealthBefore: round(healthBefore),
      bossHealthAfter: round(bossHealth),
      deaths: phaseDeaths,
      battleResurrections: phaseResurrections,
      durationSeconds: phaseDuration,
    });

    if (alive.size === 0) break;
  }

  const finalPhase = phases[phases.length - 1];
  const finalChecks = finalPhase?.checks ?? [];
  const completedAllPhases = phases.length === encounter.phases.length;
  const finalPassed = finalChecks.every((check) => check.passed || !["enrage", "damage", "healing", "tank"].includes(check.type));
  const killed = completedAllPhases && bossHealth <= 2.5 && alive.size > 0 && finalPassed;
  if (killed) bossHealth = 0;
  const failed = phases.flatMap((phase) => phase.checks).filter((check) => !check.passed);
  const suggestions = [...failed]
    .sort((left, right) => left.margin - right.margin)
    .slice(0, 2)
    .map((result) => {
      const config = encounter.phases.flatMap((phase) => phase.checks).find((check) => check.id === result.id);
      return config ? suggestionFor(config) : "Adjust the roster and try again.";
    });

  return {
    rulesVersion: CCG_GAME_RULES_VERSION,
    encounterId: encounter.id,
    encounterVersion: encounter.version,
    seed: options.seed,
    killed,
    bossHealthRemaining: round(bossHealth),
    durationSeconds: elapsed + totalDeaths * 15,
    deaths: totalDeaths,
    battleResurrections: totalBattleResurrections,
    failedChecks: failed.length,
    phaseReached: finalPhase?.label ?? encounter.phases[0]?.label ?? encounter.name,
    phases,
    suggestions: suggestions.length > 0 ? suggestions : ["hold_plan"],
  };
}

export const CCG_EXPEDITION_ENCOUNTERS: readonly CcgGameEncounter[] = [
  {
    id: "shrouded-causeway",
    name: "Shrouded Causeway",
    version: "1",
    baseDurationSeconds: 145,
    phases: [{
      id: "causeway",
      label: "The patrol",
      healthShare: 100,
      checks: [
        { id: "causeway-damage", type: "damage", label: "Patrol throughput", difficulty: 54 },
        { id: "causeway-interrupt", type: "interrupt", label: "Shadow Volley interrupt", difficulty: 55, requiredCount: 1, lethal: 1 },
        { id: "causeway-movement", type: "movement", label: "Veiled ground", difficulty: 52, lethal: 1 },
      ],
    }],
  },
  {
    id: "echoing-gallery",
    name: "Echoing Gallery",
    version: "1",
    baseDurationSeconds: 175,
    phases: [{
      id: "gallery",
      label: "The double pull",
      healthShare: 100,
      checks: [
        { id: "gallery-adds", type: "adds", label: "Echoing attendants", difficulty: 58, requiredUtility: "crowd_control" },
        { id: "gallery-healing", type: "healing", label: "Resonant damage", difficulty: 56, lethal: 1 },
        { id: "gallery-interrupt", type: "interrupt", label: "Resonance interrupt order", difficulty: 58, requiredCount: 2, lethal: 1 },
      ],
    }],
  },
  {
    id: "midnight-falls-dungeon",
    name: "Midnight Falls",
    version: "1",
    baseDurationSeconds: 270,
    phases: [
      {
        id: "fractured-light",
        label: "Fractured Light",
        healthShare: 34,
        checks: [
          { id: "dungeon-tank", type: "tank", label: "Fractured tank swap", difficulty: 57, lethal: 1 },
          { id: "dungeon-soak", type: "soak", label: "Twin light soak", difficulty: 56, requiredCount: 2, lethal: 1 },
        ],
      },
      {
        id: "void-choir",
        label: "Void Choir",
        healthShare: 33,
        checks: [
          { id: "dungeon-choir", type: "interrupt", label: "Void Choir interrupt", difficulty: 60, requiredCount: 2, lethal: 1 },
          { id: "dungeon-dispel", type: "dispel", label: "Unmaking dispel", difficulty: 57, lethal: 1 },
          { id: "dungeon-move", type: "movement", label: "Collapsing lanes", difficulty: 58, lethal: 1 },
        ],
      },
      {
        id: "sunwell-collapse",
        label: "Sunwell Collapse",
        healthShare: 33,
        checks: [
          { id: "dungeon-heal", type: "healing", label: "Sunwell collapse", difficulty: 60, lethal: 1 },
          { id: "dungeon-enrage", type: "enrage", label: "Midnight enrage", difficulty: 61 },
        ],
      },
    ],
  },
];

export const CCG_RAID_ENCOUNTERS: readonly CcgGameEncounter[] = [
  {
    id: "midnight-falls",
    name: "Midnight Falls",
    version: "1",
    baseDurationSeconds: 430,
    phases: [
      {
        id: "fractured-light",
        label: "Fractured Light",
        healthShare: 34,
        checks: [
          { id: "raid-tanks", type: "tank", label: "Fractured tank order", difficulty: 60, lethal: 2 },
          { id: "raid-soaks", type: "soak", label: "Four-way light soak", difficulty: 61, requiredCount: 4, lethal: 3 },
          { id: "raid-heal-one", type: "healing", label: "Radiant aftermath", difficulty: 58, lethal: 2 },
        ],
      },
      {
        id: "void-choir",
        label: "Void Choir",
        healthShare: 33,
        checks: [
          { id: "raid-interrupts", type: "interrupt", label: "Alternating Choir interrupts", difficulty: 64, requiredCount: 4, lethal: 3 },
          { id: "raid-dispel", type: "dispel", label: "Priority Unmaking dispel", difficulty: 61, lethal: 2 },
          { id: "raid-ranged", type: "composition", label: "Ranged constellation", difficulty: 58, requiredUtility: "ranged", requiredCount: 7 },
          { id: "raid-move", type: "movement", label: "Void lane movement", difficulty: 62, lethal: 3 },
        ],
      },
      {
        id: "sunwell-collapse",
        label: "Sunwell Collapse",
        healthShare: 33,
        checks: [
          { id: "raid-heal-two", type: "healing", label: "Sunwell collapse", difficulty: 65, lethal: 3 },
          { id: "raid-execution", type: "execution", label: "Final constellation", difficulty: 63, lethal: 3 },
          { id: "raid-enrage", type: "enrage", label: "Midnight enrage", difficulty: 65 },
        ],
      },
    ],
  },
  {
    id: "crown-of-cinders",
    name: "Crown of Cinders",
    version: "1",
    baseDurationSeconds: 465,
    phases: [
      {
        id: "ashen-court",
        label: "The Ashen Court",
        healthShare: 36,
        checks: [
          { id: "cinders-adds", type: "adds", label: "Cinderbound court", difficulty: 63, requiredUtility: "crowd_control", lethal: 2 },
          { id: "cinders-tank", type: "tank", label: "Molten crown swap", difficulty: 62, lethal: 2 },
          { id: "cinders-dispel", type: "dispel", label: "Searing brand dispel", difficulty: 62, lethal: 2 },
        ],
      },
      {
        id: "ember-maze",
        label: "Ember Maze",
        healthShare: 31,
        checks: [
          { id: "cinders-move", type: "movement", label: "Ember maze", difficulty: 65, lethal: 3 },
          { id: "cinders-soak", type: "soak", label: "Falling star soaks", difficulty: 64, requiredCount: 6, lethal: 3 },
          { id: "cinders-heal", type: "healing", label: "Scorching pulse", difficulty: 64, lethal: 3 },
        ],
      },
      {
        id: "last-light",
        label: "Last Light",
        healthShare: 33,
        checks: [
          { id: "cinders-interrupt", type: "interrupt", label: "Crown ignition", difficulty: 66, requiredCount: 4, lethal: 4 },
          { id: "cinders-execution", type: "execution", label: "Ashfall spread", difficulty: 65, lethal: 3 },
          { id: "cinders-enrage", type: "enrage", label: "Cinder enrage", difficulty: 67 },
        ],
      },
    ],
  },
];
