import fixture from "./turtles-ulatek-pulls.json";

export function turtlesPulls() {
  return fixture.rows.map(([report, fightId, timestamp, duration, bossPercentage, fightPercentage, kill, roster, complete]) => ({
    reportCode: fixture.reports[report], fightId, timestamp: new Date(timestamp),
    reportStartTime: timestamp, fightStartTime: 0, fightEndTime: duration,
    duration, bossPercentage, fightPercentage, isKill: !!kill,
    guildId: "69078debcac26f9ef1008fe6", zoneId: 53, encounterID: 3492, difficulty: 5,
    encounterName: "Ula'tek", combatantInfoRosterComplete: !!complete,
    combatants: Array.from({ length: fixture.rosterSizes[roster] }, (_, index) => ({ name: `Roster${roster}Player${index}`, server: "Test Realm" })),
  }));
}
