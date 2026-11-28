import assert from "node:assert/strict";
import test from "node:test";
import TwitchCcgRedemption from "../src/models/TwitchCcgRedemption";
import User from "../src/models/User";
import twitchCcgRewardService from "../src/services/twitch-ccg-reward.service";

test("linked reward retries resolve accounts with one users query and skip unlinked viewers", async t => {
  const distinct = t.mock.method(TwitchCcgRedemption, "distinct", async () => ["viewer-c", "viewer-a", "unlinked-1", "viewer-b", "unlinked-2"]);
  const find = t.mock.method(User, "find", (filter: unknown) => {
    assert.deepEqual(filter, { "twitch.id": { $in: ["viewer-c", "viewer-a", "unlinked-1", "viewer-b", "unlinked-2"] } });
    return { select: () => ({ lean: async () => [{ twitch: { id: "viewer-a" } }, { twitch: { id: "viewer-b" } }, { twitch: { id: "viewer-c" } }] }) };
  });
  const granted: string[] = [];
  t.mock.method(twitchCcgRewardService, "grantPendingForTwitchUser", async (id: string) => { granted.push(id); return 1; });

  assert.equal(await twitchCcgRewardService.retryLinkedPending(["packs"], 2), 2);
  assert.deepEqual(granted, ["viewer-a", "viewer-b"], "linked viewers only, in a stable order, up to the limit");
  assert.equal(distinct.mock.callCount(), 1);
  assert.equal(find.mock.callCount(), 1, "one users query per pass, however many redemptions are due");

  distinct.mock.mockImplementation(async () => []);
  assert.equal(await twitchCcgRewardService.retryLinkedPending(["packs"]), 0);
  assert.equal(find.mock.callCount(), 1, "nothing due needs no users query");
});
