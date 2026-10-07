import assert from "node:assert/strict";
import test, { TestContext } from "node:test";
import wcl from "../src/services/warcraftlogs.service";
import rateLimit from "../src/services/rate-limit.service";
import userAuth from "../src/services/warcraftlogs-user-auth.service";

function setup(t: TestContext, statuses: number[], oauthStatus = 200) {
  const service = new (wcl.constructor as new () => typeof wcl)();
  const transport = service as unknown as {
    accessToken: string | null;
    tokenExpiry: number;
    requestDelay(): Promise<void>;
    fetchWithNetworkRetry(url: string, options: { headers: Record<string, string>; body: string }): Promise<unknown>;
  };
  transport.accessToken = "rejected-token";
  transport.tokenExpiry = Date.now() + 360 * 24 * 60 * 60 * 1000;
  const originalId = process.env.WCL_CLIENT_ID;
  const originalSecret = process.env.WCL_CLIENT_SECRET;
  process.env.WCL_CLIENT_ID = "test-client";
  process.env.WCL_CLIENT_SECRET = "test-secret";
  t.after(() => {
    if (originalId === undefined) delete process.env.WCL_CLIENT_ID;
    else process.env.WCL_CLIENT_ID = originalId;
    if (originalSecret === undefined) delete process.env.WCL_CLIENT_SECRET;
    else process.env.WCL_CLIENT_SECRET = originalSecret;
  });
  t.mock.method(transport, "requestDelay", async () => {});
  t.mock.method(rateLimit, "waitForHardLimit", async () => {});
  t.mock.method(rateLimit, "recordRateLimited", async () => {});
  const calls: { url: string; authorization: string; body: string }[] = [];
  const data = { reportData: { reports: { data: [{ code: "live-report" }] } } };
  t.mock.method(transport, "fetchWithNetworkRetry", async (url: string, options: { headers: Record<string, string>; body: string }) => {
    calls.push({ url, authorization: options.headers.Authorization, body: options.body });
    const isAuth = url.endsWith("/oauth/token");
    const status = isAuth ? oauthStatus : statuses.shift();
    assert.ok(status !== undefined, "unexpected extra API retry");
    return {
      status,
      ok: status === 200,
      statusText: status === 401 ? "Unauthorized" : status === 403 ? "Forbidden" : "OK",
      headers: { get: () => "1" },
      json: async () => isAuth ? { access_token: "fresh-token", expires_in: 31104000 } : { data },
    };
  });
  return { service, transport, calls, data };
}

test("a rejected cached WCL client token is refreshed and the same query is retried once", async (t) => {
  const { service, calls, data } = setup(t, [401, 200, 200]);
  const query = "query($code: String!) { reportData { report(code: $code) { code } } }";
  const variables = { code: "live-report" };
  assert.deepEqual(await service.query(query, variables), data);
  assert.deepEqual(await service.query(query, variables), data);
  assert.equal(calls.filter((call) => call.url.endsWith("/oauth/token")).length, 1);
  const apiCalls = calls.filter((call) => call.url.endsWith("/api/v2/client"));
  assert.deepEqual(apiCalls.map((call) => call.authorization), ["Bearer rejected-token", "Bearer fresh-token", "Bearer fresh-token"]);
  assert.ok(apiCalls.every((call) => call.body === JSON.stringify({ query, variables })));
});

for (const statuses of [[401, 401], [401, 429, 401]]) {
  test(`WCL authentication retry remains bounded across HTTP ${statuses.join(" -> ")}`, async (t) => {
    const { service, calls } = setup(t, [...statuses]);
    await assert.rejects(service.query("query { rateLimitData { limitPerHour } }"), /401 Unauthorized/);
    assert.equal(calls.filter((call) => call.url.endsWith("/oauth/token")).length, 1);
    assert.equal(calls.filter((call) => call.url.endsWith("/api/v2/client")).length, statuses.length);
  });
}

test("WCL 403 does not refresh or retry authentication", async (t) => {
  const { service, calls } = setup(t, [403]);
  await assert.rejects(service.query("query { reportData { reports { data { code } } } }"), /403 Forbidden/);
  assert.equal(calls.length, 1);
});

test("a failed WCL token refresh propagates without retrying the API", async (t) => {
  const { service, calls } = setup(t, [401], 401);
  await assert.rejects(service.query("query { rateLimitData { limitPerHour } }"), /WCL authentication failed: Unauthorized/);
  assert.equal(calls.length, 2);
});

test("a WCL user endpoint 401 does not refresh client credentials", async (t) => {
  const { service, calls } = setup(t, [401]);
  t.mock.method(userAuth, "getAccessToken", async () => "user-token");
  await assert.rejects(service.queryUser("query { userData { currentUser { id } } }"), /401 Unauthorized/);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.endsWith("/api/v2/user"));
  assert.equal(calls[0].authorization, "Bearer user-token");
});

test("a delayed WCL 401 reuses a newer token obtained by another request", async (t) => {
  const { service, transport, calls } = setup(t, [401, 200]);
  const originalFetch = transport.fetchWithNetworkRetry.bind(transport);
  t.mock.method(transport, "fetchWithNetworkRetry", async (url: string, options: { headers: Record<string, string>; body: string }) => {
    const response = await originalFetch(url, options);
    if (options.headers.Authorization === "Bearer rejected-token") transport.accessToken = "newer-token";
    return response;
  });
  await service.query("query { rateLimitData { limitPerHour } }");
  assert.deepEqual(calls.map((call) => call.authorization), ["Bearer rejected-token", "Bearer newer-token"]);
});
