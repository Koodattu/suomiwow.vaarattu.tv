# Local collectible assets

`community-001/` contains the curated, fixed-pose character GLBs. The development
opening page and debug gallery use the matching catalog at
`frontend/src/data/figurines/community-001.json`. Each file is self-contained,
uses Meshopt geometry and WebP textures (2048-pixel cap, quality 89), and must stay below 2,000,000 bytes.

The earlier two-character experiment remains in `prototype-series-001/`.
These are public static assets even though their pages are hidden/development-only.

`community-002/` is the second box: 16 different community characters,
with its catalog at `frontend/src/data/figurines/community-002.json` marked
`releaseState: "upcoming"`. Both boxes are registered in the collectible prototype.
Its local recipe is `worker/series.community-002.json`; the catalog's
`authoringSeries` identifies the frozen source batch. See
`docs/figurine-lab.md` for the roster, poses, and review notes.

Authoring runs locally in `E:\Projektit\wow.export`, using
`worker/series.community-001.json`. Full snapshots and export records for the
current batch are in `worker/data/series/community-posed-005/` there. Catalog
source paths refer to that local provenance, not website URLs. A character-level
`authoringSeries` overrides the batch for a repaired asset: Abiw now points to
`community-002-texture-fix-001`. No exporter is
needed on the VM or during a box opening.

The six roster replacements use `community-roster-refresh-001` and
`community-roster-refresh-002`: Violetmw, Röökiheal, Galardodric, Kahvishock,
Jannu, and Shippyboi. Their character-level `authoringSeries` fields identify
the exact batch. The replaced characters are no longer served by these two
catalogs; earlier authoring batches remain available locally.

The GLBs include source M2 blend metadata for additive weapon effects and a
body/boot ground and stance-center anchor. Keep that metadata when recompressing. Sheathed weapons
use Retail item sheath types and animated skeleton attachment transforms.

Use a new authoring ID for each batch, review poses and equipment visually, retain
warnings, and run `node --test frontend/test/figurine-*.test.mjs` from the repo
root. See `docs/figurine-lab.md` for workflow and remaining shader limitations.
