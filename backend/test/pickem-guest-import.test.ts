import assert from "node:assert/strict";
import test from "node:test";
import { PICK_EM_RWF_GUILDS } from "../src/config/guilds";
import Guild from "../src/models/Guild";
import User from "../src/models/User";
import {
  assertPickemAcceptingPredictions,
  createGuestPickemEntryIfAbsent,
  PickemSubmissionError,
  validatePickemPredictions,
} from "../src/services/pickem-submission.service";

const votingStart = new Date("2026-07-20T10:00:00.000Z");
const votingEnd = new Date("2026-07-20T11:00:00.000Z");

function competition(overrides: Record<string, unknown> = {}) {
  return {
    active: true,
    finalized: false,
    votingStart,
    votingEnd,
    type: "regular",
    guildCount: 2,
    ...overrides,
  } as any;
}

function submissionErrorCode(code: string) {
  return (error: unknown) => error instanceof PickemSubmissionError && error.code === code;
}

test("uses the server voting window and accepts the existing inclusive deadline boundary", () => {
  assert.doesNotThrow(() => assertPickemAcceptingPredictions(competition(), votingStart));
  assert.doesNotThrow(() => assertPickemAcceptingPredictions(competition(), votingEnd));
  assert.throws(() => assertPickemAcceptingPredictions(competition(), new Date(votingEnd.getTime() + 1)), submissionErrorCode("VOTING_NOT_OPEN"));
  assert.throws(() => assertPickemAcceptingPredictions(competition({ finalized: true }), votingStart), submissionErrorCode("PICKEM_FINALIZED"));
  assert.throws(() => assertPickemAcceptingPredictions(competition({ active: false }), votingStart), submissionErrorCode("PICKEM_NOT_FOUND"));
});

test("rejects malformed runtime prediction values before canonical guild lookup", async () => {
  await assert.rejects(
    validatePickemPredictions(competition(), [
      { guildName: "Guild One", realm: "Realm", position: "1" },
      { guildName: "Guild Two", realm: "Realm", position: 2 },
    ]),
    submissionErrorCode("INVALID_PREDICTIONS"),
  );

  await assert.rejects(
    validatePickemPredictions(competition(), [
      { guildName: "Guild One", realm: "Realm", position: 1 },
      { guildName: "Guild One", realm: "Realm", position: 2 },
    ]),
    submissionErrorCode("INVALID_PREDICTIONS"),
  );
});

test("validates and normalizes RWF guest predictions without trusting extra client fields", async () => {
  const [firstGuild, secondGuild] = PICK_EM_RWF_GUILDS;
  const predictions = await validatePickemPredictions(
    competition({ type: "rwf" }),
    [
      { guildName: ` ${firstGuild} `, realm: "RWF", position: 1, submittedAt: "2000-01-01T00:00:00.000Z" },
      { guildName: secondGuild, realm: "RWF", position: 2, userId: "spoofed" },
    ],
  );

  assert.deepEqual(predictions, [
    { guildName: firstGuild, realm: "RWF", position: 1 },
    { guildName: secondGuild, realm: "RWF", position: 2 },
  ]);
});

test("accepts only canonical parent guilds for regular guest predictions", async () => {
  const originalFind = Guild.find;
  Guild.find = ((..._args: unknown[]) => ({
    lean: async () => [
      { name: "Guild One", realm: "Realm", parent_guild: null },
      { name: "Guild Two", realm: "Realm", parent_guild: "" },
    ],
  })) as typeof Guild.find;

  try {
    const predictions = await validatePickemPredictions(competition(), [
      { guildName: " Guild One ", realm: "Realm", position: 1 },
      { guildName: "Guild Two", realm: "Realm", position: 2 },
    ]);

    assert.deepEqual(predictions, [
      { guildName: "Guild One", realm: "Realm", position: 1 },
      { guildName: "Guild Two", realm: "Realm", position: 2 },
    ]);
  } finally {
    Guild.find = originalFind;
  }
});

test("uses one atomic create-only update and never falls back to replacing an entry", async () => {
  const originalUpdateOne = User.updateOne;
  const calls: unknown[][] = [];
  let attempt = 0;

  User.updateOne = (async (...args: unknown[]) => {
    calls.push(args);
    attempt += 1;
    return { modifiedCount: attempt === 1 ? 1 : 0 };
  }) as typeof User.updateOne;

  const acceptedAt = new Date("2026-07-20T10:30:00.000Z");
  const predictions = [
    { guildName: "Guild One", realm: "Realm", position: 1 },
    { guildName: "Guild Two", realm: "Realm", position: 2 },
  ];

  try {
    assert.equal(await createGuestPickemEntryIfAbsent("507f1f77bcf86cd799439011", "season-one", predictions, acceptedAt), true);
    assert.equal(await createGuestPickemEntryIfAbsent("507f1f77bcf86cd799439011", "season-one", predictions, acceptedAt), false);

    assert.deepEqual(calls[0][0], {
      _id: "507f1f77bcf86cd799439011",
      "pickems.pickemId": { $ne: "season-one" },
    });
    assert.deepEqual(calls[0][1], {
      $push: {
        pickems: {
          pickemId: "season-one",
          predictions,
          submittedAt: acceptedAt,
          updatedAt: acceptedAt,
        },
      },
    });
    assert.deepEqual(calls[0][2], { runValidators: true });
  } finally {
    User.updateOne = originalUpdateOne;
  }
});
