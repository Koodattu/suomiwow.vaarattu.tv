# Card Studio and Supporter set

Implemented 2026-09-16 from the product decisions in the grill-me session. The implementation and rollout notes below take precedence over the original engineering sketch later in this document.

## Implementation and rollout

- `/ccg/studio` provides character discovery, five saved drafts, publication, and edits to the single shared Supporter snapshot. Both English and Finnish are included.
- Studio verifies the complete EU Battle.net roster without a level filter. Durable Twitch and Battle.net identity bindings prevent moving allowances between site accounts. Publication, slot usage, creator ownership, pool updates, and leaderboard invalidation share a MongoDB transaction.
- Stored character renders use the existing shared ingestion service. Community render storage needs no migration. Successful refreshes have a six-hour cooldown, failed requests a one-minute retry delay, and creators have ten ingestion attempts per day.
- Supporter cards display the guild from the user's saved Battle.net roster, including guilds not tracked by the site. Refresh characters updates that roster; saving a draft picks up its guild name/realm and links a tracked guild when available. Publish/Apply changes reads the latest saved membership and updates the existing public card. Guild transfers and departures do not require refreshing artwork or create a new snapshot. Failed guild lookups preserve known membership; an unverified missing guild cannot erase a card's guild.
- Signed subscription events and weekly status checks supply evidence. A monthly sweep checks accounts in each Helsinki calendar month. Earned grants are permanent and uniquely indexed; outages never revoke them. Twitch does not provide a complete historical subscription timeline: activity missed by both events and checks cannot be credited automatically.
- Public Supporter packs cost one normal pack credit and contain five cards with replacement. Each card can roll the seven base finishes plus its selected raid finish. Custom pity uses separate `supporter-<finish>` counters with the existing 250-pull hard pity, advancing only when that finish is eligible. Base-finish pity remains shared; raid-pack pity is untouched. The selected finish is also eligible for redemption. Approved alternative images use the existing 25% alternative-art roll and unlock rules; approved audio uses the existing card-audio playback independently of the image unlock.
- Admin CCG controls can freeze editing and suppress distribution. Suppressed cards retain existing copies and points but leave the active completion denominator. Publication and moderation persist a revision that requests a full leaderboard rebuild through the existing runner.
- `CCG_SUPPORTER_LEADERBOARD_ENABLED` in `backend/src/config/ccg.ts` controls launch scoring. Changing it also changes the leaderboard score version; run the existing full leaderboard rebuild after changing this policy.

Deployment uses the existing MongoDB replica set, media storage, Twitch configuration, scheduler, and CCG feature gate. The backend runtime image now installs FFmpeg; rebuild the backend/worker image and frontend, and reload the updated nginx configuration. Both Compose configurations already mount the persistent `ccg_media` volume, so no Compose change or new environment variable is needed. Ensure the new model indexes are created before accepting traffic, especially creator identity, character identity, grant-ledger, and pending/approved media unique indexes. The Supporter set is created by the existing publisher initialization; no historical card migration is needed.

After deployment, reconnect the **vaarattu broadcaster** through the existing admin Twitch connection to authorize `channel:read:subscriptions` and `moderator:read:followers` alongside the existing reward permission. Viewer connections do not need these broadcaster scopes. The scheduler creates `channel.subscribe` and `channel.subscription.end` EventSub subscriptions using the existing signed HTTPS callback. The admin panel reports setup failures; weekly API checks continue independently. Confirm the callback is reachable and Twitch accepts both subscriptions.

Before public launch, perform a controlled real-account check: connect Battle.net and Twitch, verify follower/subscriber allowance, publish a draft, open a Supporter pack, and apply a score/transmog update. Automated verification uses mocked provider responses and an isolated MongoDB replica set; it does not exercise real OAuth consent or live Blizzard/Twitch availability.

The implemented API is under `/api/ccg/studio`: `GET /`, `GET /characters`, `POST /roster`, `POST /status`, `POST /drafts`, `PATCH` and `DELETE /drafts/:id`, `POST /drafts/:id/render`, and `POST /drafts/:id/publish`. Admin moderation uses `GET /moderation` and `PATCH /moderation/:id`. Mutations require the existing session, JSON content (except raw media uploads), and the site's allowed Origin. Public card and opening responses never expose the private roster or tokens.

### Character loading and refresh

The overview loads saved creations, slots, Twitch status, media review state, rewards, and editor choices from the database. The browser then requests characters separately when Battle.net is connected. Pending media review polls only the overview once per minute. Neither overview polling nor the browser's five-minute character-query stale time expires the stored Battle.net roster.

`User.battlenet.characters` stores the complete EU roster at all levels, including realm IDs, guild names/realms, selection flags, and successful guild-check timestamps. Connecting/reconnecting fetches the roster once and checks guilds with at most five concurrent requests per API process. `rosterSyncedAt` marks the shared cache, including a successfully fetched empty roster. Existing accounts without that marker fill it on their first Studio character read; no database migration is required. Successful caches have no automatic expiry and remain readable after the access token expires. Ownership checks use the last synced roster until the user refreshes it; disconnect and account-binding guards remain in place.

Refresh characters in Studio and profile use the same sync service. Concurrent syncs for a user share one operation within an API process; refreshes within 30 seconds reuse the saved result, and Studio retains its five-minute manual refresh limit. Failed Studio roster syncs refund their original rate-limit window, so an expired token or Blizzard failure does not replace the next attempt's actionable error with a cooldown. Guild checks cover every character rather than stopping after ten seconds. A failed roster request leaves saved characters intact. Individual failed guild checks retain the previous guild and timestamp; retrying requires an explicit refresh. Large rosters can take longer because every guild lookup is attempted.

Battle.net refresh logs include the site user ID, cache timestamp/count, token-expired flag, result code, upstream HTTP status when available, and duration. Studio logs distinguish roster reads from manual refreshes, fallback responses, and rejected routes (including cooldown deadlines). Tokens, request bodies, and raw upstream error payloads are excluded from these diagnostics.

Creating a draft still requests that character's Armory profile for class/spec and identity, then its profile/media to ingest artwork. Refresh from Armory also requests profile/media for artwork. Saving and publishing use the stored roster and do not call Battle.net. Published card guilds change only when Publish/Apply changes succeeds.

Verification includes focused backend tests plus `npm run test:ccg-supporter --prefix backend`. The latter requires a disposable local MongoDB replica set at the address documented in `backend/integration/ccg-supporter.test.ts`; it creates and drops its own process-specific database. Coverage includes duplicate and out-of-order events, simultaneous slot grants/publications, five-draft enforcement, ownership rejection, mutable snapshot edits, actual user/guest pack openings, pity, creator-finish isolation, moderation, and leaderboard invalidation.

## Supporter media extension

Card Studio offers all configured, unlocked raid backgrounds plus Community and Supporter backgrounds, with a horizontal position slider. The chosen path and crop are stored on the existing Supporter card when changes are applied; its ID, snapshot version, and collector ownership remain unchanged. No historical migration is required. Cards without a selected background retain their set background. The workbench keeps optional media visible beside the editor on wide screens, locked until publication. Selecting an image previews it locally with a toggle before uploading; audio always requires admin review.

Image submissions use the official `openai` SDK and the existing `OPENAI_API_KEY`, with `gpt-6-luna`, low reasoning, structured output, `store: false`, a 25-second timeout, and no automatic retries. Only a `safe` result scoring at least 75/100 with no flagged issues is auto-approved. This is model-reported confidence, not a calibrated probability; review real submissions before lowering the threshold. Ambiguity, likely violations, refusals, invalid responses, missing credentials, and provider failures leave the durable submission pending for an admin. The normalized image is sent inline; no public URL or user identity is sent. Embedded image instructions are treated as untrusted content. Ordinary fantasy characters/weapons/combat are allowed; sexual content, nudity, graphic gore, hate, targeted harassment, personal data, advertising, unrelated imagery, and unclear content are flagged for admins.

Admin media review includes approved submissions and their AI model, confidence, reason, policy version, response ID, and review time in the stored audit record. The panel identifies AI approvals and supports the existing revoke action. AI details are omitted from creator responses. Auto-approval uses the same transactional replacement and cache invalidation path as manual approval; audio never calls the model. AI tests mock provider responses and do not spend API credits. Official references: [Luna](https://developers.openai.com/api/docs/models/gpt-6-luna), [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs).

Published cards accept optional alternative character images and audio in Card Studio. Only these uploads require review in **Admin → CCG → Supporter media review**. Publishing and editing the card itself remain immediate and never create another collectible snapshot.

- Files live under `supporter/` in the existing persistent `ccg_media` volume; MongoDB stores ownership, review state, checksums, and media metadata. Back up the volume together with MongoDB. Pending files are accessible only to their uploader and admins. Public serving rechecks approval, uses `no-store`, and supports audio range requests.
- Images: static PNG/WebP, up to 5 MiB and 40 million decoded pixels, with any opacity, including fully opaque or fully transparent artwork. The existing Sharp dependency resizes to fit 2048 × 2048 without enlargement, converts to WebP, and strips metadata.
- GIF and WebM artwork uses the same upload limits and accepts any opacity. FFmpeg preserves animation, fits frames within 2048 × 2048, and converts to silent VP9 WebM. GIF loop metadata is ignored during conversion; the card player loops the result. AI reviews only the first frame extracted from the normalized animation, encoded as a still WebP with transparency. The same safety prompt and approval threshold apply; later frames are not reviewed. Extraction failures or AI results that do not qualify for auto-approval leave the submission pending for admin review.
- Static and animated AVIF (`.avif` / `.avifs`), including AVIF files named `.gif`, are identified by their file contents and converted to the same WebM format. The converter selects the full animation rather than its still cover, merges the matching AV1 transparency stream, and preserves frame timestamps. The existing size, pixel and processing limits and first-frame AI review apply.
- Audio: common FFmpeg audio/container formats (MP3, WAV, FLAC, Ogg, AAC/M4A, MP4, WebM/Matroska, AIFF, WMA), up to 8 MiB. Decode and measure the first 10.01 seconds; reject decoded duration at or above 10 seconds. Re-encode accepted audio as 96 kbps stereo MP3 at 44.1 kHz without metadata. Input format/protocol allowlists and subprocess timeouts limit processing. Local development/tests require `ffmpeg` and `ffprobe` on PATH, or `FFMPEG_PATH` / `FFPROBE_PATH` overrides.
- Audio decoding allows FFmpeg to recover from damaged packets before validation and re-encoding. Empty, undecodable, oversized, and over-duration files are still rejected; uploaded source bytes are never served as the approved audio.
- Forty successful uploads per creator per UTC day, shared between image and audio uploads. The quota is charged in the transaction that saves normalized media for review; validation, processing, and transaction failures do not consume it. The accepted-upload counter is separate from the former attempt counter, so earlier failed attempts do not carry over. At most one pending/processing submission per card and kind, with two active conversions and eighteen waiting per API process. A new image and audio can be reviewed separately.
- Replacements preserve the currently approved media until approval. Admins approve, reject, or remove approved media; rejection/removal requires a reason shown to the creator. Creators may withdraw a pending upload. Approval replaces that media kind for all collectors without changing stats, rarity, finish, or snapshot.
- Media is scoped to the Supporter card, never inherited from or applied to the same character's raid/Community cards. The legacy admin artwork editor cannot modify Supporter media. Only approved images permit alternative-art grants.
- The hourly worker cleanup removes failed/abandoned uploads, withdrawn files after 7 days, and rejected/superseded files after 30 days. Approved files are retained. Review records remain after file cleanup.

Media endpoints: `POST /api/ccg/studio/media/:sourceId/:kind` with an `application/octet-stream` body, `DELETE /api/ccg/studio/media/:submissionId`, admin `GET /api/ccg/studio/media-review` and `POST /api/ccg/studio/media-review/:submissionId`, and access-controlled `GET /api/ccg/media/supporter/:submissionId`. Nginx allows 8 MiB bodies and a 120-second upstream timeout on the upload path.

Verification adds actual image/audio normalization tests and replica-set integration coverage for privacy, ownership, publication gating, independent review, concurrent approval, replacement, withdrawal, rejection, cleanup, audio range serving, and real pack alternative-art/audio results.

## Product contract

**Card Studio** at `/ccg/studio` uses a slot-driven workspace without tabs. The top grid starts with ten positions: two base slots, three follower opportunities, and five subscriber opportunities. Permanent grants unlock those positions; additional earned capacity extends the grid. Clicking an available position opens a compact character picker below the slots; clicking a creation opens its editor. The roster is hidden until creation begins. Draft placement is provisional and only publication spends capacity. A saved-drafts drawer keeps all five working copies accessible even when publication capacity is exhausted.

The default page also shows a collection grid of the latest raid cards featuring the connected account's characters. There are no captions beneath those cards. Inspection provides snapshot/ownership counts and a collection link. Battle.net, Twitch, and slot explanations are accessible through compact header controls, with a contextual Battle.net prompt when connection is needed. Character-load failures remain in the corresponding picker tile; appearance, save, and publication feedback remains in the editor.

Confirmed requirements:

- Character ownership comes from Battle.net; public character data and the render come from Armory. No guild, raid participation, logs, gear, performance, or site-tracking requirement.
- One permanent published card per character in the Supporter set; subsequent updates change that same card for all collectors. No additional collectible snapshots.
- Creators choose rarity, role/spec, custom scores, and one card-specific raid finish. All collectors can obtain standard, foil, golden, prismatic, holographic, negative, astral, and that card's selected finish. For example, choosing Phaseglass allows Phaseglass on that card but no other raid finishes.
- Published cards cannot be deleted by creators. Drafts can be saved and deleted.
- Supporter has a dedicated pack at the bottom of Open Packs. It never enters All Raid Sets, custom raid selections, or raid-pack replacement rolls.
- Supporter cards count toward leaderboard points at launch. A later scoring-policy change must be applicable with a full rebuild.
- Alternative art and audio are available through the reviewed-media extension above. Existing character-wide alternative art is never inherited automatically.

## Confirmed launch decisions

These product decisions were settled in the grill-me session.

| Topic | Decision |
| --- | --- |
| Initial slots | Every user starts with two slots. Following earns +3 once; subscribing earns +5 once. A follower who subscribes starts with ten. The follower grant requires verified following. |
| Subscription tiers | Equal allowance for all active tiers, including Prime and gifted subscriptions. |
| Monthly growth | +1 for each qualifying calendar month in Europe/Helsinki, starting the month after the first verified subscriber month. No bonus in that initial month. At most one monthly grant per account per month. |
| Tracking start | Starts when Twitch is connected to the site. No rewards for months before connection. |
| Twitch disconnection | Intentionally disconnecting pauses new reward tracking until reconnection. Earned slots remain usable. No rewards for disconnected intervals; reconnecting preserves original grant history and the first-month exception. |
| Draft limit | Five saved drafts per creator, independent of earned slots. Drafts are deletable and do not consume publication slots. |
| Subscription expiry | All earned slots remain usable. Published cards, creator copies, editing access, and pack availability remain. Battle.net character ownership is still required for publishing and editing. |
| Re-subscription | Can qualify for future monthly grants; never repeats initial grants, resets usage, or restarts the first-month exception. |
| Rarity and creator finish | Editable in a draft; locked at first publication. Stats, valid spec/role, and appearance remain editable afterward. |
| Pack access | Everyone who can open ordinary packs, including guests. One existing pack credit buys five Supporter cards; no Twitch requirement for collecting. |
| Pack size and selection | Five cards, uniformly chosen from published Supporter characters, with replacement. Existing base-finish odds and pity behavior. |
| Geography | Preserve the current EU account integration for the first release and explicitly label it. No level filter. Supporting US/KR/TW account ownership is additional work; public Armory lookup support alone does not provide ownership proof. |
| Distribution after departure | Published cards remain in packs even if the creator leaves or the character disappears from Armory. Keep the last saved render. Loss of verified ownership freezes editing; admin can suppress distribution when necessary. |
| Transmog refresh | Initial Armory import immediately; later successful refreshes at most once per character per six hours. Failed requests permit an earlier retry. Refresh prepares a preview; Apply changes updates the published card. |

There is no fixed ten-card lifetime cap: ten is the initial total for someone who both follows and subscribes. Monthly grants increase permanent capacity. No additional total-cap rule has been requested.

Unused slots accumulate and never expire. A published card permanently consumes one slot and cannot be swapped for a different character to recycle it. Following/subscription status governs earning additional slots, not spending slots already earned.

## What Twitch can verify

Current subscription status is available through [Get Broadcaster Subscriptions](https://dev.twitch.tv/docs/api/reference/#get-broadcaster-subscriptions), using the broadcaster's token with `channel:read:subscriptions`. Its response includes tier and gift status, but no historical subscription-month count.

Follower status is available through [Get Channel Followers](https://dev.twitch.tv/docs/api/reference/#get-channel-followers), using the broadcaster's or an authorized moderator's token with `moderator:read:followers`.

[Subscription Message events](https://dev.twitch.tv/docs/eventsub/eventsub-reference/#channel-subscription-message-event) include cumulative months. However, [the event is triggered by a shared resubscription chat message](https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/#channelsubscriptionmessage), so it is not a complete historical lookup for every subscriber. Subscription-start events are also not a monthly renewal ledger. Do not infer actual lifetime subscribed months from elapsed time since first observation.

Recommendation: use broadcaster authorization for both checks. Viewers keep their existing identity connection; they do not need additional subscription/follow scopes. Extend the existing broadcaster authorization deliberately and show its required capabilities in admin. Verify the saved token belongs to the configured broadcaster ID. Do not use the chatbot identity as a substitute for the broadcaster.

Monthly rewards use subscription evidence collected after the account connects, not Twitch's historical tenure. Record successful subscription checks and verified subscription events with their observation/effective times. A qualified month can grant immediately; the user need not visit again at month end.

## Permanent grants and calendar months

- Persist the original tracking start and first verified subscriber month. Neither resets on reconnect, an expired subscription, or an account-recovery operation.
- Use a durable grant ledger with unique keys for `(broadcasterId, twitchUserId, grantKind, periodKey)`: one follower grant, one initial subscriber grant, and one grant per eligible `YYYY-MM` in Europe/Helsinki. A grant's slot amount is +3, +5, or +1 respectively. Studio access transactionally tops up older initial grants to the new amounts once, including after support ends or Twitch is disconnected.
- Atomically insert the grant and increase earned capacity. Duplicate login, webhook, manual refresh, and job deliveries must not double-credit. Used slots are allocated separately, with `used < earned` checked transactionally.
- The initial subscriber month never receives its monthly +1, even when subscription verification repeats or the user reconnects. Following can qualify separately before or after that month.
- Later months qualify when supported by a verified active-subscription observation or valid subscription event in that month. Qualifying once is sufficient; ending the subscription later does not revoke that month's grant.
- Example: a follower first connects and is verified subscribed on September 30: ten slots. A verified subscription on October 1 grants an eleventh. No September monthly bonus. If November has no qualifying evidence, no November bonus; verified subscription in December grants one more.
- No inference of uninterrupted subscription from first-seen date, stale cached status, or a later positive check. No automatic backfill for months without evidence. Stored evidence and grant-processing failures can be replayed safely for the correct historical month after tracking began.
- Persist tracking-enabled intervals or connection revisions. Disconnect stops account-specific polling and reward evidence collection; reject evidence from disconnected intervals, including delayed events received after reconnection. Fence in-flight checks against disconnection so they cannot introduce new qualification after tracking stops. Qualification already durably recorded before disconnect remains valid and can finish processing idempotently.

Polling cannot prove every real-world subscription interval during an outage. Keep coverage failures visible to admin and retain evidence for reconciliation instead of promising complete historical coverage or fabricating grants. Intentional disconnection pauses qualification; it does not revoke grants or erase previous usage.

## Eligibility checks and failures

Maintain cached status separately from permanent grants and publication usage. Store the broadcaster ID, Twitch user ID, following/subscription result, tier, successful check timestamps, and verification error state. An API error is **unknown**, not **not subscribed**. Grant processing runs through the same idempotent service for every source below.

- On Twitch connect: check status immediately.
- On site login: queue a refresh when stale; do not delay or fail site login.
- On Studio entry: serve cached state immediately and refresh if older than 15 minutes.
- Manual **Refresh status**: bypass the normal cache, subject to a 60-second server cooldown.
- On publication: require an unused earned slot and current Battle.net ownership proof. Do not require a current follow/subscription or a successful Twitch request to spend an existing slot. Reuse very recent ownership proof to absorb double clicks.
- Recommended background coverage: a weekly reconciliation of tracked linked accounts, a month-boundary pass, and subscription events between checks. Batch requests and reuse the existing scheduler/job locks. Retry transient failures with backoff and respect provider limits. Check all tracked linked reward participants, not only recent Studio visitors.
- If Twitch verification cannot complete: preserve earned slots, drafts, collections, and last known status. Delay unverified new grants; spending earned slots remains available. Failed Battle.net ownership verification pauses publication/editing, not collection access.

Monthly accrual makes subscription EventSub useful in the first release: weekly polling alone can miss eligibility between checks. Reuse existing signature verification, broadcaster validation, and delivery deduplication for subscription start/end events. A valid delayed start event can supply historical evidence for its own eligible month without overwriting a newer current-status observation. Events never replace month-boundary and periodic checks, since subscription-start events do not represent every renewal. Process notification time carefully and reject events from before tracking started. Out-of-order events must not revoke a permanent grant.

## Character ownership and identity

Use the existing site session, then connect Battle.net. The current application signs users in through Discord; Battle.net and Twitch are linked identities. Do not silently introduce new primary sign-in methods as part of this feature.

The current Battle.net sync is EU-only, filters to level 60+, and does not store realm ID or region on each character. The Studio needs an unfiltered account-character result with explicit region, realm ID, Blizzard character ID, and the selected character's public profile. Preserve other profile consumers' existing behavior through an explicit Studio path or option.

- The browser submits a selection from a server-provided account roster, not arbitrary name/realm ownership claims.
- At publication, verify the selected character still appears in the authenticated roster and matches the public Armory response.
- Store region, realm ID, and Blizzard character ID as external identity evidence, with a stable internal identity for the Supporter series.
- Treat name and realm slug as display/lookup data, not sufficient ownership evidence. Do not assume Blizzard IDs survive every transfer unchanged.
- Reuse tracked-character and continuity resolution when available, but never require a tracked character to create a Supporter card.
- Keep an untracked Supporter card's series ID stable if it later becomes a tracked raid character. Linking must not replace its collectible identity or ownership records.
- Renames/transfers that cannot be proven automatically require recovery; no automatic takeover based only on a matching name.
- If the character is no longer on the linked Battle.net account, freeze mutations. Existing published cards and collected copies remain.
- A missing render or temporary Armory failure leaves a recoverable draft. Publication requires a successfully stored render. Missing active-spec data on a lower-level character should permit a valid manual spec selection.

To prevent reconnect farming, bind publication usage durably to the creator and the original Twitch/Battle.net identities. Use database uniqueness and transactional allocation, not only the current account-link fields. Reconnecting the same identities preserves usage; changing the identities must not grant a new allowance or transfer editing rights automatically. Account-recovery cases should be explicit admin operations.

## Studio experience

Show the page and a useful connection state even before accounts are linked. Require Battle.net for private character discovery and ownership verification. Everyone receives two base slots. Require verified Twitch support to earn additional slots; publishing spends previously earned slots even after unfollowing or unsubscribing.

The supporter shelf stays mounted while the picker/editor is open. Desktop uses six columns, with three and two columns at narrower widths. Card typography scales with the rendered card width through the shared CCG typography variables. Raid cards are separate from Supporter/Community creations and do not grant ownership to the character owner.

Connection controls show current provider status separately from permanent slot entitlements. The authenticated Studio response derives follower/subscriber entitlements from the grant ledger, not current Twitch status. Aggregate earned/used/available counts remain authoritative. Failed creation retries reconcile saved creations first so a lost response does not leave an inaccessible draft.

Editor sequence:

1. Select an owned character. Load Armory profile and stored render immediately with a visible loading state.
2. Show a large live card preview. Choose a valid class specialization and role, rarity, creator finish, performance score, mechanics score, and M+ score. Class/name/identity are not editable text fields.
3. Show the public standard appearance and creator finish as preview choices so users understand what everyone else can collect.
4. Save Draft, or review and Publish. Publication review states that the character slot is permanent, the creator receives one copy with the selected raid finish, and future saved changes affect everyone's copy.

After publication, edits use a working draft while the live card remains unchanged. **Apply changes** updates the existing card. Refreshing transmog updates the preview first; it does not silently change every collector's card. Show save state and recover from reloads and request failures. Use optimistic revision checks to prevent an old browser tab overwriting a newer edit. Recommended editor default: at most one working draft per character; saved working copies count toward the five-draft limit, with discard/apply freeing that space.

Use the existing card renderer, finish styling, account connection components, and English/Finnish localization. Keep the editor usable as a single column on mobile with a reachable preview and explicit save/publish controls.

## Scores, rarity, and creator finish

- Treat the performance field as the existing card's 0–100 DPS/HPS score, not raw damage or healing per second. Label based on role; tanks use DPS.
- Accept finite performance/mechanics values between 0 and 100, rounded to one decimal. M+ is a finite nonnegative score with a documented upper bound, initially the existing 100,000 ceiling. An unset value remains visibly unset.
- Calculate combined on the server: `roundTo1Decimal((performance + mechanics) / 2)`. If either component is unset, combined is unset. Reject/ignore client-supplied combined rather than storing it as authoritative.
- **Randomize stats** changes preview values only, within the same bounds, and recalculates combined. It makes no Armory request and never auto-publishes.
- Explain in card details that Supporter stats and rarity are creator selected. They are not measured raid results. Keep them out of verified performance records and combat scoring unless a future mode deliberately supports custom stats.
- Allow existing rarity grades, including H. Do not force a grade distribution or raid-style A-or-better guarantee on this pool: creators control grades, so those assumptions are unreliable.
- Creator finishes come from an explicit allowlist of released raid finishes, excluding reserved keys. The chosen effect does not make the card a member of that raid's set or import its background/theme.
- Grant exactly one copy with the selected raid finish during first publication. Use an idempotent grant identity and the existing ownership/series bookkeeping. Lock the chosen finish at publication so a card's obtainable finishes stay stable.
- All other grant paths, including redemption and admin codes, allow only the seven base finishes plus the selected finish for that Supporter card. Other raid finishes and unapproved alternative artwork are rejected. Sharing a preview must not grant ownership.

## Rendering and mutable publication

Community cards already call `characterRenderStorageService.ingest`, persist `renderAssetId`, and use stored WebP assets with content hashing and fit metadata. Regular cards use the same service. No separate Community render migration is needed for this feature based on the inspected code.

Reuse that pipeline. Only accept server-fetched Blizzard media URLs, keeping the service's host, format, size, and timeout checks. Retain the last good asset on failure. Identical refresh results should produce a “No appearance changes found” result and preserve the published image. A changed image gets a different asset reference; never overwrite immutable image bytes at a cacheable URL.

Do not copy Community's automatic render refresh into Supporter publication behavior: the creator should choose when a new appearance becomes public. Avoid introducing a broad asset garbage-collection project here; any cleanup added for discarded drafts must preserve shared and published references.

Keep `CcgCard._id`, series identity, set number, and `snapshotVersion = 1` stable. A separate edit revision supports concurrency/audit without creating collectible snapshots. Store private draft edits separately from the public card payload.

Published raid cards currently reject mutation through model hooks; Community uses a narrowly filtered raw collection update. Add an equally narrow, reviewed Supporter update path restricted to Supporter source/card/creator identity and an explicit editable-field allowlist. Do not weaken raid-card immutability globally.

All reads of collection cards, catalogue, card shares, and pack-reveal details must resolve the current Supporter card. Preserve historical opening/grant facts, but do not render stale embedded Supporter stats as a second snapshot. Invalidate relevant response/share/OG caches; already downloaded images or third-party link previews cannot be forcibly updated.

## Pack isolation

Introduce `CcgSet.kind = "supporter"`, a `supporter` slug, and a reserved non-raid zone identity. Do not put it in `CCG_CONFIGURED_SETS`, which drives raid behavior.

Use an explicit Supporter pack selection mode. Reuse transactional balance deduction, pack-opening persistence, idempotency, finish rolling, and ownership writes, but keep candidate selection separate from `selectPackResults`, which currently selects raids and can inject Community cards.

Hard invariants:

- All Raid Sets selects raids and retains its existing Community behavior; no Supporter candidates.
- Custom raid selections accept only raid IDs, even when a forged request includes Supporter.
- The Supporter pack selects only published, distributable Supporter cards. No Community substitutions or alternate art.
- Supporter packs track custom-finish pity separately for each eligible selected finish, without advancing or resetting raid-pack finish pity. Test switching pack types and mixing Supporter cards with different selected finishes.
- An empty pool disables the pack action; a pool race must never charge a pack balance without producing a valid opening.
- A small pool can contain fewer than five unique characters. Duplicates are expected; no new minimum-card publication gate.
- Publishing another card expands the pool. Applying only score/spec/render changes does not rebuild an unchanged membership pool.

## Leaderboards

User decision: Supporter counts at launch. Include ordinary collection, rarity, finish, and completion points under the existing model. Card finish completion requires all eight obtainable finishes: the seven bases plus that card's selected raid finish. The score version advances for this rule so the existing rebuild recalculates completion.

The inspected leaderboard service recalculates from ownership and card data during a full refresh. Add the Supporter inclusion decision in one scoring-policy location shared by full and incremental calculation. A later exclusion changes the policy, advances the scoring version as appropriate, and runs a full rebuild; it does not delete cards or rewrite acquisitions. Keep UI explanation in sync with the active policy.

Critical existing constraint: incremental selection currently uses `lastAcquiredAt`. A new Supporter publication changes the set-completion denominator for everyone who already owns that set, even if they acquire nothing. A metadata change that affects scoring has the same issue. Do not falsify acquisition timestamps to trigger a refresh.

For launch, persist a pending full-rebuild request after publication/moderation or scoring-relevant changes. Debounce/coalesce requests into the existing scheduled runner. Capture the requested revision so a change during a rebuild remains pending for the next run. The runner currently skips when busy, so a one-shot trigger alone would lose work. The daily full rebuild remains recovery coverage.

Locking rarity at publication avoids repeated user-driven score changes. Custom performance/M+ values do not themselves contribute collection points, and must not enter verified raid-performance record leaderboards.

## Minimal engineering shape

Reuse the existing MongoDB, Express services, scheduler, React Query, and CCG components; no new production dependency or queue system is needed.

New responsibilities:

- Supporter status service: broadcaster checks, freshness, error classification, and bounded reconciliation.
- Durable creator/usage record and grant ledger: owner identity bindings, tracking start, first subscriber month, permanent earned/consumed slots, monthly evidence, and unique grant constraints.
- Supporter creation record: character identity, draft working copy, publication pointer, selected creator finish, revision, and cooldowns.
- Supporter service: ownership authorization, validation, rendering, publication, updates, and narrow moderation.

Reuse `CcgSet`, `CcgCard`, `CcgPackPool`, `CcgOwnership`, and `CcgSeriesOwnership`. Reuse score-shape and render utilities where their semantics match; do not route public writes into admin Community endpoints. Existing Community score normalization accepts negative values and independently supplied combined values, so it is not sufficient unchanged for Supporter validation. Preserve Community behavior unless a separate fix is agreed.

Representative authenticated API boundaries:

- `GET /ccg/studio`: capabilities, connection/status state, usage, and paginated creations.
- `GET /ccg/studio/characters`: owned characters with matching catalogue/collection summaries.
- `POST /ccg/studio/status/refresh`: force status verification within cooldown.
- `POST /ccg/studio/drafts`, `PATCH /ccg/studio/drafts/:id`, `DELETE /ccg/studio/drafts/:id`.
- `POST /ccg/studio/drafts/:id/render-refresh`.
- `POST /ccg/studio/drafts/:id/publish`: first publication or apply an edit, distinguished and validated server-side.
- Existing pack-opening API extended with an explicit Supporter selection contract.

First-publication transaction: verify actor/bindings/revision, reserve a remaining slot with a conditional write, allocate a permanent set number, create the single card, mark publication, grant creator ownership and snapshot 1, update the pool, and record pending leaderboard work. Perform external verification/media ingestion before the short DB transaction, then recheck local identity/proof versions inside it. A retry must return the original publication and never grant a second copy or consume a second slot.

Keep set-number allocation monotonic and separate from the current distributable card count. Moderation must not let numbers be reused.

Draft CRUD and published edits require owner authorization and existing session/CSRF protections. Tokens and the private Battle.net roster never appear in public CCG responses. Admin can freeze edits or suppress distribution for abuse without deleting collectors' ownership; creators cannot unpublish or reclaim used slots.

## Initial rate limits

| Action | Proposed limit |
| --- | --- |
| Twitch manual status refresh | Once per 60 seconds per linked Twitch identity, coalescing concurrent checks |
| Battle.net roster manual refresh | Once per 5 minutes per account; publication verification uses a short cached proof |
| Studio requests | Up to 180 per minute per creator, allowing ten-card creation sessions with repeated saves and overview reads |
| Render ingestion/refresh | Confirmed: immediate initial fetch, then once per character per 6 hours after a successful fetch. Abuse ceiling: 20 attempts per creator per day across draft creation and refresh |
| Failed render retry | Short backoff (initially 60 seconds), not the six-hour success cooldown |
| Draft saves | Debounced, up to 60 per minute per creator |
| Apply published edits | Once per card per 5 minutes |
| Publication attempts | Up to 20 per minute per creator, with idempotency and lifetime slot checks |

Use database-backed conditional cooldowns/counters for expensive operations so parallel tabs, multiple processes, reconnects, or restarts cannot bypass them. Add ordinary per-IP abuse protection using existing middleware. Return `nextAllowedAt`/`Retry-After` where useful. Provider failures must not consume publication capacity. Stats randomization stays local until save and needs no external quota.

## Delivery and verification

1. **Status and identity:** broadcaster authorization capabilities, status cache, subscription events/reconciliation, monthly grant ledger, unfiltered Studio roster, durable usage binding, and connection UI. Verify current subscriber/follower and provider-error cases with mocked APIs plus controlled account smoke checks.
2. **Studio drafts:** character discovery, shared preview, draft persistence, score calculation, render ingestion/refresh, and localized states. Verify ownership and cross-user access, low-level/untracked characters, and expired Battle.net authorization.
3. **Publication:** atomic slot allocation, one stable snapshot, creator grant, edits, cache invalidation, and moderation. Test simultaneous last-slot publishes, same-draft retries, stale tabs, disconnect/reconnect, failure after render storage, and subscription lapse.
4. **Pack and scoring:** explicit Supporter mode, seven base finishes plus the selected raid finish per card, every grant-path restriction, leaderboard inclusion and rebuild invalidation, and collection/share integration.
5. **Launch checks:** mobile/desktop Studio walkthrough in both locales; existing Community, raid packs, Twitch rewards, immutable snapshots, and collection sorting remain covered.

Required automated regressions include forged Supporter IDs in All Raid Sets, accidental Community injection, per-card finish restrictions through redemption/reward paths, all-H or very small pools, concurrent pack/publish operations, identical render refreshes, correct cache/read-model updates after edits, eight-finish completion, and a full rebuild both including and excluding Supporter. Test that new publications invalidate prior set-completion bonuses even for collectors with no recent acquisitions.

Grant regressions must cover the excluded first month; Helsinki month/year boundaries and DST; concurrent job/login/event grants; duplicate and delayed events; gaps and subsequent subscriptions; Prime/gifted/all paid tiers; no grants before connection or for disconnected intervals; disconnect racing an in-flight check; replay after partial failure; reconnects without duplicated initial or monthly grants; and publication from banked slots after unfollowing, subscription expiry, intentional Twitch disconnection, or Twitch API failure. Published cards must remain distributable when Armory no longer returns the character.

Use the repository's targeted `node --test -r ts-node/register` tests, backend TypeScript build, frontend lint/build, and Mongo-backed integration tests for transactional behavior. Run these during implementation; no tests were run for this planning-only change.

Before release, enable the set only after its indexes, pool, stored rendering, broadcaster scopes, and full leaderboard rebuild are ready. Rollback disables new creation/pack distribution while preserving published cards and ownership.

## Interview outcome

The product questions raised in the interview are resolved. Intentionally disconnecting Twitch stops future reward tracking until reconnection, while preserving earned slots, publication rights, original tracking start, first subscriber month, and grant identities. Reconnecting the same Twitch identity resumes qualification without repeating initial grants or restarting the first-month exception.

Technical limits other than the confirmed five-draft and six-hour transmog limits, plus scheduling details, remain proposed engineering defaults. This document is the reviewable implementation plan; the interview has not authorized feature implementation.
