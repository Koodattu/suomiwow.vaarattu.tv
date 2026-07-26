/// <reference path="../src/types/express-session.d.ts" />

import assert from "node:assert/strict";
import { AddressInfo } from "node:net";
import test from "node:test";
import cookieParser from "cookie-parser";
import express from "express";
import session from "express-session";
import { CCG_GUEST_COOKIE } from "../src/config/ccg";

test("CCG pack openings allow 60 requests per owner instead of sharing an IP limit", async () => {
  const [{ default: ccgRouter }, { default: ccgService }] = await Promise.all([
    import("../src/routes/ccg"),
    import("../src/services/ccg.service"),
  ]);
  const originalOpenPack = ccgService.openPack;
  ccgService.openPack = async () => ({ opened: true });

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(session({ secret: "ccg-rate-limit-test", resave: false, saveUninitialized: false }));
  app.use((req, _res, next) => {
    req.session.userId = req.header("x-test-user-id") ?? undefined;
    next();
  });
  app.use("/api/ccg", ccgRouter);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}/api/ccg/packs/open`;

  try {
    for (const userId of ["507f1f77bcf86cd799439011", "507f1f77bcf86cd799439012"]) {
      for (let request = 0; request < 60; request += 1) {
        const response = await fetch(url, { method: "POST", headers: { "x-test-user-id": userId } });
        assert.equal(response.status, 200, `request ${request + 1} for ${userId} should be allowed`);
      }
    }

    const limited = await fetch(url, {
      method: "POST",
      headers: { "x-test-user-id": "507f1f77bcf86cd799439011" },
    });
    assert.equal(limited.status, 429);
    assert.equal((await limited.json() as { code?: string }).code, "rate_limited");

    for (const guestToken of ["guest-one", "guest-two"]) {
      const response = await fetch(url, {
        method: "POST",
        headers: { Cookie: `${CCG_GUEST_COOKIE}=${guestToken}` },
      });
      assert.equal(response.status, 200, `guest ${guestToken} should have an independent limit`);
    }
  } finally {
    ccgService.openPack = originalOpenPack;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
