import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import { buildCcgCollectionGuilds } from "../src/services/ccg-publisher.service";

test("collection guild facets ignore guildless cards and deduplicate guilds", () => {
  const firstGuildId = new mongoose.Types.ObjectId();
  const secondGuildId = new mongoose.Types.ObjectId();

  const guilds = buildCcgCollectionGuilds([
    { guildId: firstGuildId, guildName: "Zulu", guildRealm: "Tarren Mill" },
    { guildId: null, guildName: null, guildRealm: null },
    { guildId: firstGuildId, guildName: "Zulu", guildRealm: "Tarren Mill" },
    { guildId: secondGuildId, guildName: "Alpha", guildRealm: "Twisting Nether" },
  ]);

  assert.deepEqual(guilds, [
    { guildId: secondGuildId, name: "Alpha", realm: "Twisting Nether" },
    { guildId: firstGuildId, name: "Zulu", realm: "Tarren Mill" },
  ]);
});
