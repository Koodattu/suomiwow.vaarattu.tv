import Fight, { IFight } from "../models/Fight";
import characterService from "./character.service";
import { createRealmIdentityKey } from "../utils/realm";

type Identity = { characterName: string; characterRealm: string; rankingFightIds: number[] };
type DeathFight = Pick<IFight, "reportCode" | "fightId" | "duration" | "fightStartTime" | "fightEndTime" | "timestamp" | "isKill" | "deaths" | "combatants" | "deathEventsFetchStatus" | "phaseTransitions" | "combatantInfoRosterComplete" | "combatantInfoFetchStatus">;
const actorKey = (name: string, realm: string) => `${name.trim().toLocaleLowerCase("en-US")}:${createRealmIdentityKey(realm)}`;

export function summarizeCharacterDeaths(fights: DeathFight[], appearances: Map<string, Identity[]>, page = 1) {
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
    if (fight.deathEventsFetchStatus !== "fetched") continue;
    evaluatedPulls++;
    if (!characterDeaths.length) continue;
    pullsWithDeaths++;
    firstDeathTimeTotal += characterDeaths[0].deathTime;

    const rosterComplete = fight.combatantInfoRosterComplete === true || (fight.combatantInfoRosterComplete === undefined && fight.combatantInfoFetchStatus === "fetched" && !!fight.combatants?.length);
    const roster = new Set((fight.combatants ?? []).map((actor) => actorKey(actor.name, actor.server)));
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
      events.push({
        reportCode: fight.reportCode, fightId: fight.fightId, date: new Date(fight.timestamp).toISOString(), isKill: fight.isKill,
        deathTime: death.deathTime, duration, deathPercent,
        order: orderAt(death),
        phase: phase ? (phase.name ?? String(phase.id)) : null,
      });
    }
  }
  events.sort((a, b) => b.date.localeCompare(a.date) || b.fightId - a.fightId || a.deathTime - b.deathTime);
  const totalPages = Math.max(1, Math.ceil(events.length / 50));
  const currentPage = Math.min(page, totalPages);
  return {
    summary: { pulls, evaluatedPulls, unconfirmedPulls, pullsWithDeaths, survivedPulls: evaluatedPulls - pullsWithDeaths, deaths: events.length, firstThreePulls, averageFirstDeathTime: pullsWithDeaths ? firstDeathTimeTotal / pullsWithDeaths : null },
    timing,
    events: events.slice((currentPage - 1) * 50, currentPage * 50),
    pagination: { currentPage, totalPages, totalItems: events.length },
  };
}

export async function getCharacterDeaths(input: { realm: string; name: string; classId: number; region: string; zoneId: number; encounterId: number; difficulty: number; outcome: "all" | "kills" | "wipes"; page: number }) {
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
  return summarizeCharacterDeaths(fights, appearances, input.page);
}
