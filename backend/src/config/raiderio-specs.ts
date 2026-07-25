export type RaiderIoSpecField = "spec_0" | "spec_1" | "spec_2" | "spec_3";

export interface BlizzardSpecSlot {
  blizzardSpecId: number;
  blizzardSpecIndex: number;
  specName: string;
  specSlug: string;
}

export interface RaiderIoClassSpecMap {
  blizzardClassId: number;
  className: string;
  classSlug: string;
  specs: Record<RaiderIoSpecField, BlizzardSpecSlot | null>;
}

export const RAIDER_IO_SPEC_FIELDS: RaiderIoSpecField[] = ["spec_0", "spec_1", "spec_2", "spec_3"];

// Blizzard class IDs come from the Blizzard Playable Class API and do not match
// the WarcraftLogs/internal class IDs used in classes.ts.
export const RAIDER_IO_SPEC_SLOTS_BY_BLIZZARD_CLASS_ID: Record<number, RaiderIoClassSpecMap> = {
  1: {
    blizzardClassId: 1,
    className: "Warrior",
    classSlug: "warrior",
    specs: {
      spec_0: { blizzardSpecId: 71, blizzardSpecIndex: 1, specName: "Arms", specSlug: "arms" },
      spec_1: { blizzardSpecId: 72, blizzardSpecIndex: 2, specName: "Fury", specSlug: "fury" },
      spec_2: { blizzardSpecId: 73, blizzardSpecIndex: 3, specName: "Protection", specSlug: "protection" },
      spec_3: null,
    },
  },
  2: {
    blizzardClassId: 2,
    className: "Paladin",
    classSlug: "paladin",
    specs: {
      spec_0: { blizzardSpecId: 65, blizzardSpecIndex: 1, specName: "Holy", specSlug: "holy" },
      spec_1: { blizzardSpecId: 66, blizzardSpecIndex: 2, specName: "Protection", specSlug: "protection" },
      spec_2: { blizzardSpecId: 70, blizzardSpecIndex: 3, specName: "Retribution", specSlug: "retribution" },
      spec_3: null,
    },
  },
  3: {
    blizzardClassId: 3,
    className: "Hunter",
    classSlug: "hunter",
    specs: {
      spec_0: { blizzardSpecId: 253, blizzardSpecIndex: 1, specName: "Beast Mastery", specSlug: "beast-mastery" },
      spec_1: { blizzardSpecId: 254, blizzardSpecIndex: 2, specName: "Marksmanship", specSlug: "marksmanship" },
      spec_2: { blizzardSpecId: 255, blizzardSpecIndex: 3, specName: "Survival", specSlug: "survival" },
      spec_3: null,
    },
  },
  4: {
    blizzardClassId: 4,
    className: "Rogue",
    classSlug: "rogue",
    specs: {
      spec_0: { blizzardSpecId: 259, blizzardSpecIndex: 1, specName: "Assassination", specSlug: "assassination" },
      spec_1: { blizzardSpecId: 260, blizzardSpecIndex: 2, specName: "Outlaw", specSlug: "outlaw" },
      spec_2: { blizzardSpecId: 261, blizzardSpecIndex: 3, specName: "Subtlety", specSlug: "subtlety" },
      spec_3: null,
    },
  },
  5: {
    blizzardClassId: 5,
    className: "Priest",
    classSlug: "priest",
    specs: {
      spec_0: { blizzardSpecId: 256, blizzardSpecIndex: 1, specName: "Discipline", specSlug: "discipline" },
      spec_1: { blizzardSpecId: 257, blizzardSpecIndex: 2, specName: "Holy", specSlug: "holy" },
      spec_2: { blizzardSpecId: 258, blizzardSpecIndex: 3, specName: "Shadow", specSlug: "shadow" },
      spec_3: null,
    },
  },
  6: {
    blizzardClassId: 6,
    className: "Death Knight",
    classSlug: "death-knight",
    specs: {
      spec_0: { blizzardSpecId: 250, blizzardSpecIndex: 1, specName: "Blood", specSlug: "blood" },
      spec_1: { blizzardSpecId: 251, blizzardSpecIndex: 2, specName: "Frost", specSlug: "frost" },
      spec_2: { blizzardSpecId: 252, blizzardSpecIndex: 3, specName: "Unholy", specSlug: "unholy" },
      spec_3: null,
    },
  },
  7: {
    blizzardClassId: 7,
    className: "Shaman",
    classSlug: "shaman",
    specs: {
      spec_0: { blizzardSpecId: 262, blizzardSpecIndex: 1, specName: "Elemental", specSlug: "elemental" },
      spec_1: { blizzardSpecId: 263, blizzardSpecIndex: 2, specName: "Enhancement", specSlug: "enhancement" },
      spec_2: { blizzardSpecId: 264, blizzardSpecIndex: 3, specName: "Restoration", specSlug: "restoration" },
      spec_3: null,
    },
  },
  8: {
    blizzardClassId: 8,
    className: "Mage",
    classSlug: "mage",
    specs: {
      spec_0: { blizzardSpecId: 62, blizzardSpecIndex: 1, specName: "Arcane", specSlug: "arcane" },
      spec_1: { blizzardSpecId: 63, blizzardSpecIndex: 2, specName: "Fire", specSlug: "fire" },
      spec_2: { blizzardSpecId: 64, blizzardSpecIndex: 3, specName: "Frost", specSlug: "frost" },
      spec_3: null,
    },
  },
  9: {
    blizzardClassId: 9,
    className: "Warlock",
    classSlug: "warlock",
    specs: {
      spec_0: { blizzardSpecId: 265, blizzardSpecIndex: 1, specName: "Affliction", specSlug: "affliction" },
      spec_1: { blizzardSpecId: 266, blizzardSpecIndex: 2, specName: "Demonology", specSlug: "demonology" },
      spec_2: { blizzardSpecId: 267, blizzardSpecIndex: 3, specName: "Destruction", specSlug: "destruction" },
      spec_3: null,
    },
  },
  10: {
    blizzardClassId: 10,
    className: "Monk",
    classSlug: "monk",
    specs: {
      spec_0: { blizzardSpecId: 268, blizzardSpecIndex: 1, specName: "Brewmaster", specSlug: "brewmaster" },
      spec_1: { blizzardSpecId: 270, blizzardSpecIndex: 2, specName: "Mistweaver", specSlug: "mistweaver" },
      spec_2: { blizzardSpecId: 269, blizzardSpecIndex: 3, specName: "Windwalker", specSlug: "windwalker" },
      spec_3: null,
    },
  },
  11: {
    blizzardClassId: 11,
    className: "Druid",
    classSlug: "druid",
    specs: {
      spec_0: { blizzardSpecId: 102, blizzardSpecIndex: 1, specName: "Balance", specSlug: "balance" },
      spec_1: { blizzardSpecId: 103, blizzardSpecIndex: 2, specName: "Feral", specSlug: "feral" },
      spec_2: { blizzardSpecId: 104, blizzardSpecIndex: 3, specName: "Guardian", specSlug: "guardian" },
      spec_3: { blizzardSpecId: 105, blizzardSpecIndex: 4, specName: "Restoration", specSlug: "restoration" },
    },
  },
  12: {
    blizzardClassId: 12,
    className: "Demon Hunter",
    classSlug: "demon-hunter",
    specs: {
      spec_0: { blizzardSpecId: 577, blizzardSpecIndex: 1, specName: "Havoc", specSlug: "havoc" },
      spec_1: { blizzardSpecId: 581, blizzardSpecIndex: 2, specName: "Vengeance", specSlug: "vengeance" },
      spec_2: { blizzardSpecId: 1480, blizzardSpecIndex: 3, specName: "Devourer", specSlug: "devourer" },
      spec_3: null,
    },
  },
  13: {
    blizzardClassId: 13,
    className: "Evoker",
    classSlug: "evoker",
    specs: {
      spec_0: { blizzardSpecId: 1467, blizzardSpecIndex: 1, specName: "Devastation", specSlug: "devastation" },
      spec_1: { blizzardSpecId: 1468, blizzardSpecIndex: 2, specName: "Preservation", specSlug: "preservation" },
      spec_2: { blizzardSpecId: 1473, blizzardSpecIndex: 3, specName: "Augmentation", specSlug: "augmentation" },
      spec_3: null,
    },
  },
};
