import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import { MIN_CHARACTER_RAID_PULLS_FOR_RANKING_ELIGIBILITY } from "../src/config/character-eligibility";
import CharacterMechanicsLeaderboard from "../src/models/CharacterMechanicsLeaderboard";
import CharacterRaidParticipation from "../src/models/CharacterRaidParticipation";
import CharacterTierListEntry from "../src/models/CharacterTierListEntry";
import Raid from "../src/models/Raid";
import characterTierListService from "../src/services/character-tierlist.service";

type TestableCharacterTierListService = {
  rebuildCharacterTierLists(zoneIds: number[]): Promise<{ entries: number }>;
  getAvailableRaids(): Promise<unknown[]>;
  buildEntryQuery(
    zoneId: number,
    filters: { minReports: number; role: null; classId: null; limit: null },
    guildId: mongoose.Types.ObjectId | null,
  ): Record<string, unknown>;
};

test("requires complete scores and at least 40 pulls when materializing generated character tier lists", async () => {
  const mechanicsModel = CharacterMechanicsLeaderboard as any;
  const participationModel = CharacterRaidParticipation as any;
  const entryModel = CharacterTierListEntry as any;
  const raidModel = Raid as any;
  const service = characterTierListService as unknown as TestableCharacterTierListService;
  const originals = {
    mechanicsFind: mechanicsModel.find,
    participationFind: participationModel.find,
    entryAggregate: entryModel.aggregate,
    entryDeleteMany: entryModel.deleteMany,
    raidFindOne: raidModel.findOne,
  };

  const captured: {
    mechanicsQuery?: Record<string, any>;
    availableRaidsPipeline?: Array<Record<string, any>>;
  } = {};

  try {
    mechanicsModel.find = (query: Record<string, any>) => {
      captured.mechanicsQuery = query;
      return {
        select() {
          return this;
        },
        lean: async () => [],
      };
    };
    participationModel.find = () => ({
      select() {
        return this;
      },
      lean: async () => [],
    });
    raidModel.findOne = () => ({
      select() {
        return this;
      },
      lean: async () => ({ id: 46, name: "Test Raid" }),
    });
    entryModel.deleteMany = async () => ({ deletedCount: 0 });
    entryModel.aggregate = async (pipeline: Array<Record<string, any>>) => {
      captured.availableRaidsPipeline = pipeline;
      return [];
    };

    const rebuildResult = await service.rebuildCharacterTierLists([46]);
    assert.equal(rebuildResult.entries, 0);
    assert.deepEqual(captured.mechanicsQuery?.score, { $gte: 0 });
    assert.deepEqual(captured.mechanicsQuery?.parseScore, { $gte: 0 });
    assert.deepEqual(captured.mechanicsQuery?.survivalScore, { $gte: 0 });
    assert.deepEqual(captured.mechanicsQuery?.survivalPercentile, { $gte: 0 });
    assert.deepEqual(captured.mechanicsQuery?.pulls, { $gte: MIN_CHARACTER_RAID_PULLS_FOR_RANKING_ELIGIBILITY });

    const filters = { minReports: 3, role: null, classId: null, limit: null };
    const globalQuery = service.buildEntryQuery(46, filters, null);
    const guildQuery = service.buildEntryQuery(46, filters, new mongoose.Types.ObjectId());
    assert.deepEqual(globalQuery.pulls, { $gte: MIN_CHARACTER_RAID_PULLS_FOR_RANKING_ELIGIBILITY });
    assert.deepEqual(guildQuery.pulls, { $gte: MIN_CHARACTER_RAID_PULLS_FOR_RANKING_ELIGIBILITY });
    assert.equal(39 >= MIN_CHARACTER_RAID_PULLS_FOR_RANKING_ELIGIBILITY, false);
    assert.equal(40 >= MIN_CHARACTER_RAID_PULLS_FOR_RANKING_ELIGIBILITY, true);

    await service.getAvailableRaids();
    assert.deepEqual(captured.availableRaidsPipeline?.[0]?.$match?.pulls, { $gte: MIN_CHARACTER_RAID_PULLS_FOR_RANKING_ELIGIBILITY });
  } finally {
    mechanicsModel.find = originals.mechanicsFind;
    participationModel.find = originals.participationFind;
    entryModel.aggregate = originals.entryAggregate;
    entryModel.deleteMany = originals.entryDeleteMany;
    raidModel.findOne = originals.raidFindOne;
  }
});
