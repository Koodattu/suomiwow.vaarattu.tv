# SuomiWoW CCG Implementation Plan

## Status

Planning document only. This document describes the agreed product behavior, data model, media pipeline, user experience, technical architecture, rollout, and verification strategy for the SuomiWoW collectible card feature.

The feature is free, non-tradable, and non-commercial. It does not include card battles, purchases, a marketplace, or real-world value.

## Product summary

SuomiWoW CCG turns Finnish World of Warcraft raid characters into collectible cards. A card represents an immutable snapshot of one character in one raid tier. The same character can receive a new card in every raid tier, but an already published card never changes.

The product has two collection modes:

- **Current** contains every enabled active raid.
- **Legacy** contains every enabled past raid.

Every raid tier is its own set and binder. Legacy storage recharges by one pack every Helsinki hour, while Current storage recharges on even Helsinki hours. Both modes store up to 25 rechargeable packs. Current packs draw from all enabled active raids; Legacy packs draw from all enabled past raids.

Guests begin with five packs in each mode. A first-time authenticated CCG player begins with 25 packs in each mode, including existing SuomiWoW accounts that have never played CCG. Guest openings are temporary: after revealing a pack, the guest may explicitly log in to add that one pack to an account that has no prior CCG activity. Logging in never silently imports the rest of a guest session, and an established CCG account cannot import guest pulls.

### Community set

`Community` is a CCG-only set for curated characters that do not meet normal raid eligibility or do not yet exist in the Warcraft Logs character database. It has its own collection binder but no dedicated pack.

- Admins add a character by region, realm slug, name, and rarity. The backend resolves the public profile, active specialization, role, guild, avatar, and full render through Blizzard Profile APIs without fetching Warcraft Logs.
- If the character already exists locally, the Community record links to it. Otherwise it retains a stable Blizzard identity that can be reconciled when the character later enters the normal raid pipeline.
- Current, random Legacy, and targeted Legacy packs may all contain Community cards. Rarity is selected by the normal pack rules first. Within that rarity, a Community result must win both its proportional pool roll and a second 50/50 gate; a failed gate keeps the already selected raid card.
- Community cards are immutable snapshots with no performance metrics. Their card metric panel displays `Community`.
- A stable `collectorKey` groups Community and normal raid variants of the same character for duplicate detection and collection display. Existing cards without the field fall back to their local character ID.

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

- There is at most one card per `{setId, characterId}`.
- A character appearing in a later raid tier receives a new card in that set.
- Card identity, scores, guild, realm, class, specialization, role, grade, art source, crop, and publication metadata are immutable after publication.
- The Current set becomes Legacy at raid rollover without modifying its cards.
- Current cards are published in waves so the set can operate during an active tier.

Recommended publication schedule:

1. Open the set approximately two weeks after the raid launches, once the data is meaningful.
2. Publish all currently eligible characters.
3. Publish newly eligible characters once per week.
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

- Duplicate identity is the character, not the immutable raid snapshot. Pulling the same character from another raid or weekly snapshot is still a duplicate.
- A duplicate is guaranteed at least the next finish above that character's best owned finish, capped at Negative.
- The first owned copy of a character is new; later pulls of that character advance duplicate progress even when they add a new snapshot or finish variant.
- Different snapshots and finishes remain separately auditable and keep their own quantities in storage.
- Ownership stores and displays quantities such as `×2` and `×7`.
- For authenticated collections, every ten duplicate character pulls award one bonus pack credit in the same mode.
- Copies are not destroyed when the duplicate meter awards a pack.
- Bonus-pack results can advance the duplicate meter normally.
- Guest results are provisional: duplicate rewards are calculated against the authenticated collection during a valid same-day claim and no spendable guest bonus credit exists before login.

The threshold must not start at five. A five-card pack producing another pack after five duplicates creates a self-reproducing loop once a collection is complete. A ten-duplicate threshold has a reproduction ratio of at most one-half and therefore converges.

Duplicate progress is displayed as a persistent meter, for example `7 / 10 — Bonus pack`.

### Finishes

Finish is independent of tier grade:

- **Standard** uses the baseline treatment for the card's tier grade.
- **Foil** adds a restrained reactive material and is the first upgraded finish.
- **Golden** adds warm metallic treatment, enhanced frame detail, and restrained animated highlights.
- **Prismatic** adds a spectral edge, microfoil, richer pointer-responsive lighting, and the premium reveal.
- **Holographic** intensifies the spectral depth and animated diffraction beyond Prismatic.
- **Negative** applies the rare full-card inverted treatment and is the highest production finish.

Void remains a design-lab-only treatment and is not a production finish.

Each non-Standard finish has a persistent per-owner protection counter. Its chance follows a quadratic protection curve: `baseChance + (1 - baseChance) * progress²`, where `baseChance` is `1 / hardPity` and `progress` is the normalized distance from the first pull to hard pity. This keeps the early increase gentle, accelerates near the limit, and guarantees the Nth consecutive miss. The counter resets only when that finish is actually awarded. Finish rolls are independent, but a card receives only the highest finish that succeeds, so reaching one hard pity cannot turn the rest of a pack into the same premium finish.

Initial hard-pity limits:

- Foil: 5 cards
- Golden: 25 cards
- Prismatic: 50 cards
- Holographic: 100 cards
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
- The mapping uses the raid's original progression season: Uldir through Ny'alotha map to BFA seasons 1–4; Castle Nathria, Sanctum, and Sepulcher map to Shadowlands seasons 1–3; Vault, Aberrus, and Amirdrassil map to Dragonflight seasons 1–3; and each later raid maps to its matching expansion season. Remix seasons such as Shadowlands season 4 and Dragonflight season 4 are deliberately excluded because they span multiple raids and are not the original tier snapshot.
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

A Current card candidate requires:

- At least two distinct Mythic reports in the raid
- At least 50 Mythic boss-pull appearances across the raid tier
- A stable internal `Character._id`
- Valid role-performance data
- Valid mechanics/survival data
- A valid combined score
- A successfully fetched Blizzard full character render

Mythic report count is materialized separately from the broader Heroic-or-Mythic participation count. Snapshot creation reads the authoritative per-raid participation rows directly, sums report counts across guilds, and requires at least two Mythic reports even when an admin bypasses readiness coverage checks. Existing character tier-list mechanics data remains the source of truth for the 50-pull threshold and scores rather than adding a second scoring pipeline.

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
- Receives weekly newcomer card publication waves.
- Moves to Legacy when the next raid becomes Current.

### Legacy

- Contains Uldir through the set immediately preceding Current.
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
- Raids without an intentional CCG configuration, background, season mapping, and theme remain excluded. This keeps short or meme raids such as Sporefall disabled by default.

### Recharge balances

- Recharge boundaries use the `Europe/Helsinki` clock.
- Current and Legacy balances are independent and both cap at 25 rechargeable packs.
- Recharge is calculated lazily for the requesting owner; there is no hourly database-wide user scan.
- Earned duplicate credits persist until opened and continue to use their existing mechanic.

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

- The backend creates a random guest token scoped to the current `Europe/Helsinki` calendar day.
- The raw token is stored only in a Secure, HttpOnly, SameSite=Lax cookie.
- MongoDB stores only a cryptographic hash of the token.
- The guest record, openings, ownership, and related progress use the same `dateKey` and expire at the next Helsinki daily reset.
- Every guest read, opening, and claim validates `dateKey` and `expiresAt` in application code. MongoDB TTL cleanup is eventual and is not the security or product-behavior boundary.
- An expired guest cookie is replaced with a new day-scoped token on the visitor's next CCG request. Data from the previous token is not carried forward.
- The UI explains the temporary nature of guest cards only after a pack has been revealed and offers an explicit login action for that pack.

Cookie resetting and other lightweight abuse are accepted product tradeoffs. Basic rate limiting and idempotency are still required to prevent accidental or automated request floods.

### Guest pack storage

Guests receive:

- Five initial Current packs with a 25-pack storage cap
- One Current pack on every even Helsinki hour while storage is below the cap
- Five initial Legacy packs with a 25-pack storage cap
- One Legacy pack on every Helsinki hour while storage is below the cap
- Five cards per pack

Guests cannot open duplicate-earned bonus packs while logged out. An explicit claim reclassifies only the selected pack against the authenticated collection, advances the authenticated user's duplicate meter, and grants any resulting bonus pack credit. Other guest openings are not imported.

### Claim on login

An eligible guest-to-user claim:

1. Validates that the guest record and selected five-card opening belong together, are unclaimed, and have not expired.
2. Requires the authenticated account's persistent CCG `hasPlayed` marker to be false.
3. Merges only the selected opening's exact card and finish quantities into the authenticated collection.
4. Reclassifies those five results and applies duplicate progress and any resulting bonus credit.
5. Preserves opening provenance and marks both the opening and guest identity claimed.
6. Leaves the account's first-time 25 Current and 25 Legacy starting balances intact.

`hasPlayed` becomes true when an authenticated account opens any rechargeable or bonus-credit pack, or when it claims its one eligible guest pack. Existing ownership and committed openings are also checked while migrating older account records. This prevents an established player from logging out, opening guest packs, and importing them later.

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
- Owned pockets group every snapshot of the same character and display the latest snapshot with the character's highest owned finish and total quantity.
- Selecting a pocket opens the large card viewer.
- The focused viewer lets the user switch between all owned snapshot and finish variants and see quantities.
- Set completion and duplicate progress remain visible near the binder controls.

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

The current folder contains 15 wide assets covering Uldir through March on Quel'Danas:

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

One immutable document per character and set:

- `setId`
- `setNumber`
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

- Unique `{setId: 1, characterId: 1}`
- Unique `{setId: 1, setNumber: 1}`
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
- `expiresAt`
- `claimedByUserId`
- `claimedAt`
- timestamps

Indexes:

- Unique `{tokenHash: 1}`
- `{dateKey: 1, expiresAt: 1}`
- TTL `{expiresAt: 1}`
- `{claimedByUserId: 1}`

### `CcgOwnership`

Use a polymorphic owner:

- `ownerType`: `user` or `guest`
- `ownerId`
- `cardId`
- `finish`: `standard`, `foil`, `golden`, `prismatic`, `holographic`, or `negative`
- `quantity`
- `firstAcquiredAt`
- `lastAcquiredAt`
- Guest-only `dateKey` and `expiresAt`; omit these fields for authenticated ownership

Indexes:

- Unique `{ownerType: 1, ownerId: 1, cardId: 1, finish: 1}`
- `{ownerType: 1, ownerId: 1, lastAcquiredAt: -1}`
- TTL `{expiresAt: 1}`; authenticated documents do not contain this field
- Collection filter indexes should include the denormalized fields only if measurement shows lookup joins are insufficient.

One document stores a quantity. Do not create one ownership document per duplicate copy.

### `CcgQualityProgress`

Store one document per owner with persistent counters for `foil`, `golden`, `prismatic`, `holographic`, and `negative`. Counters are shared by Current and Legacy openings, advance once per pulled card, and reset independently only when that finish is awarded. Guest progress uses the same day-scoped expiry as other provisional guest state. A claim reclassifies the selected opening against the authenticated collection without importing the guest's wider pity state.

All other guest-owned temporary documents, including pack balance, provisional progress, and opening documents, carry the same guest `dateKey` and `expiresAt` and have TTL indexes where applicable. Application queries must still reject expired guest data because MongoDB TTL deletion is not immediate.

### `CcgPackBalance`

- `ownerType`
- `ownerId`
- `currentRemaining`
- `legacyRemaining`
- `lastRechargeAt`
- `grantVersion`
- `hasPlayed`
- `firstPlayedAt`
- optional guest `expiresAt`
- timestamps

Index:

- Unique `{ownerType: 1, ownerId: 1}`
- TTL `{expiresAt: 1}`

Recharge is evaluated lazily against shared Helsinki hour boundaries whenever the owner loads a CCG session or opens a pack. The backend updates only that owner's balance and checkpoint, so there is no hourly fan-out across all users. Missed grants are discarded while storage is full.

### `CcgPackCredit`

Persistent bonus pack entitlements for authenticated users:

- `ownerType`
- `ownerId`
- `mode`: `current` or `legacy`
- `source`: `duplicate`, `admin`, or future supported sources
- `remaining`
- source idempotency key
- timestamps

Guests never receive a persistent credit document. Credits belong to a mode rather than a raid set.

### `CcgOwnerProgress`

One document per owner and mode:

- `ownerType`
- `ownerId`
- `mode`
- `duplicateRemainder` from 0–9
- `totalDuplicatePulls`
- `bonusPacksEarned`
- optional cached collection counts
- timestamps

Index:

- Unique `{ownerType: 1, ownerId: 1, mode: 1}`

Guest progress is provisional and expires with the guest day. It can support same-day UI classification, but `bonusPacksEarned` remains zero until the claim transaction reclassifies the results and updates the authenticated user's progress.

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
- Guest-only `dateKey` and `expiresAt`
- state
- timestamps

Indexes:

- Unique `{ownerType: 1, ownerId: 1, idempotencyKey: 1}`
- `{ownerType: 1, ownerId: 1, createdAt: -1}`
- `{sourceSetIds: 1, createdAt: -1}`
- TTL `{expiresAt: 1}`; authenticated openings do not contain this field

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
8. Resolve duplicate identity by character across all owned snapshots, including repeated characters within the same pack.
9. Roll the protected finishes once per card using the stored pack-rule version, applying the duplicate's minimum next finish and persisting the resulting counters.
10. Upsert ownership quantities.
11. For an authenticated owner, add duplicate characters to the mode-specific duplicate meter and convert every completed group of ten into a bonus pack credit.
12. For a guest, record only provisional same-day ownership and classifications; defer authenticated duplicate reclassification and rewards until claim.
13. Write the immutable opening result and ledger entries.
14. Commit.

If the transaction fails, no allowance, ownership, duplicate progress, or result is retained.

## Guest-claim transaction

Within one transaction:

1. Validate the guest cookie and locate an unclaimed, unexpired guest for the current Helsinki `dateKey`.
2. Return the previous successful result if the claim is already complete for the same user.
3. Load the explicitly selected committed five-card opening and verify that it belongs to the guest.
4. Atomically require and flip the authenticated account's `hasPlayed` marker from false to true.
5. Reclassify only those five results against the authenticated collection and upsert their quantities.
6. Apply mode-specific duplicate progress and materialize any bonus credit earned by the selected pack.
7. Associate the opening provenance with the claiming user.
8. Mark the selected opening and guest identity claimed, invalidate further guest writes, and write the claim ledger entry.
9. Commit.

The claim must remain safe under concurrent login callbacks and repeated browser requests. An expired guest or an account with any prior CCG activity receives no partial claim.

## API surface

Exact route naming can follow existing backend conventions. The expected capabilities are:

### Public and owner-aware endpoints

- `GET /api/ccg/sets`
  - Enabled Current and Legacy sets
- `GET /api/ccg/session`
  - Owner type, rechargeable balances, caps, next recharge times, bonus credits, duplicate progress, and claim state
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
| Guest expiry reconciliation | Daily at 00:15 | Remove expired guest child documents left behind by eventual TTL cleanup and report anomalies. Product enforcement still happens synchronously at the 00:00 date boundary. |
| New-character media discovery | Daily at 01:30 | Find characters newly observed by achievements, raid participation, rankings, or character ingestion since the last cursor; enqueue missing avatar and full-render media. |
| Active-character media refresh enqueue | Daily at 01:50 | Enqueue active Current candidates whose profile avatar/render metadata is stale. Spread work with `nextMediaRefreshAt`; do not refetch every known character every night. |
| Media queue recovery | Every 15 minutes | Return stale `processing` jobs to retry state and make transient failures eligible after backoff. |
| Weekly Current snapshot workflow | Wednesday at 03:00 | Query every enabled Current raid from MongoDB, capture each canonical site-week performance population during the Tuesday-to-Wednesday night, build candidates, grade newly eligible characters, and prepare the publication waves. |
| Weekly Current publication | Wednesday at 04:30 | Publish snapshot-ready candidates for every enabled Current raid whose media is available, then version and rebuild the affected per-set pools. Missing-media candidates remain pending and are reconsidered in the next wave or by an admin rerun. |

The weekly times are initial operational defaults and should be configurable. The workflow must prevent overlapping snapshot or publication runs with a distributed lock keyed by set and snapshot date.

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
- Assigns immutable grades, set numbers, crop values, theme version, and score provenance.
- Inserts only characters not already published in the set.
- Updates the versioned pack pool.
- Invalidates and warms relevant caches.
- Uses the completed 03:00 snapshot as input; it does not recompute rankings while publishing.

### Legacy backfill

- Processes one raid at a time from Uldir forward.
- Uses stored historical participation and scoring data.
- Queues all recoverable character media.
- Clearly distinguishes historical performance time from media capture time.
- Supports resumable batches and an admin preview before publication.

### Pack recharge

Pack balances are created and recharged lazily on session/open requests. A global hourly fan-out job is unnecessary. New guests receive 5/5, first-time authenticated players receive 25/25, and both modes recharge only up to 25.

### Jobs that are not recurring cron work

- Pack balances and missed shared-clock recharge grants are calculated lazily.
- Media workers run continuously and are fed by scheduled discovery/recovery jobs.
- Legacy backfill is an explicit resumable administrative batch.
- Current-to-Legacy movement happens inside the audited activation transaction for a newly enabled Current season, not from an unattended date guess or a separate promotion endpoint.

## Frontend architecture

### Routes

Recommended routes:

- `/fun/ccg` — feature landing, Current/Legacy mode selection, pack balances
- `/fun/ccg/open` — pack opening
- `/fun/ccg/collection` — binder shelf and binder pages
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
- `DuplicateProgress`
- `CharacterAvatar`
- `CharacterRender`

Do not create a second card renderer for pack reveals and collection views. Use one card component with explicit display sizes and interaction modes.

### Data fetching

- Use TanStack Query for sets, session, collection pages, and opening recovery.
- Do not optimistically invent pack results.
- Treat the committed backend opening as the source of truth.
- Reuse an opening result after refresh using its idempotency/opening id.
- Invalidate only the affected session, collection, progress, and opening queries.

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
- Enforce the guest `dateKey`, expiry, five-pack-per-mode allowance, and 25-result-per-mode claim ceiling on the backend.
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
- Duplicate bonus packs earned
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

- Add transaction-backed allowances, openings, ownership, progress, credits, and ledger.
- Implement server-side pack selection and finish rolls.
- Implement Current and all-history Legacy mode pools.
- Add basic collection and opening APIs.

### Phase 4 — guest collection and claim

- Add day-scoped guest cookies, synchronous expiry checks, and TTL cleanup.
- Allow anonymous Current and Legacy openings.
- Implement the transactional one-opening claim, first-CCG-play guard, and duplicate reclassification.
- Verify concurrency and idempotency.

### Phase 5 — binder and pack UI

- Build Current and Legacy binder navigation.
- Add pack selection, opening, reveal recovery, card viewer, quantities, and duplicate meter.
- Add responsive and localized states.
- Add avatar and media fallbacks.

### Phase 6 — premium motion and seasonal theming

- Implement rarity ornament escalation.
- Add Foil, Golden, Prismatic, Holographic, and Negative materials.
- Add fine-pointer card tilt.
- Add raid-themed pack sequences and reduced-motion alternatives.
- Performance-test representative mobile and desktop devices.

### Phase 7 — Legacy backfill and lifecycle tooling

- Backfill Uldir forward, one set at a time.
- Review historical identity and missing-media handling.
- Record activation-driven Current-to-Legacy lifecycle changes in the administrative audit trail.
- Validate binder counts, pool composition, and historical provenance.

## Verification strategy

### Unit tests

- Grade-to-rarity mapping
- Deterministic background crop generation and safe bounds
- Finish odds boundaries
- Guaranteed `B`-or-better slot
- Duplicate classification, including repeated results in one pack
- Ten-duplicate bonus conversion and remainder
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
- New character versus character-wide duplicate behavior across snapshots
- Duplicate-earned pack credit
- Legacy set selection
- Guest opening, same-day claim, and repeated claim
- Expired previous-day guest claim rejection
- Guest claim accepts only the explicitly selected five-card opening
- Existing CCG activity rejects a guest claim, including activity from pre-marker records
- Concurrent login callbacks
- First authenticated CCG session starts at 25/25 without guest conversion credits
- Current-to-Legacy rollover
- Media 404, transient retry, and stale-job recovery
- Idempotent nightly media discovery from its stored cursor
- Idempotent weekly snapshot and publication reruns

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

- A user or guest receives one Legacy pack each Helsinki hour and one Current pack on even Helsinki hours while below the 25-pack storage cap for each mode.
- A new guest starts with five packs per mode; a first-time authenticated CCG player starts with 25 packs per mode.
- A Legacy pack can contain cards from any enabled historical raid.
- Every committed result survives refresh and repeated requests during its retention window; authenticated results remain permanent.
- Guest cards can be claimed only during the Helsinki day in which they were opened; unclaimed cards are inaccessible after reset and are removed by cleanup.
- A guest claim persists only the explicitly selected five-card opening and never imports the rest of the guest session.
- Duplicate progress and rewards from that pack are applied only during a valid claim.
- An account with any prior CCG activity cannot claim guest cards; unrelated pre-CCG SuomiWoW account activity does not disqualify it.
- Cards remain immutable after publication and rollover.
- Tier grade is the visible rarity and drives pack/style behavior.
- Every pack contains five cards and satisfies its guaranteed slot.
- Duplicate characters increment visible quantities and the duplicate meter even when they come from different snapshots.
- Every ten duplicate characters award one same-mode pack credit.
- Every duplicate is guaranteed at least the next finish above that character's best owned finish, capped at Negative.
- Finish protection ramps quadratically from each configured base rate to its hard-pity guarantee and resets only the finish that was awarded.
- The collection groups all owned snapshots of one character, shows the latest snapshot with the best owned finish, and exposes every owned variant in the viewer.
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
- Soft duplicate protection
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
