import mongoose from "mongoose";
import { TRACKED_RAIDS } from "../config/guilds";
import CharacterRaidParticipation from "../models/CharacterRaidParticipation";
import Ranking from "../models/Ranking";
import Raid, { RegionDates } from "../models/Raid";
import { slugifySpecName } from "../utils/spec";

export type AccountRaidActivity = {
  characterId: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  reportCount: number;
  specs: string[];
};

export type AccountRaidTimeline = Array<{
  id: number;
  name: string;
  expansion: string;
  iconUrl?: string;
  starts?: RegionDates;
  ends?: RegionDates;
  characters: AccountRaidActivity[];
}>;

type Participation = {
  characterId?: mongoose.Types.ObjectId | null;
  zoneId: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  reportCount: number;
};

type SpecEvidence = { characterId: mongoose.Types.ObjectId; zoneId: number; specs: string[] };

export function summarizeAccountRaidActivity(participation: Participation[], specEvidence: SpecEvidence[]) {
  const byRaid = new Map<number, Map<string, AccountRaidActivity>>();
  for (const row of participation) {
    if (!row.characterId || row.reportCount <= 0) continue;
    const characterId = String(row.characterId);
    const characters = byRaid.get(row.zoneId) ?? new Map<string, AccountRaidActivity>();
    const activity = characters.get(characterId);
    if (activity) {
      if (row.firstSeenAt < activity.firstSeenAt) activity.firstSeenAt = row.firstSeenAt;
      if (row.lastSeenAt > activity.lastSeenAt) activity.lastSeenAt = row.lastSeenAt;
      activity.reportCount += row.reportCount;
    } else {
      characters.set(characterId, { characterId, firstSeenAt: row.firstSeenAt, lastSeenAt: row.lastSeenAt, reportCount: row.reportCount, specs: [] });
    }
    byRaid.set(row.zoneId, characters);
  }
  for (const row of specEvidence) {
    const activity = byRaid.get(row.zoneId)?.get(String(row.characterId));
    if (activity) {
      activity.specs = [...new Set([...activity.specs, ...row.specs.filter(Boolean).map(slugifySpecName)])].sort();
    }
  }
  return byRaid;
}

export async function getAccountRaidTimeline(characterIds: mongoose.Types.ObjectId[]): Promise<AccountRaidTimeline> {
  const [raids, participation, specs] = await Promise.all([
    Raid.find({ id: { $in: TRACKED_RAIDS } }).select("id name expansion iconUrl starts ends").lean(),
    CharacterRaidParticipation.find({ characterId: { $in: characterIds }, zoneId: { $in: TRACKED_RAIDS } })
      .select("characterId zoneId firstSeenAt lastSeenAt reportCount").lean<Participation[]>(),
    Ranking.aggregate<SpecEvidence>([
      { $match: { characterId: { $in: characterIds }, zoneId: { $in: TRACKED_RAIDS } } },
      { $project: { characterId: 1, zoneId: 1, specs: ["$specName", "$bestSpecName"] } },
      { $unwind: "$specs" },
      { $match: { specs: { $type: "string", $ne: "" } } },
      { $group: { _id: { characterId: "$characterId", zoneId: "$zoneId" }, specs: { $addToSet: "$specs" } } },
      { $project: { _id: 0, characterId: "$_id.characterId", zoneId: "$_id.zoneId", specs: 1 } },
    ]),
  ]);
  const activity = summarizeAccountRaidActivity(participation, specs);
  return raids.map((raid) => ({
    id: raid.id,
    name: raid.name,
    expansion: raid.expansion,
    iconUrl: raid.iconUrl,
    starts: raid.starts,
    ends: raid.ends,
    characters: [...(activity.get(raid.id)?.values() ?? [])],
  }));
}
