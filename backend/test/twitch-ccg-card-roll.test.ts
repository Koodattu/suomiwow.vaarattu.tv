/// <reference path="../src/types/express-session.d.ts" />

import assert from "node:assert/strict";
import test from "node:test";
import "express-session";
import mongoose from "mongoose";
import CcgCard from "../src/models/CcgCard";
import CcgOwnership from "../src/models/CcgOwnership";
import CcgQualityProgress from "../src/models/CcgQualityProgress";
import CcgSet from "../src/models/CcgSet";
import ccgService from "../src/services/ccg.service";

test("Twitch card rolls use all raid pools and the linked user's finish state", async () => {
  const cardId = new mongoose.Types.ObjectId();
  const setId = new mongoose.Types.ObjectId();
  const characterId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();
  const service = ccgService as any;
  const originals = {
    selectPackResults: service.selectPackResults,
    loadAlternativeArt: service.loadAlternativeArt,
    cardFindOne: CcgCard.findOne,
    setFindOne: CcgSet.findOne,
    ownershipFind: CcgOwnership.find,
    qualityFindOneAndUpdate: CcgQualityProgress.findOneAndUpdate,
  };
  let selectedTarget: unknown;
  let includedCommunity: boolean | undefined;
  let qualitySaved = false;

  try {
    service.selectPackResults = async (_session: unknown, targetSetId: unknown, includeCommunity: boolean) => {
      selectedTarget = targetSetId;
      includedCommunity = includeCommunity;
      return {
        results: [{ cardId, setId, tierGrade: "A" }],
        sourceSetIds: [setId],
        version: "all:test",
      };
    };
    service.loadAlternativeArt = async () => new Map();
    (CcgCard as any).findOne = () => ({
      session: () => ({
        lean: async () => ({
          _id: cardId,
          setId,
          characterId,
          snapshotVersion: 1,
          tierGrade: "A",
          collectorKey: "test-card",
          communityCharacterId: null,
        }),
      }),
    });
    (CcgSet as any).findOne = () => ({
      session: () => ({
        lean: async () => ({
          _id: setId,
          slug: "test-raid",
          kind: "raid",
          enabledAt: new Date(),
          customFinish: null,
        }),
      }),
    });
    (CcgOwnership as any).find = () => ({
      select: () => ({
        session: () => ({ lean: async () => [{ finish: "negative" }] }),
      }),
    });
    (CcgQualityProgress as any).findOneAndUpdate = async () => ({
      foil: 0,
      golden: 0,
      prismatic: 0,
      holographic: 0,
      negative: 999,
      custom: new Map(),
      save: async () => { qualitySaved = true; },
    });

    const award = await ccgService.rollExternalSingleCard({} as mongoose.ClientSession, userId);

    assert.equal(selectedTarget, null);
    assert.equal(includedCommunity, false);
    assert.equal(award.finish, "holographic");
    assert.equal(qualitySaved, true);
  } finally {
    service.selectPackResults = originals.selectPackResults;
    service.loadAlternativeArt = originals.loadAlternativeArt;
    (CcgCard as any).findOne = originals.cardFindOne;
    (CcgSet as any).findOne = originals.setFindOne;
    (CcgOwnership as any).find = originals.ownershipFind;
    (CcgQualityProgress as any).findOneAndUpdate = originals.qualityFindOneAndUpdate;
  }
});
