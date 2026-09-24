import Fight, { IFight } from "../models/Fight";
import characterService from "./character.service";
import { createRealmIdentityKey } from "../utils/realm";

type Identity = { characterName: string; characterRealm: string; rankingFightIds: number[] };
type DeathFight = Pick<IFight, "reportCode" | "fightId" | "duration" | "fightStartTime" | "fightEndTime" | "timestamp" | "isKill" | "deaths" | "combatants" | "deathEventsFetchStatus" | "phaseTransitions" | "combatantInfoRosterComplete" | "combatantInfoFetchStatus">;
const actorKey = (name: string, realm: string) => `${name.trim().toLocaleLowerCase("en-US")}:${createRealmIdentityKey(realm)}`;

const SORT_FIELDS = ["date", "isKill", "deathTime", "deathPercent", "duration", "order", "phase"] as const;
type DeathEventOptions = {
  orderFilter?: "all" | "first" | "firstThree" | "later" | "unknown";
  timingFilter?: "all" | "0" | "1" | "2" | "3";
  phaseFilter?: string;
  sortBy?: typeof SORT_FIELDS[number];
  sortDirection?: "asc" | "desc";
};

export function parseDeathEventOptions(query: Record<string, unknown>): DeathEventOptions | null {
  const { orderFilter = "all", timingFilter = "all", phaseFilter = "all", sortBy = "date", sortDirection = "desc" } = query;
  if (typeof orderFilter !== "string" || !["all", "first", "firstThree", "later", "unknown"].includes(orderFilter)
    || typeof timingFilter !== "string" || !["all", "0", "1", "2", "3"].includes(timingFilter)
    || typeof phaseFilter !== "string" || phaseFilter.length > 200 || !(phaseFilter === "all" || phaseFilter === "unknown" || (phaseFilter.startsWith("phase:") && phaseFilter.length > 6))
    || typeof sortBy !== "string" || !SORT_FIELDS.includes(sortBy as typeof SORT_FIELDS[number])
    || (sortDirection !== "asc" && sortDirection !== "desc")) return null;
  return { orderFilter, timingFilter, phaseFilter, sortBy, sortDirection } as DeathEventOptions;
}

export function summarizeCharacterDeaths(fights: DeathFight[], appearances: Map<string, Identity[]>, page = 1, options: DeathEventOptions = {}) {
  let pulls = 0;
  let evaluatedPulls = 0;
  let pullsWithDeaths = 0;
  let firstThreePulls = 0;
  let unconfirmedPulls = 0;
  let firstDeathTimeTotal = 0;
  const timing = [0, 0, 0, 0];
  const events: Array<{
    reportCode: string; fightId: number; date: string; isKill: boolean;
    deathTime: number; duration: number; deathPercent: number; order: number | null; phase: string | null;
  }> = [];
  const timeline: Array<{
    reportCode: string; fightId: number; date: string; duration: number; isKill: boolean;
    complete: boolean; rosterComplete: boolean;
    deaths: Array<{ deathTime: number; order: number | null; phase: string | null }>;
    otherDeathTimes: number[];
    phases: Array<{ time: number; name: string }>;
  }> = [];
  const seen = new Set<string>();
  for (const fight of fights) {
    const fightKey = `${fight.reportCode}:${fight.fightId}`;
    if (seen.has(fightKey)) continue;
    seen.add(fightKey);
    const identities = appearances.get(fight.reportCode) ?? [];
    const keys = new Set(identities.map((identity) => actorKey(identity.characterName, identity.characterRealm)));
    const matches = (actor: { name: string; server: string }) => keys.has(actorKey(actor.name, actor.server));
    const duration = fight.fightEndTime - fight.fightStartTime;
    if (duration <= 0 || !Number.isFinite(duration)) continue;
    const deaths = (fight.deaths ?? []).filter((death) => Number.isFinite(death.deathTime) && death.deathTime >= 0 && death.deathTime <= duration).sort((a, b) => a.deathTime - b.deathTime);
    const characterDeaths = deaths.filter(matches);
    // A report appearance alone does not prove participation in every pull.
    if (!(fight.combatants ?? []).some(matches) && !characterDeaths.length && !identities.some((identity) => identity.rankingFightIds.includes(fight.fightId))) {
      unconfirmedPulls++;
      continue;
    }
    pulls++;
    const rosterComplete = fight.combatantInfoRosterComplete === true || (fight.combatantInfoRosterComplete === undefined && fight.combatantInfoFetchStatus === "fetched" && !!fight.combatants?.length);
    const roster = new Set((fight.combatants ?? []).map((actor) => actorKey(actor.name, actor.server)));
    const pull: typeof timeline[number] = {
      reportCode: fight.reportCode, fightId: fight.fightId, date: new Date(fight.timestamp).toISOString(), duration, isKill: fight.isKill,
      complete: fight.deathEventsFetchStatus === "fetched", rosterComplete, deaths: [],
      otherDeathTimes: fight.deathEventsFetchStatus === "fetched" ? deaths.filter((death) => !matches(death) && roster.has(actorKey(death.name, death.server))).map((death) => death.deathTime) : [],
      phases: (fight.phaseTransitions ?? []).map((phase) => ({ time: phase.startTime - fight.fightStartTime, name: phase.name ?? String(phase.id) }))
        .filter((phase) => Number.isFinite(phase.time) && phase.time >= 0 && phase.time <= duration).sort((a, b) => a.time - b.time),
    };
    timeline.push(pull);
    if (fight.deathEventsFetchStatus !== "fetched") continue;
    evaluatedPulls++;
    if (!characterDeaths.length) continue;
    pullsWithDeaths++;
    firstDeathTimeTotal += characterDeaths[0].deathTime;

    const firstDeaths = new Map<string, number>();
    for (const death of deaths) {
      const key = actorKey(death.name, death.server);
      if (roster.has(key) && !firstDeaths.has(key)) firstDeaths.set(key, death.deathTime);
    }
    // Simultaneous deaths share an order; repeated deaths do not advance it.
    const orderAt = (death: { name: string; server: string; deathTime: number }) => {
      const firstTime = firstDeaths.get(actorKey(death.name, death.server));
      return rosterComplete && firstTime !== undefined ? 1 + [...firstDeaths.values()].filter((time) => time < firstTime).length : null;
    };
    const firstOrder = orderAt(characterDeaths[0]);
    if (firstOrder !== null && firstOrder <= 3) firstThreePulls++;
    for (const death of characterDeaths) {
      const deathPercent = death.deathTime / duration * 100;
      timing[Math.min(3, Math.floor(deathPercent / 25))]++;
      const phase = [...(fight.phaseTransitions ?? [])].sort((a, b) => a.startTime - b.startTime).filter((transition) => transition.startTime <= death.timestamp).pop();
      pull.deaths.push({ deathTime: death.deathTime, order: orderAt(death), phase: phase ? (phase.name ?? String(phase.id)) : null });
      events.push({
        reportCode: fight.reportCode, fightId: fight.fightId, date: new Date(fight.timestamp).toISOString(), isKill: fight.isKill,
        deathTime: death.deathTime, duration, deathPercent,
        order: orderAt(death),
        phase: phase ? (phase.name ?? String(phase.id)) : null,
      });
    }
  }
  const eventOptions = {
    phases: [...new Set(events.flatMap((event) => event.phase === null ? [] : [event.phase]))].sort((a, b) => a.localeCompare(b, "en", { numeric: true })),
    hasUnknownPhase: events.some((event) => event.phase === null),
  };
  const filteredEvents = events.filter((event) => {
    if (options.orderFilter === "first" && event.order !== 1) return false;
    if (options.orderFilter === "firstThree" && (event.order === null || event.order > 3)) return false;
    if (options.orderFilter === "later" && (event.order === null || event.order <= 3)) return false;
    if (options.orderFilter === "unknown" && event.order !== null) return false;
    if (options.timingFilter && options.timingFilter !== "all" && Math.min(3, Math.floor(event.deathPercent / 25)) !== Number(options.timingFilter)) return false;
    if (options.phaseFilter === "unknown" && event.phase !== null) return false;
    if (options.phaseFilter?.startsWith("phase:") && event.phase !== options.phaseFilter.slice(6)) return false;
    return true;
  });
  const sortBy = options.sortBy ?? "date";
  const direction = options.sortDirection === "asc" ? 1 : -1;
  filteredEvents.sort((a, b) => {
    const left = a[sortBy];
    const right = b[sortBy];
    // Unknown values remain last in either direction.
    if (left === null && right !== null) return 1;
    if (right === null && left !== null) return -1;
    const comparison = typeof left === "string" && typeof right === "string"
      ? left.localeCompare(right, "en", { numeric: true }) : Number(left) - Number(right);
    return direction * comparison || b.date.localeCompare(a.date) || b.fightId - a.fightId || a.reportCode.localeCompare(b.reportCode) || a.deathTime - b.deathTime;
  });
  const totalPages = Math.max(1, Math.ceil(filteredEvents.length / 50));
  const currentPage = Math.min(page, totalPages);
  return {
    summary: { pulls, evaluatedPulls, unconfirmedPulls, pullsWithDeaths, survivedPulls: evaluatedPulls - pullsWithDeaths, deaths: events.length, firstThreePulls, averageFirstDeathTime: pullsWithDeaths ? firstDeathTimeTotal / pullsWithDeaths : null },
    timing,
    timeline: timeline.sort((a, b) => a.date.localeCompare(b.date) || a.reportCode.localeCompare(b.reportCode) || a.fightId - b.fightId),
    eventOptions,
    events: filteredEvents.slice((currentPage - 1) * 50, currentPage * 50),
    pagination: { currentPage, totalPages, totalItems: filteredEvents.length },
  };
}

export async function getCharacterDeaths(input: { realm: string; name: string; classId: number; region: string; zoneId: number; encounterId: number; difficulty: number; outcome: "all" | "kills" | "wipes"; page: number; eventOptions?: DeathEventOptions }) {
  const rows = await characterService.getDeathAnalysisAppearances(input.realm, input.name, input.classId, input.region);
  const appearances = new Map<string, Identity[]>();
  for (const row of rows) appearances.set(row.reportCode, [...(appearances.get(row.reportCode) ?? []), row]);
  const reportCodes = [...appearances.keys()];
  const fights: DeathFight[] = [];
  for (let offset = 0; offset < reportCodes.length; offset += 200) {
    const batch = await Fight.find({
      reportCode: { $in: reportCodes.slice(offset, offset + 200) },
      zoneId: input.zoneId, encounterID: input.encounterId, difficulty: input.difficulty,
      ...(input.outcome === "all" ? {} : { isKill: input.outcome === "kills" }),
    }).select("reportCode fightId duration fightStartTime fightEndTime timestamp isKill deaths combatants deathEventsFetchStatus phaseTransitions combatantInfoRosterComplete combatantInfoFetchStatus").lean();
    fights.push(...batch);
  }
  return summarizeCharacterDeaths(fights, appearances, input.page, input.eventOptions);
}
