import assert from "node:assert/strict";
import test from "node:test";
import Report from "../src/models/Report";
import {
  GuildLogSourceError,
  getGuildLogSourceSnapshot,
  normalizeGuildLogSourceInput,
  withUpdatePipeline,
} from "../src/services/guild-log-source.service";

test("normalizes a historical Warcraft Logs source identity", () => {
  assert.deepEqual(
    normalizeGuildLogSourceInput({
      name: "  Hinausyhtiö  ",
      realm: "  Sylvanas ",
      region: "eu",
    }),
    {
      name: "Hinausyhtiö",
      realm: "Sylvanas",
      region: "EU",
      syncPolicy: "historical",
      enabled: true,
    },
  );
});

test("preserves explicit source controls during normalization", () => {
  assert.deepEqual(
    normalizeGuildLogSourceInput({
      name: "Archive",
      realm: "Realm",
      region: "US",
      syncPolicy: "active",
      enabled: false,
    }),
    {
      name: "Archive",
      realm: "Realm",
      region: "US",
      syncPolicy: "active",
      enabled: false,
    },
  );
});

test("rejects missing identities and unsupported regions with typed errors", () => {
  for (const input of [
    { name: "", realm: "Sylvanas", region: "EU" },
    { name: "Guild", realm: "Sylvanas", region: "OCE" },
  ]) {
    assert.throws(
      () => normalizeGuildLogSourceInput(input),
      (error: unknown) => error instanceof GuildLogSourceError && error.code === "invalid_input" && error.statusCode === 400,
    );
  }
});

test("report provenance snapshots are stable and omit an unresolved Warcraft Logs ID", () => {
  assert.deepEqual(
    getGuildLogSourceSnapshot({ name: "HinausYhtiö", realm: "Twisting Nether", region: "EU" }),
    { name: "HinausYhtiö", realm: "Twisting Nether", region: "EU" },
  );
  assert.deepEqual(
    getGuildLogSourceSnapshot({ name: "HinausYhtiö", realm: "Twisting Nether", region: "EU", warcraftlogsId: 123 }),
    { name: "HinausYhtiö", realm: "Twisting Nether", region: "EU", warcraftlogsId: 123 },
  );
});

test("enables Mongoose aggregation-pipeline updates used by guild migration", () => {
  const update = [{ $set: { guildId: "target-guild" } }];

  assert.throws(() => Report.updateMany({}, update), /updatePipeline/);

  assert.doesNotThrow(() => Report.updateMany({}, update, withUpdatePipeline({})));
});
