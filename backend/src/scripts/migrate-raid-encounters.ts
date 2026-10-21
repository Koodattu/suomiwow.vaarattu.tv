/** Run with writers stopped. Dry-run is the default; see docs/raid-encounter-migration.md. */
import mongoose from "mongoose";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import User from "../models/User";
import Pickem from "../models/Pickem";
import Guild from "../models/Guild";
import Raid from "../models/Raid";
import Fight from "../models/Fight";
import Report from "../models/Report";
import Cache from "../models/Cache";
import { RAID_ENCOUNTERS, isMainEncounter, raidLairs } from "../config/raid-encounters";

import { buildLairRecoveryFights } from "../utils/raid-encounter-recovery";

const RAID_ID = 53;
const args = process.argv.slice(2);
const option = (name: string) => args.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
type Snapshot = { capturedAt: string; guilds: Record<string, { progression: any; rankings: any } | null> };

async function findMissingLairReports() {
  const ids = raidLairs(RAID_ID).map(lair => lair.id);
  const reports = await Report.find({ "fightSequence.encounterID": { $in: ids } }).select("code guildId startTime fightSequence").lean();
  const missing = [];
  for (const source of reports) {
    const stored = new Set((await Fight.find({ reportCode: source.code, encounterID: { $in: ids } }).select("fightId").lean()).map(fight => fight.fightId));
    const fightIds = source.fightSequence?.filter(fight => ids.includes(fight.encounterID) && [3, 4, 5].includes(fight.difficulty) && !stored.has(fight.fightId)).map(fight => fight.fightId) ?? [];
    if (fightIds.length) missing.push({ source, fightIds });
  }
  return missing;
}

async function predictionFingerprint() {
  const definitions = await Pickem.find().sort({ _id: 1 }).lean();
  const submissions = await User.find({ "pickems.0": { $exists: true } }).select("_id pickems").sort({ _id: 1 }).lean();
  return createHash("sha256").update(JSON.stringify({ definitions, submissions })).digest("hex");
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("Set MONGODB_URI explicitly; this script does not load .env files.");
  const apply = args.includes("--apply");
  if (apply && !args.includes("--writers-stopped")) throw new Error("Stop API/worker writers first, then pass --writers-stopped.");
  const capturePath = option("capture-rio");
  const captureWclPath = option("capture-wcl");
  const snapshotPath = option("rio-snapshot");
  const reportPath = option("report");
  const wclPath = option("wcl-snapshot");
  if (!capturePath && !captureWclPath && (!snapshotPath || !reportPath)) throw new Error("Supply --capture-rio=FILE, or --rio-snapshot=FILE --report=FILE [--apply --writers-stopped].");
  await mongoose.connect(uri, { autoIndex: false, maxPoolSize: 3 });
  const raid = await Raid.findOne({ id: RAID_ID });
  if (!raid) throw new Error("Raid 53 is missing.");
  const guilds = await Guild.find().sort({ _id: 1 });

  if (capturePath) {
    const snapshot: Snapshot = { capturedAt: new Date().toISOString(), guilds: {} };
    for (const guild of guilds) {
      const relevantSlugs = new Set([raid.slug, raid.rioSlug, "the-venomous-abyss", ...raidLairs(RAID_ID).map(lair => lair.rioSlug)]);
      if (!guild.progress.some(progress => progress.raidId === RAID_ID) && !guild.officialProgress?.some(entry => relevantSlugs.has(entry.raidTierSlug))) {
        snapshot.guilds[String(guild._id)] = null;
        continue;
      }
      const url = new URL("https://raider.io/api/v1/guilds/profile");
      url.search = new URLSearchParams({ region: guild.region.toLowerCase(), realm: guild.realm.toLowerCase().replace(/\s+/g, "-"), name: guild.name, fields: "raid_progression,raid_rankings" }).toString();
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      const body: any = await response.json();
      if (response.status === 404 || (response.status === 400 && body.message === "Could not find requested guild")) snapshot.guilds[String(guild._id)] = null;
      else {
        if (!response.ok) throw new Error(`RIO capture failed (${response.status}) for ${guild.name}; nothing was written to MongoDB.`);
        const profile: any = body;
        if (!profile.raid_progression) throw new Error(`RIO returned no progression for ${guild.name}.`);
        snapshot.guilds[String(guild._id)] = { progression: profile.raid_progression, rankings: profile.raid_rankings };
      }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    await writeFile(capturePath, JSON.stringify(snapshot), { flag: "wx" });
    console.log(`Captured ${Object.values(snapshot.guilds).filter(Boolean).length} public RIO profiles for ${guilds.length} guild records. No database changes.`);
    return;
  }

  if (captureWclPath) {
    const { default: wcl } = await import("../services/warcraftlogs.service");
    const captured: Record<string, any> = {};
    for (const { source } of await findMissingLairReports()) {
      const response = await wcl.getReportByCodeAllDifficulties(source.code);
      const result = response.reportData?.report;
      if (!result) throw new Error(`WCL report unavailable: ${source.code}`);
      captured[source.code] = { code: result.code, startTime: result.startTime, endTime: result.endTime, phases: result.phases,
        fights: result.fights.filter((fight: any) => raidLairs(RAID_ID).some(lair => lair.id === fight.encounterID)) };
    }
    await writeFile(captureWclPath, JSON.stringify({ capturedAt: new Date().toISOString(), reports: captured }), { flag: "wx" });
    console.log(`Captured ${Object.keys(captured).length} WCL reports; no raid records changed.`);
    return;
  }

  const snapshot: Snapshot = JSON.parse(await readFile(snapshotPath!, "utf8"));
  const { default: guildService } = await import("../services/guild.service");
  const { buildRankingsFromCachedProgress } = await import("../routes/pickems");
  const pickemRankings = () => buildRankingsFromCachedProgress(new Map([[RAID_ID, guilds.filter(g => !g.excludedRaidIds?.includes(RAID_ID)).map(g => g.toObject())]]), [RAID_ID]);
  const protectedPredictionHash = await predictionFingerprint();
  const beforePickem = await pickemRankings();
  const before = new Map(guilds.map(guild => [String(guild._id), guild.progress.filter(p => p.raidId === RAID_ID).map(p => ({ difficulty: p.difficulty, killed: p.bossesDefeated, total: p.totalBosses, rank: p.guildRank }))]));
  const report: any = { mode: apply ? "apply" : "dry-run", raidId: RAID_ID, rioCapturedAt: snapshot.capturedAt, guilds: [], missingReports: [], pickemBefore: beforePickem };

  // Identify skipped encounters without inventing missing fight details or changing source records.
  const wclSnapshot = wclPath ? JSON.parse(await readFile(wclPath, "utf8")) : null;
  const recoveredFights: any[] = [];
  const { default: wclService } = await import("../services/warcraftlogs.service");
  for (const { source, fightIds } of await findMissingLairReports()) {
      report.missingReports.push({ code: source.code, guildId: String(source.guildId), fightIds });
      if (wclSnapshot) {
        const captured = wclSnapshot.reports[source.code];
        for (const recovered of buildLairRecoveryFights(RAID_ID, source, captured, fightIds)) {
          const raw = captured.fights.find((fight: any) => fight.id === recovered.fightId);
          const phase = wclService.determinePhaseInfo(raw, captured.phases ?? []);
          recoveredFights.push({ ...recovered, lastPhaseId: phase.lastPhase?.phaseId, lastPhaseName: phase.lastPhase?.phaseName,
            progressDisplay: phase.progressDisplay, phaseTransitions: raw.phaseTransitions?.map((transition: any) => ({
              ...transition, name: captured.phases?.find((encounter: any) => encounter.encounterID === recovered.encounterID)?.phases?.find((entry: any) => entry.id === transition.id)?.name,
            })) });
        }
      }
  }

  report.recoveryReady = recoveredFights.length;
  if (apply && report.missingReports.length && !wclSnapshot) throw new Error("Capture the missing WCL reports and supply --wcl-snapshot before applying.");

  const affectedIds = new Set((await Fight.distinct("guildId", { zoneId: RAID_ID })).map(String));
  for (const guild of guilds) if (guild.progress.some(p => p.raidId === RAID_ID) || guild.officialProgress?.some(p => p.raidTierSlug === raid.slug)) affectedIds.add(String(guild._id));
  for (const guild of guilds) {
    const id = String(guild._id);
    if (!affectedIds.has(id)) continue;
    if (!(id in snapshot.guilds)) throw new Error(`RIO snapshot is missing guild ${guild.name}; capture it again.`);
    const profile = snapshot.guilds[id];
    const oldOfficial = guild.officialProgress?.find(entry => entry.raidTierSlug === raid.slug);
    await guildService.calculateGuildStatistics(guild, RAID_ID, { createEvents: false, recalculateSchedule: false, queueVodLinks: false });
    if (!profile && oldOfficial) {
      // A 404 cannot establish which of an old combined total were main bosses.
      for (const difficulty of ["mythic", "heroic"] as const) {
        const oldKills = difficulty === "mythic" ? oldOfficial.mythicBossesKilled : oldOfficial.heroicBossesKilled;
        const loggedKills = guild.progress.find(p => p.raidId === RAID_ID && p.difficulty === difficulty)?.bossesDefeated ?? 0;
        if (oldKills > loggedKills) throw new Error(`Cannot safely recover official ${difficulty} progress for ${guild.name} from a RIO 404. Resolve this before applying.`);
      }
    }
    guildService.reconcileRaidOfficialProgress(guild, raid, profile?.progression ?? {}, profile?.rankings);
    for (const progress of guild.progress.filter(p => p.raidId === RAID_ID)) {
      assert.equal(progress.totalBosses, RAID_ENCOUNTERS[RAID_ID].main.length);
      assert(progress.bosses.every(boss => isMainEncounter(RAID_ID, boss.bossId)));
      assert(progress.bossesDefeated <= progress.totalBosses);
    }
  }
  await guildService.calculateGuildRankingsForRaid(RAID_ID, guilds);
  report.pickemAfter = await pickemRankings();
  for (const guild of guilds) report.guilds.push({ id: String(guild._id), name: guild.name, realm: guild.realm, before: before.get(String(guild._id)), after: guild.progress.filter(p => p.raidId === RAID_ID).map(p => ({ difficulty: p.difficulty, killed: p.bossesDefeated, total: p.totalBosses, rank: p.guildRank })) });
  await writeFile(reportPath!, JSON.stringify(report, null, 2));
  if (!apply) {
    console.log(`Dry-run complete: ${guilds.length} guilds; ${report.missingReports.length} reports need encounter recovery. No database writes.`);
    return;
  }

  // Add only missing source fights. Never rewrite existing fights or predictions/cards.
  if (recoveredFights.length) {
    await Fight.bulkWrite(recoveredFights.map(fight => ({ updateOne: {
      filter: { reportCode: fight.reportCode, fightId: fight.fightId }, update: { $setOnInsert: fight }, upsert: true,
    } })));
    for (const guild of guilds.filter(g => recoveredFights.some(fight => String(fight.guildId) === String(g._id)))) {
      await guildService.calculateGuildStatistics(guild, RAID_ID, { createEvents: false, recalculateSchedule: false, queueVodLinks: false });
      const profile = snapshot.guilds[String(guild._id)];
      guildService.reconcileRaidOfficialProgress(guild, raid, profile?.progression ?? {}, profile?.rankings);
    }
    await guildService.calculateGuildRankingsForRaid(RAID_ID, guilds);
    assert.deepEqual(await pickemRankings(), report.pickemAfter, "Recovered lair fights changed main Pick'em inputs");
  }
  for (const guild of guilds.filter(g => affectedIds.has(String(g._id)))) await Guild.updateOne({ _id: guild._id }, { $set: { progress: guild.progress, lairProgress: guild.lairProgress, officialProgress: guild.officialProgress } });
  for (const lair of raidLairs(RAID_ID)) if (!raid.bosses.some(boss => boss.id === lair.id)) raid.bosses.push({ id: lair.id, name: lair.name, slug: lair.slug });
  await raid.save();
  // Derived builders load their own inputs; release embedded historical pull arrays first.
  guilds.length = 0;

  const { default: characterService } = await import("../services/character.service");
  const { default: mechanicsService } = await import("../services/character-mechanics.service");
  const { default: characterTierListService } = await import("../services/character-tierlist.service");
  const { default: raidAnalyticsService } = await import("../services/raid-analytics.service");
  const { default: tierListService } = await import("../services/tierlist.service");
  await characterService.rebuildCharacterRaidParticipations({ reconcileIdentities: false });
  await characterService.buildCharacterLeaderboards();
  const mechanics = await mechanicsService.buildMechanicsLeaderboards([RAID_ID]);
  if (mechanics.zones.some(zone => zone.status !== "built")) throw new Error("Mechanics rebuild was skipped; keep writers stopped and resolve coverage before resuming.");
  await characterTierListService.rebuildCharacterTierLists([RAID_ID]);
  if (!await raidAnalyticsService.calculateRaidAnalytics(RAID_ID)) throw new Error("Raid analytics rebuild failed.");
  await tierListService.calculateTierLists();
  await Cache.deleteMany({ key: /^(home:|progress:|guild:|guilds:|raids:|raid:|pickems:|tierlists:|characters:|compare:|character-tierlists:|raid-analytics:)/ });
  assert.equal(await predictionFingerprint(), protectedPredictionHash, "Pick’em definitions or submitted predictions changed");
  report.predictionsPreserved = true;
  report.completedAt = new Date().toISOString();
  report.mechanics = mechanics;
  await writeFile(reportPath!, JSON.stringify(report, null, 2));
  console.log("Migration and derived-data rebuild complete. Review the report before restarting writers.");
}

main().catch(error => { console.error(error instanceof Error ? error.message : "Migration failed"); process.exitCode = 1; }).finally(async () => { await mongoose.disconnect(); });
