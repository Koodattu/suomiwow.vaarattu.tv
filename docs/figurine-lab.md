# Local collectible prototypes

The game is available by direct link only while it is a work in progress:
- `/collectibles`: focused blind-box opening and figure reveal, with an image-only
  SuomiWoW logo in the top left that returns to the main site.
- `/collectibles/gallery`: development-only; one entry per character, pose/time, weapon state,
  size, and orbit controls. At most six nearby previews use GPU contexts.
- `/tools/figurine-lab`: development-only; EU lookup, Blizzard reference image, appearance JSON,
  local GLB/glTF import, and the original workbench.

Start the frontend with its normal `npm run dev` and supported Node version.
The gallery, workbench, and `/api/figurine-lab/character` return 404 outside development.
Collectibles has no public navigation entries or sitemap entry and uses `noindex, nofollow`.

## Current series

The catalog is `frontend/src/data/figurines/community-001.json`; compressed,
self-contained GLBs are in `frontend/public/figurines/community-001/`.
There are 16 unique characters, including Ovelakettu–Kazzak (Chipiepew was dropped from the pool). Each is below
2,000,000 bytes. The older two-character sample is retained separately.

| Character | Frozen pose | Weapons |
| --- | --- | --- |
| Röidy–Kazzak | Cheer, 900 ms | Held |
| Yolobolt–Kazzak | Roar, 1200 ms | Held |
| Laku–Stormreaver | WALean01, 0 ms | Hidden |
| Jannu–Kazzak | Point, 900 ms | Sheathed |
| Vesipuhveli–Khadgar | Flex, 1000 ms | Sheathed |
| Turrilol–Kazzak | Dance, 2500 ms | Sheathed |
| Karstinen–Tarren Mill | Salute, 800 ms | Sheathed |
| Kahvishock–Kazzak | Roar, 1000 ms | Sheathed |
| Stablol–Kazzak | Rude, 900 ms | Sheathed |
| Suursmurffi–Kazzak | Shy, 1800 ms | Sheathed |
| Rmp–Outland | Lean, 2000 ms | Sheathed |
| Violetmw–Kazzak | Wave, 800 ms | Sheathed |
| Shippyboi–Outland | Salute, 800 ms | Sheathed |
| Abiw–Kazzak | Flex, 1000 ms | Sheathed |
| Chipie–Stormreaver | Kiss, 900 ms | Sheathed |
| Ovelakettu–Kazzak | Lean, 1600 ms | Sheathed |

The 2026-10-30 roster refresh replaces Rhagy, Preazhy, Mullinmallin,
Manfromsand, Melice, and Boxx with Violetmw, Röökiheal, Galardodric,
Kahvishock, Jannu, and Shippyboi respectively, retaining their box and slot.
There are still 16 figures in each box. Frozen appearances and exports are in
`community-roster-refresh-001` and `community-roster-refresh-002`; each new
catalog entry identifies its batch. All six use sheathed weapons. Röökiheal
uses Shy at 1500 ms; Galardodric uses Laugh at 1100 ms. The first-box poses are
listed above. Both silhouette sheets and canonical authoring recipes match
this roster. Retired models are removed from the active public asset folders;
historical authoring batches remain intact.

All six replacement GLBs passed decoded validation with zero errors/warnings,
and front/back Blender renders were checked against their Armory references.
Texture settings remain WebP 89 with a 2048-pixel cap. Box 1 now totals
13,916,292 bytes; box 2 totals 16,248,556 bytes. Review renders are under
`.codex-runtime/roster-update/`. Full WoW particle/shader parity remains outside
the current exporter; Blender also differs from the web viewer's additive effects.

These are static poses baked from game animations, not animated character rigs.
Laku's updated batch is `community-laku-lean-002`: WALean01 (1260, variation 0)
at 0 ms, with the weapon completely hidden and hands open. It reuses the frozen
appearance snapshot; the 556,224-byte model passed decoded validation with no
errors or warnings, and front/back Blender renders confirm the pose and absent
weapon. The first box's silhouette sheet was rebuilt with this pose.
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
(`animationId`, `variation`, `timeMs`), and `weapons: "held" | "sheathed" | "hidden"`.
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

## Box 2

The separate catalog is `frontend/src/data/figurines/community-002.json`, with
models under `frontend/public/figurines/community-002/`. Its `releaseState` is
`upcoming`; both boxes are registered in the current collectible prototype. The exporter
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
| Röökiheal | Kazzak | Shy | Sheathed |
| Galardodric | Outland | Laugh | Sheathed |

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
classes) follows 80 ms later, then a fanfare. A figure whose CCG card has a quip then says it
(`/ccg/audio/quips`, mapped per figure in `frontend/src/data/figurines/quips.json` with a
gain that levels the clips), with the fanfare ducked under the voice. Supporter-card media is
not used. The CCG stores which clip belongs to which card in its database
(`CcgAlternativeArt.quipAudioFilename`); the map here was matched by name, so a quip saved
under another filename needs adding by hand. Each play picks a random variant and
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

Collectible form policy: non-Evoker Dracthyr default to their humanoid visage;
Evokers default to their Dracthyr form. This is resolved from race/class in the
local exporter, so future series inherit it without name-specific rules. A recipe
entry can explicitly set `"form": "dracthyr"` or `"form": "visage"` to override
the default for that character. Other races and the existing druid cat selection
are unaffected. Export provenance records the resolved form and model file ID.

Eppugrip and Zetacmi in box 2 were rebuilt from their frozen appearances in
`community-visage-001`, preserving transmog and emotes. Both exports retain all
26 selected visage customizations, have zero export/validation warnings, and
were visually checked in Blender. Their compressed models are 875,404 and
1,367,568 bytes respectively. Their collection silhouettes were regenerated;
Morinicar remains in Dracthyr form as an Evoker.

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

`/collectibles` is one 3D scene with a home and stations round it. Home is the centre: the
pedestal, seen head-on with the shop and the case at either side, holding either a sealed box
(opening) or an inspected figure (viewer). Both share one camera, so swapping between a box
and a figure never moves it, and returning from a station lands where the camera was left.
The stations are the shop, the collection case and the recycler; the camera flies there and
back in under a second. The trading post and the hall of fame already stand at the plaza
(`figurine-outposts.ts`) but are not open: tapping one only says "coming soon".
There are no labels and no buttons: tap a station to go there, a series' boxes to get a box,
an owned figure to inspect it, and empty ground or the station you are at to come back. From
home, boxes and figures can be tapped straight in the background stations. A picked box drops
onto the pedestal with its thud, timed to land as the camera arrives. After a reveal, the next
box comes from the shop. Hovered stacks, stations and figures get an outer glow
(`figurine-glow.ts`: an additive back-face shell for props, a blurred-alpha halo for figure
cards). At home the camera orbits all the way round (left or middle drag) and zooms; the shop and the
case hide while the camera is close to them or behind them, so the orbit never clips into
them. In the shop the middle button turns the shot; in the collection dragging pans across
the case and the wheel zooms in close. Auto-rotation is slow, stops while you hold the camera
and eases back in 2.5 s after you let go. Hovered figures in the case get a soft halo and keep
their size. Station shots back off until the station's width fits the
screen, so phones see the whole stall; when that pulls a shot back past the pedestal, the box
steps aside. Keyboard: Esc back, S shop, C collection, M recycler, 1-9 pick a series (in the
shop), Enter opens the sealed box. The figure's name and details appear as it
lands. The only button is the sound toggle.
Series are registered in `frontend/src/lib/figurine-series.ts` with a box print theme
(`PACKAGING_THEMES` in `figurine-packaging.ts`). Series 002 uses the verdigris theme.
Announced series (`UPCOMING_SERIES`, 003–020) have no figures yet, only a hue: `seriesTheme`
prints their box in the same scheme around it. They fill the shop greyed, can be picked and
dropped on the pedestal (full colour there, so the print can be seen) and shaken, but the
tape never comes off.

### Shop and case at scale

The shop is a stepped riser on the stall's counter: one box per series, five to a step,
series 001 front left. Each step rises more than a box is tall, so every step's price tag
(number and collected count, or "coming soon") shows over the boxes in front. Twenty series
fill four steps.

The collection is glass display cases, one shelf per series and five shelves to a case, side
by side as series grow (pan across them). Each shelf has its series' box at the left end and
sixteen figures on round bases in two staggered rows, the back row on a clear riser; only a
card's middle takes taps so the rows never steal each other's taps. The case shows every
released series and fills its last case with the next announced ones, on shelves washed in
their colour and labelled "coming soon". Missing figures are faint frosted outlines; a base's
colour is the figure's finest quality, and spare copies show as a count beside it. A
completed series' shelf turns gold.

### Qualities, recycler and trade-up

Every box rolls a quality with its figure (`rollQuality`, `figurine-collection.ts`):
standard (89 %), golden (10 %, 1 in 10) or galaxy (1 %, 1 in 100). The
finishes (`figurine-finish.ts`) are swapped onto the figure's own meshes: golden is polished
metal with the paint's light and shade kept as engraving, galaxy a screen-fixed nebula with
twinkling stars and a violet rim. Both reflect a neutral studio environment, not the green sky.
The reveal and viewer show a quality badge; the case shows each figure in its finest quality.

The recycler (`figurine-machine.ts`) is a gnomish machine with a pegboard of every figure
owned more than once (one card per quality, with its spare count). Tap a card to load a copy
into one of three slots, tap a loaded card to take it back, and pull the lever. The display
says what the three will make: three copies of one figure at one quality trade up to the next
quality (the figure is shown on the pedestal afterwards); any other three make a blind box of
the series most of them came from (it pops out of the chute, then drops on the pedestal). It
refuses to recycle the last copy of any figure. The rules are pure functions in
`figurine-collection.ts` (`trayGroups`, `machineOutcome`, `machineChanges`) and the
collection changes as one all-or-nothing set. There are no box limits yet, so a recycled box is
just another box.

The collection is session-only (`sessionStorage`, `figurine-collection.ts`): figure key to
copies per quality; nothing is sent anywhere. The first prototype's counts (key
`…-collection-v1`) carry over as standard copies. Owned figures show a portrait rendered from
their model at their quality (captured on reveal, or regenerated from the model file after a
reload). Portraits use the silhouette sheet's framing (orthographic, feet on the bottom edge),
so all stand on their bases. Sheet cells are 280×360 so nearly every pose is fitted by height
and figures share one height. Box limits, trading and leaderboards will need the collection on
the server: anything kept in the browser can be edited by the player.

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

Station props came from a second model job (`station-models-001`; provenance under
`stations` in `source-models.json`, loaded through `figurine-props.ts`): the Tinker Town
gear that spins on the recycler, a gnome exhaust pipe, work lamp, pistons, bucket and tool; a
Duskwood shop counter and gnomish postbox for the trading post; a notice board and podium for
the hall of fame. Candidates looked at and left out: the Gnomeregan gnome machine and broken
machine, hut machinery, hazard light, steel plate, goblin weathervane and orc wanted poster.

Loading happens once, behind a start-up screen: scenery and station models, every released
series' pedestal box (built up front and swapped on series change, never rebuilt; announced
series' boxes are built when picked, the last two kept), every texture uploaded, all sounds
downloaded (decoded on the first tap), portraits of every owned figure and every recycler card,
and shaders compiled. The figure inside each sealed box is drawn when the box arrives and preloaded
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

## Deferred: gravity-driven gear (2026-10-31)

Deferred at the user's request. Do not start a physics implementation or rebuild
collectibles for it until requested. Some rope-hung ornaments use physics-driven
bones rather than ordinary animation tracks. Both our fork and the upstream
wow.export M2 loader currently skip PFID (external physics) and PFDC (embedded
physics); playing or freezing an animation cannot reproduce that simulation.
This is a possible cause of rigid dangling parts, not a diagnosis for every item.
The `.phys.obj` collision export is not this simulation data.

Research references:

- [Upstream M2 loader](https://github.com/Kruithne/wow.export/blob/main/src/js/3D/loaders/M2Loader.js)
- [PHYS research and hanging-gear examples](https://www.wowmodding.net/files/file/133-phys-template-mop-and-wod/)
- [Elune M2 source](https://github.com/elune-m2/addon) and
  [physics documentation](https://elune-m2.github.io/documentation.html#physics).

Elune documents importing embedded/external physics versions 0–6 and previewing
bone-driven bodies/joints in Blender. This is a candidate, not a tested dependency;
its preview uses Blender's solver and does not promise WoW-identical motion.
A future experiment should extract one real affected weapon, retain its rig,
place it in the final held/sheathed orientation, fix its anchor, settle the dangling
parts, and bake the resulting geometry before our normal compression. A mid-swing
snapshot instead requires simulating the preceding movement. Test both orientations,
attachment stability and collisions, and compare against the game. No browser
physics is needed for a static result. Do not infer which bones should sag simply
from their names. Inspect tool compatibility and license before integrating code.

## Secret Series 000 — prepared, models deferred (2026-10-31)

Update: the owner subsequently authorized a render gallery. Local review batch
`E:/Projektit/wow.export/worker/data/series/secret-000-review-001/` contains all
sixteen models from the saved 12:17 UTC snapshots. Valopallo uses EmoteRude (73),
variation 0, at exactly 53 ms with weapons sheathed. All sixteen compressed
models passed decoded validation with zero errors or warnings (12,308,704 bytes
total, 330,088–1,833,384 bytes each). The local gallery and decoded render inputs
are in `.codex-runtime/figurine-research/series-000/review-001/`. This is a review
batch only; the website catalog remains unreleased. The earlier preparation
notes below describe the pre-export state.

Review flags: the Blender sheets show rectangular effect surfaces on Tonzidan
and visible red effect planes on Syöpä, including after approximating the
website's additive materials. Compare these in the website renderer before
attributing them to export data or approving the batch. Geometry validation is
not visual sign-off. Front/rear PNG sheets and `index.html` are in the review
folder; the local review server uses port 3019.

The canonical roster and future exporter recipe is
`frontend/src/data/figurines/community-000.json`. It contains exactly the sixteen
requested EU characters, in requested order: nine on Kazzak and seven on Outland.
All sixteen resolved through the development Armory endpoint. Frozen appearance
snapshots are local-only in `.codex-runtime/figurine-research/series-000/<id>.json`;
the manifest records class/race, lookup timestamp and reference image. No model
exports, silhouettes or character renders were generated.

After the owner logged into all sixteen characters, their appearances were
refreshed on 2026-10-31 at 12:17 UTC. The new local batch is
`.codex-runtime/figurine-research/series-000/refresh-2026-10-31T12-17-41-646Z/`.
Each `imports/<id>.json` is a raw Battle.net appearance response, not a native
desktop import file. Use `wow-export/<Name>-<Realm>.json` with the desktop
Import JSON / Import Character buttons. These version-2 files contain race/model
IDs, model-specific customization choices, equipment and appearance modifiers.
All sixteen passed the actual direct JSON import handler with a simulated UI;
model mappings and choices were checked against cached game tables. No visual
preview was performed. `snapshots/` preserves the full lab responses; `jobs/`
contains validated future worker inputs outside any watched queue. The batch
also includes the matching series recipe and a README with the pose table.
Importing appearance alone does not apply the recipe's pose or weapon placement.
All sixteen profiles report logins on the refresh date. Earlier snapshots remain
intact. No exports or renders were performed during this refresh.

The manifest is compatible with wow.export's `validateSeries`; extra authoring
metadata is ignored by that validator. Emote timestamps and weapon placement are
provisional until the target models' animations can be checked. Preserve the
standing rule: non-Evoker Dracthyr use visage unless explicitly overridden.

The barrel at world x=11.3, z=-2.1, beside the right of the collection case, is the
hidden interaction. It selects an amber Series 000 box on the pedestal. The box
remains sealed and says coming soon until real models are registered. There is no
shop entry, announcement, draw-pool entry, or keyboard shop shortcut for
this series. Its collection shelf is hidden until the first Series 000 box is
opened and a figure is added to the collection. Selecting the barrel/box alone
does not unlock it. Once unlocked, the full sixteen-slot shelf appears at the
very top, above Series 001; uncollected figures keep the usual silhouettes.
The cabinet updates immediately without resetting the reveal or camera. The
existing session collection restores the unlock on reload (any owned quality
counts), and the recycler preserves the last copy. Unreleased series never
unlock a shelf, even if stale collection data mentions them. The target is tied to one barrel instance, not every barrel; foreground
scenery/stations block the pick. This is an Easter egg, not an access-control boundary.

When model generation is requested later:

1. Copy the recipe to a new authoring batch ID before invoking
   `E:/Projektit/wow.export/worker/build-series.mjs`; do not run the builder now.
   Choose whether to replay the saved appearances or refresh them intentionally.
2. Verify the emotes exist and sample times fit each model; render and review
   transmog, attachments, feet, capes, effects, and ground placement.
3. Compress at the approved improved texture quality, validate, copy the reviewed
   models into `frontend/public/figurines/community-000/`, and bake silhouettes.
4. Register the real catalog for opening/collection while retaining its hidden
   distribution. Supply its real keys, models and silhouettes to the world and
   mark it released. The existing collection-shelf policy then unlocks its top
   shelf after the first opening. Never add it to the normal shop or public
   announced series as a side effect of release.

Preparation verification: 37 figurine tests, targeted ESLint, TypeScript, and the
exporter's recipe/job validators pass. Browser check on `http://localhost:3000/collectibles`:
tapping the chosen broken barrel selects Series 000, Enter leaves it sealed, and
the collection keeps its normal 001–005 shelves. No model jobs were queued.

Secret-shelf regression checks cover first ownership at all qualities, session
restoration, unknown/zero-count entries, unreleased data, shelf ordering across
cases, and safe cabinet replacement without disposing shared box/portrait assets.

## Series 000 armor and weapon repair review (2026-10-31)

The latest local review batch is
`E:/Projektit/wow.export/worker/data/series/secret-000-repair-001/`.
All 16 compressed GLBs rebuilt successfully with zero export warnings and zero
validation warnings; total size is 16,169,292 bytes. Tonzidan is 2,674,732 bytes
because its masked weapon effects are now included. Improved texture quality is
retained. The front/back review gallery is in
`.codex-runtime/figurine-research/series-000/repair/`, served locally on port 3019.
The previous review batch remains available on disk for comparison.

Root causes and fixes in the wow.export fork:

- A single candidate in ComponentTextureFileData bypassed gender/class filtering.
  Some classic female chest pieces therefore received a male-only lower-torso
  panel. Apply the normal filter even to a single candidate, and skip a region
  when no compatible texture exists. Röiza, Valopallo, Valotettu and Röi were
  checked in the frontend lab after rebuilding.
- Base clothing layers 13 (top) and 14 (bottom) were both enabled globally.
  The new default `chrIncludeBaseClothing: "auto"` evaluates chest and legs
  independently. Visible armor suppresses that region's underwear; hidden or
  empty slots retain it. Existing explicit true/false settings remain supported.
  In a desktop installation with saved preferences, choose **Underwear → Auto
  (per armor slot)**. Dalarian's rebuilt layers were checked in the lab.
- Tonzidan and Syöpä use two-texture M2 effects, while equipment export retained
  only the first texture. The posed GLB path now bakes the supported Mod_Mod and
  Mod_Mod2x combinations using both UV sets, texture transforms and opacity.
  Their opaque rectangular sheets are gone in the frontend review. This is a
  static texture bake, not a complete implementation of animated or
  view-dependent WoW shaders; future unfamiliar effect types still need review.

Röiza now uses EmoteFlex (82), variation 0, 39 ms, sheathed. Öitä uses Ready1H
(26), variation 0, 700 ms, held. Valopallo retains EmoteRude (73), 53 ms,
sheathed. The canonical community-000 recipe contains these changes.

The optimized effect bake was verified by rebuilding both affected weapons in
`secret-000-effect-check-001`: compressed model SHA-256 hashes exactly match the
initial repair batch. Export duration changed from 424,684 to 29,011 ms for
Tonzidan and 19,883 to 6,232 ms for Syöpä (excluding worker startup/compression).
Exporter regression coverage includes gender-only regions, independent underwear
rules, both texture combiners, UV transforms and overlapping effect faces.
Series 000 is still unreleased; these files were not registered in the website
catalog or copied into public assets.

## Series 000 enabled in the local collectibles world (2026-10-31)

The repaired batch `secret-000-repair-001` is now registered in
`frontend/src/data/figurines/community-000.json`, with all sixteen compressed
GLBs in `frontend/public/figurines/community-000/` and a freshly baked silhouette
atlas. Each catalog entry records its byte size and SHA-256. `RELEASED_SERIES`
includes the secret figures for draws, inspection and the recycler;
`FIGURINE_SERIES` remains the public shop roster. No shop entry, announcement or
number-key shortcut was added for Series 000. Its repaired files retain the
approved texture quality, including Tonzidan's 2.67 MB GLB.

A printed amber Series 000 box now sits inside the marked broken barrel beside
the collection cabinet. A measured cavity anchor in barrel.glb (-0.022, 0.296,
-0.088) positions it inside the upright barrel; whole-mesh bounds incorrectly
include fallen staves outside it. The world box is scaled to 65% to clear the
inward broken wood, with its centre at about y=0.315 and its lid at y=0.53.
The broken opening faces away from the plaza. Both the box and that barrel can select the
series; nearer props still block selection. Its print is reused for the newly
unlocked shelf and recycler output. The shelf stays hidden until the first
secret figure is received, then appears above Series 001 with all sixteen slots.
The game uses the existing session collection persistence.

Play verification: selecting the visible barrel box brought Series 000 to the
pedestal, opening it revealed Valopallo, and its shelf immediately appeared at
the top with 1/16 collected. Targeted tests verify asset hashes/sizes, bilingual
race/class labels, public-shop exclusion, picking/occlusion and shelf unlocks.
TypeScript and targeted ESLint pass. This is a local website change, not a
production deployment; the earlier deferred/review-only notes above are history.

The browser play check also confirmed that reloading retains Series 000's top
shelf and 1/16 count, and clicking the owned Valopallo opens the normal figure
viewer. The pre-opening shelf had no Series 000 row. Twenty targeted figurine
checks pass, including both maintained locales and every shipped model hash.

## Lightforged rune export repair (2026-10-31)

Valotettu's white forehead rectangle came from the body exporter retaining only
the first input of a two-texture `Combiners_Mod_Mod` material. Body submesh 88
uses the rune atlas twice, with distinct UVs and a scrolling first-layer transform.
The static-pose exporter now bakes supported fixed-texture body effects through
the same mask/UV-transform baker as equipment. The rune remains visible; it is
not removed or replaced with a character-specific transparency workaround.

`secret-000-face-repair-002` replaces only Valotettu's shipped GLB (998,992 bytes),
with an updated catalog hash and cache-versioned URL. It is byte-identical to the
visually reviewed repair. glTF validation reports zero errors and warnings.
The lab comparison against the original export confirms the white square is gone.
Other shader families, replacement-texture body effects and animated desktop
exports retain their prior behavior; this fix does not promise complete WoW shader parity.

Draenei and Lightforged Draenei labels exist in both English and Finnish, following
the existing convention of English in-game race names. The catalog regression
check now covers race/class labels for all three released series, not only Series 000.

Valotettu's subsequent pose update is `secret-000-valotettu-rude-001`:
EmoteRude (73), variation 0, 53 ms, weapons sheathed. The 998,672-byte GLB,
catalog hash/cache version and Series 000 silhouette atlas are updated together.
The forehead rune fix remains in this export; validation has zero errors/warnings.

Timing clarification: the intended value was wow.export **frame 53**, not 53 ms.
The final batch is `secret-000-valotettu-rude-frame53-001`, EmoteRude at 883 ms
(rounded from `53 / floor(4.667 * 60) * 4667`), weapons sheathed. The shipped
999,264-byte model and silhouette atlas replace the earlier 53 ms version.

`secret-000-bow-rude-001` updates three more Series 000 poses: Röi uses AttackBow
(46) at 100 ms with the bow drawn, Jousivakio uses ReadyBow (29) at 700 ms with
the bow drawn, and Syöpä uses EmoteRude (73) at frame 53 (883 ms), weapon sheathed.
All three were inspected in the frontend lab. Their GLBs, catalog pose metadata,
hashes/cache versions and the shelf silhouette atlas are updated together.
