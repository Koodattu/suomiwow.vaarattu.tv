#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

const DEFAULT_URL = "https://suomiwow.vaarattu.tv/";

function parseArgs(argv) {
  const options = {
    url: DEFAULT_URL,
    runs: 1,
    timeoutMs: 45_000,
    idleMs: 1_500,
    output: null,
    headed: false,
    disableBrowserCache: true,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`Missing value for ${arg}`);
      }
      i += 1;
      return value;
    };

    if (arg === "--url") options.url = next();
    else if (arg === "--runs") options.runs = Number(next());
    else if (arg === "--timeout-ms") options.timeoutMs = Number(next());
    else if (arg === "--idle-ms") options.idleMs = Number(next());
    else if (arg === "--output") options.output = next();
    else if (arg === "--headed") options.headed = true;
    else if (arg === "--allow-browser-cache") options.disableBrowserCache = false;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isInteger(options.runs) || options.runs < 1) {
    throw new Error("--runs must be a positive integer");
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 1_000) {
    throw new Error("--timeout-ms must be at least 1000");
  }
  if (!Number.isFinite(options.idleMs) || options.idleMs < 100) {
    throw new Error("--idle-ms must be at least 100");
  }

  return options;
}

function printHelp() {
  console.log(`
Usage:
  node scripts/perf/benchmark-home.mjs [options]

Options:
  --url <url>              Page to benchmark. Default: ${DEFAULT_URL}
  --runs <n>               Number of fresh-browser runs. Default: 1
  --timeout-ms <n>         Max wait per run. Default: 45000
  --idle-ms <n>            Network quiet window after load. Default: 1500
  --output <file>          Write full JSON report to this path
  --headed                 Show the browser window
  --allow-browser-cache    Do not disable browser cache through CDP
  --help                   Show this help

Environment:
  CHROME_PATH              Explicit Chrome/Edge executable path

Notes:
  Requires Node with global WebSocket support. Node 22+ works.
  Uses Chrome/Edge DevTools directly; no npm packages are required.
`);
}

function findBrowserExecutable() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/microsoft-edge",
  ].filter(Boolean);

  return candidates.find((candidate) => existsSync(candidate));
}

async function waitForDevToolsPort(profileDir, timeoutMs) {
  const portFile = path.join(profileDir, "DevToolsActivePort");
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const text = await readFile(portFile, "utf8");
      const [port] = text.trim().split(/\r?\n/);
      if (port) return Number(port);
    } catch {
      // Browser has not written DevToolsActivePort yet.
    }
    await sleep(100);
  }

  throw new Error(`Timed out waiting for DevToolsActivePort in ${profileDir}`);
}

async function getPageWebSocketUrl(port) {
  const listResponse = await fetch(`http://127.0.0.1:${port}/json/list`);
  const targets = await listResponse.json();
  const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
  if (page) return page.webSocketDebuggerUrl;

  const newResponse = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, {
    method: "PUT",
  });
  const newPage = await newResponse.json();
  if (!newPage.webSocketDebuggerUrl) {
    throw new Error("Chrome did not return a page WebSocket URL");
  }
  return newPage.webSocketDebuggerUrl;
}

class CdpSession {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = new Map();
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timed out connecting to DevTools WebSocket")), 10_000);
      this.ws.addEventListener("open", () => {
        clearTimeout(timeout);
        resolve();
      });
      this.ws.addEventListener("error", (event) => {
        clearTimeout(timeout);
        reject(new Error(`DevTools WebSocket error: ${event.message ?? "unknown error"}`));
      });
    });

    this.ws.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(`${message.error.message} (${message.error.code})`));
        else resolve(message.result ?? {});
        return;
      }

      if (message.method && this.handlers.has(message.method)) {
        for (const handler of this.handlers.get(message.method)) {
          handler(message.params ?? {});
        }
      }
    });
  }

  on(method, handler) {
    const handlers = this.handlers.get(method) ?? [];
    handlers.push(handler);
    this.handlers.set(method, handlers);
  }

  send(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;

    const message = JSON.stringify({ id, method, params });
    this.ws.send(message);

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

async function runBenchmark(options, runNumber) {
  const browserPath = findBrowserExecutable();
  if (!browserPath) {
    throw new Error("Could not find Chrome or Edge. Set CHROME_PATH to the browser executable.");
  }
  if (typeof WebSocket === "undefined") {
    throw new Error("This script needs Node 22+ global WebSocket support.");
  }

  const profileDir = await mkdtemp(path.join(tmpdir(), "wow-home-bench-"));
  const browserArgs = [
    "--remote-debugging-port=0",
    "--remote-allow-origins=*",
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-extensions",
    "--disable-sync",
    "--disable-component-update",
    "--disable-features=Translate,MediaRouter",
    options.headed ? null : "--headless=new",
    options.headed ? null : "--disable-gpu",
    "about:blank",
  ].filter(Boolean);

  const browser = spawn(browserPath, browserArgs, {
    stdio: "ignore",
    windowsHide: true,
  });

  let cdp = null;

  try {
    const port = await waitForDevToolsPort(profileDir, 10_000);
    const wsUrl = await getPageWebSocketUrl(port);
    cdp = new CdpSession(wsUrl);
    await cdp.connect();

    const state = createNetworkState();
    attachNetworkHandlers(cdp, state);

    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Network.enable", {
      maxTotalBufferSize: 100_000_000,
      maxResourceBufferSize: 20_000_000,
    });
    await cdp.send("Page.setLifecycleEventsEnabled", { enabled: true });
    if (options.disableBrowserCache) {
      await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    }

    const wallStart = new Date().toISOString();
    const start = performance.now();
    await cdp.send("Page.navigate", { url: options.url });
    const waitResult = await waitForNetworkQuiet(state, options);
    const end = performance.now();

    return buildRunReport({
      runNumber,
      url: options.url,
      wallStart,
      elapsedMs: end - start,
      waitResult,
      state,
    });
  } finally {
    if (cdp) cdp.close();
    await stopBrowser(browser);
    await removeTempDir(profileDir);
  }
}

async function stopBrowser(browser) {
  if (browser.exitCode !== null || browser.signalCode !== null) return;

  browser.kill();
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 2_000);
    browser.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function removeTempDir(profileDir) {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      await rm(profileDir, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 5) {
        console.warn(`Warning: could not remove temporary browser profile ${profileDir}: ${error.message}`);
        return;
      }
      await sleep(250 * attempt);
    }
  }
}

function createNetworkState() {
  return {
    requests: new Map(),
    inFlight: new Set(),
    lifecycle: [],
    domContentEventTs: null,
    loadEventTs: null,
    lastActivityAt: Date.now(),
  };
}

function attachNetworkHandlers(cdp, state) {
  cdp.on("Network.requestWillBeSent", (params) => {
    state.lastActivityAt = Date.now();
    state.inFlight.add(params.requestId);

    state.requests.set(params.requestId, {
      requestId: params.requestId,
      url: params.request.url,
      method: params.request.method,
      type: params.type,
      startTs: params.timestamp,
      wallTime: params.wallTime,
      initiatorType: params.initiator?.type ?? null,
      status: null,
      statusText: null,
      mimeType: null,
      protocol: null,
      responseHeaders: {},
      responseTs: null,
      endTs: null,
      encodedDataLength: 0,
      decodedDataLength: 0,
      failed: false,
      errorText: null,
      fromDiskCache: false,
      fromServiceWorker: false,
      fromPrefetchCache: false,
      timing: null,
    });
  });

  cdp.on("Network.responseReceived", (params) => {
    state.lastActivityAt = Date.now();
    const record = state.requests.get(params.requestId);
    if (!record) return;

    const response = params.response;
    record.status = response.status;
    record.statusText = response.statusText;
    record.mimeType = response.mimeType;
    record.protocol = response.protocol;
    record.responseHeaders = response.headers ?? {};
    record.responseTs = params.timestamp;
    record.fromDiskCache = Boolean(response.fromDiskCache);
    record.fromServiceWorker = Boolean(response.fromServiceWorker);
    record.fromPrefetchCache = Boolean(response.fromPrefetchCache);
    record.timing = response.timing ?? null;
  });

  cdp.on("Network.dataReceived", (params) => {
    state.lastActivityAt = Date.now();
    const record = state.requests.get(params.requestId);
    if (!record) return;
    record.decodedDataLength += params.dataLength ?? 0;
    record.encodedDataLength += params.encodedDataLength ?? 0;
  });

  cdp.on("Network.loadingFinished", (params) => {
    state.lastActivityAt = Date.now();
    state.inFlight.delete(params.requestId);
    const record = state.requests.get(params.requestId);
    if (!record) return;
    record.endTs = params.timestamp;
    record.encodedDataLength = Math.max(record.encodedDataLength, params.encodedDataLength ?? 0);
  });

  cdp.on("Network.loadingFailed", (params) => {
    state.lastActivityAt = Date.now();
    state.inFlight.delete(params.requestId);
    const record = state.requests.get(params.requestId);
    if (!record) return;
    record.endTs = params.timestamp;
    record.failed = true;
    record.errorText = params.errorText;
  });

  cdp.on("Page.lifecycleEvent", (params) => {
    state.lifecycle.push({
      name: params.name,
      timestamp: params.timestamp,
    });
  });

  cdp.on("Page.domContentEventFired", (params) => {
    state.domContentEventTs = params.timestamp;
  });

  cdp.on("Page.loadEventFired", (params) => {
    state.loadEventTs = params.timestamp;
  });
}

async function waitForNetworkQuiet(state, options) {
  const deadline = Date.now() + options.timeoutMs;

  while (Date.now() < deadline) {
    const idleForMs = Date.now() - state.lastActivityAt;
    const loaded = state.loadEventTs !== null;
    if (loaded && state.inFlight.size === 0 && idleForMs >= options.idleMs) {
      return { timedOut: false, idleForMs, inFlight: state.inFlight.size };
    }
    await sleep(100);
  }

  return {
    timedOut: true,
    idleForMs: Date.now() - state.lastActivityAt,
    inFlight: state.inFlight.size,
  };
}

function buildRunReport({ runNumber, url, wallStart, elapsedMs, waitResult, state }) {
  const records = [...state.requests.values()].map(normalizeRequest).sort((a, b) => a.startMs - b.startMs);
  const navigationStartTs = findNavigationStart(records, url);

  for (const record of records) {
    record.startMs = fromNavigationMs(record.rawStartTs, navigationStartTs);
    record.responseStartMs = fromNavigationMs(record.rawResponseTs, navigationStartTs);
    record.endMs = fromNavigationMs(record.rawEndTs, navigationStartTs);
    delete record.rawStartTs;
    delete record.rawResponseTs;
    delete record.rawEndTs;
  }

  const apiRequests = records.filter((record) => record.category === "api");
  const summary = {
    totalRequests: records.length,
    apiRequests: apiRequests.length,
    totalEncodedBytes: sum(records, "encodedBytes"),
    apiEncodedBytes: sum(apiRequests, "encodedBytes"),
    documentLoadMs: fromNavigationMs(state.loadEventTs, navigationStartTs),
    domContentLoadedMs: fromNavigationMs(state.domContentEventTs, navigationStartTs),
    networkQuietMs: elapsedMs,
    timedOut: waitResult.timedOut,
    inFlightAtEnd: waitResult.inFlight,
  };

  return {
    run: runNumber,
    url,
    startedAt: wallStart,
    summary,
    lifecycle: state.lifecycle.map((event) => ({
      name: event.name,
      ms: fromNavigationMs(event.timestamp, navigationStartTs),
    })),
    requests: records,
  };
}

function normalizeRequest(record) {
  const urlInfo = safeUrl(record.url);
  const responseHeaders = lowerCaseHeaders(record.responseHeaders);
  const durationMs = record.endTs && record.startTs ? (record.endTs - record.startTs) * 1000 : null;
  const ttfbMs = record.timing?.receiveHeadersEnd ?? (record.responseTs && record.startTs ? (record.responseTs - record.startTs) * 1000 : null);

  return {
    requestId: record.requestId,
    category: categorize(record.url, record.type),
    type: record.type,
    method: record.method,
    url: record.url,
    origin: urlInfo?.origin ?? null,
    path: urlInfo ? `${urlInfo.pathname}${urlInfo.search}` : record.url,
    status: record.status,
    mimeType: record.mimeType,
    protocol: record.protocol,
    durationMs: round(durationMs),
    ttfbMs: round(ttfbMs),
    encodedBytes: record.encodedDataLength,
    decodedBytes: record.decodedDataLength,
    contentLengthBytes: parseContentLength(responseHeaders["content-length"]),
    cacheControl: responseHeaders["cache-control"] ?? null,
    cfCacheStatus: responseHeaders["cf-cache-status"] ?? null,
    age: responseHeaders.age ?? null,
    fromDiskCache: record.fromDiskCache,
    fromServiceWorker: record.fromServiceWorker,
    fromPrefetchCache: record.fromPrefetchCache,
    failed: record.failed,
    errorText: record.errorText,
    initiatorType: record.initiatorType,
    rawStartTs: record.startTs,
    rawResponseTs: record.responseTs,
    rawEndTs: record.endTs,
    startMs: null,
    responseStartMs: null,
    endMs: null,
  };
}

function findNavigationStart(records, targetUrl) {
  const target = new URL(targetUrl);
  const document = records.find((record) => {
    if (record.type !== "Document") return false;
    const recordUrl = safeUrl(record.url);
    return recordUrl?.origin === target.origin && recordUrl?.pathname === target.pathname;
  });
  return document?.rawStartTs ?? records[0]?.rawStartTs ?? null;
}

function fromNavigationMs(timestamp, navigationStartTs) {
  if (timestamp === null || timestamp === undefined || navigationStartTs === null || navigationStartTs === undefined) {
    return null;
  }
  return round((timestamp - navigationStartTs) * 1000);
}

function categorize(url, type) {
  const parsed = safeUrl(url);
  if (!parsed) return "other";
  if (parsed.pathname.startsWith("/api/")) return "api";
  if (parsed.pathname.startsWith("/_next/static/")) return "next-static";
  if (parsed.pathname.startsWith("/_next/")) return "next";
  if (type === "Image") return "image";
  if (type === "Stylesheet") return "css";
  if (type === "Script") return "script";
  if (type === "Document") return "document";
  return "other";
}

function lowerCaseHeaders(headers) {
  return Object.fromEntries(
    Object.entries(headers ?? {}).map(([key, value]) => [key.toLowerCase(), Array.isArray(value) ? value.join(", ") : String(value)]),
  );
}

function parseContentLength(value) {
  if (!value) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function safeUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function sum(records, field) {
  return records.reduce((total, record) => total + (record[field] ?? 0), 0);
}

function round(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.round(value * 10) / 10;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printRun(run) {
  console.log(`\nRun ${run.run}: ${run.url}`);
  console.log(
    [
      `requests=${run.summary.totalRequests}`,
      `api=${run.summary.apiRequests}`,
      `load=${formatMs(run.summary.documentLoadMs)}`,
      `quiet=${formatMs(run.summary.networkQuietMs)}`,
      `encoded=${formatBytes(run.summary.totalEncodedBytes)}`,
      `apiEncoded=${formatBytes(run.summary.apiEncodedBytes)}`,
      run.summary.timedOut ? "timedOut=true" : null,
    ]
      .filter(Boolean)
      .join("  "),
  );

  const apiRequests = run.requests.filter((request) => request.category === "api");
  if (apiRequests.length === 0) {
    console.log("No /api/ requests were observed.");
    return;
  }

  console.log("\nAPI requests:");
  printTable(
    apiRequests.map((request) => ({
      method: request.method,
      status: request.status ?? "ERR",
      ms: formatMs(request.durationMs),
      ttfb: formatMs(request.ttfbMs),
      size: formatBytes(request.encodedBytes || request.contentLengthBytes || 0),
      cache: cacheLabel(request),
      path: request.path,
    })),
    ["method", "status", "ms", "ttfb", "size", "cache", "path"],
  );
}

function printAggregate(runs) {
  const allRequests = runs.flatMap((run) => run.requests);
  const apiRequests = allRequests.filter((request) => request.category === "api");
  const grouped = groupBy(apiRequests, (request) => `${request.method} ${request.path}`);

  console.log("\nAggregate API endpoints:");
  printTable(
    [...grouped.entries()]
      .map(([endpoint, requests]) => ({
        endpoint,
        runs: requests.length,
        ok: requests.filter((request) => request.status >= 200 && request.status < 400).length,
        p50: formatMs(percentile(requests.map((request) => request.durationMs), 50)),
        p95: formatMs(percentile(requests.map((request) => request.durationMs), 95)),
        avgSize: formatBytes(average(requests.map((request) => request.encodedBytes || request.contentLengthBytes || 0))),
        cache: mostCommon(requests.map(cacheLabel)),
      }))
      .sort((a, b) => parseMs(b.p95) - parseMs(a.p95)),
    ["runs", "ok", "p50", "p95", "avgSize", "cache", "endpoint"],
  );
}

function printTable(rows, columns) {
  if (rows.length === 0) return;

  const widths = Object.fromEntries(
    columns.map((column) => [
      column,
      Math.min(
        Math.max(column.length, ...rows.map((row) => String(row[column] ?? "").length)),
        column === "path" || column === "endpoint" ? 110 : 16,
      ),
    ]),
  );

  console.log(columns.map((column) => pad(column, widths[column])).join("  "));
  console.log(columns.map((column) => "-".repeat(widths[column])).join("  "));
  for (const row of rows) {
    console.log(columns.map((column) => pad(String(row[column] ?? ""), widths[column])).join("  "));
  }
}

function pad(value, width) {
  if (value.length > width) return `${value.slice(0, width - 1)}…`;
  return value.padEnd(width, " ");
}

function formatMs(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  return `${Math.round(value)}ms`;
}

function parseMs(value) {
  if (!value || value === "-") return 0;
  return Number(String(value).replace("ms", ""));
}

function formatBytes(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  if (value < 1024) return `${Math.round(value)}B`;
  if (value < 1024 * 1024) return `${Math.round(value / 102.4) / 10}KB`;
  return `${Math.round(value / 1024 / 102.4) / 10}MB`;
}

function cacheLabel(request) {
  if (request.fromDiskCache) return "disk";
  if (request.fromServiceWorker) return "sw";
  if (request.fromPrefetchCache) return "prefetch";
  if (request.cfCacheStatus) return `cf:${request.cfCacheStatus}`;
  if (request.age) return `age:${request.age}`;
  return "-";
}

function groupBy(items, keyFn) {
  const groups = new Map();
  for (const item of items) {
    const key = keyFn(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return groups;
}

function percentile(values, p) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

function average(values) {
  const numbers = values.filter((value) => Number.isFinite(value));
  if (numbers.length === 0) return null;
  return numbers.reduce((total, value) => total + value, 0) / numbers.length;
}

function mostCommon(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "-";
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const runs = [];

  for (let run = 1; run <= options.runs; run += 1) {
    const result = await runBenchmark(options, run);
    runs.push(result);
    printRun(result);
  }

  if (runs.length > 1) {
    printAggregate(runs);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    options,
    runs,
  };

  if (options.output) {
    await mkdir(path.dirname(path.resolve(options.output)), { recursive: true });
    await writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(`\nWrote ${options.output}`);
  }
}

export { CdpSession, findBrowserExecutable, waitForDevToolsPort, getPageWebSocketUrl, stopBrowser };

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main().catch((error) => {
    console.error(error.stack ?? error.message);
    process.exitCode = 1;
  });
}
