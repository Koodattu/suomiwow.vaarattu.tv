import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSearchText, scoreSearchCandidate } from "../src/utils/search";

test("search normalization folds diacritics, punctuation, and special Latin letters", () => {
  assert.equal(normalizeSearchText(" Ægir–Drak’thul "), "aegir drakthul");
  assert.equal(normalizeSearchText("Smørrebrød_Løw"), "smorrebrod low");
});

test("search scoring favors exact, prefix, substring, and close fuzzy matches", () => {
  const candidate = normalizeSearchText("Nickledone");
  assert.ok(scoreSearchCandidate(normalizeSearchText("Nickledone"), candidate) > scoreSearchCandidate(normalizeSearchText("Nick"), candidate));
  assert.ok(scoreSearchCandidate(normalizeSearchText("ledone"), candidate) > 0);
  assert.ok(scoreSearchCandidate(normalizeSearchText("Nuckledone"), candidate) > 0);
  assert.equal(scoreSearchCandidate(normalizeSearchText("completely different"), candidate), 0);
});
