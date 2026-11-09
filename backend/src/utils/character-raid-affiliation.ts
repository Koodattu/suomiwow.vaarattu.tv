import { areEquivalentRealms } from "./realm";

const DAY_MS = 24 * 60 * 60 * 1000;
const RAID_DAY_START_MS = 6 * 60 * 60 * 1000;
const RECENT_GUILD_NIGHTS = 6;

export type RaidAttendanceEvidence = {
  startedAt: Date;
  mythic: boolean;
  guilds: { name: string; realm: string }[];
};

export type RaidAffiliationInput = {
  reportGuildId: unknown;
  reportGuildName: string;
  reportGuildRealm: string;
  attendanceEvidence: RaidAttendanceEvidence[];
};

export type RaidAffiliation = {
  raidNightCount: number;
  mythicNightCount: number;
  affiliationQualifiedAt: Date | null;
};

// EU evening raids and uploads after midnight belong to the same raid night.
export function raidNight(date: Date): number {
  return Math.floor((new Date(date).getTime() - RAID_DAY_START_MS) / DAY_MS);
}

/** Evaluate one tier at a time. Preserve qualification earned earlier in the tier. */
export function qualifyRaidAffiliations(rows: readonly RaidAffiliationInput[]): RaidAffiliation[] {
  const guildNights = new Map<string, Set<number>>();
  const evidence = rows.map((row) => {
    const nights = new Map<number, { mythic: boolean; member: boolean }>();
    const guildKey = String(row.reportGuildId);
    const calendar = guildNights.get(guildKey) ?? new Set<number>();
    for (const report of row.attendanceEvidence) {
      const night = raidNight(report.startedAt);
      const existing = nights.get(night);
      const member = (report.guilds ?? []).some((guild) =>
        guild.name.trim().toLowerCase() === row.reportGuildName.trim().toLowerCase()
        && areEquivalentRealms(guild.realm, row.reportGuildRealm),
      );
      nights.set(night, { mythic: Boolean(existing?.mythic || report.mythic), member: Boolean(existing?.member || member) });
      calendar.add(night);
    }
    guildNights.set(guildKey, calendar);
    return nights;
  });
  const calendars = new Map(Array.from(guildNights, ([guild, nights]) => [guild, [...nights].sort((a, b) => a - b)]));

  return rows.map((row, index) => {
    const nights = evidence[index];
    const attended = [...nights.keys()].sort((a, b) => a - b);
    const calendar = calendars.get(String(row.reportGuildId)) ?? [];
    let qualification: number | null = null;
    let memberSeen = false;
    for (let i = 0; i < attended.length; i += 1) {
      const night = attended[i];
      memberSeen ||= nights.get(night)!.member;
      if (i < 1) continue;
      // A character-guild snapshot corroborates repeated attendance, never a single visit.
      if (memberSeen) {
        qualification = night;
        break;
      }
      if (i < 2 || night - attended[0] < 7) continue;
      // Opportunities before a late recruit's first appearance are irrelevant.
      const recent = calendar.filter((day) => day >= attended[0] && day <= night).slice(-RECENT_GUILD_NIGHTS);
      if (recent.filter((day) => nights.has(day)).length * 2 >= recent.length) {
        qualification = night;
        break;
      }
    }
    return {
      raidNightCount: attended.length,
      mythicNightCount: [...nights.values()].filter((night) => night.mythic).length,
      affiliationQualifiedAt: qualification === null ? null : new Date(qualification * DAY_MS + RAID_DAY_START_MS),
    };
  });
}
