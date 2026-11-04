# Collectibles: local asset workflow

Current instructions; [figurine-lab.md](figurine-lab.md) retains historical decisions.
Game code: `frontend/src/app/tools/figurine-lab/FigurineStage.tsx` and
`frontend/src/lib/figurine-*.ts`. Catalogs: `frontend/src/data/figurines/community-*.json`.
Runtime assets: `frontend/public/figurines/`; originals never belong there.

## Get models on this machine

The exporter fork is `E:/Projektit/wow.export`; read its `worker/README.md` for job
schemas. Use Node 24.22.1+ and Docker Desktop with Linux containers. From that repo:

```powershell
# Characters: copy a series recipe, give the batch a fresh ID, then:
node worker/build-series.mjs worker/series.example.json http://127.0.0.1:3000
# Props: submit your own model search/export JSON with a fresh *-models-NNN ID:
docker compose -f worker/compose.yaml up -d --build
node worker/submit.cjs path/to/props.json pond-models-002
# Wait for completion; stop only the worker you started, when no other job owns it.
docker compose -f worker/compose.yaml stop
```

Prop jobs use `{"kind":"models","search":["fishing"],"limit":200}` to discover
paths, then `models: [{name, file}]` with returned M2 paths/fileDataIDs to export.
Results: `worker/data/results/<job-id>/`; inspect `result.json` and `search.json`.
Animated props use `"animations": true` on a model job. The daily chest is
`7du_challengechestuber01.m2`, exported as `plaza-chest-models-001/chest-uber.glb`.
Keep its skeleton and Open/Opened/Close clips through optimization and KTX2 conversion. `figurine-chest.ts` plays Open on
claim, holds the open pose, and plays Close when the next day's crate becomes ready.
The fishing prize still uses the separate static `chest-02.glb`.
The daily chest and fishing coin rewards use `spells/treasuregoblin_coinpile.m2`
(fileDataID 916363), exported as `coins-2026-11-03-models-001` and registered as
`coin` in `figurine-props.ts`. Its HUD icon is baked from that same model with
`node scripts/bake-fish-cards.mjs 3211`, then `http://localhost:3211/?coin`.
The chest's bottom action, Space key and chest tap use the same claim handler. During local
development, each page load permits one opening without changing the saved daily
streak; production retains the daily limit. Opening/lift/reward sounds were generated
with the playground script and mastered offline; prompts and sources are recorded
in `frontend/src/data/figurines/chest-audio.json`.
District props (market, fair, hall, forge and quest models) come from
`plaza-districts-models-001` to `-004`, recorded under `districts` in `source-models.json`.
Their optimizer output is capped at 512px, or 256px for props seen only from afar, then
converted from the original PNGs to embedded ETC1S. To compare candidates, export a batch
of up to 32 models and render it as a contact sheet before choosing; the models retired on
2026-11-04 are in `.codex-runtime/retired-models-2026-11-04/` with hashes in `manifest.json`.
Character provenance: `worker/data/series/<batch>/sources/<figure>.json`, selected
poses in `selection.json`, optimized files in `models/`. Preserve frozen snapshots;
use catalog `authoringSeries` (per-character override takes precedence).

Stage geometry through `worker/optimizer/optimize.mjs`'s exported
`optimize(source, destination, {maxTextureSize, quality: 89})` function; it is not a CLI.
The series builder already does this. Review poses, equipment and prop orientation;
remove unused rigs only for static props. Keep Meshopt and `wowM2`/`wowCharacter`
metadata. This optimizer's WebP output is an intermediate, not the final runtime asset.
Copy reviewed staged files into `frontend/public/figurines/world/models/` or the
matching `community-NNN/` folder before conversion; keep their source filenames.
Choose texture dimensions for the actual viewing distance (figures cap at 2048).

## Convert and verify in this repository

From `frontend`, with a fresh ignored work directory for each batch:

```powershell
$exporter = 'E:/Projektit/wow.export'
$toktx = 'C:/Users/Juha/.codex/visualizations/2026/10/31/01a192df-a72f-7d90-b786-87aadc794f7a/ktx-tools/portable/bin/toktx.exe'
$work = '../.codex-runtime/ktx-models-YYYY-MM-DD-NNN'
node scripts/convert-figurine-assets.mjs $exporter $toktx $work --apply
node --test test/figurine-ktx.test.mjs
```

The converter uses existing dependencies in `$exporter/worker/optimizer`, backs up
inputs, skips ETC1S, and converts **original PNG exports** at the staged dimensions:
ETC1S q255/clevel2, full mipmaps, power-of-two dimensions. It matches source material
slots, validates decoded GLBs, checks non-image buffers are unchanged and rejects
concurrent edits. Omit `--apply` to prepare outputs only. Do not transcode old WebP
pixels or overwrite original exporter results. Reports/backups stay in `$work`.

Register world assets in `figurine-props.ts`/`figurine-forest.ts`; bump their
`PROP_VERSION`/`MODEL_VERSION` after replacement. Catalog hashes/URLs update automatically.
All GLTF loaders need the renderer's KTX2 loader (`/figurines/basis/r186/`). Archive
retired models and unused catalogs under `.codex-runtime/`, after checking references;
the test rejects unregistered served GLBs. The 2026-11-02 archive is
`.codex-runtime/retired-models-2026-11-02/`, with hashes in `manifest.json`.

Exceptions: close-up boxes use UASTC (2K artwork/1K masks); shelves use ETC1S.
Close-up encoding is q2, RDO lambda 0.5, Zstd 18, with full mipmaps; keep source PNGs.
`bake-figurine-boxes.mjs` includes these settings in content hashes. The 2026-11-04
recompression preserves dimensions and reduces the 58 unique close-up maps from
51,490,062 to 35,926,089 bytes. Originals, source PNGs, the previous manifest and
per-file results are preserved in `.codex-runtime/box-compression-v2/`.
Only series 000/001/002 have distinct boxes; future series share one gray design.
Only the selected series loads close-up artwork; the scene retains at most two
other recently selected boxes. Shelf boxes use the small ETC1S tier. For the first
English box these tiers are about 4.97 MB and 181 KB respectively. Twenty distinct
series should therefore add small shelf textures to startup, not twenty close-up sets.
Race/form heights are runtime settings in `figurine-materials.ts`, not re-exports.
After changing figures, run catalog/material tests and review the gallery; rebake
portraits/silhouettes/box artwork only when their source appearance or design changes.

## Studio reflections and loading

The fixed `RoomEnvironment` PMREM is baked once and stored as gzip-compressed,
lossless half-float RGBA data. It is **already convolved**: load it as a
`CubeUVReflectionMapping` DataTexture, without running PMREM over it again.
Its manifest records the Three.js revision. Missing, stale or timed-out bakes fall
back to the original runtime calculation. The painted world sky stays dynamic.

To rebake after a Three.js upgrade, from `frontend`:

```powershell
node scripts/figurine-benchmark-server.mjs ../.codex-runtime/studio-bake 3222
# Open http://localhost:3222/bench/bake-figurine-environment.html in Chrome.
# Pass the resulting report filename to:
node scripts/bake-figurine-environment.mjs ../.codex-runtime/studio-bake/browser-<timestamp>.json
node --test test/figurine-environment.test.mjs test/figurine-ktx.test.mjs
```

Create the work directory first; preserve the previous bake when replacing it.
The current 1,194,775-byte bake reproduced the original pixels and rendered metallic
spheres identically on the benchmark GPU.

Figure downloads now follow use: current sealed draw, saved display figures, and
one next draw prefetched while opening. Selecting another series or inspecting a
figure loads it on demand. The compressed-file LRU retains at most 32 MiB; the
existing GPU cache has its own budget. Catalog metadata remains available for
the collection UI; idle time no longer fetches every model. Decorative image loads
have an eight-second deadline and cannot repaint a disposed scene or apply late.
