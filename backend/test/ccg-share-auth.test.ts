/// <reference path="../src/types/express-session.d.ts" />

import assert from "node:assert/strict";
import { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import session from "express-session";

test("CCG share creation requires an authenticated user", async () => {
  const { default: ccgRouter } = await import("../src/routes/ccg");
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "ccg-share-auth-test", resave: false, saveUninitialized: false }));
  app.use("/api/ccg", ccgRouter);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;

  try {
    for (const path of ["/shares/card", "/shares/pack"]) {
      const response = await fetch(`http://127.0.0.1:${port}/api/ccg${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      assert.equal(response.status, 401, `POST ${path} must require authentication`);
      assert.equal((await response.json() as { code?: string }).code, "authentication_required");
    }

    const publicResponse = await fetch(`http://127.0.0.1:${port}/api/ccg/shares/not-a-share-id`);
    assert.equal(publicResponse.status, 404);
    assert.equal((await publicResponse.json() as { code?: string }).code, "share_not_found");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
