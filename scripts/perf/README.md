# Performance Scripts

Dependency-free scripts for measuring the production home page and API endpoints.

## Collectibles loading benchmark

Run the frontend only with `npm run dev -- --port 3100` in `frontend`. For a
production comparison, run `npm run build`, then `npm run start -- --port 3201`.
Run benchmarks sequentially, after the build/initial dev compilation has finished:

```bash
node scripts/perf/benchmark-collectibles.mjs --url http://localhost:3100/collectibles --output .codex-runtime/dev.json
node scripts/perf/benchmark-collectibles.mjs --url http://localhost:3201/collectibles --output .codex-runtime/prod.json
node scripts/perf/benchmark-collectibles.mjs --url https://suomiwow.vaarattu.tv/collectibles --output .codex-runtime/live.json
```

This uses an isolated, GPU-enabled Chrome/Edge profile and measures navigation to
the game's loading overlay becoming complete, with a working WebGL canvas and
navigation. The first of four runs has a cold browser cache; the next three are
warm reloads in the same browser. The initial three-second camera introduction
and the overlay's 0.6-second fade are additional presentation time. Existing user
profiles and saved collections are untouched. `CHROME_PATH` selects the browser.

The JSON report includes loading progress timestamps, long tasks, resource timings,
bytes, GPU identity, and 120 animation-frame intervals after entry. PNG screenshots
sit beside it. `--profile` also saves DevTools-loadable `.cpuprofile` files; profile
separately from timing comparisons because profiling adds overhead.

For a controlled cold download, use `--runs 1 --mbps 20 --latency 40`. For a local
functional regression check, use `--runs 1 --check-startup`: this holds an optional
sound request, fails the cloud/cobblestone images to exercise their fallbacks,
asserts that only the selected figure is required at entry, and opens the first box
through the normal keyboard control, checking its award and visible identity.
Keep these fault-injection checks separate from normal timing comparisons.

### 2026-11-04 measurements

Chrome headless, Windows, RTX 4090/D3D11, 1280×800, DPR 1; frontend only.
Times end when the game declares loading complete, excluding the camera introduction.
The production baseline and updated build used the same harness and machine.

| Production workload | Before | After |
| --- | ---: | ---: |
| Warm reload, median of 3 | 1.97 s | 1.78 s |
| Warm reload, observed range | 1.90–2.88 s | 1.75–1.78 s |
| Cold browser, unthrottled, 1 run | 3.88 s | 3.80 s |
| Cold browser, 20 Mbps / 40 ms, 1 run | 37.92 s | 14.39 s |
| Transferred before entry, cold | 89.21 MB | 30.27 MB |
| Figure files required at entry | 48 | 1 |

Single cold runs are estimates, not stable speedup claims. The unthrottled cold
difference is too small to distinguish from variation. The initial diagnostic
live-site sample was 4.43 s cold and 2.03–3.27 s warm (three reloads). Development
also passed the startup checks; its extra React setup/cleanup and compilation
overhead make it unsuitable as a production speed estimate.

The old 84% plateau covered GPU uploads and first-draw/shader preparation after
downloads. CPU profiling also identified synchronous environment-map generation
and a 512×512×70 fallback cobblestone calculation on every load. The update defers
the rest of the catalog, removes optional audio from the entry gate, generates the
cobblestone fallback only on failure, bakes final sky lighting once, allows up to
four texture decoder workers, and reports completed GPU preparation stages.
First-figure preparation and hidden warmup draws remain in the loading boundary.
The remaining GPU setup still costs time even when HTTP downloads are cached.

A coin image returned HTTP 400 in both the baseline and updated production build,
and on the live site; it is unrelated to this loading change. The live anonymous
auth check also returned its expected HTTP 401. No backend was started or deployed.

## Browser Home Page Benchmark

```bash
node scripts/perf/benchmark-home.mjs --url https://suomiwow.vaarattu.tv/ --runs 3 --output .perf/home.json
```

This launches an installed Chrome or Edge in a fresh profile, disables browser cache by default, records Chrome DevTools network events, waits for the page load plus a quiet network window, and prints the `/api/*` calls with timings, transfer sizes, and cache headers.

If Chrome or Edge is installed somewhere unusual:

```bash
$env:CHROME_PATH = "C:\Path\To\chrome.exe"
node scripts/perf/benchmark-home.mjs --runs 3
```

## API Endpoint Benchmark

Benchmark the expected home page API calls:

```bash
node scripts/perf/benchmark-api.mjs --base https://suomiwow.vaarattu.tv --runs 10 --output .perf/api.json
```

Replay the exact GET `/api/*` endpoints discovered by the browser benchmark:

```bash
node scripts/perf/benchmark-api.mjs --from .perf/home.json --runs 10 --output .perf/api-from-home.json
```

Benchmark one endpoint directly:

```bash
node scripts/perf/benchmark-api.mjs --endpoint "/api/progress?raidId=42" --runs 20
```

Useful flags:

- `--warmup 0` disables warm-up requests.
- `--delay-ms 1000` reduces request pressure.
- `--cache-bust` appends a changing `__bench` query parameter to avoid shared cache hits.

## Interpreting Results

Start with the slowest p95 API endpoints and the largest encoded payloads. For this app, likely candidates to inspect first are the progress payload, live streamer payload, event feed payload, and any image-heavy crest or static asset traffic visible in the browser benchmark.
