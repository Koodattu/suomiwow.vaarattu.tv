import assert from "node:assert/strict";
import test from "node:test";
import { findAvoidableMechanic } from "../src/config/avoidable-mechanics";
import Guild from "../src/models/Guild";
import Raid from "../src/models/Raid";
import service from "../src/services/avoidable-damage.service";

test("guild options identify participation in the exact Mythic boss and respect raid exclusions", async (t) => {
  const mechanic = findAvoidableMechanic("sszorak-tempest")!;
  const other = findAvoidableMechanic("coiled-altar-axegrinder")!;
  const boss = (bossId = mechanic.encounterId, pullCount = 10, kills = 0) => ({ bossId, pullCount, kills });
  const progress = (bosses = [boss()], difficulty = "mythic", raidId = mechanic.zoneId) => ({ raidId, difficulty, bosses });
  const guilds = [
    { _id: "both", progress: [progress([boss(), boss(other.encounterId)])] },
    { _id: "kill", progress: [progress([boss(mechanic.encounterId, 0, 1)])] },
    { _id: "heroic", progress: [progress([boss()], "heroic")] },
    { _id: "other-boss", progress: [progress([boss(other.encounterId)])] },
    { _id: "other-raid", progress: [progress([boss()], "mythic", 44)] },
    { _id: "unpulled", progress: [progress([boss(mechanic.encounterId, 0, 0)])] },
    { _id: "rank-only", progress: [{ ...progress([]), bossesDefeated: 1 }] },
    { _id: "excluded", progress: [progress()], excludedRaidIds: [mechanic.zoneId] },
    { _id: "untracked" },
  ].map((guild) => ({ name: guild._id, realm: "realm", region: "eu", ...guild }));
  t.mock.method(Raid, "find", () => ({ select: () => ({ lean: async () => [
    { id: mechanic.zoneId, name: "Raid", expansion: "Midnight", iconUrl: "raid.jpg", bosses: [{ id: mechanic.encounterId, iconUrl: "boss.jpg" }] },
  ] }) }) as unknown as ReturnType<typeof Raid.find>);
  t.mock.method(Guild, "find", () => ({ select: () => ({ sort: () => ({ lean: async () => guilds }) }) }) as unknown as ReturnType<typeof Guild.find>);

  const options = await (service as unknown as { buildOptions: typeof service.getOptions }).buildOptions();
  const participants = (key: string) => options.guilds.filter((guild) => guild.mechanicKeys.includes(key)).map((guild) => guild.id);
  assert.deepEqual(participants(mechanic.key), ["both", "kill"]);
  assert.deepEqual(participants(other.key), ["both", "other-boss"]);
  assert.equal(options.guilds.length, guilds.length, "admin collection keeps its existing guild list");
  assert.equal(options.mechanics.find((entry) => entry.key === mechanic.key)?.bossIcon, "boss.jpg");
  assert.equal("progress" in options.guilds[0], false, "public options should only include compact participation keys");
});
