/// <reference path="../src/types/express-session.d.ts" />
process.env.BLIZZARD_CLIENT_ID = "media-cache-test";
process.env.BLIZZARD_CLIENT_SECRET = "media-cache-test";
import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AddressInfo } from "node:net";
import Media from "../src/models/CcgSupporterMedia";
import * as storage from "../src/services/character-render-storage.service";
import router from "../src/routes/ccg";

test("approved artwork revalidates without retransmission and revoked artwork cannot return 304", async t => {
  const directory = await mkdtemp(join(tmpdir(), "ccg-media-cache-"));
  const file = join(directory, "test.webp");
  await writeFile(file, "fixture artwork");
  let row: any = { contentType: "image/webp", status: "approved", storageKey: "test.webp", sha256: "test-sha", userId: "someone-else" };
  t.mock.method(Media, "findOne", ((filter: any) => {
    assert.equal(filter.purgedAt, null);
    return { lean: async () => row };
  }) as any);
  t.mock.method(storage, "resolveCharacterRenderStoragePath", () => file);
  const app = express();
  app.use((req, _res, next) => { req.session = {} as any; next(); });
  app.use(router);
  const server = await new Promise<ReturnType<typeof app.listen>>(resolve => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/media/supporter/6aaec2c81b2b5c5d5ec6d459`;
  const first = await fetch(url);
  assert.equal(first.status, 200);
  assert.equal(await first.text(), "fixture artwork");
  assert.equal(first.headers.get("cache-control"), "private, no-cache");
  assert.equal(first.headers.get("etag"), '"test-sha"');
  const headers = { "If-None-Match": '"test-sha"', "Cache-Control": "max-age=0" };
  const unchanged = await fetch(url, { headers });
  assert.equal(unchanged.status, 304);
  assert.equal(await unchanged.text(), "");
  row = { ...row, status: "rejected" };
  const revoked = await fetch(url, { headers });
  assert.equal(revoked.status, 404);
  assert.equal(revoked.headers.get("cache-control"), "private, no-store");
  row = null;
  const purged = await fetch(url, { headers });
  assert.equal(purged.status, 404);
});
