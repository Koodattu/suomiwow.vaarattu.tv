# CCG Raid-Specific Card Finish Styling

Status: implemented and attached to their configured raid sets. The finishes remain available in the Admin CCG Card Studio for continued visual iteration.

## Scope

The configured CCG raid list in [`backend/src/config/ccg.ts`](../backend/src/config/ccg.ts) is the source of truth. This gives the research scope 20 raids from Warlords of Draenor through The War Within:

- Warlords of Draenor: 3
- Legion: 4
- Battle for Azeroth: 4
- Shadowlands: 3
- Dragonflight: 3
- The War Within: 3

Trial of Valor and Crucible of Storms are intentionally excluded. The existing CCG plan states that raids without a deliberate configuration, artwork, season mapping, and theme remain disabled; see [`docs/ccg-implementation-plan.md`](ccg-implementation-plan.md).

March on Quel'Danas and Venomous Abyss are recorded separately in the final Midnight roadmap table. Their assignments are locked to Void and Toxic respectively and are not redesign proposals.

Every card in every pack pool can roll the seven global base finishes, including Astral after Negative with a 1/2,500 base rate and 2,500-card hard pity. Each configured raid from Warlords of Draenor through The War Within also uses the finish listed below as its single raid-scoped finish, with the same 250 matching-set-card hard pity used by Void. Community redeem codes may grant any raid-specific finish without changing pack completion or protection. Until dedicated announcer recordings exist, these raid finishes use the existing Unique callouts. Other Card Studio development finishes remain preview-only.

## Overall finish system

The most useful lesson from [simeydotme/pokemon-cards-css](https://github.com/simeydotme/pokemon-cards-css) is its construction: independent material, shine, glare, mask, and pointer-reactive layers. The CCG should borrow that architecture without turning every raid into a differently colored rainbow foil.

Each raid finish should satisfy the following contract:

- **Static identity:** The finish must be recognizable without animation.
- **Restrained idle atmosphere:** Use one primary environmental behavior such as dust, smoke, rain, bubbles, snow, petals, sparks, or electricity.
- **Thematic hover response:** Tie one clear visual response directly to the pointer and card tilt.
- **Artwork readability:** The finish supports the raid artwork and character rather than obscuring them.
- **Reduced motion:** Preserve the material and pattern while freezing nonessential ambient motion.
- **Intensity budget:** Quiet finishes make the few spectacle finishes feel genuinely special.
- **Interruptible interaction:** Hover changes should follow pointer variables and explicit CSS transitions rather than uninterruptible interaction keyframes.
- **Specific transitions:** Transition only the properties that change; never use `transition: all`.
- **Measured compositing:** Reserve `will-change` for a demonstrated need and only use compositor-friendly properties such as `transform`, `opacity`, or `filter`.

## Intensity categories

| Category | Purpose | Typical behaviors |
| --- | --- | --- |
| Quiet | Material-led, premium, readable at a glance | Stone relief, velvet pile, silk glint, ceramic circuits, restrained light sweeps |
| Medium | Environmental identity without dominating the card | Smoke, rain, bubbles, spores, petals, sparks, runes, controlled refraction |
| Spectacle | A limited set of collection peaks | Cosmic cores, impossible architecture, elemental storms, casino neon, phase distortion |

## Warlords of Draenor

Blizzard presents Highmaul as the torchlit seat of the Gorian Empire, Blackrock Foundry as a strongly industrial forge, and Hellfire Citadel as a fel-twisted bastion. Sources: [Highmaul](https://worldofwarcraft.blizzard.com/en-gb/news/16863396/warlords-of-draenor-journey-into-highmaul), [Blackrock Foundry](https://worldofwarcraft.blizzard.com/en-us/news/17633660/warlords-of-draenor-raid-preview-blackrock-foundry), and [Hellfire Citadel](https://worldofwarcraft.blizzard.com/en-us/news/19546341).

| Raid | Proposed finish | Static identity | Idle | Hover | Intensity |
| --- | --- | --- | --- | --- | --- |
| Highmaul | **Relic** | Matte sandstone and hammered bronze, broad embossed ogre runes, soot-darkened edges, amber torch reflection, and a restrained plum arcane underglow. It should feel old, heavy, and imperial. | Fine arena dust drifts across the surface; torchlight flickers gently; one or two runes recharge over a long cycle. | A warm light follows the pointer and reveals the relief of the stone and bronze. Nearby runes glow, with a few embers lifting from the lower edge. | Quiet |
| Blackrock Foundry | **Slagforged** | Blackened iron plating, hammer marks, chain silhouettes, and narrow orange molten seams. The surface is mostly dark metal rather than bright fire. | Sparks rise irregularly, seams breathe between dull orange and hot yellow, and subtle vertical heat distortion passes over the art. | The pointer becomes a white-hot forge reflection. Nearby cracks flare and sparks lean with the card's tilt. | Medium |
| Hellfire Citadel | **Felscorched** | Charred Iron Horde metal breached by sharp green fel flame, burnt ash, and smoky black staining. Keep it flame-and-smoke based so it does not resemble Toxic's acid or bubbling liquid. | Dense green-black smoke travels slowly upward; small fel cinders flicker within it. | Smoke parts around the pointer and the nearest structural cracks ignite into a narrow green flame wake. | Medium |

## Legion

The raid themes are unusually distinct: corrupted nature in Emerald Nightmare, ordered arcane sophistication in Nighthold, moonlit Elune architecture invaded by fel in Tomb of Sargeras, and a cosmic annihilation forge in Antorus. Sources: [Emerald Nightmare](https://worldofwarcraft.blizzard.com/en-us/news/20271917), [Nighthold](https://worldofwarcraft.blizzard.com/en-us/news/20407404), [Tomb of Sargeras](https://worldofwarcraft.blizzard.com/en-gb/news/20783382/raid-preview-schedule-tomb-of-sargeras), and [Antorus](https://worldofwarcraft.blizzard.com/en-gb/news/21245598/raid-preview-antorus-the-burning-throne).

| Raid | Proposed finish | Static identity | Idle | Hover | Intensity |
| --- | --- | --- | --- | --- | --- |
| The Emerald Nightmare | **Nightmare** | Black and crimson root veins, thorn silhouettes, diseased petals, and dark organic blotches. It should read as corrupted forest rather than generic shadow magic. | Veins pulse almost imperceptibly; red spores drift; thin tendrils creep only a few pixels. | A corrupted bloom opens around the pointer, drawing nearby veins inward and briefly intensifying the red organic texture. | Medium |
| The Nighthold | **Nightwell** | Polished midnight-blue crystal, lavender arcane filigree, clean constellation lines, and formal palace-glass reflections. It should be ordered and elegant, not a random star field like Cosmos. | Arcane energy flows vertically like liquid light; constellation points twinkle; one large astronomical ring rotates extremely slowly. | A cool white-violet lens follows the pointer while star-map lines shift at different parallax depths. | Quiet |
| Tomb of Sargeras | **Moonfall** | Moon-silver and deep-blue temple marble, a partially eclipsed lunar disc, broken Elune glyphs, and hairline green fel fractures. | A broad moonbeam crosses the surface, low mist gathers near the bottom, and the fel cracks breathe out of sync with the moonlight. | The eclipse rim brightens around the pointer; nearby cracks ignite green and release a trace of smoky fel vapor. | Medium |
| Antorus, the Burning Throne | **Worldcore** | Obsidian Legion machinery surrounding a red-orange primordial core, with sparse stars and sharp acid-green energy conduits. It should feel cosmic-industrial rather than like another Hellfire finish. | The core beats slowly, stars move almost imperceptibly, and rare green lightning forks across the black shell. | Energy converges from the edges toward the pointer before feeding the central core, creating a localized gravity-lens effect. | Spectacle |

## Battle for Azeroth

Uldir is a failed Titan quarantine facility; Battle of Dazar'alor combines Zandalari gold, siege, and storm; Eternal Palace is Azshara's underwater empire; and Ny'alotha is the Void-shrouded Black Empire. Sources: [Uldir](https://worldofwarcraft.blizzard.com/en-us/news/22461362/the-gates-are-open-and-new-challenges-await), [Battle of Dazar'alor](https://worldofwarcraft.blizzard.com/en-gb/news/22839056/battle-of-dazar-alor-raid-preview-and-schedule), [Eternal Palace](https://worldofwarcraft.blizzard.com/en-gb/news/23021200/the-eternal-palace-raid-finder-wing-3-now-available), and [Ny'alotha](https://worldofwarcraft.blizzard.com/en-gb/news/23236726/visions-of-nzoth-now-live).

| Raid | Proposed finish | Static identity | Idle | Hover | Intensity |
| --- | --- | --- | --- | --- | --- |
| Uldir | **Quarantine** | Pale Titan gold and ivory geometry, sterile teal grids, containment glyphs, and one creeping crimson specimen stain. It should resemble a sealed laboratory panel becoming contaminated. | A narrow scanner line traverses the card; small diagnostic blocks flicker; suspended red motes remain inside the contaminated area. | The scan locks onto the pointer, the grid turns hazard amber, and the red contamination contracts before blooming outward. | Medium |
| Battle of Dazar'alor | **Tempest** | Engraved Zandalari gold mosaic under deep teal stormwater, with rain beads and navy shadows. The gold establishes the palace while the weather carries the siege into Jaina's finale. | Diagonal tropical rain and slow water trails pass over the surface; distant lightning flashes very infrequently. | Frost grows locally around the pointer, droplets shear with tilt, and the wet gold catches one hard storm flash. | Medium |
| The Eternal Palace | **Abyssal** | Dark sea-blue and amethyst mother-of-pearl, subtle naga-scale embossing, wet gloss, and refracted underwater caustics. | Caustic light flows across the card, bubbles rise at different speeds, and suspended particles drift in the current. | The pointer behaves like a refractive water lens, creating a localized ripple and bending the art beneath it. | Medium |
| Ny'alotha, the Waking City | **Empire** | Oily wine-black lacquer, carmine city silhouettes, amber slit-eyes, and impossible architectural linework. Avoid the purple singularity language of the existing Void finish. | Red fog crawls between structures; eyes blink rarely and independently; the architectural lines subtly shear out of alignment. | Perspective bends toward the pointer, one dominant eye opens or brightens, and surrounding specular light is swallowed by a dark red halo. | Spectacle |

## Shadowlands

These raids naturally suggest three different materials: gothic velvet and stained glass, cold chained steel, then clean Progenitor ceramic and geometry. Sources: [Castle Nathria](https://worldofwarcraft.blizzard.com/en-gb/news/23572634/shadowlands-season-1-preview), [Sanctum of Domination](https://worldofwarcraft.blizzard.com/en-us/news/23667538/shadowlands-sanctum-of-domination-raid-preview), and [Zereth Mortis and the Sepulcher](https://worldofwarcraft.blizzard.com/en-us/news/23762274).

| Raid | Proposed finish | Static identity | Idle | Hover | Intensity |
| --- | --- | --- | --- | --- | --- |
| Castle Nathria | **Sanguine** | Deep burgundy velvet, black gothic tracery, red stained-glass fragments, and a restrained antique-gold pinstripe. It should feel luxurious before it feels magical. | The velvet pile changes direction under a slow light; candlelight flickers; occasional dark rose petals or red dust descend. | A liquid scarlet highlight follows the pointer while the rest of the velvet deepens to matte black. Stained glass projects a small colored reflection nearby. | Quiet |
| Sanctum of Domination | **Runebound** | Cold blue-black steel, curved chain lattices, domination runes, frost, and pale soul-light trapped beneath the surface. | Soul wisps rise through the chains, highlights travel along individual links, and fine soul ash or frozen dust falls downward. | Chains visually draw taut toward the pointer, runes flash ice-white, and frost fractures outward in short lines. | Medium |
| Sepulcher of the First Ones | **Progenitor** | Warm ivory and pearl ceramic, muted gold, symmetrical concentric circuits, and small mint-teal nodes. It should feel perfectly ordered rather than conventionally mechanical. | Concentric rings counter-rotate by tiny amounts; luminous nodes travel along pathways; sparse stars remain almost static. | Rings align around the pointer and activate connected pathways without producing a large glare. | Quiet |

## Dragonflight

Vault of the Incarnates represents all four primal elements with storm as the climax; Aberrus is a laboratory of elementium, fire, and shadow; and Amirdrassil juxtaposes the Emerald Dream with consuming flame. Sources: [Vault of the Incarnates](https://worldofwarcraft.blizzard.com/en-gb/news/23891615/vault-of-the-incarnates-raid-finder-wing-1-now-live), [Aberrus](https://worldofwarcraft.blizzard.com/en-us/news/23935246/aberrus-the-shadowed-crucible-raid-finder-wing-4-now-live), and [Amirdrassil](https://worldofwarcraft.blizzard.com/en-us/news/24017500/amirdrassil-the-dreams-hope-raid-finder-wing-4-now-live).

| Raid | Proposed finish | Static identity | Idle | Hover | Intensity |
| --- | --- | --- | --- | --- | --- |
| Vault of the Incarnates | **Primalstorm** | Dark basalt and storm slate with white-violet lightning. The four edges carry restrained elemental accents: ember, frost, earth, and wind. | Snow and ash cross in opposite directions; pressure bands move through the air; lightning fires sparingly rather than constantly. | The pointer becomes the eye of the storm. The closest edge element dominates locally: frost crystallizes, embers flare, dust lifts, or wind ribbons tighten. | Spectacle |
| Aberrus, the Shadowed Crucible | **Shadowflame** | Blackened elementium and dark purple glass, orange molten seams, violet smoke, and heavy chain impressions. | Orange flame and purple smoke curl around one another while heat distortion rises through both. | Where the pointer brings the two energies together, they form a bright magenta-white hotspot; cracks flare while smoke peels away. | Medium-high |
| Amirdrassil, the Dream's Hope | **Emberbloom** | Deep emerald and teal dream-glass, lavender leaves, root filigree, and orange singed margins. | Leaves and petals fall while embers rise in the opposite direction; soft dream mist gathers around the roots. | New leaves or flowers bloom around the pointer, followed by an orange singe at their outer edge and a cooling teal counterglow. | Medium |

## The War Within

Nerub-ar Palace combines royal silk, chitin, and Black Blood; Liberation of Undermine combines chrome, casino spectacle, exhaust, and neon; and Manaforge Omega combines arcane machinery, shattered glass, ethereal magic, and reality consumption. Sources: [Nerub-ar Palace](https://worldofwarcraft.blizzard.com/en-gb/news/24135892/take-the-fight-to-nerub-ar-palace-beginning-10-september), [Liberation of Undermine](https://worldofwarcraft.blizzard.com/en-us/news/24178099), and [Manaforge Omega](https://worldofwarcraft.blizzard.com/en-us/news/24215996/ghosts-of-karesh-manaforge-omega-raid-goes-live-august-12).

| Raid | Proposed finish | Static identity | Idle | Hover | Intensity |
| --- | --- | --- | --- | --- | --- |
| Nerub-ar Palace | **Royal** | Aubergine and black chitin lacquer, gold court accents, ultrafine pearlescent silk, and a few viscous Black Blood beads near the margins. | Highlights travel along individual web strands; silk flexes at different parallax depths; dark droplets creep extremely slowly. | Strands pull taut toward the pointer, flashing violet-gold iridescence, while one dark bead refracts the art beneath it. | Quiet |
| Liberation of Undermine | **Jackpot** | Tarnished chrome, oil-slick edges, lime and turquoise neon, marquee bulbs, and a subtle casino-diamond pattern. Unlike Disco, it should contain no field of projected colored squares. | Marquee bulbs chase, exhaust smoke puffs from the edges, spotlights sweep, and occasional sparks or fireworks appear behind the art. | A spotlight locks to the pointer, the chrome shifts from green to jackpot gold, and a localized sequence of reel-like light bands races past. | Spectacle |
| Manaforge Omega | **Phaseglass** | Translucent cobalt-violet glass over black and bronze machine rings, magenta electricity, floating fractured polygons, and deep space behind the machinery. | Energy flows through the rings, fragments drift at different depths, and the surface occasionally phase-splits into subtle cyan/magenta afterimages. | The pointer bends an electric arc, pulls the glass refraction toward itself, and makes the central aperture contract like a camera lens. | Spectacle |

## Separation from existing finishes

| Existing or proposed pair | Required distinction |
| --- | --- |
| Void and Empire | Void remains cosmic absence and distortion; Empire uses architecture, red fog, and watching eyes. |
| Toxic and Felscorched | Toxic remains liquid, chemical, and acidic; Felscorched is flame, smoke, and charred iron. |
| Galaxy, Cosmos, and Nightwell | Galaxy is colorful nebula; Cosmos is a natural night sky; Nightwell is ordered arcane astronomy and palace glass. |
| Disco and Jackpot | Disco is mirror-ball projection; Jackpot is casino chrome, marquee bulbs, exhaust, and spotlights. |
| Golden and Tempest | Golden is precious foil; Tempest is wet carved architecture with rain, storm, and frost. |
| Holographic and Abyssal | Holographic uses spectral foil; Abyssal uses water refraction, caustics, and mother-of-pearl. |

## Reusable effect vocabulary

The 20 finishes should be composed from a controlled set of reusable primitives rather than 20 unrelated rendering systems.

| Primitive | Candidate finishes |
| --- | --- |
| Material relief and directional sheen | Relic, Sanguine, Progenitor, Royal |
| Sparks, embers, and heat distortion | Slagforged, Felscorched, Worldcore, Shadowflame, Emberbloom |
| Smoke, fog, and mist | Felscorched, Moonfall, Empire, Runebound, Emberbloom, Jackpot |
| Weather fields | Tempest rain, Primalstorm snow and ash, Runebound soul ash |
| Bubbles, droplets, and caustics | Abyssal, Toxic, Tempest |
| Organic growth and particles | Nightmare, Emberbloom, Royal |
| Procedural lines and marks | Nightwell star maps, Uldir containment grids, Runebound chains and runes, Progenitor circuits, Royal webs |
| Refraction and distortion | Abyssal water lens, Worldcore gravity lens, Empire perspective bend, Phaseglass chromatic phase split |
| Reactive light lens | All finishes; each should use a raid-specific shape, color, and blend behavior |

## Recommended prototype order

This sequence develops the broadest reusable effect vocabulary before the most complex combinations are attempted.

1. **Sanguine** — proves that a finish can feel premium without being loud.
2. **Abyssal** — establishes water, bubbles, caustics, and refraction.
3. **Slagforged** — establishes sparks, heat distortion, and molten seams.
4. **Royal** — establishes web geometry, thread highlights, and organic refraction.
5. **Jackpot** — establishes neon, smoke, spotlights, and chrome.
6. **Phaseglass** — establishes fractured glass, chromatic displacement, and deep parallax.
7. **Nightmare** — establishes organic growth, spores, and pulsing veins.
8. **Primalstorm** — combines weather primitives once rain, snow, ash, and lightning are proven.

## Midnight locked finish roadmap

March on Quel'Danas is the current Midnight Season 1 CCG set and is already configured with Void. Blizzard describes darkness engulfing Quel'Danas, a Void-exposed phoenix defending the Sunwell, and L'ura's dark energies threatening the Sunwell itself. Venomous Abyss is the Midnight Season 2 raid on the corrupted Coiled Isle, culminating in Ula'tek, an ancient creature of hatred, corruption, and venom. Sources: [Midnight Season 1 and March on Quel'Danas](https://worldofwarcraft.blizzard.com/en-us/news/24244646) and [Curse of Ula'tek and Venomous Abyss](https://worldofwarcraft.blizzard.com/en-us/news/24280285).

| Season | Raid | Locked finish | Raid identity | Static identity | Idle | Hover | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Midnight Season 1 | March on Quel'Danas | **Void** | A darkened Quel'Danas, Void-corrupted phoenix energy, L'ura, and the threatened Sunwell. The finish represents cosmic absence encroaching on a source of sacred light. | A near-black cosmic field with cyan, violet, and magenta refraction rings, sparse star-like points, radial distortion, and a luminous singularity response. | Brightness and saturation breathe slowly while the corona gently scales and rotates; sparse points shift in shallow parallax. | The singularity and its refractive rings follow the pointer, radial spokes intensify, and the surrounding field darkens to make the local cyan-violet light feel deeper. | Current and configured in `backend/src/config/ccg.ts`; existing Void finish is locked. |
| Midnight Season 2 | Venomous Abyss | **Toxic** | Ula'tek, poisonous waters, venomous enemies, and a corrupted ecosystem within the Coiled Isle. The finish represents living chemical contamination rather than fel flame. | A chartreuse toxic film with green-teal-violet interference, acidic droplets, bubble-like particles, wet bands, and a sickly luminous edge. | Poisonous bands flow across the surface, particle layers counter-drift, and the stats panel and quality text receive a slow toxic light sweep. | An acidic spotlight follows the pointer, droplets and bubbles shift at different parallax depths, and nearby lime-green highlights intensify into a reactive contamination bloom. | Locked roadmap assignment. The Toxic finish exists; the Venomous Abyss set is not yet present in the configured set list. |
