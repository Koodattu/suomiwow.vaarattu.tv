# SuomiWoW CCG Implementation Plan

## Status

Planning document only. This document describes the agreed product behavior, data model, media pipeline, user experience, technical architecture, rollout, and verification strategy for the SuomiWoW collectible card feature.

The feature is free, non-tradable, and non-commercial. It does not include card battles, purchases, a marketplace, or real-world value.

## Product summary

SuomiWoW CCG turns Finnish World of Warcraft raid characters into collectible cards. A card represents an immutable snapshot of one character in one raid tier. A character receives a new snapshot in the same raid set when its canonical S-F rarity grade or its dominant Mythic spec, role, or metric changes; an already published card never changes.

The product has two collection modes:

- **Current** contains every enabled active raid.
- **Legacy** contains every enabled past raid.

Every raid tier is its own set and binder. Legacy storage recharges by one pack every Helsinki half-hour, while Current storage recharges every Helsinki hour. Both modes store up to 50 rechargeable packs. Current packs draw from all enabled active raids; Legacy packs draw from all enabled past raids.

Guests begin with 20 packs in each mode. A first-time authenticated CCG player begins with 20 packs in each mode, including existing SuomiWoW accounts that have never played CCG. Guest collections persist on the server and remain linked to the browser by a rolling device cookie. A guest may explicitly log in to transfer the complete guest collection to an account that has no prior CCG activity. An established CCG account cannot import guest pulls.

### Community set

`Community` is a CCG-only set for curated characters that do not meet normal raid eligibility or do not yet exist in the Warcraft Logs character database. It has its own collection binder but no dedicated pack.

- Admins add a character by region, realm slug, name, and rarity. The backend resolves the public profile, active specialization, role, guild, avatar, and full render through Blizzard Profile APIs without fetching Warcraft Logs.
- If the character already exists locally, the Community record links to it. Otherwise it retains a stable Blizzard identity that can be reconciled when the character later enters the normal raid pipeline.
- Current, random Legacy, and targeted Legacy packs may all contain Community cards. Rarity is selected by the normal pack rules first. Within that rarity, a Community result must win both its proportional pool roll and a second 50/50 gate; a failed gate keeps the already selected raid card.
- Community cards are immutable snapshots with no performance metrics. Their card metric panel displays `Community`.
- A stable `collectorKey` links Community and normal raid variants of the same character to one alternative-art definition, shared quips, and administrative identity reconciliation. It does not define ownership, alternative-art unlock scope, or duplicate identity.

## Goals

- Make opening packs and discovering recognizable community characters feel exciting.
- Preserve each card as a historical raid-tier snapshot.
- Give every raid tier a distinct visual identity.
- Make the collection feel like a physical card binder rather than a generic data grid.
- Support anonymous play while making account creation valuable.
- Reuse existing character, raid, ranking, mechanics, Mythic+, authentication, queue, scheduler, and MongoDB infrastructure.
- Keep storage and pack opening efficient as collections grow.
- Add Blizzard character avatars to character profile pages.

## Non-goals for the initial release

- Card battles or deck building
- Trading between users
- Buying packs or cards
- Crafting, dusting, or selling duplicates
- User-generated cards
- Client-side image export or canvas composition
- A guarantee that historical Legacy artwork matches historical transmog

## Locked product decisions

### Card identity and immutability

- A character has one stable card series per `{setId, characterId}` and one immutable card document per published snapshot version.
- The first eligible snapshot is published. Later snapshots are published when `tierGrade`, `specName`, `role`, or `metric` differs from the latest published version.
- Pack pools and the catalog use the latest published version in each card series. Finish ownership belongs to the series, while share links keep pointing to their selected immutable snapshot.
- A collector unlocks only the exact snapshot version they acquire. Publishing a later version does not add it to existing collections; the collector must pull or redeem that version before it appears in their snapshot selector. Acquiring a later version never unlocks earlier versions.
- Collection completion counts a card series once. The viewer defaults to the newest snapshot that collector has explicitly unlocked and offers only their unlocked versions, all with the same series-wide finishes and quantities.
- A character appearing in a later raid tier receives a new card in that set.
- Card identity, scores, guild, realm, class, specialization, role, grade, art source, crop, and publication metadata are immutable after publication.
- The Current set becomes Legacy at raid rollover without modifying its cards.
- Current cards are published in waves so the set can operate during an active tier.

Recommended publication schedule:

1. Open the set approximately two weeks after the raid launches, once the data is meaningful.
2. Publish all currently eligible characters.
3. Publish newly eligible characters and rarity-changing versions once per week.
4. Publish a final newcomer wave when the tier closes.
5. Lock the set and move it to Legacy.

The initial delay and publication cadence remain configurable per set.

### Tier grade is card rarity

The snapshotted character tier grade determines the user-facing rarity. The CCG uses `S`, `A`, `B`, `C`, `D`, `E`, and `F`.

The grade maps to an internal rarity bucket for pack selection and visual styling:

| Tier grade | Internal bucket | Baseline visual treatment |
| --- | --- | --- |
| S | Artifact | Light-gold metal; maximum ornament and strongest rarity glow |
| A | Legendary | Yellow-orange; rich ornament and premium frame treatment |
| B | Epic | Deep-purple layered frame and portal lighting |
| C | Rare | Blue foil surface and brighter frame detail |
| D | Uncommon | Green metallic accents and modest ornament |
| E | Common | White, restrained matte frame |
| F | Poor | Gray, minimal ornament |

`tierGrade` is authoritative. `rarityBucket` may be stored as denormalized, indexed data, but must be derived from the set's versioned grade mapping.

The grade is calculated once at publication from one canonical, unfiltered global population. It must not depend on frontend filters. The grading snapshot records its algorithm version and source timestamp.

### Duplicates

Duplicates do not upgrade card rarity. Rarity represents the character's snapshotted raid-tier performance and must remain truthful.

- Duplicate identity is the card series `{setId, characterId}`. A newer immutable snapshot in that series shares finish and completion state; the same character in another raid set is a different card series.
- A finish that is not yet owned for that card series is awarded unchanged, even when another finish of the series is already owned.
- If the rolled finish is already owned, the result fills the closest missing finish below it first. If no lower gap remains, it advances to the closest missing finish above it so every pre-completion duplicate advances the card.
- A card series is complete when every finish in its set's pack ladder is owned for that series. The default ladder is Standard, Foil, Golden, Prismatic, Holographic, and Negative; a raid-scoped finish is inserted between Holographic and Negative only for its configured raid set. Community cards always use the six-finish default ladder, even when code-exclusive raid finishes are owned.
- Completing the final missing finish does not immediately award a pack. The first later duplicate on that already-complete series awards one pack credit for that series, and the idempotency key prevents any snapshot version from rewarding again.
- A completed card in a Current raid awards a Current pack. A completed card in a Legacy raid awards a Legacy pack. Community cards do not award completion packs.
- Alternative art is a separate card-series cosmetic unlock scoped to `{setId, characterId}`. It never affects duplicate classification or finish completion, and one unlock makes the alternative art available for every owned finish and explicitly unlocked snapshot in that raid or Community set only.
- Ownership stores and displays quantities such as `×2` and `×7`.
- Copies are not destroyed when a completed-card reward is granted.
- Guest results are provisional: completed-card rewards are calculated against the authenticated collection during a valid claim and no spendable guest bonus credit exists before login.

### Finishes

Finish is independent of tier grade:

- **Standard** uses the baseline treatment for the card's tier grade.
- **Foil** adds a restrained reactive material and is the first upgraded finish.
- **Golden** adds warm metallic treatment, enhanced frame detail, and restrained animated highlights.
- **Prismatic** adds a spectral edge, microfoil, richer pointer-responsive lighting, and the premium reveal.
- **Holographic** intensifies the spectral depth and animated diffraction beyond Prismatic.
- A raid may optionally add one themed finish between Holographic and Negative. **Void** is the March on Quel'Danas finish; **Toxic** is reserved for a future poison-themed raid. Both finishes are immediately available as code-exclusive rewards for Community cards without entering Community pack rolls, pity, duplicate protection, or completion.
- **Negative** applies the rare full-card inverted treatment and is the highest production finish.

Each non-Standard finish has a persistent per-owner protection counter. Base-finish counters are shared by Current and Legacy openings. A raid-scoped finish has a separate counter keyed by raid-set slug and advances only when a card from that set is pulled. Its chance remains at `1 / hardPity` through the first 80% of the interval, then follows a quadratic soft-pity ramp to a guaranteed hit at hard pity. The selected raw finish resets its own counter even when duplicate protection converts it, and a different non-Standard finish awarded by that conversion also resets its counter. Finish rolls are independent, but a card receives only the highest finish that succeeds, so reaching one hard pity cannot turn the rest of a pack into the same premium finish.

Initial hard-pity limits:

- Foil: 5 cards
- Golden: 25 cards
- Prismatic: 50 cards
- Holographic: 100 cards
- Raid-scoped finish: 250 matching-set cards by default
- Negative: 1,000 cards

Odds are versioned configuration, not hard-coded business logic.

## Card content contract

### Card front

Every card front contains:

| Area | Content |
| --- | --- |
| Identity | Character name |
| Affiliation | Guild and realm |
| Character | Class, specialization, and role icon |
| Set | Raid tier name and set symbol |
| Performance | DPS/HPS, Mechanics, Combined, and Mythic+ |
| Tier | S–F grade |
| Finish | Golden or Prismatic marker when applicable |
| Art | Blizzard full character render over the raid background |

The card does not show a numeric placement such as `#12`.

### Score mapping

- **DPS/HPS** is the normalized role-performance component. Use `parseScore`; display DPS or HPS according to the card's stored metric.
- **Mechanics** is the survival/mechanics component. Use `survivalScore`.
- **Combined** is the existing combined performance-mechanics score. The current implementation weights parse and survival equally.
- **M+** is `scores.all` from the Raider.IO Mythic+ season explicitly mapped to the raid set.
- Tomb of Sargeras maps to Raider.IO `season-7.2.5` and Antorus maps to `season-7.3.2`. Highmaul, Blackrock Foundry, Hellfire Citadel, Emerald Nightmare, and Nighthold intentionally have no CCG Mythic+ mapping, so their cards display `—` for M+. Uldir through Ny'alotha map to BFA seasons 1–4; Castle Nathria, Sanctum, and Sepulcher map to Shadowlands seasons 1–3; Vault, Aberrus, and Amirdrassil map to Dragonflight seasons 1–3; and each later raid maps to its matching expansion season. Remix seasons such as Shadowlands season 4 and Dragonflight season 4 are deliberately excluded because they span multiple raids and are not the original tier snapshot.
- Snapshot creation joins Mythic+ only on the set's exact configured season. It never falls back to the current season; a missing or zero historical score is displayed as unavailable.
- **Tier grade** is the snapshotted canonical S–F classification.

Mythic+ is supplementary. A missing Mythic+ score displays `—` and does not block card publication.

The nightly Mythic+ maintenance has two bounded passes. At 00:45 Helsinki time, before the weekly CCG snapshot, a historical score-repair pass finds eligible characters that lack one or more stored main-season results, requests only those missing seasons, and does not fetch dungeon details. The current-season pass later refreshes active characters and dungeon runs. Positive scores are stored normally, while an explicit Raider.IO zero-score row is stored as `no_score` so it is not retried forever. A failed request or a requested season omitted from an otherwise successful response remains a gap and is retried by a later bounded pass. Published CCG cards remain immutable; repaired values are available to character views and future CCG snapshots.

All dynamic numbers use tabular numerals in the UI.

### Card detail or back

Keep the front readable. The focused card view or back may additionally show:

- Set number
- Performance snapshot date
- Media capture date
- Publication wave
- Class and specialization names
- Role and source metric
- Item level at snapshot
- Pull and report counts
- Kills, deaths, and survival details
- Source partition
- Score definitions
- Grading and pack-rule versions
- Finish quantities
- Acquisition history summary

## Character eligibility

A raid card candidate requires:

- At least three distinct Mythic reports in the raid
- At least 50 Mythic boss-pull appearances across the raid tier
- A stable internal `Character._id`
- Valid role-performance data
- Valid mechanics/survival data
- A valid combined score
- A successfully fetched Blizzard full character render

Mythic report count is materialized separately from the broader Heroic-or-Mythic participation count. Snapshot creation reads the authoritative per-raid participation rows directly, sums report counts across guilds, and requires at least three Mythic reports even when an admin bypasses readiness coverage checks. Existing character tier-list mechanics data remains the source of truth for the 40-pull threshold and requires calculated role-performance, mechanics, and combined scores rather than adding a second scoring pipeline.

The card snapshots the stable guild ID, name, and realm of the guild with which the character recorded the most Mythic reports in that raid tier. Total qualifying reports, then most-recent appearance, provide deterministic tie-breakers. Guild attribution is not rewritten when the character later transfers.

Achievement-completed characters are useful seeds for media fetching, but achievement completion does not itself make a character eligible for a card.

### Canonical grading population

The publisher calculates tier grades from the complete eligible population for the publication wave:

- No user-selected role, class, guild, or report-count filters
- One actual character per `Character._id`
- Stable ordering for score ties
- Versioned calculation inputs and algorithm

The resulting grade is written to the card and never recalculated.

## Current and Legacy modes

The overall feature is called SuomiWoW CCG. The recommended user-facing tabs are **Current** and **Legacy** so that “CCG” is not both the product name and a mode name.

### Current

- Contains every enabled raid in the active raid tier or season.
- Grants ten daily Current packs.
- Draws across the complete Current card pool automatically.
- Receives weekly publication waves for newcomers and rarity-grade changes.
- Moves to Legacy when the next raid becomes Current.

### Legacy

- Contains enabled sets from Highmaul through the set immediately preceding Current. Trial of Valor and other intentionally unconfigured raids remain excluded.
- Grants ten daily Legacy packs.
- Draws across every enabled historical raid in one combined Legacy pool.
- Preserves the originating raid set on every result and keeps the collection organized into raid-specific binders.
- Adds the former Current set at raid rollover.

Grade odds remain global and versioned. Within the selected grade, every eligible card in the mode has equal weight, so larger raid sets contribute proportionally more cards without requiring one oversized MongoDB pool document.

### Administrative activation

- Configured raids begin as disabled `draft` candidates and are absent from all player-facing endpoints and pack pools.
- Admins can run a read-only readiness check showing eligible characters, Blizzard renders, media coverage, published cards, and explicit blockers.
- Initial thresholds are configurable and default to 100 eligible characters, 50 ready renders, and 75% render coverage.
- Enabling performs a fresh snapshot and publication before atomically recording `enabledAt`, `enabledBy`, and the target Current or Legacy lifecycle state.
- Enabling is irreversible. There is no disable endpoint or UI control after activation.
- Enabling a Current raid moves enabled Current raids from older Mythic+ seasons to Legacy; raids sharing the same current season may coexist.
- An activation that moves an older Current season records an immutable, sequenced rollover event in the same transaction. The admin must confirm against the current activation revision so a stale preview cannot move an unexpected raid.
- Raids without an intentional CCG configuration, background, season mapping, and theme remain excluded. This keeps Trial of Valor, Crucible of Storms, and short or meme raids such as Sporefall disabled by default.

### Recharge balances

- Recharge boundaries use the `Europe/Helsinki` clock.
- Current and Legacy balances are independent and both cap at 50 rechargeable packs.
- Recharge is calculated lazily for the requesting owner; there is no hourly database-wide user scan.
- Earned completed-card credits persist until opened.
- Rollover reconciliation is also lazy. At the cutover timestamp, every unused Current balance and bonus credit becomes Legacy, authenticated Current storage is reset to 50, and guest Current storage is reset to 20.

### Pack contents

Initial pack configuration:

- Five cards per pack
- Four weighted slots
- One guaranteed `A`-or-better slot
- Server-side cryptographic random selection
- Versioned odds and pool configuration stored with every opening

The client never submits card IDs, grades, rarity buckets, finishes, or random results.

## Guest play and account conversion

### Guest identity

- The backend creates a random persistent guest token for the browser.
- The raw token is stored only in a Secure, HttpOnly, SameSite=Lax cookie.
- MongoDB stores only a cryptographic hash of the token.
- The cookie uses the browser-supported 400-day maximum lifetime and is renewed whenever the guest uses a CCG endpoint.
- Guest records, openings, ownership, pack balances, and related progress do not expire or reset at the Helsinki daily boundary.
- The `dateKey` on guest-owned activity records remains acquisition provenance only; it is never part of guest identity or retention checks.
- Clearing site cookies or allowing the browser cookie to expire removes the device's recovery credential. The server-side collection remains intact but cannot be automatically reassociated without that token.
- The UI offers an explicit login action after a pack has been revealed.

Cookie resetting and other lightweight abuse are accepted product tradeoffs. Basic rate limiting and idempotency are still required to prevent accidental or automated request floods.

### Guest pack storage

Guests receive:

- 20 initial Current packs with a 50-pack storage cap
- One Current pack on every Helsinki hour while storage is below the cap
- 20 initial Legacy packs with a 50-pack storage cap
- One Legacy pack on every Helsinki half-hour while storage is below the cap
- Five cards per pack

Guests cannot open completed-card bonus packs while logged out. An explicit claim transfers the complete server-recorded guest collection, including exact quantities and alternative-art unlocks, to an eligible authenticated account.

### Claim on login

An eligible guest-to-user claim:

1. Validates that the guest record and selected five-card opening belong together and are unclaimed.
2. Requires the authenticated account's persistent CCG `hasPlayed` marker to be false.
3. Reconstructs the complete guest collection from immutable server opening records and rejects any ownership mismatch.
4. Transfers the verified card, finish, quantity, alternative-art, and quality-protection state to the authenticated collection.
5. Preserves every opening's provenance and marks the openings and guest identity claimed.
6. Leaves the account's first-time 20 Current and 20 Legacy starting balances intact and converts up to 20 unspent guest packs per mode into persistent login-conversion credits.

`hasPlayed` becomes true when an authenticated account opens any rechargeable or bonus-credit pack, or when it claims its one eligible guest collection. Existing ownership and committed openings are also checked while migrating older account records. This prevents an established player from logging out, opening guest packs, and importing them later.

Claiming must be an idempotent database transaction.

## Collection experience

### Binder model

The primary collection experience resembles a physical card album:

- Current has a featured binder.
- Legacy presents a shelf of raid-specific binders.
- Each binder cover uses its raid background and set identity.
- Desktop binder pages use a 3×3 pocket layout.
- Tablet and mobile reduce the pocket count without shrinking cards below readable sizes.
- The default **All cards** view shows collected cards only.
- The **By guild** view defaults to collected cards and can optionally reveal missing cards as numbered dark silhouettes.
- Owned pockets treat each raid card as a separate collectible, even when the same character appears in another raid.
- Selecting a pocket opens the large card viewer.
- The focused viewer lets the user switch between owned finishes and see quantities.
- Set and finish completion remain visible near the binder controls.

The binder is a real collection affordance, so a repeated card grid is appropriate here. A searchable index view can be added as a utility for large collections, but it is secondary to the binder.

### Set numbering

- Assign a stable, monotonically increasing set number at publication.
- Published numbers never change.
- Weekly newcomer cards append to the Current binder.
- Legacy backfills may be numbered deterministically during import.

### Filters and navigation

Useful collection controls:

- Raid set
- All cards or By guild
- Searchable raid-tier guild selector
- Collected only or Show missing within a selected guild
- Tier grade
- Finish
- Class
- Role
- Character or guild search

All controls require English and Finnish localization.

## Card and pack visual system

### Direction

Use a hybrid of the explored visual directions:

- Portal Artifact artwork depth and reveal drama
- Performance Showcase information density and legibility
- Raid Reliquary's restrained raid-specific material details

The card anatomy remains stable, while each raid season can change its frame, palette, sigils, foil mask, pack wrapper, and opening portal.

### Rarity escalation

Ornament and motion increase with tier grade:

- F is gray Junk with minimal ornament.
- E is white Common with a restrained matte treatment.
- D is green Uncommon with metallic accents.
- C is blue Rare with foil and stronger edge treatment.
- B is deep-purple Epic with layered depth and more active portal lighting.
- A is yellow-orange Legendary with rich ornament and premium frame behavior.
- S is luminous light-purple Mythic with the strongest rarity glow and richest set treatment.

The score panel stays engineered and legible at every grade. Higher rarity must not reduce readability.

### Theme versioning

Every set stores `themeKey` and `themeVersion`. Old themes remain renderable. Updating a future season must not redesign previously published cards.

Prefer one shared card component driven by versioned theme tokens and narrowly scoped theme modules. If a future season materially changes anatomy, introduce a new renderer version instead of complicating the original component with unlimited conditionals.

### Hover tilt and foil

- Enable pointer-responsive tilt only on fine-pointer devices.
- Limit rotation to approximately six degrees.
- Drive the spectral reflection from pointer position.
- Use `requestAnimationFrame` or interruptible CSS transitions.
- Animate composited properties such as transform, opacity, and filter.
- Do not use `transition: all`.
- Disable tilt and sweeping foil for `prefers-reduced-motion`.
- Do not apply hover tilt to touch devices.

## Pack-opening experience

The backend resolves and commits the pack before the reveal animation begins. The frontend only reveals immutable server results.

Recommended sequence:

1. Show the selected mode's pack and remaining allowance.
2. Pressing the pack breaks a seal or opens a raid-themed portal.
3. Five face-down cards enter with an approximately 100 ms stagger.
4. Edge lighting hints at tier without revealing the card prematurely.
5. Cards reveal individually or with **Reveal all**.
6. B, A, S, Golden, and Prismatic results progressively increase light, material, and sound treatment.
7. Keep the result visible until the user dismisses it.

Because users may have ten or more packs available daily, support:

- Open one
- Open all five for the selected mode/set
- Reveal all
- Skip or shorten repeated animations after the first complete experience

Reduced-motion mode uses short crossfades or immediate results, without flashing, sweeping reflections, or forced delays.

Card reveal controls and cards must be keyboard accessible and expose a readable result summary to assistive technology.

## Raid background assets

Raid backgrounds are stored in:

`frontend/public/ccg/`

The folder contains wide raid assets covering Highmaul through March on Quel'Danas. The original Uldir-and-later source set is listed below:

The WoD and Legion expansion adds `highmaul.png`, `blackrock_foundry.png`, `hellfire_citadel.png`, `emerald_nightmare.png`, `nighthold.png`, `tomb_of_sargeras.png`, and `antorus.png`. Trial of Valor has no configured set.

| File | Intended set |
| --- | --- |
| `uldir_desktop.avif.png` | Uldir |
| `bfd_desktop.webp` | Battle of Dazar'alor |
| `crucible_desktop.avif.png` | Crucible of Storms |
| `eternal_palace_desktop.webp` | The Eternal Palace |
| `nyalotha_desktop.jpg` | Ny'alotha, the Waking City |
| `CastleNathriaRaid_Masthead.jpg` | Castle Nathria |
| `sanctum_of_domination_bg_masthead.jpg` | Sanctum of Domination |
| `sepulcher_of_the_first_ones_desktop.jpg` | Sepulcher of the First Ones |
| `vault_of_the_incarnates_desktop.jpg` | Vault of the Incarnates |
| `Black_Dragon_Lab_Raid_Desktop.jpg` | Aberrus, the Shadowed Crucible |
| `Amirdrassil_Desktop.jpg` | Amirdrassil, the Dream's Hope |
| `Nerub-ar_Palace_Desktop.jpg` | Nerub-ar Palace |
| `Liberation_of_Undermine_Desktop.jpg` | Liberation of Undermine |
| `Manaforge_Omega_Desktop.jpg` | Manaforge Omega |
| `March_on_QuelDanas_Desktop.jpg` | March on Quel'Danas |

Most assets are 2400×750. Manaforge Omega and March on Quel'Danas are 2048×640. The wide format is suitable for producing varied crops behind a vertical character card.

### Required asset normalization

Several filenames do not match the actual encoded format. Before use, normalize the extension and/or encoding so that static serving returns the correct content type:

- `crucible_desktop.avif.png` is AVIF.
- `eternal_palace_desktop.webp` is AVIF.
- `Liberation_of_Undermine_Desktop.jpg` is WebP.
- `Nerub-ar_Palace_Desktop.jpg` is AVIF.
- `nyalotha_desktop.jpg` is WebP.
- `sanctum_of_domination_bg_masthead.jpg` is AVIF.
- `sepulcher_of_the_first_ones_desktop.jpg` is AVIF.
- `uldir_desktop.avif.png` is AVIF.
- `vault_of_the_incarnates_desktop.jpg` is AVIF.

Perform this as an explicit asset task and review the resulting diff. Do not silently rename assets while unrelated implementation work is underway.

### Deterministic crop variation

Every published card receives a stable background crop:

```ts
type CardBackgroundCrop = {
  x: number; // percentage
  y: number; // percentage
  scale: number;
};
```

Recommended approach:

- Configure safe `x`, `y`, and scale ranges per set.
- Derive a deterministic seed from the card identity.
- Resolve and store the actual crop at publication.
- Use roughly 1.04–1.16 for background scale unless a set needs tighter bounds.
- Keep the crop identical for all duplicates and finishes of the same card.
- Change finish lighting and material, not the underlying card composition.

Safe ranges are necessary because several backgrounds have important focal subjects near an edge. Fully unrestricted random positioning could create empty, low-contrast, or distracting crops.

## Blizzard character media

### API

Use the regional World of Warcraft Character Media profile endpoint:

```text
GET https://{region}.api.blizzard.com/profile/wow/character/{realmSlug}/{characterName}/character-media
    ?namespace=profile-{region}
    &locale={locale}
```

Use the existing Battle.net application credentials and app-access-token cache. No new per-user Blizzard authorization is required.

Expected useful assets:

- `avatar` for character profile pages
- `main-raw` for the transparent full character render used on cards
- `inset` may be stored if useful later, but is not required for the initial design

### Character media model

Create a dedicated media record keyed by the stable internal character identity:

```ts
type CharacterMedia = {
  characterId: ObjectId;
  region: string;
  realmSlug: string;
  characterName: string;
  avatarUrl: string | null;
  insetUrl: string | null;
  mainRawUrl: string | null;
  sourceUpdatedAt: Date | null;
  fetchedAt: Date | null;
  status: "pending" | "available" | "not_found" | "failed";
  attemptCount: number;
  nextAttemptAt: Date | null;
  lastErrorCode: string | null;
};
```

Store URLs and metadata in MongoDB, not image binaries.

### Media queue

Implement a separate character-media queue following the existing achievement and Mythic+ job patterns:

- Atomic `findOneAndUpdate` claim
- Pending, processing, completed, retry, and permanent/not-found states
- Bounded exponential backoff
- Attempt counters and next-attempt timestamps
- Stale-processing recovery
- Admin status and retry controls
- TaskLog integration

Seed the queue from:

- Characters with successful achievement fetches, for avatar coverage
- Current and Legacy card candidates, for full renders
- Character profile requests that lack media, as a low-priority backfill signal

A 404 should not retry continuously. Treat it as not found for a long cooldown, while allowing later retry because characters can transfer or rename.

### Character profile avatar

Extend the character-profile response with optional media:

```ts
media?: {
  avatarUrl: string | null;
};
```

The character page at `frontend/src/app/characters/[realm]/[name]/` displays the avatar near the character identity. The current class icon remains the fallback for missing or failed media.

Use explicit image dimensions and an error fallback to prevent layout shift.

### Browser and CORS behavior

Direct Blizzard CDN display works in a normal image element. The CDN does not reliably provide the CORS headers needed for client-side canvas export. Do not base the initial implementation on browser canvas composition.

If image export or shareable composites are added later, implement an approved server-side composition/proxy path.

## Legacy artwork limitation

Historical scores, guild, realm, role, grade, and raid participation can be reconstructed from stored historical data. Exact historical character appearance generally cannot, because full character renders were not captured during those tiers.

Legacy behavior must be honest:

- Use the historical performance snapshot.
- Use the earliest full render obtainable during the backfill.
- Store `performanceSnapshotAt` separately from `mediaCapturedAt`.
- If Blizzard no longer returns media, retain the card using an intentional avatar or class/spec silhouette fallback.
- Do not imply that a newly fetched Legacy render represents the character's historical transmog.

Current cards capture their render source when published.

## MongoDB architecture

Do not embed the CCG collection in `User`. Use dedicated collections keyed by either authenticated user or guest owner.

### `CcgSet`

One document per raid set:

- `slug`
- `zoneId`
- `raidName`
- `expansionName`
- `mythicPlusSeason`
- `state`: `draft`, `current`, `legacy`, or `locked`
- irreversible `enabledAt` and `enabledBy`; null means the set is disabled and player-invisible
- `opensAt`, `closesAt`, `lockedAt`
- `themeKey`, `themeVersion`
- optional `customFinish`: finish key and hard-pity limit; absent sets use the default finish ladder
- `backgroundPath`
- `backgroundSafeCrop`
- `eligibilityVersion`
- `gradingVersion`
- `gradeRarityMapping`
- `packRuleVersion`
- `publicationWave`
- published card counts
- timestamps

Indexes:

- Unique `{slug: 1}`
- Unique `{zoneId: 1}`
- `{state: 1, opensAt: -1}`

### `CcgCard`

One immutable document per published character snapshot version:

- `setId`
- `setNumber`
- `snapshotVersion`, unique within the card series
- `snapshotKey`
- `supersedesCardId` for versions after the first
- `characterId`
- WCL canonical identity where available
- Snapshotted name, realm, region, stable guild ID, guild name, and guild realm
- `classID`, specialization, role, and metric
- DPS/HPS, mechanics, combined, and Mythic+ scores
- `tierGrade`
- derived `rarityBucket`
- avatar and full-render URLs
- deterministic background crop
- performance and media timestamps
- source partition and supporting provenance
- publication wave
- grading, eligibility, and theme versions
- `publishedAt`

Indexes:

- Unique `{setId: 1, characterId: 1, snapshotVersion: 1}`
- Unique `{setId: 1, setNumber: 1, snapshotVersion: 1}`
- `{setId: 1, characterId: 1, performanceSnapshotAt: -1, publishedAt: -1}`
- `{setId: 1, tierGrade: 1, setNumber: 1}`
- `{setId: 1, guildId: 1, setNumber: 1}`
- `{setId: 1, guildId: 1, tierGrade: 1, setNumber: 1}`
- `{setId: 1, rarityBucket: 1}`
- `{characterId: 1, publishedAt: -1}`
- Search-supporting indexes for name, class, and role as required by final query design

Application code must reject attempts to modify immutable snapshot fields after publication.

### `CcgGuest`

- `tokenHash`
- `dateKey`
- `firstSeenAt`
- `lastSeenAt`
- `claimedByUserId`
- `claimedAt`
- timestamps

Indexes:

- Unique `{tokenHash: 1}`
- `{dateKey: 1}`
- `{claimedByUserId: 1}`

### `CcgOwnership`

Use a polymorphic owner:

- `ownerType`: `user` or `guest`
- `ownerId`
- `setId` and `characterId`, which identify the shared card series
- `cardId`, retained as the exact snapshot that originated this finish row
- `finish`: `standard`, `foil`, `golden`, `prismatic`, `holographic`, `void`, `toxic`, or `negative`; raid-scoped values are valid for their configured raid set or as redeem-code-only Community ownership
- `quantity`
- `alternativeQuantity`: an existing value above zero is alternative-art unlock evidence for that row's `{setId, characterId}` card series; it does not split or add to finish quantities
- `firstAcquiredAt`
- `lastAcquiredAt`
- Guest acquisition `dateKey`; clear it when ownership is transferred to an authenticated account

Indexes:

- Unique `{ownerType: 1, ownerId: 1, setId: 1, characterId: 1, finish: 1}`
- Unique `{ownerType: 1, ownerId: 1, cardId: 1, finish: 1}` retained for exact acquisition-snapshot lookups
- `{ownerType: 1, ownerId: 1, lastAcquiredAt: -1}`
- Collection filter indexes should include the denormalized fields only if measurement shows lookup joins are insufficient.

One document stores a quantity. Do not create one ownership document per duplicate copy.

### `CcgSeriesOwnership`

Store one entitlement document per owned card series:

- `ownerType` and `ownerId`
- `setId` and `characterId`
- `unlockedSnapshotVersions`: the exact snapshot versions acquired through packs or rewards; versions are added independently and never inferred from an earlier or later acquisition
- `firstAcquiredAt` and `lastAcquiredAt`
- Guest acquisition `dateKey`

Indexes:

- Unique `{ownerType: 1, ownerId: 1, setId: 1, characterId: 1}`
The idempotent startup migrations backfill series identity from each ownership row's exact card snapshot, create the corresponding series entitlement, and convert the initial version boundary into explicit acquired snapshot versions. They do not fill gaps between acquired versions. A structurally valid ownership row whose card no longer exists fails the migration so ownership is not silently lost. Structurally malformed legacy rows without a usable card or finish are retained unchanged for audit, excluded from collection calculations, and reported in the migration result.

### `CcgQualityProgress`

Store one document per owner with persistent base counters for `foil`, `golden`, `prismatic`, `holographic`, and `negative`, plus a `custom` map keyed by raid-set slug. Base counters are shared by Current and Legacy openings and advance once per pulled card; custom counters advance only for their matching set. The selected raw finish resets its counter, while a different non-Standard finish awarded through duplicate protection resets too. Guest progress persists with the rest of the guest collection. A claim reclassifies the selected opening against the authenticated collection without importing the guest's wider pity state.

All guest-owned documents, including pack balance, provisional progress, and opening documents, persist until they are transferred to an eligible authenticated account. Guest collection models must not declare TTL indexes.

### `CcgPackBalance`

- `ownerType`
- `ownerId`
- `currentRemaining`
- `legacyRemaining`
- `lastRechargeAt`
- `lastRolloverSequence`
- `grantVersion`
- `hasPlayed`
- `firstPlayedAt`
- timestamps

Index:

- Unique `{ownerType: 1, ownerId: 1}`

Recharge is evaluated lazily against shared Helsinki half-hour boundaries whenever the owner loads a CCG session or opens a pack. The backend updates only that owner's balance and checkpoint, so there is no scheduled fan-out across all users. Missed grants are discarded while storage is full.

### `CcgPackCredit`

Persistent bonus pack entitlements for authenticated users:

- `ownerType`
- `ownerId`
- `mode`: `current` or `legacy`
- `source`: `duplicate`, `admin`, `raid_rollover`, or future supported sources
- `remaining`
- source idempotency key
- timestamps

Guests never receive a persistent credit document. Credits belong to a mode rather than a raid set.

Completed-card credits use a per-owner, per-card source idempotency key. This makes the reward permanent and one-time even after its credit has been consumed or the raid later moves from Current to Legacy.

### `CcgRollover`

Immutable activation audit and lazy-reconciliation input:

- monotonic `sequence`
- previous Current set IDs and Mythic+ seasons
- new Current set ID and Mythic+ season
- `effectiveAt` and `activatedBy`
- authenticated and guest Current refill amounts

Balances created after a rollover start at its active sequence. Older balances replay every missing event in order, including recharge earned before each cutover, and write an idempotent per-owner rollover ledger entry.

### `CcgPackPool`

Precomputed, versioned card IDs grouped by:

- set
- grade or rarity bucket
- pool version
- active state

Pack opening must not sort or scan the whole card catalog.

Current and Legacy are logical mode pools over these per-set documents. Pack opening first loads compact grade counts, chooses cards with equal weight inside the selected grade, and fetches only the selected set/grade buckets. This avoids storing every historical card ID in one MongoDB document while still allowing one Legacy pack to contain multiple raid sets.

### `CcgPackOpening`

- `ownerType`
- `ownerId`
- `mode`
- `sourceSetIds` used by the mode pool
- allowance/credit source
- idempotency key
- pool version
- pack-rule version
- ordered result list
- per-result card id, originating set id, finish, and new/duplicate classification
- duplicate rewards produced by this opening
- Guest acquisition `dateKey`
- state
- timestamps

Indexes:

- Unique `{ownerType: 1, ownerId: 1, idempotencyKey: 1}`
- `{ownerType: 1, ownerId: 1, createdAt: -1}`
- `{sourceSetIds: 1, createdAt: -1}`

### `CcgLedgerEntry`

Append-only provenance for:

- Initial and recharge grants
- Duplicate reward grants
- Pack consumption
- Card acquisition quantities
- Guest claims
- Administrative adjustments

Every source action receives a unique idempotency key. Ledger entries are not used as the primary collection query; they support audit and recovery.

## MongoDB transaction prerequisite

Pack opening and guest claiming update multiple documents and must be atomic.

The current standalone MongoDB deployment does not provide multi-document transactions. Before enabling pack ownership, configure MongoDB as a one-node replica set in development and production, or use a managed replica set.

Do not implement pack opening as a series of unrelated writes. Without transactions, the fallback would require a significantly more complex recoverable state machine.

## Pack-opening transaction

Within one transaction:

1. Resolve the authenticated user or guest owner from trusted server context.
2. Find an existing opening by idempotency key and return it if present.
3. Validate Current/Legacy mode and resolve every enabled set in that mode inside the transaction.
4. Lazily apply shared-clock recharge up to the mode's storage cap, then atomically reserve one rechargeable pack or an authenticated owner's persistent pack credit.
5. Load the active versioned pack pool.
6. Select card IDs with server-side cryptographic randomness.
7. Apply the guaranteed `A`-or-better slot.
8. Resolve owned finishes by card series, including repeated snapshot IDs from the same series within the same pack.
9. Roll the protected finishes once per card using the stored pack-rule version. Keep a missing rolled finish; promote an exact-finish duplicate to the next missing finish and persist the resulting counters.
10. Upsert ownership quantities.
11. For an authenticated owner, grant one idempotent mode-specific credit when a duplicate is pulled for an already-complete raid card that has not rewarded before.
12. For a guest, record persistent provisional ownership and classifications; defer authenticated duplicate reclassification and rewards until claim.
13. Write the immutable opening result and ledger entries.
14. Commit.

If the transaction fails, no allowance, ownership, completed-card reward, or result is retained.

## Guest-claim transaction

Within one transaction:

1. Validate the guest cookie and locate its guest record regardless of the original creation date.
2. Return the previous successful result if the claim is already complete for the same user.
3. Load a committed five-card opening belonging to the guest. Validate the explicitly selected opening when supplied; otherwise use the latest opening so every login path can preserve the collection.
4. Atomically require and flip the authenticated account's `hasPlayed` marker from false to true.
5. Load every committed opening and ownership row for the guest and verify that the aggregated server results exactly reproduce the stored collection.
6. Re-key the verified ownership and quality-protection rows to the authenticated user.
7. Associate every opening's provenance with the claiming user.
8. Convert up to 20 remaining server-recorded guest packs per mode into idempotent authenticated pack credits.
9. Mark every opening and the guest identity claimed, invalidate further guest writes, and write the claim ledger entry.
10. Commit.

The claim must remain safe under concurrent login callbacks and repeated browser requests. A missing guest or an account with any prior CCG activity receives no partial claim.

## API surface

Exact route naming can follow existing backend conventions. The expected capabilities are:

### Public and owner-aware endpoints

- `GET /api/ccg/sets`
  - Enabled Current and Legacy sets
- `GET /api/ccg/session`
  - Owner type, rechargeable balances, caps, next recharge times, bonus credits, and claim state
- `GET /api/ccg/sets/:setSlug/catalog`
  - Paginated binder catalog with owned/missing state
- `GET /api/ccg/sets/:setSlug/guilds`
  - Raid-tier guild facets with published and collected card counts
- `GET /api/ccg/collection`
  - Paginated/filterable owned collection, optionally scoped to a raid-tier guild ID
- `GET /api/ccg/cards/:cardId`
  - Full immutable card details
- `POST /api/ccg/packs/open`
  - Body includes mode and idempotency key
- `GET /api/ccg/openings/:openingId`
  - Recover a committed result after refresh or interrupted animation
- `POST /api/ccg/guest/claim`
  - Authenticated, idempotent claim operation if it is not integrated directly into the login callback

### Administrative endpoints

- Create and update draft set configuration
- Preview eligible cards and grading distribution
- Preview deterministic card crops
- Publish a set wave
- Rebuild a draft pool
- Check readiness and irreversibly enable a configured raid
- Inspect activation-driven Current-to-Legacy lifecycle changes
- Inspect pack odds and simulated distributions
- Inspect guest and authenticated pack activity
- Inspect and retry character-media failures
- Apply explicit, audited pack-credit adjustments

Administrative writes use existing authorization patterns and TaskLog/audit infrastructure.

## Background jobs

All schedules use the IANA timezone `Europe/Helsinki`, not a fixed UTC offset, so daylight-saving changes are handled correctly. Store the last successful cursor or source watermark for every producer job. Every job is idempotent, uses the existing task/audit infrastructure, and can be rerun manually for a specified date or set.

### Scheduled-job matrix

| Job | Schedule (`Europe/Helsinki`) | Purpose |
| --- | --- | --- |
| New-character media discovery | Daily at 01:30 | Find characters newly observed by achievements, raid participation, rankings, or character ingestion since the last cursor; enqueue missing avatar and full-render media. |
| Active-character media refresh enqueue | Daily at 01:50 | Enqueue active Current candidates whose profile avatar/render metadata is stale. Spread work with `nextMediaRefreshAt`; do not refetch every known character every night. |
| Media queue recovery | Every 15 minutes | Return stale `processing` jobs to retry state and make transient failures eligible after backoff. |
| Weekly raid snapshot workflow | Wednesday at 03:00 | Query every enabled Current and Legacy raid from MongoDB, capture each canonical site-week performance population during the Tuesday-to-Wednesday night, build candidates, grade all eligible characters, and prepare the publication waves. |
| Weekly raid publication | Wednesday at 04:30 | Publish newly eligible characters and characters whose rarity grade changed across Current and Legacy raids, then rebuild each affected per-set pool from the latest version of every card series. Unchanged candidates are recorded without creating cards. Missing-media candidates remain pending and are reconsidered in the next wave or by an admin rerun. |

The weekly times are initial operational defaults and should be configurable. Setting `CCG_WEEKLY_AUTOMATION_ENABLED=false` skips both weekly jobs without disabling the rest of the CCG. The workflow must prevent overlapping snapshot or publication runs with a distributed lock keyed by set and snapshot date.

The snapshot records its source watermarks and fails closed if required rankings or mechanics inputs are incomplete; publication must never use a partially refreshed population. Weekly snapshots and media refreshes never rewrite already published cards.

### Character media discovery and fetcher

- The nightly discovery jobs only enqueue work; bounded workers continuously process the character-media queue.
- Gives Current candidates higher priority than general avatar backfill.
- Recovers stale jobs and retries transient failures.
- Uses per-character freshness metadata so normal nightly runs are incremental.
- Never mutates media or crop fields of an already published `CcgCard`; refreshes update character-profile media and unpublished candidates only.
- Exposes counts and recent failures to admin status.

### Current card candidate builder

- Finds Mythic raid participants with usable score data.
- Joins character identity, rankings, mechanics, Mythic+, guild snapshot, and media readiness.
- Produces a preview without publishing.
- Reports exclusion reasons per candidate.
- Runs as part of the Wednesday 03:00 snapshot workflow and may also run as an idempotent admin preview.

### Card publisher

- Runs in the scheduled Wednesday publication wave or through an explicit admin trigger.
- Consumes the canonical grading snapshot produced by the snapshot workflow.
- Assigns immutable grades, stable set numbers, snapshot versions, crop values, theme version, and score provenance.
- Inserts the first card for a character and later versions only when the rarity grade changed.
- Updates the versioned pack pool with only the latest version of each card series.
- Invalidates and warms relevant caches.
- Uses the completed 03:00 snapshot as input; it does not recompute rankings while publishing.

### Legacy backfill

- Processes one configured raid at a time from Highmaul forward.
- Uses stored historical participation and scoring data.
- Queues all recoverable character media.
- Clearly distinguishes historical performance time from media capture time.
- Supports resumable batches and an admin preview before publication.

### Pack recharge

Pack balances are created and recharged lazily on session/open requests. A global hourly fan-out job is unnecessary. New guests and first-time authenticated players receive 20/20, and both modes recharge only up to 50.

### Jobs that are not recurring cron work

- Pack balances and missed shared-clock recharge grants are calculated lazily.
- Media workers run continuously and are fed by scheduled discovery/recovery jobs.
- Legacy backfill is an explicit resumable administrative batch.
- Current-to-Legacy set movement and rollover-event creation happen inside the audited activation transaction for a newly enabled Current season. Per-owner pack conversion materializes transactionally on the next balance access, not from an unattended date guess, startup hook, or database-wide fan-out.

## Frontend architecture

### Routes

Recommended routes:

- `/ccg` — feature landing, Current/Legacy mode selection, pack balances
- `/ccg/open` — pack opening
- `/ccg/collection` — binder shelf and binder pages
- Existing character route — avatar and future card references

Use the existing navigation and localization structures. Add all visible copy to both English and Finnish locale files.

### Core components

- `CcgModeSwitcher`
- `PackBalance`
- `PackSelector`
- `PackOpeningStage`
- `PackRevealCard`
- `CollectionShelf`
- `CollectionBinder`
- `BinderPage`
- `BinderPocket`
- `CollectibleCard`
- `CollectibleCardViewer`
- `FinishSelector`
- `CharacterAvatar`
- `CharacterRender`

Do not create a second card renderer for pack reveals and collection views. Use one card component with explicit display sizes and interaction modes.

### Data fetching

- Use TanStack Query for sets, session, collection pages, and opening recovery.
- Do not optimistically invent pack results.
- Treat the committed backend opening as the source of truth.
- Reuse an opening result after refresh using its idempotency/opening id.
- Invalidate only the affected session, collection, and opening queries.

### Image handling

- Permit exact Blizzard render hosts using narrow `next.config` remote patterns, or use a dedicated image component with a raw image element if remote optimization is unsuitable.
- Always set dimensions/aspect ratio.
- Lazy-load binder pages outside the viewport.
- Load only the active binder page and focused card at full priority.
- Preload the five committed pack results before beginning the reveal.
- Fall back from full render to avatar to class/spec silhouette where allowed by the surface.

## Performance strategy

- Store URLs and quantities, not image binaries or per-copy ownership documents.
- Precompute pack pools by set and rarity bucket.
- Paginate the collection and binder catalog.
- Fetch only the active binder page; prefetch the next page during idle time.
- Cache immutable card and set data aggressively.
- Use ETags or long-lived cache headers for immutable card responses.
- Keep owner-specific balances and collection queries private and short-lived.
- Avoid loading all historical sets and cards on the landing page.
- Use indexed ownership queries and measure before denormalizing card metadata into ownership.
- Animate transform, opacity, and filter rather than layout.
- Use `will-change` only during active tilt/reveal interactions if measurement shows it is needed.

## Accessibility and interaction requirements

- Minimum interactive hit area: 40×40 pixels.
- Full keyboard support for packs, binder pages, finish selection, and card detail.
- Visible focus state that works over every seasonal theme.
- Text and score contrast of at least WCAG AA.
- Do not communicate tier or finish only through color.
- Announce opened cards and finish names to screen readers.
- Provide reduced-motion equivalents for every reveal and hover effect.
- Avoid rapid flashing and high-frequency full-screen effects.
- Use tabular numerals for scores, quantities, pack balances, and progress meters.
- Preserve readable card content at mobile sizes; the focused viewer may reveal information hidden from tiny binder thumbnails.

## Security and integrity

- Results are selected exclusively on the backend.
- Use cryptographic random selection.
- Require an idempotency key for every opening and claim.
- Rate-limit pack-open and guest-identity creation endpoints.
- Store only guest token hashes.
- Use Secure, HttpOnly, SameSite cookies.
- Enforce guest-token ownership, pack balances, and opening-to-ownership consistency on the backend.
- Treat client-provided set ids, modes, and filters as untrusted.
- Validate that every source set belongs to the requested enabled Current or Legacy mode.
- Never expose Blizzard credentials or access tokens.
- Keep administrative set and credit changes authorization-gated and audited.
- Do not log raw cookies, OAuth tokens, or private profile data.

## Legal and product constraints

The feature must remain free and non-commercial. It should include an unofficial fan-project notice and appropriate Blizzard copyright/trademark notices.

Before public release, review Blizzard's then-current:

- Developer API terms
- Fan-site and legal FAQ
- Trademark guidance
- Requirements around downloaded images and modification

Avoid selling packs, charging for collection access, trading cards for value, or presenting the feature as an officially licensed Blizzard card game.

This plan is technical/product guidance, not legal advice.

## Observability and administration

Track:

- Pack opens by mode and set
- Recharge balance use
- Guest-to-account pack claim
- Expired unclaimed guest results and rejected over-limit claims
- New versus duplicate rates
- Grade and finish distributions
- Completed-card bonus packs earned
- Opening transaction failures and retries
- Media queue throughput, 404s, and retry volume
- Candidate exclusion reasons
- Current and Legacy set completion rates
- Pack animation abandonment versus committed openings

Provide admin previews for:

- Irreversible activation readiness, target mode, and explicit threshold blockers
- Candidate count and exclusions
- Grade distribution
- Pack-pool composition
- Expected odds through simulation
- Background crop samples
- Missing media
- Rollover effects

Never expose user-level private collection data in public operational dashboards.

## Rollout plan

### Phase 0 — prerequisites

- Normalize raid background formats and filenames.
- Configure MongoDB as a replica set.
- Confirm Current raid and Mythic+ season mapping.
- Add CCG configuration and feature flag.
- Confirm legal notices and non-commercial scope.

### Phase 1 — character media and avatar

- Add the CharacterMedia model and queue.
- Fetch avatar and full-render URLs.
- Add avatar to character profile responses and pages.
- Add admin queue visibility and retries.

### Phase 2 — set and immutable card foundation

- Add set, card, pack-pool, and publishing models.
- Build candidate preview and canonical grading.
- Implement deterministic card crops.
- Publish a development Current set.
- Verify card immutability.

### Phase 3 — authenticated pack and collection core

- Add transaction-backed allowances, openings, ownership, credits, and ledger.
- Implement server-side pack selection and finish rolls.
- Implement Current and all-history Legacy mode pools.
- Add basic collection and opening APIs.

### Phase 4 — guest collection and claim

- Add rolling persistent guest cookies and migrate away from guest TTL cleanup.
- Allow anonymous Current and Legacy openings.
- Implement the transactional full-library claim, first-CCG-play guard, and provenance verification.
- Verify concurrency and idempotency.

### Phase 5 — binder and pack UI

- Build Current and Legacy binder navigation.
- Add pack selection, opening, reveal recovery, card viewer, quantities, and finish completion.
- Add responsive and localized states.
- Add avatar and media fallbacks.

### Phase 6 — premium motion and seasonal theming

- Implement rarity ornament escalation.
- Add Foil, Golden, Prismatic, Holographic, and Negative materials.
- Add fine-pointer card tilt.
- Add raid-themed pack sequences and reduced-motion alternatives.
- Performance-test representative mobile and desktop devices.

### Phase 7 — Legacy backfill and lifecycle tooling

- Backfill Highmaul forward, one configured set at a time.
- Review historical identity and missing-media handling.
- Record activation-driven Current-to-Legacy lifecycle changes in the administrative audit trail.
- Validate binder counts, pool composition, and historical provenance.

## Verification strategy

### Unit tests

- Grade-to-rarity mapping
- Deterministic background crop generation and safe bounds
- Finish odds boundaries
- Guaranteed `B`-or-better slot
- Exact-card and exact-finish duplicate classification, including repeated results in one pack
- Missing-finish promotion and completed-card reward eligibility
- Helsinki date-key generation
- Next-reset expiry generation across daylight-saving transitions
- Guest token hashing
- Initial guest/user pack grants and recharge caps
- Set state validation
- Card immutability guards

### Integration tests

- Successful transactional pack opening
- Idempotent repeated opening request
- Concurrent opening requests with one remaining pack
- Transaction rollback after a mid-operation failure
- Ownership quantity updates
- Same-character cards in different raid sets remain independent
- One-time Current/Legacy completed-card pack credit
- Legacy set selection
- Guest opening, cross-day claim, and repeated claim
- Guest identity and collection survive Helsinki midnight
- Guest claim accepts an explicitly selected five-card opening or resolves the guest's latest opening for shared login paths, then transfers only the verified library belonging to that guest
- Existing CCG activity rejects a guest claim, including activity from pre-marker records
- Concurrent login callbacks
- First authenticated CCG session starts at 20/20 without guest conversion credits
- Current-to-Legacy rollover
- Media 404, transient retry, and stale-job recovery
- Idempotent nightly media discovery from its stored cursor
- Idempotent weekly snapshot and publication reruns
- Unchanged grades do not create card versions, while changed grades do
- Catalog and pack pools expose only the latest published version per card series
- Collection defaults to the newest snapshot that collector has explicitly acquired and exposes only independently unlocked versions
- Finish quantities, duplicate protection, completion, and the one-time completion reward are shared by every snapshot in a card series
- Sharing a selected historical snapshot preserves that exact card ID

### Statistical tests

Run large offline simulations against every pack-rule version:

- Grade distribution by slot
- Guaranteed-slot compliance
- Golden and Prismatic frequency
- Duplicate rate at different collection completion levels
- Bonus-pack feedback behavior
- Worst-case request and write volume when a mature collector opens all daily and earned packs

Statistical tests use tolerances; they must not depend on a fixed random sequence unless a test-only RNG is explicitly injected.

### Frontend tests

- Pack balance and disabled states
- Recovery of committed openings after refresh
- Binder pagination and missing slots
- Quantity and finish switching
- Current and Legacy selection
- Guest daily-reset countdown, expiry, and login claim messaging
- Character avatar fallback
- Keyboard navigation
- Screen-reader result summary
- Reduced-motion behavior
- Responsive card readability

### Manual visual QA

- All tier-grade treatments
- Standard, Foil, Golden, Prismatic, Holographic, and Negative finishes
- Every raid background and its safe crop range
- Long character, guild, realm, and raid names
- Missing guild and missing Mythic+ values
- Avatar and silhouette fallbacks
- Mobile, tablet, and desktop binder layouts
- High-contrast focus states
- Slow network during media preload

## Acceptance criteria

The initial feature is ready when:

- A user or guest receives one Legacy pack each Helsinki half-hour and one Current pack each Helsinki hour while below the 50-pack storage cap for each mode.
- A new guest starts with 20 packs per mode; a first-time authenticated CCG player starts with 20 packs per mode.
- A Legacy pack can contain cards from any enabled historical raid.
- Every committed result survives refresh and repeated requests; authenticated and guest results remain permanent.
- Guest cards, balances, and progress survive Helsinki midnight without receiving a fresh starting balance.
- A guest claim transfers the complete cross-day guest library only when its ownership exactly matches the immutable server opening history, plus up to 20 unspent server-recorded guest packs per mode.
- An account with any prior CCG activity cannot claim guest cards; unrelated pre-CCG SuomiWoW account activity does not disqualify it.
- Cards remain immutable after publication and rollover.
- Tier grade is the visible rarity and drives pack/style behavior.
- Every pack contains five cards and satisfies its guaranteed slot.
- The same character in different raid sets is collected and completed as a different card.
- A missing rolled finish is awarded unchanged; an exact-finish duplicate advances to the next missing finish for that card series.
- The first duplicate pulled after every finish in the card series' pack ladder is owned awards exactly one pack for that series: Current for a Current raid and Legacy for a Legacy raid.
- Community cards roll and complete against the six base finishes only; redeem codes may additionally award Void or Toxic without changing completion or protection state.
- Alternative art is one cosmetic unlock per `{setId, characterId}` card series and never contributes to duplicate or finish-completion state.
- Finish protection remains at each configured base rate through 80% of the interval, then ramps quadratically to hard pity; converted duplicates reset both the selected raw finish and any different non-Standard finish awarded.
- The collection displays each raid card series separately, exposes every owned finish on every explicitly unlocked snapshot, and does not add newly published, missed, or historical snapshots until the collector acquires that exact version.
- Current becomes Legacy without changing existing cards.
- The binder displays owned, missing, quantities, finishes, and completion by raid set.
- Character pages display a Blizzard avatar with a reliable fallback.
- Full renders and raid backgrounds produce stable card compositions.
- Reduced-motion, keyboard, mobile, and localization requirements are met.
- Pack opening and guest claiming are transaction-backed and idempotent.
- New-character media discovery runs nightly, while the Current performance snapshot and publication workflow runs during the Tuesday-to-Wednesday night.
- Operational tooling can explain every grant, opening, claim, and failure.

## Configurable launch values

These values are intentionally configuration, even when this plan proposes defaults:

- Initial Current-set publication delay
- Minimum participation/score eligibility
- Weekly publication cadence
- Grade thresholds or proportions
- Pack slot weights
- Guaranteed-slot grade
- Finish duplicate-promotion order
- Golden and Prismatic odds
- Guest reset time and cleanup grace period
- Nightly media-discovery and weekly snapshot/publication times
- Active-character media freshness interval
- Per-set background safe crop ranges
- Pack reveal duration and sound policy

Changing a value creates a new version for future cards or openings. It does not rewrite historical cards or pack results.

## Recommended implementation order

The smallest safe vertical path is:

1. MongoDB replica-set prerequisite
2. Character media and profile avatar
3. One development set and immutable card publisher
4. Authenticated transactional Current pack opening
5. Basic binder and card viewer
6. Legacy selection and backfill
7. Duplicate rewards
8. Guest ownership and claim
9. Seasonal materials, tilt, and premium reveals
10. Rollover and full operational tooling

This order proves the irreversible data and transaction model before investing heavily in visual effects, while still delivering the character-media work as an independently useful first feature.
