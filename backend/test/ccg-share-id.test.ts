import assert from "node:assert/strict";
import test from "node:test";
import CcgShare from "../src/models/CcgShare";
import {
  CCG_SHARE_PUBLIC_ID_LENGTH,
  CCG_SHARE_SHORT_ID_LENGTH,
  createCcgShareShortId,
  resolveCcgShareLookup,
} from "../src/utils/ccg-share-id";

test("CCG short share IDs use eight URL-safe characters", () => {
  const shortId = createCcgShareShortId();

  assert.equal(shortId.length, CCG_SHARE_SHORT_ID_LENGTH);
  assert.match(shortId, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(resolveCcgShareLookup(shortId), { shortId });
});

test("CCG share lookup keeps existing public IDs as aliases", () => {
  const publicId = "m4Ky5aEKApJU0LErncVRcw";

  assert.equal(publicId.length, CCG_SHARE_PUBLIC_ID_LENGTH);
  assert.deepEqual(resolveCcgShareLookup(publicId), { publicId });
});

test("CCG share lookup rejects partial and malformed IDs", () => {
  for (const value of ["m4Ky5", "m4Ky5aE", "m4Ky5aEK!", "m4Ky5aEKApJU0LErncVRc"]) {
    assert.equal(resolveCcgShareLookup(value), null);
  }
});

test("CCG short share IDs are protected by a sparse unique index", () => {
  const shortIdPath = CcgShare.schema.path("shortId");

  assert.equal(shortIdPath.options.unique, true);
  assert.equal(shortIdPath.options.sparse, true);
});
