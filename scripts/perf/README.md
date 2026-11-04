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
sound request, leaves cloud/cobblestone requests stalled to exercise their deadlines,
and fails the baked reflection request to exercise runtime lighting fallback.
It checks the coin icon, idle model count, and two openings through normal keyboard
controls, including that the second award matches the prefetched model.
`--runs 1 --check-showcase` seeds two saved display figures in the isolated browser,
checks that only those plus the current draw download, then switches to and opens
another series using its on-demand close-up box.
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

A coin image returned HTTP 400 in both the baseline and first updated production build,
and on the live site; the follow-up below fixes it. The live anonymous
auth check also returned its expected HTTP 401. No backend was started or deployed.

### Follow-up: selective assets, compressed boxes and baked studio

Same machine, browser settings and readiness boundary; frontend only. The previous
column is the first optimization above. Warm values are medians of three reloads;
cold values remain single samples and should be treated as estimates.

| Production workload | Previous | Follow-up |
| --- | ---: | ---: |
| Warm reload median | 1.78 s | 1.09 s |
| Warm reload observed range | 1.75–1.78 s | 1.05–1.10 s |
| Cold, unthrottled | 3.80 s | 2.63 s |
| Cold, 20 Mbps / 40 ms | 14.39 s | 8.26 s |
| Transferred before entry, cold | 30.27 MB | 15.35 MB |
| Box texture payload at entry | 21.65 MB | 5.52 MB |
| Figure downloads while idle after entry | Entire catalog | Current draw only |

Development measured 3.20 s cold and 1.52 s warm median (1.49–1.54 s), with
16.81 MB transferred cold. Keep development and production results separate.
The three-second camera introduction is unchanged and excluded from these numbers.

Close-up boxes now load only when selected, and all 58 unique close-up textures
were recompressed from original PNGs using UASTC RDO 0.5 / Zstd 18. Their combined
size fell 30.2%, from 51.49 to 35.93 MB, keeping the same resolution and mipmaps.
An original-versus-new GPU-rendered artwork comparison measured 51.3 dB front /
52.6 dB back PSNR at 1024 pixels; visually reviewed text remained crisp. This is
controlled lossy compression, not a claim that every pixel is identical.

The fixed studio reflection bake is lossless (1.19 MB), and its comparison had
zero differing raw or rendered pixels on the test GPU. Profiling before this
change attributed roughly 0.47 s to its runtime generation. The production
coin uses a static hashed import, avoiding the rejected query-string image URL.

Normal benchmarks reported no HTTP failures or page errors. The image deadline,
reflection fallback, current/next draw, saved display, and series-switch scenarios
are separately exercised with the functional commands above. Cache unit coverage
visits 320 model URLs and checks bounded retention; this is not a benchmark with
320 fully authored figures or 20 distinct released box designs.

Local reports/screenshots: `.codex-runtime/loading-v2-{prod,prod-slow,dev}.json`;
functional reports use `-check` and `-showcase`. Texture and reflection comparison
artifacts are in `.codex-runtime/box-compression-v2/`. GPU-specific performance on
mobile devices has not been measured.

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
