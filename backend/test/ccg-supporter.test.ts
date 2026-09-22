import assert from "node:assert/strict";
import test from "node:test";
import { CLASSES } from "../src/config/classes";
import { getCcgPackFinishOrder, getCcgRedeemFinishOrder, CCG_BASE_FINISH_ORDER } from "../src/config/ccg";
import { supporterMonth, supporterScores, supporterGrants, validateSupporterDraft, SUPPORTER_CREATOR_FINISHES, SUPPORTER_BACKGROUNDS } from "../src/utils/ccg-supporter";

test("Supporter allowance uses Helsinki calendar months, including DST boundaries", () => {
  assert.equal(supporterMonth(new Date("2026-09-30T20:59:59Z")), "2026-09");
  assert.equal(supporterMonth(new Date("2026-09-30T21:00:00Z")), "2026-10");
  assert.equal(supporterMonth(new Date("2026-10-31T21:59:59Z")), "2026-10");
  assert.equal(supporterMonth(new Date("2026-10-31T22:00:00Z")), "2026-11");
  assert.deepEqual(supporterGrants(true, true, "2026-09", new Date("2026-09-16T12:00:00Z")), [
    { kind: "follower", period: "once", amount: 1 }, { kind: "subscriber", period: "once", amount: 3 },
  ]);
  assert.equal(supporterGrants(false, true, "2026-09", new Date("2026-10-01T12:00:00Z")).find((grant) => grant.kind === "monthly")?.period, "2026-10");
  assert.deepEqual(supporterGrants(false, false, "2026-09", new Date("2026-10-01T12:00:00Z")), []);
});

test("manual scores reject invalid values and derive combined on the server", () => {
  assert.deepEqual(supporterScores({ performance: 90, mechanics: 72.1, mythicPlus: 0 }), { performance: 90, mechanics: 72.1, combined: 81.1, mythicPlus: 0 });
  assert.equal(supporterScores({ performance: 100 }).combined, null);
  for (const value of [-1, 100.1, Infinity, NaN, "100", {}, true]) assert.throws(() => supporterScores({ performance: value }), { code: "invalid_scores" });
  assert.throws(() => supporterScores({ mythicPlus: 100001 }), { code: "invalid_scores" });
});

test("specializations must belong to the character class; unreleased finishes cannot be selected", () => {
  const input = { specName: "Fire", role: "dps", tierGrade: "H", creatorFinish: SUPPORTER_CREATOR_FINISHES[0] };
  assert.equal(validateSupporterDraft(4, input).specName, "fire");
  assert.throws(() => validateSupporterDraft(4, { ...input, specName: "blood" }), { code: "invalid_spec" });
  assert.throws(() => validateSupporterDraft(4, { ...input, creatorFinish: "worldcore" }), { code: "invalid_finish" });
});

test("every class specialization supports any role, with the normal role as the default", () => {
  const input = { tierGrade: "H", creatorFinish: SUPPORTER_CREATOR_FINISHES[0] };
  for (const characterClass of CLASSES) {
    for (const spec of characterClass.specs) {
      assert.equal(validateSupporterDraft(characterClass.id, { ...input, specName: spec.name }).role, spec.role);
      for (const role of ["tank", "healer", "dps"]) {
        const draft = validateSupporterDraft(characterClass.id, { ...input, specName: spec.name, role });
        assert.equal(draft.role, role);
        assert.equal(draft.specName, spec.name);
      }
    }
  }
  for (const role of [null, "", "damage", "invalid", 1, {}]) {
    assert.throws(() => validateSupporterDraft(4, { ...input, specName: "fire", role }), { code: "invalid_role" });
  }
});

test("Supporter pack and redeem finishes contain only the bases and the card's chosen raid finish", () => {
  const expected = [...CCG_BASE_FINISH_ORDER.slice(0, -2), "phaseglass", ...CCG_BASE_FINISH_ORDER.slice(-2)];
  assert.deepEqual(getCcgPackFinishOrder("supporter", "phaseglass"), expected);
  assert.deepEqual(getCcgRedeemFinishOrder("supporter", "phaseglass"), expected);
  assert.deepEqual(getCcgPackFinishOrder("supporter"), CCG_BASE_FINISH_ORDER);
  assert.ok(!getCcgPackFinishOrder("supporter", "phaseglass").includes("relic"));
});

test("supporter backgrounds include raid, community and supporter art with bounded offsets", () => {
  const input = { specName: "Fire", tierGrade: "H", creatorFinish: SUPPORTER_CREATOR_FINISHES[0] };
  assert.ok(SUPPORTER_BACKGROUNDS.some((entry) => entry.id === "community"));
  assert.ok(SUPPORTER_BACKGROUNDS.some((entry) => entry.id === "supporter"));
  assert.ok(SUPPORTER_BACKGROUNDS.some((entry) => entry.id === "highmaul"));
  for (const background of SUPPORTER_BACKGROUNDS) {
    for (const x of [0, 50, 100]) assert.equal(validateSupporterDraft(4, { ...input, backgroundId: background.id, backgroundOffsetX: x }).backgroundOffsetX, x);
  }
  for (const backgroundId of ["missing", "https://example.com/art.png", null]) {
    assert.throws(() => validateSupporterDraft(4, { ...input, backgroundId }), { code: "invalid_background" });
  }
  for (const backgroundOffsetX of [-1, 101, NaN, Infinity, "50", null]) {
    assert.throws(() => validateSupporterDraft(4, { ...input, backgroundOffsetX }), { code: "invalid_background" });
  }
});
