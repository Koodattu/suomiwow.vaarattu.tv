import assert from "node:assert/strict";
import test from "node:test";
import { QueryClient } from "@tanstack/react-query";
import { prefetchCcgCollectionPage } from "../src/lib/ccg-collection-prefetch.ts";

test("prefetch shares the exact next-page cache and request with navigation, without fetching further pages", async () => {
  const client = new QueryClient();
  let resolve, calls = 0;
  const data = { page: 2, pages: 500, cards: ["a", "a", "b"] };
  const options = { queryKey: ["ccg", "collection", { page: 2, set: "raid", sort: "alphabetical" }], staleTime: 30000,
    queryFn: () => { calls++; return new Promise(r => { resolve = r; }); } };
  const warmed = [];
  const prefetch = prefetchCcgCollectionPage(client, options, new AbortController().signal, d => d.cards, async url => { warmed.push(url); });
  const navigation = client.fetchQuery(options);
  resolve(data);
  await prefetch;
  assert.deepEqual(await navigation, data);
  assert.equal(calls, 1);
  assert.deepEqual(warmed.sort(), ["a", "b"]);
  assert.equal(client.getQueryCache().getAll().length, 1);
  assert.equal(client.getQueryData(["ccg", "collection", { page: 2, set: "other", sort: "alphabetical" }]), undefined);
  client.clear();
});

test("leaving a page stops speculative artwork without cancelling a request navigation may need", async () => {
  const client = new QueryClient(), controller = new AbortController();
  let resolve;
  const options = { queryKey: ["next"], queryFn: () => new Promise(r => { resolve = r; }) };
  const work = prefetchCcgCollectionPage(client, options, controller.signal, () => ["a"], async () => { assert.fail("obsolete artwork"); });
  controller.abort();
  resolve({ page: 2 });
  await work;
  assert.deepEqual(client.getQueryData(["next"]), { page: 2 });
  client.clear();
});

test("artwork warming is limited to two requests and speculative failures are contained", async () => {
  const client = new QueryClient();
  let running = 0, peak = 0;
  await prefetchCcgCollectionPage(client, { queryKey: ["next"], queryFn: async () => ["a", "b", "c", "d"] }, new AbortController().signal, d => d, async () => {
    peak = Math.max(peak, ++running);
    await new Promise(r => setImmediate(r));
    running--;
    throw new Error("image unavailable");
  });
  assert.equal(peak, 2);
  await prefetchCcgCollectionPage(client, { queryKey: ["failed"], retry: false, queryFn: async () => { throw Error("offline"); } }, new AbortController().signal, () => [], async () => {});
  client.clear();
});
