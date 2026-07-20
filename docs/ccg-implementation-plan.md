# SuomiWoW CCG Implementation Plan

## Status

Planning document only. This document describes the agreed product behavior, data model, media pipeline, user experience, technical architecture, rollout, and verification strategy for the SuomiWoW collectible card feature.

The feature is free, non-tradable, and non-commercial. It does not include card battles, purchases, a marketplace, or real-world value.

## Product summary

SuomiWoW CCG turns Finnish World of Warcraft raid characters into collectible cards. A card represents an immutable snapshot of one character in one raid tier. The same character can receive a new card in every raid tier, but an already published card never changes.

The product has two collection modes:

- **Current** contains the active raid tier.
- **Legacy** contains Uldir through the raid tier immediately preceding Current.

Every raid tier is its own set and binder. Users receive five Current packs and five Legacy packs per day. Legacy pack credits can be spent on a user-selected Legacy raid set.

Users may open packs without logging in. Guest cards are saved server-side and claimed when the visitor logs in. The first guest-to-account conversion also grants five additional Current packs.

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

The snapshotted character tier grade is the user-facing rarity. The card prints `Crown`, `S`, `A`, `B`, `C`, `D`, `E`, or `F`; it does not need a separate user-facing Common/Legendary label.

The grade maps to an internal rarity bucket for pack selection and visual styling:

| Tier grade | Internal bucket | Baseline visual treatment |
| --- | --- | --- |
| Crown / S | Legendary | Maximum ornament, animated raid sigil, premium foil |
| A | Epic | Layered frame, strong foil, portal lighting |
| B | Rare | Foil surface and brighter frame detail |
| C / D | Uncommon | Metallic class accents and modest ornament |
| E / F | Common | Restrained matte frame |

`tierGrade` is authoritative. `rarityBucket` may be stored as denormalized, indexed data, but must be derived from the set's versioned grade mapping.

The grade is calculated once at publication from one canonical, unfiltered global population. It must not depend on frontend filters. The grading snapshot records its algorithm version and source timestamp.

### Duplicates

Duplicates do not upgrade card rarity. Rarity represents the character's snapshotted raid-tier performance and must remain truthful.

- The first owned copy of a card and finish is new.
- Further copies of the same card and finish are exact duplicates.
- A newly acquired Golden or Prismatic finish is new even if Standard is already owned.
- Ownership stores and displays quantities such as `×2` and `×7`.
- Every ten exact duplicate pulls award one bonus pack credit in the same mode.
- Copies are not destroyed when the duplicate meter awards a pack.
- Bonus-pack results can advance the duplicate meter normally.

The threshold must not start at five. A five-card pack producing another pack after five duplicates creates a self-reproducing loop once a collection is complete. A ten-duplicate threshold has a reproduction ratio of at most one-half and therefore converges.

Duplicate progress is displayed as a persistent meter, for example `7 / 10 — Bonus pack`.

### Finishes

Finish is independent of tier grade:

- **Standard** uses the baseline treatment for the card's tier grade.
- **Golden** adds warm metallic treatment, enhanced frame detail, and restrained animated highlights.
- **Prismatic** adds a spectral edge, microfoil, richer pointer-responsive lighting, and the premium reveal.

Rare-or-better cards are already foil by baseline treatment. `Foil` therefore does not need to be a separate stored finish.

Proposed initial per-card finish odds:

- Standard: 98.9%
- Golden: 1.0%
- Prismatic: 0.1%

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
| Tier | Crown or S–F grade |
| Finish | Golden or Prismatic marker when applicable |
| Art | Blizzard full character render over the raid background |

The card does not show a numeric placement such as `#12`.

### Score mapping

- **DPS/HPS** is the normalized role-performance component. Use `parseScore`; display DPS or HPS according to the card's stored metric.
- **Mechanics** is the survival/mechanics component. Use `survivalScore`.
- **Combined** is the existing combined performance-mechanics score. The current implementation weights parse and survival equally.
- **M+** is `scores.all` from the Raider.IO Mythic+ season explicitly mapped to the raid set.
- **Tier grade** is the snapshotted canonical Crown/S–F classification.

Mythic+ is supplementary. A missing Mythic+ score displays `—` and does not block card publication.

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

- Mythic participation in the raid
- A stable internal `Character._id`
- Valid role-performance data
- Valid mechanics/survival data
- A valid combined score
- A successfully fetched Blizzard full character render

The exact minimum participation threshold should be set-level configuration. Existing character tier-list eligibility and mechanics data should be reused where possible rather than adding a second inconsistent scoring pipeline.

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

- Contains exactly one active raid set.
- Grants five daily Current packs.
- Uses the active set automatically.
- Receives weekly newcomer card publication waves.
- Moves to Legacy when the next raid becomes Current.

### Legacy

- Contains Uldir through the set immediately preceding Current.
- Grants five daily Legacy packs.
- Lets the user select the Legacy raid set before spending a pack credit.
- Allows the five daily credits to be split across different Legacy sets.
- Adds the former Current set at raid rollover.

A single Legacy pool spanning every historical character should not be used. It would make completing a particular raid binder unnecessarily frustrating and would bias results toward sets with larger eligible populations.

### Daily reset

- Daily allowances use an explicit `Europe/Helsinki` calendar date key.
- Current and Legacy allowances are independent.
- Daily allowances do not need to become permanent inventory.
- Earned duplicate and login bonus credits persist until opened.

### Pack contents

Initial pack configuration:

- Five cards per pack
- Four weighted slots
- One guaranteed `B`-or-better slot
- Optional soft duplicate protection on the guaranteed slot until the relevant pool is substantially collected
- Server-side cryptographic random selection
- Versioned odds and pool configuration stored with every opening

The client never submits card IDs, grades, rarity buckets, finishes, or random results.

## Guest play and account conversion

### Guest identity

- The backend creates a stable random guest token.
- The raw token is stored only in a Secure, HttpOnly, SameSite=Lax cookie.
- MongoDB stores only a cryptographic hash of the token.
- Guest data has a TTL; 30 days is the proposed starting value.
- The UI tells guests that their collection is saved temporarily and can be permanently claimed by logging in.

Cookie resetting and other lightweight abuse are accepted product tradeoffs. Basic rate limiting and idempotency are still required to prevent accidental or automated request floods.

### Guest allowances

Guests receive:

- Five Current packs per Helsinki day
- Five Legacy packs per Helsinki day
- Duplicate bonus packs under the same rules as authenticated users

### Claim on login

The first successful guest-to-user claim:

1. Merges exact card and finish quantities into the authenticated collection.
2. Transfers persistent bonus pack credits and duplicate-meter progress.
3. Preserves opening provenance.
4. Marks the guest identity claimed so it cannot be claimed twice.
5. Grants five additional Current pack credits as a one-time conversion bonus.

The conversion bonus is not granted on every login.

Claiming must be an idempotent database transaction.

## Collection experience

### Binder model

The primary collection experience resembles a physical card album:

- Current has a featured binder.
- Legacy presents a shelf of raid-specific binders.
- Each binder cover uses its raid background and set identity.
- Desktop binder pages use a 3×3 pocket layout.
- Tablet and mobile reduce the pocket count without shrinking cards below readable sizes.
- Missing cards appear as numbered dark silhouettes.
- Owned pockets display the highest owned finish and a visible total quantity.
- Selecting a pocket opens the large card viewer.
- The focused viewer lets the user switch between owned finishes and see quantities.
- Set completion and duplicate progress remain visible near the binder controls.

The binder is a real collection affordance, so a repeated card grid is appropriate here. A searchable index view can be added as a utility for large collections, but it is secondary to the binder.

### Set numbering

- Assign a stable, monotonically increasing set number at publication.
- Published numbers never change.
- Weekly newcomer cards append to the Current binder.
- Legacy backfills may be numbered deterministically during import.

### Filters and navigation

Useful collection controls:

- Current or Legacy
- Raid set
- Owned or missing
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

- E/F remain largely matte and restrained.
- C/D add metallic class accents.
- B introduces foil and stronger edge treatment.
- A adds layered depth and more active portal lighting.
- S/Crown use the richest set ornament, sigils, and premium foil behavior.

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

1. Show the selected set's pack and remaining allowance.
2. Pressing the pack breaks a seal or opens a raid-themed portal.
3. Five face-down cards enter with an approximately 100 ms stagger.
4. Edge lighting hints at tier without revealing the card prematurely.
5. Cards reveal individually or with **Reveal all**.
6. B, A, S/Crown, Golden, and Prismatic results progressively increase light, material, and sound treatment.
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
- Snapshotted name, realm, region, guild, and guild realm
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
- `{setId: 1, rarityBucket: 1}`
- `{characterId: 1, publishedAt: -1}`
- Search-supporting indexes for name, guild, class, and role as required by final query design

Application code must reject attempts to modify immutable snapshot fields after publication.

### `CcgGuest`

- `tokenHash`
- `firstSeenAt`
- `lastSeenAt`
- `expiresAt`
- `claimedByUserId`
- `claimedAt`
- timestamps

Indexes:

- Unique `{tokenHash: 1}`
- TTL `{expiresAt: 1}`
- `{claimedByUserId: 1}`

### `CcgOwnership`

Use a polymorphic owner:

- `ownerType`: `user` or `guest`
- `ownerId`
- `cardId`
- `finish`: `standard`, `golden`, or `prismatic`
- `quantity`
- `firstAcquiredAt`
- `lastAcquiredAt`

Indexes:

- Unique `{ownerType: 1, ownerId: 1, cardId: 1, finish: 1}`
- `{ownerType: 1, ownerId: 1, lastAcquiredAt: -1}`
- Collection filter indexes should include the denormalized fields only if measurement shows lookup joins are insufficient.

One document stores a quantity. Do not create one ownership document per duplicate copy.

### `CcgDailyAllowance`

- `ownerType`
- `ownerId`
- `dateKey`
- `currentGranted`
- `currentOpened`
- `legacyGranted`
- `legacyOpened`
- timestamps

Index:

- Unique `{ownerType: 1, ownerId: 1, dateKey: 1}`

### `CcgPackCredit`

Persistent non-daily pack entitlements:

- `ownerType`
- `ownerId`
- `mode`: `current` or `legacy`
- `source`: `duplicate`, `login_conversion`, `admin`, or future supported sources
- `remaining`
- source idempotency key
- timestamps

Legacy credits are not tied to a set until the user opens them, allowing the user to select a Legacy binder.

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

### `CcgPackPool`

Precomputed, versioned card IDs grouped by:

- set
- grade or rarity bucket
- pool version
- active state

Pack opening must not sort or scan the whole card catalog.

### `CcgPackOpening`

- `ownerType`
- `ownerId`
- `mode`
- selected `setId`
- allowance/credit source
- idempotency key
- pool version
- pack-rule version
- ordered result list
- per-result card id, finish, and new/duplicate classification
- duplicate rewards produced by this opening
- state
- timestamps

Indexes:

- Unique `{ownerType: 1, ownerId: 1, idempotencyKey: 1}`
- `{ownerType: 1, ownerId: 1, createdAt: -1}`
- `{setId: 1, createdAt: -1}`

### `CcgLedgerEntry`

Append-only provenance for:

- Daily grants
- Login conversion grants
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
3. Validate Current/Legacy mode and selected set.
4. Atomically reserve one daily allowance or persistent pack credit.
5. Load the active versioned pack pool.
6. Select card IDs with server-side cryptographic randomness.
7. Apply the guaranteed `B`-or-better slot and optional duplicate protection.
8. Roll each finish using the stored pack-rule version.
9. Determine whether every result is new or an exact duplicate, including duplicates repeated within the same pack.
10. Upsert ownership quantities.
11. Add exact duplicates to the mode-specific duplicate meter.
12. Convert every completed group of ten into a bonus pack credit.
13. Write the immutable opening result and ledger entries.
14. Commit.

If the transaction fails, no allowance, ownership, duplicate progress, or result is retained.

## Guest-claim transaction

Within one transaction:

1. Validate the guest cookie and locate the unclaimed guest.
2. Return the previous successful result if the claim is already complete for the same user.
3. Upsert guest ownership quantities into user ownership.
4. Merge mode-specific duplicate progress.
5. Transfer persistent pack credits.
6. Associate or annotate historical opening provenance with the claiming user.
7. Grant five Current conversion credits using a unique source key.
8. Mark the guest claimed and invalidate further guest writes.
9. Write claim ledger entries.
10. Commit.

The claim must remain safe under concurrent login callbacks and repeated browser requests.

## API surface

Exact route naming can follow existing backend conventions. The expected capabilities are:

### Public and owner-aware endpoints

- `GET /api/ccg/sets`
  - Current set and available Legacy sets
- `GET /api/ccg/session`
  - Owner type, daily allowances, bonus credits, duplicate progress, and claim state
- `GET /api/ccg/sets/:setSlug/catalog`
  - Paginated binder catalog with owned/missing state
- `GET /api/ccg/collection`
  - Paginated/filterable owned collection
- `GET /api/ccg/cards/:cardId`
  - Full immutable card details
- `POST /api/ccg/packs/open`
  - Body includes mode, selected Legacy set when required, and idempotency key
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
- Lock and roll over a set
- Inspect pack odds and simulated distributions
- Inspect guest and authenticated pack activity
- Inspect and retry character-media failures
- Apply explicit, audited pack-credit adjustments

Administrative writes use existing authorization patterns and TaskLog/audit infrastructure.

## Background jobs

### Character media fetcher

- Continuously processes the character-media queue.
- Gives Current candidates higher priority than general avatar backfill.
- Recovers stale jobs and retries transient failures.
- Exposes counts and recent failures to admin status.

### Current card candidate builder

- Finds Mythic raid participants with usable score data.
- Joins character identity, rankings, mechanics, Mythic+, guild snapshot, and media readiness.
- Produces a preview without publishing.
- Reports exclusion reasons per candidate.

### Card publisher

- Runs only through an explicit scheduled/configured wave or admin trigger.
- Takes the canonical grading snapshot.
- Assigns immutable grades, set numbers, crop values, theme version, and score provenance.
- Inserts only characters not already published in the set.
- Updates the versioned pack pool.
- Invalidates/warm relevant caches.

### Legacy backfill

- Processes one raid at a time from Uldir forward.
- Uses stored historical participation and scoring data.
- Queues all recoverable character media.
- Clearly distinguishes historical performance time from media capture time.
- Supports resumable batches and an admin preview before publication.

### Daily allowance

Allowance documents may be created lazily on first session/open request for the Helsinki date. A global midnight fan-out job is unnecessary.

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
- Treat client-provided set ids, modes, and filters as untrusted.
- Validate that Current and selected Legacy sets are open for the requested operation.
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
- Daily allowance use
- Guest-to-account conversion
- New versus duplicate rates
- Grade and finish distributions
- Duplicate bonus packs earned
- Opening transaction failures and retries
- Media queue throughput, 404s, and retry volume
- Candidate exclusion reasons
- Current and Legacy set completion rates
- Pack animation abandonment versus committed openings

Provide admin previews for:

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
- Implement Current and selectable Legacy pack modes.
- Add basic collection and opening APIs.

### Phase 4 — guest collection and claim

- Add guest cookies and TTL records.
- Allow anonymous Current and Legacy openings.
- Implement transactional claim and the five-pack Current conversion bonus.
- Verify concurrency and idempotency.

### Phase 5 — binder and pack UI

- Build Current and Legacy binder navigation.
- Add pack selection, opening, reveal recovery, card viewer, quantities, and duplicate meter.
- Add responsive and localized states.
- Add avatar and media fallbacks.

### Phase 6 — premium motion and seasonal theming

- Implement rarity ornament escalation.
- Add foil, Golden, and Prismatic materials.
- Add fine-pointer card tilt.
- Add raid-themed pack sequences and reduced-motion alternatives.
- Performance-test representative mobile and desktop devices.

### Phase 7 — Legacy backfill and rollover tooling

- Backfill Uldir forward, one set at a time.
- Review historical identity and missing-media handling.
- Add administrative Current-to-Legacy rollover.
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
- Guest token hashing
- Set state validation
- Card immutability guards

### Integration tests

- Successful transactional pack opening
- Idempotent repeated opening request
- Concurrent opening requests with one remaining pack
- Transaction rollback after a mid-operation failure
- Ownership quantity updates
- New finish versus exact duplicate behavior
- Duplicate-earned pack credit
- Legacy set selection
- Guest opening, claim, and repeated claim
- Concurrent login callbacks
- One-time conversion bonus
- Current-to-Legacy rollover
- Media 404, transient retry, and stale-job recovery

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
- Guest expiry and login claim messaging
- Character avatar fallback
- Keyboard navigation
- Screen-reader result summary
- Reduced-motion behavior
- Responsive card readability

### Manual visual QA

- All tier-grade treatments
- Standard, Golden, and Prismatic finishes
- Every raid background and its safe crop range
- Long character, guild, realm, and raid names
- Missing guild and missing Mythic+ values
- Avatar and silhouette fallbacks
- Mobile, tablet, and desktop binder layouts
- High-contrast focus states
- Slow network during media preload

## Acceptance criteria

The initial feature is ready when:

- A user or guest can receive and open five Current and five Legacy packs per day.
- A Legacy pack can target a selected Legacy raid set.
- Every committed result survives refresh and repeated requests.
- Guest cards and persistent rewards merge exactly once on login.
- The first guest claim grants exactly five additional Current packs.
- Cards remain immutable after publication and rollover.
- Tier grade is the visible rarity and drives pack/style behavior.
- Every pack contains five cards and satisfies its guaranteed slot.
- Exact duplicates increment visible quantities and the duplicate meter.
- Every ten exact duplicates award one same-mode pack credit.
- Current becomes Legacy without changing existing cards.
- The binder displays owned, missing, quantities, finishes, and completion by raid set.
- Character pages display a Blizzard avatar with a reliable fallback.
- Full renders and raid backgrounds produce stable card compositions.
- Reduced-motion, keyboard, mobile, and localization requirements are met.
- Pack opening and guest claiming are transaction-backed and idempotent.
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
- Guest TTL
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
