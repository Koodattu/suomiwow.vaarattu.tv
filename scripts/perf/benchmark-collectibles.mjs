#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CdpSession, findBrowserExecutable, waitForDevToolsPort, getPageWebSocketUrl, stopBrowser } from "./benchmark-home.mjs";

// Isolated, GPU-enabled Chrome. No user profile or game save is read or modified.
const options = { url: "http://localhost:3100/collectibles", output: ".codex-runtime/collectibles.json", runs: 4, mbps: 0, latency: 0, profile: false, checkStartup: false, checkShowcase: false };
for (let i = 2; i < process.argv.length; i++) {
  const flag = process.argv[i];
  if (flag === "--profile") options.profile = true;
  else if (flag === "--check-startup") options.checkStartup = true;
  else if (flag === "--check-showcase") options.checkShowcase = true;
  else if (["--url", "--output", "--runs", "--mbps", "--latency"].includes(flag)) {
    const value = process.argv[++i];
    assert.ok(value && !value.startsWith("--"), `Missing value for ${flag}`);
    options[flag.slice(2)] = ["--url", "--output"].includes(flag) ? value : Number(value);
  } else throw new Error(`Unknown option: ${flag}`);
}
assert.ok(Number.isInteger(options.runs) && options.runs > 0);
assert.ok(Number.isFinite(options.mbps) && options.mbps >= 0);
assert.ok(Number.isFinite(options.latency) && options.latency >= 0);
assert.ok(!(options.checkStartup && options.checkShowcase), "Run empty and saved-showcase scenarios separately");
const browserPath = findBrowserExecutable();
assert.ok(browserPath, "Install Chrome/Edge or set CHROME_PATH");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const profileDir = await mkdtemp(path.join(tmpdir(), "wow-collectibles-bench-"));
await mkdir(path.dirname(path.resolve(options.output)), { recursive: true });
const browser = spawn(browserPath, ["--remote-debugging-port=0", `--user-data-dir=${profileDir}`, "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-extensions", "--headless=new", "--window-size=1280,800", "about:blank"], { stdio: "ignore", windowsHide: true });
let cdp;
const runs = [];
try {
  cdp = new CdpSession(await getPageWebSocketUrl(await waitForDevToolsPort(profileDir, 15000)));
  await cdp.connect();
  await cdp.send("Page.enable"); await cdp.send("Runtime.enable"); await cdp.send("Network.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  const displayed = [];
  if (options.checkShowcase) {
    for (const id of ["community-000", "community-002"]) {
      const catalog = JSON.parse(await readFile(new URL(`../../frontend/src/data/figurines/${id}.json`, import.meta.url)));
      displayed.push({ key: `${id}:${catalog.characters[0].id}`, quality: "golden", url: catalog.characters[0].model });
    }
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: `
      sessionStorage.setItem('suomiwow-figurine-collection-v2', ${JSON.stringify(JSON.stringify(Object.fromEntries(displayed.map(d => [d.key, { golden: 1 }]))))});
      sessionStorage.setItem('suomiwow-figurine-records-v1', ${JSON.stringify(JSON.stringify({ favorites: displayed.map(({key,quality})=>({key,quality})), boons: { coins: 10 } }))});
    ` });
  }
  if (options.mbps || options.latency) await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: options.latency, downloadThroughput: options.mbps ? options.mbps * 1e6 / 8 : -1, uploadThroughput: -1 });
  // Deliberately leave one optional sound pending: it must not hold entry hostage.
  let pendingSound = null;
  let stalledTextures = 0, missingStudio = 0;
  if (options.checkStartup) {
    await cdp.send("Fetch.enable", { patterns: ["*/figurines/audio/tap-a.mp3*", "*/figurines/world/clouds.jpg", "*/figurines/world/floor-cobble.png", "*/figurines/world/studio-*.bin.gz"].map(urlPattern => ({ urlPattern })) });
    cdp.on("Fetch.requestPaused", (event) => {
      if (event.request.url.includes("/audio/")) pendingSound = event.requestId;
      else if (event.request.url.includes("/studio-")) { missingStudio++; void cdp.send("Fetch.failRequest", { requestId: event.requestId, errorReason: "Failed" }); }
      else stalledTextures++; // Neither success nor failure: exercise the actual image deadline.
    });
  }
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: String.raw`
    window.__collectiblesBench = {ready:null, progress:[], longTasks:[], frames:[], errors:[]};
    performance.setResourceTimingBufferSize(4000);
    let seed=12345; Math.random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
    new PerformanceObserver(list=>window.__collectiblesBench.longTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:true});
    addEventListener('error',e=>window.__collectiblesBench.errors.push(e.message));
    new MutationObserver(()=>{
      const el=document.querySelector('[role=status][data-done]');if(!el)return;
      const data=window.__collectiblesBench, value=el.querySelector('i')?.style.width;
      if(data.progress.at(-1)?.value!==value)data.progress.push({time:performance.now(),value});
      if(el.dataset.done==='true' && data.ready===null){
        data.ready=performance.now();
        const gl=document.querySelector('canvas')?.getContext('webgl2'), ext=gl?.getExtension('WEBGL_debug_renderer_info');
        data.gpu=ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):null;
        data.parallelShaders=!!gl?.getExtension('KHR_parallel_shader_compile');
        data.modelsAtEntry=performance.getEntriesByType('resource').filter(e=>/\/figurines\/community-\d+\/.*\.glb/.test(new URL(e.name).pathname)).map(e=>e.name);
        let last=performance.now();const frame=now=>{data.frames.push(now-last);last=now;if(data.frames.length<120)requestAnimationFrame(frame);};requestAnimationFrame(frame);
      }
    }).observe(document,{subtree:true,childList:true,attributes:true,attributeFilter:['style','data-done']});
  ` });
  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await cdp.send("Runtime.evaluate", { expression, returnByValue: true });
    assert.ok(!exceptionDetails, exceptionDetails?.text);
    return result.value;
  };
  for (let run = 0; run < options.runs; run++) {
    stalledTextures = 0; missingStudio = 0;
    if (run === 0) await cdp.send("Network.clearBrowserCache");
    const failures = [];
    cdp.handlers.set("Network.responseReceived", [(event) => { if (event.response.status >= 400) failures.push({ url: event.response.url, status: event.response.status }); }]);
    if (options.profile) { await cdp.send("Profiler.enable"); await cdp.send("Profiler.start"); }
    await cdp.send("Page.navigate", { url: options.url });
    const deadline = Date.now() + 180000;
    let ready = null;
    while (Date.now() < deadline && !ready) { await sleep(200); ready = await evaluate("window.__collectiblesBench?.ready"); }
    assert.ok(ready, "World did not finish loading within 180 seconds");
    if (options.profile) { const { profile } = await cdp.send("Profiler.stop"); await writeFile(`${options.output}.${run}.cpuprofile`, JSON.stringify(profile)); }
    if (options.checkStartup) {
      assert.ok(pendingSound, "The slow-audio check must actually intercept a sound");
      assert.equal(stalledTextures, 2, "The world must also load when cloud and cobblestone requests never settle");
      // Development Strict Mode can start and cancel the first scene before creating the live one.
      assert.ok(missingStudio >= 1, "The reflection fallback must actually be exercised");
      assert.equal(await evaluate("window.__collectiblesBench.modelsAtEntry.length"), 1, "Only the first figure should be required before entry");
      assert.equal(await evaluate("window.__collectiblesBench.progress.at(-1).value"), "100%");
      await cdp.send("Fetch.continueRequest", { requestId: pendingSound }); pendingSound = null;
    }
    await sleep(2500);
    const data = await evaluate(`({...window.__collectiblesBench, resources:performance.getEntriesByType('resource').map(e=>({url:e.name,start:e.startTime,end:e.responseEnd,bytes:e.transferSize,decoded:e.decodedBodySize})), navigation:performance.getEntriesByType('navigation')[0]?.toJSON(), openingAvailable:!!document.querySelector('nav button[class*=opening]:not(:disabled)')})`);
    assert.ok(data.gpu, "Readiness must include a working WebGL canvas, not its error fallback");
    assert.ok(data.openingAvailable, "The world's opening control must be usable");
    assert.deepEqual(data.errors, [], "Unexpected page errors");
    const report = { run, cache: run === 0 ? "cold" : "warm reload", ...data, failures };
    if (options.checkShowcase) {
      const models = data.resources.filter(r => /\/figurines\/community-\d+\/.*\.glb/.test(new URL(r.url).pathname));
      assert.equal(models.length, 3, "Only the current draw and the two displayed figures should download");
      for (const figure of displayed) assert.ok(models.some(r => r.url === new URL(figure.url, options.url).href), `${figure.key} should load from its saved display slot`);
      await sleep(1000);
      // Visit a second series through the normal shop keyboard controls.
      const key = async (key, code) => {
        await evaluate("document.activeElement?.blur()");
        await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key, code });
        await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key, code });
      };
      const beforeBoxes = data.resources.filter(r => r.url.includes('/figurines/packaging/')).length;
      await key("s", "KeyS"); await sleep(1300); await key("2", "Digit2"); await sleep(3000);
      assert.ok(await evaluate(`performance.getEntriesByType('resource').filter(e=>e.name.includes('/figurines/packaging/')).length > ${beforeBoxes}`), "Selecting another series must load its close-up box on demand");
      await key("Enter", "Enter");
      const deadline = Date.now() + 20000;
      let opened = false;
      while (Date.now() < deadline && !opened) {
        await sleep(250);
        opened = await evaluate("JSON.parse(sessionStorage.getItem('suomiwow-figurine-records-v1')).stats?.opened === 1 && Object.entries(JSON.parse(sessionStorage.getItem('suomiwow-figurine-collection-v2'))).filter(([key])=>key.startsWith('community-002:')).flatMap(([,copies])=>Object.values(copies)).reduce((sum,n)=>sum+n,0) === 2");
      }
      if (!opened) {
        console.error(await evaluate("({text:document.body.innerText,records:sessionStorage.getItem('suomiwow-figurine-records-v1'),errors:window.__collectiblesBench.errors})"));
        const failed = await cdp.send("Page.captureScreenshot", { format: "png" });
        await writeFile(`${options.output}.failed.png`, Buffer.from(failed.data, "base64"));
      }
      assert.ok(opened, "The second series must open successfully after loading on demand");
      report.showcaseAndSeriesPassed = true;
      assert.deepEqual(await evaluate("window.__collectiblesBench.errors"), []);
    }
    if (options.checkStartup) {
      assert.equal(data.resources.filter(r => /\/figurines\/community-\d+\/.*\.glb/.test(new URL(r.url).pathname)).length, 1, "Idle time must not download the catalog");
      assert.ok(await evaluate("[...document.images].some(i=>i.src.includes('coin') && i.complete && i.naturalWidth>0)"), "The production coin icon must decode successfully");
      // Exercise the first prepared figure using the game's normal keyboard control.
      await sleep(1000);
      await evaluate("document.querySelector('nav button[class*=opening]').click(); document.activeElement?.blur()");
      await sleep(1100);
      const before = await evaluate("sessionStorage.getItem('suomiwow-figurine-collection-v2')");
      await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
      await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
      const revealDeadline = Date.now() + 20000;
      let collection = before;
      while (Date.now() < revealDeadline && collection === before) { await sleep(250); collection = await evaluate("sessionStorage.getItem('suomiwow-figurine-collection-v2')"); }
      if (collection === before) {
        console.error(await evaluate("({text:document.body.innerText,active:document.activeElement?.tagName,errors:window.__collectiblesBench.errors})"));
        const failed = await cdp.send("Page.captureScreenshot", { format: "png" });
        await writeFile(`${options.output}.failed.png`, Buffer.from(failed.data, "base64"));
      }
      assert.notEqual(collection, before, "The first box must finish revealing and award its figure");
      assert.ok(await evaluate("document.querySelector('[class*=revealIdentity] h1')?.textContent"), "The revealed figure must have a visible identity");
      report.firstOpeningPassed = true;
      const modelRequests = await evaluate("performance.getEntriesByType('resource').filter(e=>/\\/figurines\\/community-\\d+\\/.*\\.glb/.test(new URL(e.name).pathname)).map(e=>e.name)");
      assert.equal(modelRequests.length, 2, "Opening should preload exactly one next draw, without downloading the catalog");
      const predictedUrl = new URL(modelRequests[1]);
      const match = predictedUrl.pathname.match(/\/figurines\/(community-\d+)\/(.+)\.glb$/);
      const predictedKey = `${match[1]}:${match[2]}`;
      const copies = (raw, key) => Object.values(JSON.parse(raw ?? "{}")[key] ?? {}).reduce((sum, n) => sum + n, 0);
      const previousCopies = copies(collection, predictedKey);
      await evaluate("document.querySelector('[class*=drawActions] button').click(); document.activeElement?.blur()");
      await sleep(1800);
      await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
      await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
      const nextDeadline = Date.now() + 20000;
      while (Date.now() < nextDeadline && copies(collection, predictedKey) === previousCopies) { await sleep(250); collection = await evaluate("sessionStorage.getItem('suomiwow-figurine-collection-v2')"); }
      assert.equal(copies(collection, predictedKey), previousCopies + 1, "The next awarded figure must be the prefetched draw");
      report.predictedOpeningPassed = true;
      assert.deepEqual(await evaluate("window.__collectiblesBench.errors"), []);
    }
    runs.push(report);
    const screenshot = await cdp.send("Page.captureScreenshot", { format: "png" });
    await writeFile(`${options.output}.${run}.png`, Buffer.from(screenshot.data, "base64"));
    await writeFile(options.output, JSON.stringify({ options, runs }, null, 2));
    console.log(JSON.stringify({ run, cache: report.cache, readyMs: Math.round(ready), longestTaskMs: Math.max(0, ...data.longTasks.filter(t => t.start < ready).map(t => t.duration)), bytesBeforeEntry: data.resources.filter(r => r.end <= ready).reduce((sum, r) => sum + r.bytes, 0), modelsAtEntry: data.modelsAtEntry.length, gpu: data.gpu, failures }));
  }
} finally {
  if (cdp) { try { await cdp.send("Browser.close"); } catch { /* Process may already have exited. */ } cdp.close(); }
  await stopBrowser(browser);
  // Only the exact temporary directory created above is eligible for cleanup.
  assert.equal(path.dirname(profileDir), tmpdir());
  for (let attempt = 0; attempt < 5; attempt++) {
    try { await rm(profileDir, { recursive: true, force: true }); break; }
    catch (error) { if (attempt === 4) console.warn(`Temporary profile remains at ${profileDir}: ${error.message}`); else await sleep(500); }
  }
}
