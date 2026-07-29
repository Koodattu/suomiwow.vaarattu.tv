/// <reference path="../src/types/express-session.d.ts" />

import assert from "node:assert/strict";
import { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import session from "express-session";

test("every Admin CCG route rejects an unauthenticated request", async () => {
  process.env.BLIZZARD_CLIENT_ID ??= "test-client";
  process.env.BLIZZARD_CLIENT_SECRET ??= "test-secret";
  const { default: adminCcgRouter } = await import("../src/routes/admin-ccg");
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "admin-ccg-auth-test", resave: false, saveUninitialized: false }));
  app.use("/api/admin/ccg", adminCcgRouter);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  const routes: Array<{ method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; path: string }> = [
    { method: "GET", path: "/status" },
    { method: "GET", path: "/analytics" },
    { method: "POST", path: "/community" },
    { method: "PATCH", path: "/community/507f1f77bcf86cd799439011" },
    { method: "DELETE", path: "/community/507f1f77bcf86cd799439011" },
    { method: "GET", path: "/cards" },
    { method: "PUT", path: "/cards/507f1f77bcf86cd799439011/alternative-art" },
    { method: "POST", path: "/sets/bootstrap" },
    { method: "GET", path: "/snapshot-preview" },
    { method: "POST", path: "/snapshots" },
    { method: "POST", path: "/publications" },
    { method: "GET", path: "/sets/1/preview" },
    { method: "POST", path: "/sets/1/enable" },
    { method: "POST", path: "/sets/1/snapshot" },
    { method: "POST", path: "/sets/test/publish" },
    { method: "POST", path: "/media/discover" },
    { method: "GET", path: "/media/status" },
    { method: "POST", path: "/media/refresh-current" },
    { method: "POST", path: "/media/recover" },
    { method: "POST", path: "/media/retry" },
  ];

  try {
    for (const route of routes) {
      const response = await fetch(`http://127.0.0.1:${port}/api/admin/ccg${route.path}`, {
        method: route.method,
        headers: route.method === "GET" ? undefined : { "Content-Type": "application/json" },
        body: route.method === "GET" ? undefined : "{}",
      });
      assert.equal(response.status, 401, `${route.method} ${route.path} must require admin authentication`);
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
