# Local collectible prototypes

All three pages are development-only:
- `/tools/collectibles`: focused blind-box opening and figure reveal.
- `/tools/collectibles/gallery`: one entry per character, pose/time, weapon state,
  size, and orbit controls. At most six nearby previews use GPU contexts.
- `/tools/figurine-lab`: EU lookup, Blizzard reference image, appearance JSON,
  local GLB/glTF import, and the original workbench.

Start the frontend with its normal `npm run dev` and supported Node version.
The pages and `/api/figurine-lab/character` return 404 outside development.
There are no navigation entries or production configuration changes.

## Current series

The catalog is `frontend/src/data/figurines/community-001.json`; compressed,
self-contained GLBs are in `frontend/public/figurines/community-001/`.
There are 16 unique characters, including Ovelakettu–Kazzak (Chipiepew was dropped from the pool). Each is below
2,000,000 bytes. The older two-character sample is retained separately.

| Character | Frozen pose | Weapons |
| --- | --- | --- |
| Röidy–Kazzak | Cheer, 900 ms | Held |
| Yolobolt–Kazzak | Roar, 1200 ms | Held |
| Laku–Stormreaver | SitGround, 750 ms | Sheathed |
| Melice–Kazzak | Laugh, 1100 ms | Sheathed |
| Vesipuhveli–Khadgar | Flex, 1000 ms | Sheathed |
| Turrilol–Kazzak | Dance, 2500 ms | Sheathed |
| Karstinen–Tarren Mill | Salute, 800 ms | Sheathed |
| Manfromsand–Stormreaver | Point, 900 ms | Sheathed |
| Stablol–Kazzak | Rude, 900 ms | Sheathed |
| Suursmurffi–Kazzak | Shy, 1800 ms | Sheathed |
| Rmp–Outland | Lean, 2000 ms | Sheathed |
| Rhagy–Kazzak | Roar, 1400 ms | Sheathed |
| Boxx–Stormreaver | Cheer, 400 ms | Sheathed |
| Abiw–Kazzak | Flex, 1000 ms | Sheathed |
| Chipie–Stormreaver | Kiss, 900 ms | Sheathed |
| Ovelakettu–Kazzak | Lean, 1600 ms | Sheathed |

These are static poses baked from game animations, not animated character rigs.
The box/reveal animation runs independently. Each draw is uniform with replacement;
loading and opening lock the result, retry keeps the chosen character, and reset
conceals it. Identity appears after the figure lands on the disc. Reduced motion
skips the transition. There is no persisted inventory, reward, or payment.

Static files would be public if included in a deployed build, despite the hidden
development pages. Nothing has been deployed.

## Local authoring

The exporter fork is `E:\Projektit\wow.export`. Its
`worker/build-series.mjs` accepts a selection JSON and this lab's origin:

```powershell
node worker/build-series.mjs worker/series.community-001.json http://127.0.0.1:3015
```

The builder fetches appearance snapshots, starts the local container, bakes poses,
compresses with Meshopt/WebP (2048 maximum texture dimension, quality 89), validates
decoded geometry, saves provenance, and stops the container. It requires several
GB during authoring. No exporter runs on the VM.

Each selection entry has `id`, EU `name`/`realm`, `pose`
(`animationId`, `variation`, `timeMs`), and `weapons: "held" | "sheathed"`.
Use a new authoring series ID for each batch; builds never overwrite old series.
Current source snapshots and full export records are retained under
`E:\Projektit\wow.export\worker\data\series\community-posed-005`.
Catalog `source` paths refer to that local provenance, not website URLs.
The catalog stores SHA-256, byte size, pose, warnings, and pinned WoW build.

Weapon sheathing uses Retail Item.SheatheType and skeleton attachments; hands
open when weapons leave them. Items with no sheath attachment are hidden in
sheathed mode. This does not yet reproduce player-selected hip/back overrides
introduced by later transmog options.

## Exporter corrections

Röidy is included; the underlying failure was in selection and attachment handling:

1. Haranir female uses Night Elf female as its recorded ChrRaces model fallback.
   The old selector chose the first variant when no exact Haranir entry existed,
   producing Blood Elf male boots and cloak.
2. Item 204392 now selects model 4692124 (Night Elf female) instead of 4692107.
   All 38 weighted boot bones match the character by pivot and bone-name CRC.
3. Item 253332 now selects cloak 7214253 instead of 7214234. All 10 weighted
   cloak bones match. The cloak must deform with the body skeleton, not attach
   rigidly to BACK. The fork detects shared skeletons before choosing the path.
4. Belt buckles use attachment 53. Extra rigid shoulder components share their
   slot attachment instead of being mistaken for body collections.
5. Sheath rotations use global sequence zero and its own clock. Previously the
   selected emote index skipped these global rotations, leaving back/hip weapons
   pointing horizontally. Translation, rotation, and scale now share correct
   global/per-animation track selection, covered by an attachment-matrix test.

[ChrRaces definitions](https://github.com/wowdev/WoWDBDefs/blob/master/definitions/ChrRaces.dbd)
describe the sex-specific fallback fields. The actual selection and bone matches
were checked against the pinned game data, not inferred solely from filenames.

## Texture quality, materials, and ground placement

The previous 1024-pixel cap reduced 2048×1024 body atlases to 1024×512.
The current 2048 cap preserves all four times as many body-atlas pixels and WebP
quality increases from 85 to 89. Geometry and UV arrays were decoded and compared
before/after: they are identical. Meshopt settings are unchanged; no mesh
simplification was added. Original small textures stay small; missing source
detail and unsupported WoW shader effects cannot be recovered by recompression.
The local quality comparisons are retained under
`.codex-runtime/figurine-research/texture-quality-001` and `texture-quality-002`.

GLBs retain source material mode/flags in `material.extras.wowM2`.
The Three.js viewer restores M2 modes 3 and 4 as additive, unlit surfaces with
depth writes disabled and the correct source-alpha behavior. This removes
Stablol's black weapon-effect rectangles without making dark armor transparent.
Generic glTF viewers use the standard alpha fallback and may still show these
effects differently. Full WoW shader combiners, particles, and animated UVs are
not implemented. Four existing undefined replaceable-texture warnings are retained
in the relevant character records; they are not silently treated as resolved.

`scene.extras.wowCharacter.groundY` records the lowest visible posed body/boot
vertex, excluding weapons and back pieces. The viewer places this on the disc,
so a low weapon cannot make the feet float. The same metadata includes centerX
and centerZ: the midpoint of the visible body/boot footprint within the lowest
10% of body height. This centers standing feet or seated contact independently
of weapon bounds, arm gestures, or mesh density. The viewer rotates this anchor
with the model before centering it over the pedestal. It is a stance heuristic,
not a simulated center of mass; extreme poses may still need art review. Long weapons can still intersect
the body/platform in a particular pose; choosing a suitable pose/sheath state
remains part of authoring review. Sitting figures use their body contact surface.

## Lookup and verification

Lookup preserves accented names, hidden transmogs, modifier zero, independent
shoulder appearances, and customization choices. It does not generate models.
Blizzard OAuth credentials remain server-side in the existing environment
(falling back to `backend/.env` locally); neither secrets nor tokens reach the browser.

Imported files stay in the browser. One GLB/glTF root and up to 150 MB of files are
accepted; remote resources are rejected. Meshopt/WebP are supported, Draco/KTX2
are not configured.

Run from the repository root:

```sh
node --test frontend/test/figurine-*.test.mjs
```

Run TypeScript with `--noEmit --incremental false` and targeted ESLint from
`frontend`. Exporter checks are `node --test worker/*.test.cjs`.
Tests cover draw/retry/reset, reveal landing, additive material factors, ground
anchors, exact asset hashes and budgets, localization, API input/secret handling,
race fallback, skeleton classification, sheath selection, and global-track
attachment rotation. The active catalog has 16 files totaling 14,335,584
bytes; the largest is 1,974,580 bytes. The authoring batch retains the earlier
17-character selection; Chipiepew is not served by the current catalog. All decoded GLBs validated with zero
errors/warnings and their served HTTP hashes match the catalog.

Verification: 18 frontend tests and 30 exporter tests passed; TypeScript and
targeted ESLint passed. The local authoring container is stopped.

Browser verification covers opening/reset, download failure/retry, reduced motion,
narrow layout, gallery loading, the additive effect correction, and corrected
Ovelakettu hip/Boxx back sheaths. Independent back views cover all 17 poses.
Independent
Blender front/back checks verified Röidy's fitted cloak/boots and frozen poses.
These are reviewed prototypes, not a guarantee of parity for every WoW item,
shader, race, or pose. Funko-style proportions are not implemented.

## Upcoming box 2

The separate catalog is `frontend/src/data/figurines/community-002.json`, with
models under `frontend/public/figurines/community-002/`. Its `releaseState` is
`upcoming`; neither the opening page nor the gallery imports it. The exporter
recipe is `E:\Projektit\wow.export\worker\series.community-002.json`. The catalog's
`authoringSeries` identifies the frozen batch with full appearance snapshots,
export details, compression results, and validation reports.

The eleven requested characters were resolved through read-only production
character/CCG records and verified against Blizzard appearance snapshots. Five
additional active CCG community characters were randomly sampled, excluding the
first box. No database records were changed.

| Character | EU realm | Frozen pose | Weapons |
| --- | --- | --- | --- |
| Ajotettu | Draenor | Roar | Held |
| Eppugrip | Stormreaver | Wave | Sheathed |
| Zetabeach | Stormreaver | Cat form, mid-dance | Hidden in form |
| Np | Spinebreaker | Shy | Sheathed |
| Zetacmi | Kazzak | Cheer | Sheathed |
| Hirvihotline | Stormreaver | Point | Sheathed |
| Tonza | Die Silberne Hand | Flex | Held |
| Thrusbard | Kazzak | Salute | Sheathed |
| Jampton | Kazzak | Cheer | Held |
| Morinicar | Kazzak | Roar | Sheathed |
| Mightyhuu | Kazzak | Laugh | Sheathed |
| Kuurankukká | Twisting Nether | Kiss | Sheathed |
| Raggè | Twisting Nether | Sit | Sheathed |
| Chipi | Stormreaver | Wave | Sheathed |
| Preazhy | Draenor | Sit | Sheathed |
| Mullinmallin | Kazzak | Flex | Held |

Chipi is a paladin, distinct from Chipie the priest retained in box 1. Chipiepew
is excluded from both catalogs and removed from the first authoring recipe;
historical export batches remain untouched.

Texture quality remains WebP 89 with a 2048-pixel cap. The user explicitly
approved larger files for this series: Eppugrip is 2,035,996 bytes, Zetacmi
2,086,404 bytes, and Morinicar 2,451,912 bytes. The first box's existing 2 MB test
remains unchanged. The new catalog is not yet localized/wired into a UI; its
additional race/class keys will need locale entries when that work is requested.

The final frozen batch is `community-002-posed-004`: 16 models totaling
18,000,036 bytes. Zetabeach uses the saved Ghost of the Pridemother (Green)
customization (choice 10088, creature display 66783), sampled at 500 ms of its
1000 ms EmoteDance loop. This replaces the humanoid model in the catalog;
there is still exactly one collectible for Zetabeach. Its file is 269,056 bytes.
The exporter resolves the form through ChrCustomizationElement and
ChrCustomizationDisplayInfo, retains the form's skin/geosets, and excludes
humanoid equipment. Only explicit cat appearances are supported currently;
default/random selections fail rather than picking an arbitrary skin.

Three exporter corrections were needed for these characters:

- CPU skeleton matrices now include all bones. The 345-bone Dracthyr skeleton
  places shoulder attachments above the old 256-bone limit. GPU uploads retain
  the existing shader palette limit.
- Worker imports retain faction race IDs even when the desktop race picker
  deduplicates their shared model. This fixes Hirvihotline's Haranir race 91.
- Equipment exports include fixed textures referenced by the equipment M2,
  alongside item-display replacement textures. Previously these surfaces could
  fall back to the character skin atlas without a warning.

The last correction also fixes Abiw in box 1: the Bilge Rat Swabbie's Mop and
slippers now use their own textures, checked against the current Armory image.
His pose/gear are unchanged. His catalog entry has its own `authoringSeries`
override (`community-002-texture-fix-001`); its source path is relative to that
batch. The repaired model is 638,616 bytes. Box 1 now totals 14,335,584 bytes.

Independent front/back Blender contact sheets and the Abiw comparison are saved
under `.codex-runtime/figurine-research/series-002/`. Generic Blender rendering
does not reproduce the web viewer's custom additive-material handling. Models
remain `needs-review` for release art approval; detailed weapon/body clipping
and full WoW particle/shader parity are not guaranteed by structural validation.

## Box opening

Pull the holographic tear-tape: press its tab and drag along the tape. It peels
with your finger (crackle follows drag speed, light leaks from the lid), sticks back
down if released early, chimes when fully free, and opens only on release. The
"Pull the tape to open" hint does the same from a keyboard. Opening rips the tape
away and starts a 2.4-second build-up while the drawn model loads: music swell,
knocks, seam light. The burst layers an orchestral/choir hit and a sub boom over
the cardboard pop; a choir carries the figure up. Every figure lands with the same
impact (`land-a…d`: a punchy knock over a synthesized sub thump, 95 Hz falling to ~42) and
the reveal freezes for 70 ms (hit-stop) while the camera kicks in; its class signature (`class-<classKey>-a|b.mp3`, all 13
classes) follows 80 ms later, then a fanfare. Each play picks a random variant and
nudges its speed slightly, except the music bed, riser and hum, which stay at pitch.
Before opening, grab the box anywhere off the tape to lift and shake it; it trails
the pointer on a spring and every hard change of direction plays a soft, low thunk
of the bagged figure against the cardboard (`rattle-a…e`, low-passed so nothing
clicks). The pedestal (`frontend/src/lib/figurine-pedestal.ts`) has a
rune ring with one notch per character whose inlay glows and spins with the build-up. The burst then unfolds the box, the figure rises
as a glowing silhouette, takes its colors and lands on the disc. The timeline and
its sound cues live in `frontend/src/lib/figurine-reveal.ts`; the immersive stage
keeps one renderer across rounds and precompiles shaders before the burst.

Packaging art is procedural (`frontend/src/lib/figurine-packaging.ts`). The
lineup silhouettes come from `frontend/public/figurines/<series>/silhouettes.png`;
rebuild it after changing a catalog with
`node frontend/scripts/bake-figurine-silhouettes.mjs`.

Sounds in `frontend/public/figurines/audio/` were generated with ElevenLabs sound
effects (playground `generate_sfx.py`) and mastered with ffmpeg: trimmed to the
transient and loudness-matched; the music build-ups are reversed so they swell
into the burst. Sources and prompts are logged under the playground's
`output/figurine-box-v1` to `output/figurine-box-v4`.

Latest verification: all 16 box-2 GLBs plus repaired Abiw passed decoded glTF
validation with zero errors/warnings; all 17 served hashes match their catalogs.
18 frontend tests, 30 exporter tests, and TypeScript passed. Box-2 frontend tests
retain the explicitly approved texture quality and exact hashes, including the
cat-form identity and midpoint sample. The final contact sheet is
`.codex-runtime/figurine-research/series-002/series-002-final.png`; the cat and
Abiw also have individual comparison renders. The local container and temporary
snapshot replay helpers are stopped.

## Appearance repair audit (2026-10-30)

Audited the back geometry/materials of all 32 figures and rendered both complete
lineups from behind. Eleven classic cloaks were incorrectly using the character
atlas: Yolobolt, Melice, Turrilol, Suursmurffi, Rhagy, Ovelakettu, Hirvihotline,
Tonza, Jampton, Mightyhuu and Kuurankukká. The exporter now resolves their standalone
type-2 cloak texture even when the item has no separate model. Separate back
attachments were also inspected; their equipment textures were already bound.

External customization meshes now retain their character texture types.
Morinicar's horn decorations also respect `RelatedChrCustomizationChoiceID`;
previously all 19 horn variants were enabled simultaneously. Dracthyr wing color
composites remain intact. Chipi's boot display uses a negative foot-geoset selector,
which must preserve bare feet rather than hide them; her toes now match the Armory
reference. Zetabeach's ground anchor uses visible paw/toe-weighted vertices instead
of transparent hock fur below the soles. The viewer also uses `PEDESTAL_TOP`
instead of an offset that left a small shared gap.

Seventeen figures were regenerated from frozen appearance snapshots in
`community-repairs-001` and `community-repairs-002`. Each updated catalog entry
records its batch via `authoringSeries`; original batches remain available.
Both silhouette sheets were rebuilt. Texture quality is unchanged (WebP 89,
2048-pixel cap). Current totals: box 1 is 14,472,972 bytes; box 2 is 17,742,120
bytes. Morinicar is now 2,202,032 bytes with the unwanted horn geometry removed.

Verification: all 17 rebuilt GLBs passed decoded validation without warnings;
all 32 served model hashes match their catalogs. All 35 exporter tests, 23
figurine frontend tests, TypeScript and targeted ESLint checks passed. Browser
inspection confirms Chipi's exposed feet. Review images are under
`.codex-runtime/figurine-research/cape-repair/` (`box-1-backs.png`,
`box-2-backs.png`, `chipi-fixed.png`, `morinicar-fixed.png`, `chipi-browser.png`).
These remain development models pending release art approval; the independent
Blender renders do not reproduce the viewer's additive effects exactly.

## Collectibles world

`/tools/collectibles` is one 3D scene with five views and a camera that flies between them:
main menu (overview), shop (a stall with every series' boxes), opening (the pedestal),
collection (a lit cubby cabinet, one 4×4 grid per series) and viewer (an owned figure on
the pedestal). There are no labels and no navigation buttons: tap any visible station (shop,
case, pedestal) to go there, a series' boxes to open one, an owned figure to inspect it, and
empty ground or sky to step back (or tap the station you are at). Boxes and figures can be
picked straight from the main menu. Hovered stacks, stations, the pedestal and figures get an
outer glow (`figurine-glow.ts`: an additive back-face shell for props, a blurred-alpha halo for
figure cards), and "back" returns to where the pick was made. Dragging on the hub turns the
camera around the plaza; the middle button turns every view and the wheel zooms every view.
Auto-rotation stops while you hold the camera and eases back in 2.5 s after you let go. Station shots back off until the station's width fits the screen, so phones see the
whole stall. Dragging sideways on the menu slides the camera. Keyboard: Esc back, S shop,
C collection, 1-9 pick a series, Enter opens the sealed box. The only button is
"New blind box" after a reveal (plus the sound toggle).
Series are registered in `frontend/src/lib/figurine-series.ts` with a box print theme
(`PACKAGING_THEMES` in `figurine-packaging.ts`). Series 002 uses the verdigris theme.

The collection is session-only (`sessionStorage`, `figurine-collection.ts`): figure key to
times opened; nothing is sent anywhere. Unowned figures show as black silhouettes from the
baked sheet; owned ones show a portrait rendered from their model (captured on reveal, or
regenerated from the model file after a reload). Portraits use the silhouette sheet's
framing (orthographic, feet on the bottom edge), so both stand on the cubby floor. Sheet cells
are 280×360 so nearly every pose is fitted by height and figures share one height.

World textures in `frontend/public/figurines/world/` (Elwynn cobblestone and grass, cloud and
nebula sky layers) were exported from game data with the local wow.export worker's texture
job (`kind: "textures"` in `src/worker.js`; provenance in `source.json`). Like the models,
they are game assets for this development-only page. The clearing around the plaza uses
Elwynn Forest doodads (canopy trees, bushes, rocks, stumps, hay, lamp posts) from the
worker's model job (`kind: "models"`, `{ models: [{ name, file }] }`; provenance in
`source-models.json`). They were optimized with `worker/optimizer` after stripping their
skeletons: the site draws them as static instanced meshes, and quantizing a skinned mesh
moves its scale into the inverse bind matrices. Placement is seeded in
`frontend/src/lib/figurine-forest.ts`; the camera side of the ring stays open. The grass
and cobbles blend in Elwynn dirt through painted masks (a worn rim and a path into the
woods). Where the path leaves the plaza is a small market (`marketLayout`): a human tent, the
Duskwood wagon, a signpost, crates, barrels and produce tables. No faction banners: the
market takes no side.

Loading happens once, behind a start-up screen: scenery models, every series' box (all
built up front and swapped on series change, never rebuilt), every texture uploaded, all
sounds downloaded (decoded on the first tap), portraits of every owned figure, and shaders
compiled. The figure inside each sealed box is drawn when the box arrives and preloaded
while it waits, so opening goes straight into the build-up; its case portrait shaders are
compiled with an off-screen target bound (portraits skip tone mapping, a different shader
variant) and the portrait renders at the next idle moment. Picking a series always drops its
box onto the pedestal with the thud once the camera arrives. Hovering the tape lights the
tape; hovering the rest of the box outlines the box.

The world is lit as an afternoon: a painted day sky (its PMREM is the scene environment, so
props and figures pick up soft sky shading), a warm sun whose single 2048 shadow map covers the
plaza and both stations (trees, stalls, props, the box and figures cast; figures self-shadow),
light haze fog and dimmed lantern glows. The box rests on the pedestal; its contact shadow and
glow planes lie between the two so they never cut across the box walls.
