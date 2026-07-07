import dotenv from "dotenv";
import mongoose from "mongoose";
import Character from "../models/Character";
import CharacterMythicPlusDungeonRun from "../models/CharacterMythicPlusDungeonRun";
import CharacterMythicPlusSeasonScore from "../models/CharacterMythicPlusSeasonScore";
import mythicPlusService from "../services/mythic-plus.service";

(dotenv.config as (options?: { quiet?: boolean }) => void)({ quiet: true });

function getArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match?.slice(prefix.length);
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function parseStringList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeRealm(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "-");
}

async function loadNamedCharacters(tokens: string[]) {
  const characters = [];
  for (const token of tokens) {
    const [realmPart, namePart] = token.includes("/") ? token.split("/", 2) : token.split("-", 2).reverse();
    if (!realmPart || !namePart) {
      throw new Error(`Invalid character token "${token}". Use realm/name, e.g. argent-dawn/Yksin.`);
    }

    const realm = normalizeRealm(realmPart);
    const nameRegex = new RegExp(`^${namePart.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
    const realmRegex = new RegExp(`^${realm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
    const character = await Character.findOne({
      name: nameRegex,
      realm: realmRegex,
    })
      .collation({ locale: "en", strength: 2 })
      .select("_id wclCanonicalCharacterId name realm region classID guildName guildRealm lastMythicSeenAt")
      .sort({ lastMythicSeenAt: -1, lastReportSeenAt: -1 })
      .lean();

    if (character) characters.push(character);
  }
  return characters;
}

async function loadSampleCharacters(sampleSize: number) {
  return Character.find({ wclProfileHidden: { $ne: true } })
    .select("_id wclCanonicalCharacterId name realm region classID guildName guildRealm lastMythicSeenAt")
    .sort({ lastMythicSeenAt: -1, lastReportSeenAt: -1 })
    .limit(sampleSize)
    .lean();
}

async function main(): Promise<void> {
  const mongoUri = getArg("mongo") || process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/wow_guild_tracker";
  const sampleSize = Math.max(1, Number(getArg("sample") || 4));
  const requestedMaxJobs = Number(getArg("maxJobs") || 0);
  const maxJobs = Number.isFinite(requestedMaxJobs) && requestedMaxJobs > 0 ? requestedMaxJobs : sampleSize * 25;
  const namedTokens = parseStringList(getArg("characters") || getArg("character"));
  const skipStatic = hasFlag("skipStatic");

  await mongoose.connect(mongoUri);

  const namedCharacters = await loadNamedCharacters(namedTokens);
  const sampleCharacters = namedCharacters.length > 0 ? [] : await loadSampleCharacters(sampleSize);
  const characters = [...namedCharacters, ...sampleCharacters];

  if (characters.length === 0) {
    throw new Error("No test characters found in MongoDB");
  }

  if (!skipStatic) {
    const staticResult = await mythicPlusService.syncStaticData();
    console.log(`Static data synced: ${staticResult.seasons} seasons, ${staticResult.dungeons} dungeons`);
  }

  const characterIds = characters.map((character: any) => String(character._id));
  const enqueue = await mythicPlusService.enqueueProfileJobs({ characterIds, refresh: true });
  const processed = await mythicPlusService.processPendingJobs({ maxJobs });

  const [scoreRows, runRows] = await Promise.all([
    CharacterMythicPlusSeasonScore.find({ characterId: { $in: characterIds } })
      .select("characterId name realm season scores bestSpecName bestSpecScore fetchedAt -_id")
      .sort({ name: 1, season: 1 })
      .lean(),
    CharacterMythicPlusDungeonRun.find({ characterId: { $in: characterIds }, bucket: "all" })
      .select("characterId name realm season dungeonName mythicLevel score completedAt -_id")
      .sort({ name: 1, season: 1, dungeonName: 1 })
      .lean(),
  ]);

  const output = {
    generatedAt: new Date().toISOString(),
    options: {
      mongoUri: mongoUri.replace(/\/\/([^:@]+):([^@]+)@/, "//$1:***@"),
      sampleSize,
      namedTokens,
      maxJobs,
      skipStatic,
    },
    characters: characters.map((character: any) => ({
      id: String(character._id),
      name: character.name,
      realm: character.realm,
      region: character.region,
      classID: character.classID,
      guildName: character.guildName ?? null,
    })),
    enqueue,
    processed,
    stored: {
      seasonScores: scoreRows.length,
      dungeonRuns: runRows.length,
    },
    seasonScores: scoreRows.map((row: any) => ({
      name: row.name,
      realm: row.realm,
      season: row.season,
      score: row.scores?.all ?? 0,
      dps: row.scores?.dps ?? 0,
      healer: row.scores?.healer ?? 0,
      tank: row.scores?.tank ?? 0,
      bestSpecName: row.bestSpecName ?? null,
      bestSpecScore: row.bestSpecScore ?? 0,
      fetchedAt: row.fetchedAt,
    })),
    dungeonRuns: runRows.slice(0, 80).map((row: any) => ({
      name: row.name,
      realm: row.realm,
      season: row.season,
      dungeonName: row.dungeonName,
      mythicLevel: row.mythicLevel,
      score: row.score,
      completedAt: row.completedAt,
    })),
  };

  console.log(JSON.stringify(output, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    await mongoose.disconnect();
  });
