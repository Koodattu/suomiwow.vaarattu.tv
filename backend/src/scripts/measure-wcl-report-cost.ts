import dotenv from "dotenv";
import mongoose from "mongoose";
import Report from "../models/Report";
import Fight from "../models/Fight";
import wclService from "../services/warcraftlogs.service";

dotenv.config();

type RateLimitData = {
  limitPerHour: number;
  pointsSpentThisHour: number;
  pointsResetIn: number;
};

type QueryResult = {
  label: string;
  before: RateLimitData;
  after: RateLimitData;
  cost: number;
  summary: Record<string, unknown>;
};

type MeasuredQueryResult<T> = QueryResult & {
  value: T;
};

type ReportFight = {
  id: number;
  encounterID: number;
  name?: string;
  difficulty?: number;
  kill?: boolean;
};

const RATE_LIMIT_PROBE_COST = 1;

function getArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match?.slice(prefix.length);
}

function uniqueNumbers(values: Array<number | undefined | null>): number[] {
  return Array.from(new Set(values.filter((value): value is number => typeof value === "number" && Number.isFinite(value)))).sort((a, b) => a - b);
}

async function getRateLimit(label: string): Promise<RateLimitData> {
  const query = `
    query {
      rateLimitData {
        limitPerHour
        pointsSpentThisHour
        pointsResetIn
      }
    }
  `;

  const result = await wclService.query<{ rateLimitData: RateLimitData }>(query);
  if (!result.rateLimitData) {
    throw new Error(`Missing rateLimitData for ${label}`);
  }
  return result.rateLimitData;
}

async function measure<T>(
  label: string,
  query: string,
  variables: Record<string, unknown>,
  summarize: (result: T) => Record<string, unknown>,
): Promise<MeasuredQueryResult<T>> {
  const before = await getRateLimit(`${label}:before`);
  const result = await wclService.query<T>(query, variables);
  const after = await getRateLimit(`${label}:after`);

  const queryResult = {
    label,
    before,
    after,
    cost: after.pointsSpentThisHour - before.pointsSpentThisHour - RATE_LIMIT_PROBE_COST,
    summary: summarize(result),
  } as MeasuredQueryResult<T>;

  Object.defineProperty(queryResult, "value", {
    value: result,
    enumerable: false,
  });

  return queryResult;
}

async function findReportCode(cliReportCode?: string): Promise<string> {
  if (cliReportCode) return cliReportCode;

  const fight = await Fight.findOne({
    difficulty: 5,
    isKill: true,
  })
    .sort({ timestamp: -1 })
    .select("reportCode")
    .lean();

  if (fight?.reportCode) return fight.reportCode;

  const report = await Report.findOne({ fightCount: { $gt: 0 } }).sort({ startTime: -1 }).select("code").lean();
  if (report?.code) return report.code;

  throw new Error("No stored report found in MongoDB. Pass --report=<WCL report code> to measure a specific report.");
}

async function main(): Promise<void> {
  const mongoUri = getArg("mongo") || process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/wow_guild_tracker";
  await mongoose.connect(mongoUri);

  const reportCode = await findReportCode(getArg("report"));
  const storedReport = await Report.findOne({ code: reportCode }).lean();
  const storedFights = await Fight.find({ reportCode }).sort({ fightId: 1 }).select("fightId encounterID difficulty isKill").lean();
  const storedFightIds = uniqueNumbers(storedFights.map((fight) => fight.fightId));
  const requestedFightId = Number(getArg("fightId")) || undefined;

  const reportFightsQuery = `
    query($reportCode: String!) {
      rateLimitData {
        limitPerHour
        pointsSpentThisHour
        pointsResetIn
      }
      reportData {
        report(code: $reportCode) {
          code
          startTime
          endTime
          phases {
            encounterID
            separatesWipes
            phases {
              id
              name
              isIntermission
            }
          }
          fights(killType: Encounters) {
            id
            encounterID
            name
            difficulty
            kill
            bossPercentage
            fightPercentage
            startTime
            endTime
            phaseTransitions {
              id
              startTime
            }
          }
        }
      }
    }
  `;

  const reportWithCharactersQuery = `
    query($reportCode: String!) {
      rateLimitData {
        limitPerHour
        pointsSpentThisHour
        pointsResetIn
      }
      reportData {
        report(code: $reportCode) {
          code
          startTime
          endTime
          rankedCharacters {
            canonicalID
            name
            classID
            hidden
            server {
              slug
              region {
                slug
              }
            }
            guilds {
              name
              server {
                slug
                region {
                  slug
                }
              }
            }
          }
          phases {
            encounterID
            separatesWipes
            phases {
              id
              name
              isIntermission
            }
          }
          fights(killType: Encounters) {
            id
            encounterID
            name
            difficulty
            kill
            bossPercentage
            fightPercentage
            startTime
            endTime
            phaseTransitions {
              id
              startTime
            }
          }
        }
      }
    }
  `;

  const charactersOnlyQuery = `
    query($reportCode: String!) {
      rateLimitData {
        limitPerHour
        pointsSpentThisHour
        pointsResetIn
      }
      reportData {
        report(code: $reportCode) {
          code
          rankedCharacters {
            canonicalID
            name
            classID
            hidden
            server {
              slug
              region {
                slug
              }
            }
            guilds {
              name
              server {
                slug
                region {
                  slug
                }
              }
            }
          }
        }
      }
    }
  `;

  const backendGetFightCharactersShapeQuery = `
    query($reportCode: String!, $fightId: Int!) {
      rateLimitData {
        limitPerHour
        pointsSpentThisHour
        pointsResetIn
      }
      reportData {
        report(code: $reportCode) {
          rankedCharacters {
            canonicalID
            name
            classID
            hidden
            server {
              slug
              region {
                slug
              }
            }
            guilds {
              name
              server {
                slug
                region {
                  slug
                }
              }
            }
          }
          fights(fightIDs: [$fightId]) {
            id
            encounterID
            name
            difficulty
            kill
          }
        }
      }
    }
  `;

  const deathEventsQuery = `
    query($reportCode: String!, $fightIds: [Int]!, $limit: Int!) {
      rateLimitData {
        limitPerHour
        pointsSpentThisHour
        pointsResetIn
      }
      reportData {
        report(code: $reportCode) {
          code
          startTime
          masterData {
            actors(type: "Player") {
              id
              name
              server
            }
          }
          events(
            fightIDs: $fightIds,
            dataType: Deaths,
            hostilityType: Friendlies,
            limit: $limit
          ) {
            data
          }
        }
      }
    }
  `;

  const results: QueryResult[] = [];
  const reportFightsResult = await measure<any>("report fights + phases (backend getReportByCodeAllDifficulties)", reportFightsQuery, { reportCode }, (result) => {
    const report = result.reportData?.report;
    return {
      fightCount: report?.fights?.length ?? 0,
      phaseEncounterCount: report?.phases?.length ?? 0,
    };
  });
  results.push(reportFightsResult);

  const reportFights: ReportFight[] = reportFightsResult.value.reportData?.report?.fights ?? [];
  const reportFightIds = uniqueNumbers(reportFights.map((fight) => fight.id));
  const firstFightId = requestedFightId || reportFightIds[0];

  if (!firstFightId) {
    throw new Error(`Report ${reportCode} has no WCL encounter fights.`);
  }
  results.push(
    await measure<any>("same report query + rankedCharacters", reportWithCharactersQuery, { reportCode }, (result) => {
      const report = result.reportData?.report;
      return {
        fightCount: report?.fights?.length ?? 0,
        rankedCharacterCount: report?.rankedCharacters?.length ?? 0,
      };
    }),
  );
  results.push(
    await measure<any>("rankedCharacters only for report", charactersOnlyQuery, { reportCode }, (result) => {
      const report = result.reportData?.report;
      return {
        rankedCharacterCount: report?.rankedCharacters?.length ?? 0,
      };
    }),
  );
  results.push(
    await measure<any>(
      "current backend getFightCharacters shape (rankedCharacters + one filtered fight)",
      backendGetFightCharactersShapeQuery,
      { reportCode, fightId: firstFightId },
      (result) => {
        const report = result.reportData?.report;
        return {
          requestedFightId: firstFightId,
          returnedFightIds: (report?.fights ?? []).map((fight: { id: number }) => fight.id),
          rankedCharacterCount: report?.rankedCharacters?.length ?? 0,
        };
      },
    ),
  );

  if (reportFightIds.length > 0) {
    results.push(
      await measure<any>(
        "death events for all WCL encounter fights in report (backend getDeathEventsForReport)",
        deathEventsQuery,
        { reportCode, fightIds: reportFightIds, limit: 10000 },
        (result) => {
          const report = result.reportData?.report;
          return {
            requestedFightCount: reportFightIds.length,
            actorCount: report?.masterData?.actors?.length ?? 0,
            deathEventCount: report?.events?.data?.length ?? 0,
          };
        },
      ),
    );
  }

  const perFightLimit = Math.max(0, Number(getArg("perFightLimit")) || reportFightIds.length);
  const perFightIds = reportFightIds.slice(0, perFightLimit);
  const perFightResults: QueryResult[] = [];

  for (const fightId of perFightIds) {
    const fight = reportFights.find((item) => item.id === fightId);
    perFightResults.push(
      await measure<any>(`per-fight death events: fight ${fightId}`, deathEventsQuery, { reportCode, fightIds: [fightId], limit: 10000 }, (result) => {
        const report = result.reportData?.report;
        return {
          fightId,
          encounterID: fight?.encounterID,
          name: fight?.name,
          difficulty: fight?.difficulty,
          kill: fight?.kill,
          actorCount: report?.masterData?.actors?.length ?? 0,
          deathEventCount: report?.events?.data?.length ?? 0,
        };
      }),
    );

    perFightResults.push(
      await measure<any>(`per-fight current character query shape: fight ${fightId}`, backendGetFightCharactersShapeQuery, { reportCode, fightId }, (result) => {
        const report = result.reportData?.report;
        return {
          fightId,
          encounterID: fight?.encounterID,
          name: fight?.name,
          difficulty: fight?.difficulty,
          kill: fight?.kill,
          returnedFightIds: (report?.fights ?? []).map((returnedFight: { id: number }) => returnedFight.id),
          rankedCharacterCount: report?.rankedCharacters?.length ?? 0,
        };
      }),
    );
  }

  const totalWholeReportCost = results.reduce((sum, result) => sum + result.cost, 0);
  const totalPerFightCost = perFightResults.reduce((sum, result) => sum + result.cost, 0);

  const output = {
    reportCode,
    selectedFromMongo: !getArg("report"),
    storedReport: storedReport
      ? {
          zoneId: storedReport.zoneId,
          fightCount: storedReport.fightCount,
          startTime: storedReport.startTime,
          endTime: storedReport.endTime,
        }
      : null,
    storedFightCount: storedFightIds.length,
    wclEncounterFightCount: reportFightIds.length,
    measuredAt: new Date().toISOString(),
    note: "cost uses standalone probes immediately before and after each measured query; the one-point before-probe charge is excluded",
    totals: {
      wholeReportMeasuredCost: totalWholeReportCost,
      perFightMeasuredCost: totalPerFightCost,
      perFightMeasuredFightCount: perFightIds.length,
    },
    results,
    perFightResults,
  };

  console.log(JSON.stringify(output, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await mongoose.disconnect();
  });
