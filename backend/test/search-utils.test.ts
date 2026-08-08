import assert from "node:assert/strict";
import test from "node:test";
import { createAccentInsensitiveSearchRegex, normalizeSearchText, scoreSearchCandidate } from "../src/utils/search";

test("search normalization folds diacritics, punctuation, and special Latin letters", () => {
  assert.equal(normalizeSearchText(" Ægir–Drak’thul "), "aegir drakthul");
  assert.equal(normalizeSearchText("Smørrebrød_Løw"), "smorrebrod low");
  assert.equal(normalizeSearchText("Áhàhàhähâháh"), "ahahahahahah");
  assert.equal(normalizeSearchText("Lääke"), normalizeSearchText("laake"));
});

test("accent-insensitive regex accepts plain and decorated spellings in either direction", () => {
  assert.equal(createAccentInsensitiveSearchRegex("ahahahahahah", { exact: true }).test("Áhàhàhähâháh"), true);
  assert.equal(createAccentInsensitiveSearchRegex("Áhàhàhähâháh", { exact: true }).test("ahahahahahah"), true);
  assert.equal(createAccentInsensitiveSearchRegex("laake", { exact: true }).test("Lääke"), true);
  assert.equal(createAccentInsensitiveSearchRegex("Lääke", { exact: true }).test("laake"), true);
  assert.equal(createAccentInsensitiveSearchRegex("Aegir", { exact: true }).test("Ægir"), true);
  assert.equal(createAccentInsensitiveSearchRegex("Smorrebrod", { exact: true }).test("Smørrebrød"), true);
  assert.equal(createAccentInsensitiveSearchRegex("Strasse", { exact: true }).test("Straße"), true);
});

test("separator-insensitive regex treats punctuation and spacing as optional", () => {
  const realmSearch = createAccentInsensitiveSearchRegex("Drak-thul", { exact: true, ignoreSeparators: true });
  const guildSearch = createAccentInsensitiveSearchRegex("Taika olennot", { exact: true, ignoreSeparators: true });

  assert.equal(realmSearch.test("Drak'thul"), true);
  assert.equal(realmSearch.test("Drakthul"), true);
  assert.equal(guildSearch.test("Taika-Olennot"), true);
  assert.equal(guildSearch.test("Taikaolennot"), true);
});

test("search scoring favors exact, prefix, substring, and close fuzzy matches", () => {
  const candidate = normalizeSearchText("Nickledone");
  assert.ok(scoreSearchCandidate(normalizeSearchText("Nickledone"), candidate) > scoreSearchCandidate(normalizeSearchText("Nick"), candidate));
  assert.ok(scoreSearchCandidate(normalizeSearchText("ledone"), candidate) > 0);
  assert.ok(scoreSearchCandidate(normalizeSearchText("Nuckledone"), candidate) > 0);
  assert.equal(scoreSearchCandidate(normalizeSearchText("completely different"), candidate), 0);
});
