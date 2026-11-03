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
`world/skillactivated/containers/treasurechest01.m2` (fileDataID 219372), exported
as `daily-chest-models-001/treasurechest01.glb`. Keep its skeleton and Open/Opened/Close
clips through optimization and KTX2 conversion. `figurine-chest.ts` plays Open on
claim, holds the open pose, and plays Close when the next day's crate becomes ready.
The fishing prize still uses the separate static `chest-02.glb`.
The daily chest's printed reward box shares the shop's first released box. Its
bottom action, Space key and chest tap use the same claim handler. During local
development, each page load permits one opening without changing the saved daily
streak; production retains the daily limit. Opening/lift/reward sounds were generated
with the playground script and mastered offline; prompts and sources are recorded
in `frontend/src/data/figurines/chest-audio.json`.
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
Only series 000/001/002 have distinct boxes; future series share one gray design.
Race/form heights are runtime settings in `figurine-materials.ts`, not re-exports.
After changing figures, run catalog/material tests and review the gallery; rebake
portraits/silhouettes/box artwork only when their source appearance or design changes.
