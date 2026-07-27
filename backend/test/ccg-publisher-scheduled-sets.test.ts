import assert from "node:assert/strict";
import test from "node:test";
import CcgSet from "../src/models/CcgSet";
import ccgPublisherService from "../src/services/ccg-publisher.service";

test("weekly CCG jobs select every enabled Current and Legacy raid set", async () => {
  const setModel = CcgSet as any;
  const service = ccgPublisherService as any;
  const originalFind = setModel.find;
  const originalEnsureConfiguredSets = service.ensureConfiguredSets;
  let capturedFilter: Record<string, unknown> | null = null;
  let capturedSort: Record<string, number> | null = null;

  try {
    service.ensureConfiguredSets = async () => undefined;
    setModel.find = (filter: Record<string, unknown>) => {
      capturedFilter = filter;
      return {
        sort(sort: Record<string, number>) {
          capturedSort = sort;
          return Promise.resolve([]);
        },
      };
    };

    assert.deepEqual(await service.getEnabledRaidSets(), []);
    assert.deepEqual(capturedFilter, {
      kind: "raid",
      state: { $in: ["current", "legacy"] },
      enabledAt: { $ne: null },
      cardCount: { $gt: 0 },
    });
    assert.deepEqual(capturedSort, { state: 1, zoneId: -1 });
  } finally {
    setModel.find = originalFind;
    service.ensureConfiguredSets = originalEnsureConfiguredSets;
  }
});
