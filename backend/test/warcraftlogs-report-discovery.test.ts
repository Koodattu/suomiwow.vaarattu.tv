import assert from "node:assert/strict";
import test from "node:test";
import wclService from "../src/services/warcraftlogs.service";

test("report discovery keeps raiders from UI-added guilds and guests without guild metadata", async (t) => {
  const characters = [
    { canonicalID: 1, name: "Raider", guilds: [{ name: "UI-added guild", server: { slug: "tarren-mill", region: { slug: "EU" } } }] },
    { canonicalID: 2, name: "Guest", guilds: [] },
    { canonicalID: 3, name: "NoGuildMetadata" },
  ];
  t.mock.method(wclService, "query", async () => ({ reportData: { report: { rankedCharacters: characters } } }) as any);

  const result = await wclService.getReportCharacters("tracked-guild-report");

  assert.deepEqual(result.reportData.report.rankedCharacters, characters);
});
