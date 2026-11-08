# Forever leveling

## Leaderboard performance and freshness

The leveling endpoint shares a 30-second ranked snapshot across API processes,
using the same lease-based cache service as M+. Its storage remains isolated in
`forever_leaderboard_cache` and `forever_leaderboard_leases`. Each API process
warms the snapshot every 15 seconds; a shared lease prevents duplicate builds.
Expired snapshots wait for a fresh build rather than serving indefinitely stale data.

A build reads only public character fields, without histories, using MongoDB
snapshot read concern for a consistent population during concurrent worker updates.
Ranks are assigned once by level descending, first observation of that level,
then ID. Filtering, statistics and pagination operate on that ranked population
in memory. Warm requests perform one indexed worker-revision read, rather than
repeating population scans and ranking queries. Admin visibility/status changes
bump that revision so all API processes invalidate the old population.

The first page receives server-fetched data and renders its rows in the initial
HTML. The browser caches filter/page results, prefetches adjacent pages, debounces
search and cancels obsolete requests. Active views refresh within roughly one
minute of the snapshot timestamp, including when revisiting cached pages. This
bounds presentation delay for data already in our database; Blizzard publication
delays and the separate Armory polling schedule still apply.

The isolated `integration/forever-leaderboard.test.ts` checks global ranks,
concurrent build coalescing, shared cache reuse, moderation and expiry. Frontend
query freshness and cancellation are covered by
`node --test test/forever-leveling-query.test.mjs`.

## Community analytics

`/forever/analytics` is linked from the Forever hub and the Leveling/Analytics tabs.
`GET /api/forever/analytics` returns aggregates for the same visible, tracked EU
population as the leaderboard, with observed levels 1–60. Pending, paused, rejected,
unfetched and US characters are excluded. Independently confirmed characters retain
the existing exception to guild hiding. No retail collections are involved.

The page includes all sixty level bins, class and race counts/shares, a race × class
heatmap, and the five most common/rarest **observed** known combinations. Both Skyborne
variants are grouped consistently with the board. Unknown race/class values remain
explicit categories; zero heatmap cells mean no tracked characters, not a claim that
the game disallows that combination. Bar axes start at zero and heat intensity is
linear against the largest cell. Exact counts are visible without hover.

Activity is a rolling 24-hour count of distinct characters with at least one observed
level increase. The first observation, repeated/lower levels, malformed and future
observations do not count. Multiple gains per character merge into a single active
interval. A gain at exactly `sample time - 24h` has expired. Recently capped characters
are active for 24 hours after the observed gain to 60, then leave the active count.
The timeline samples every six hours for up to thirty days, plus the current endpoint;
the UI offers 7/30-day views and shows the number of cohort members observed by each
sample. There is no invented history before the first observation. The first day's
incomplete coverage is labeled, and charts have expandable numeric data tables.

History is retrospective for the **currently tracked cohort**, not a historical
snapshot of all users or proof of logins/churn. Moderation/removal changes that cohort.
First discovery is not a level gain; first sightings therefore do not create fake
activity spikes. Armory delays can shift when gains become observable. Dates use
Finnish formatting in Europe/Helsinki in both languages.

The API reads only the fields needed for aggregation and caches the result in-process
for 60 seconds, coalescing concurrent reads. Guild visibility is checked before cache
reuse; a changed visibility predicate triggers a new aggregate immediately. Other
updates appear within the cache interval. No history arrays or character identities
are returned to the browser. The sweep over merged gain intervals avoids scanning
every character for every timeline point. Tests:

```powershell
node --test -r ts-node/register test/forever-analytics.test.ts
node --test -r ts-node/register integration/forever-analytics.test.ts
```

The integration test uses the same disposable replica-set environment variable as
the other Forever tests below.

The first version is an unlisted community leaderboard at `/forever/leveling`,
with a small `/forever` hub and readable `/forever/characters/firstname-surname`
links for EU profiles. Existing ID links still load and switch to the name URL. These routes
are excluded from navigation and the sitemap and marked `noindex, nofollow`.
Administration lives at `/admin?tab=forever`.

The admin panel has separate character and guild workspaces. Character search
matches name, guild or Twitch channel across all pages; status and fetch-health
filters can be combined. Page selection supports tracking, pausing, rejecting
pending suggestions and retrying up to 50 characters. Actions report updated
and skipped counts. Guild inspection shows roster membership/tracking states,
attempts, errors and retry times beside the guild list. No guild is approved
merely by inspecting it.

Admin retries can bring forward an individual character or guild's failed
retry, after five minutes since its last attempt. Paused entries are excluded,
and the shared worker's rate-limit/Retry-After deadline is never shortened.
Public-user refresh limits and retry protection remain unchanged.

## Adding characters

An admin pastes a Blizzard Forever character URL to start tracking. Signed-in
Discord users can submit proposals (five per account per UTC hour); proposals
are private and do not trigger upstream requests until approved. Duplicate
proposals preserve the existing decision. Users can request refreshes of tracked
characters (ten per hour). Requests never bypass upstream retry deadlines or
the five-minute minimum since the last attempt. No IP address or device
fingerprint is collected for this feature.

A successful character fetch discovers its guild. The worker fetches a preview
roster once, but **does not track its members until an admin approves the guild**.
Approval imports the current roster and checks for new members every fifteen minutes.
Explicitly paused/rejected characters remain excluded. Pausing guild imports
does not pause members already being tracked; pause those individually if needed.
Leaving a guild does not automatically end character tracking. Newly discovered
guilds always need their own approval, so discovery cannot recursively approve
an entire network of guilds.

Hiding a guild only hides guild-dependent imports. Seeded characters, direct admin
additions and individually approved characters remain visible and continue polling
even in hidden/rejected guilds. Their own explicit pause/rejection still wins.
`independentlyTracked` records this confirmation without losing the original
`source`. Adding/approving an existing guild import also sets that flag. Seed reruns
and initialization confirm already-stored seed identities without changing status,
channels or history. Legacy tracked proposals are treated as individually approved;
new proposals promoted automatically through guild approval explicitly remain
guild-dependent.

## Source research and limitations

Verified on 2026-11-05 with read-only requests to the user-supplied
[Blizzard character page](https://worldofwarcraft.blizzard.com/en-gb/forever/eu/armory/character/paladin-dingdong)
and its linked guild. Neither was seeded into application storage.

The [Battle.net documentation](https://community.developer.battle.net/documentation/world-of-warcraft/profile-apis)
available during research described realm-based profiles and did not establish
a public Forever API contract. The implemented adapter instead uses the
**public Blizzard website**:

- Character pages contain `var characterProfileInitialState = {...}`. Parse the
  JSON assignment without executing JavaScript. Validate the Forever URL, region,
  full-name slug, level, ruleset and source timestamp before storing anything.
- Guild pages use the persisted `GetGuildRoster` query at `/en-gb/graphql`.
  Its hash was read from Blizzard's guild-page JavaScript. The **Forever guild
  page Referer is essential**: omitting it returned retail classes and a level
  cap of 90; supplying it returned Forever's cap of 60 and the sample roster.
  The importer verifies the game constants, guild identity, realmless character
  identities, and entire roster before accepting the response.
- This website contract is undocumented and can change. A changed persisted
  query or page format must be reverified in `forever-armory.ts`; failure leaves
  stored data intact. There is no retail or Classic fallback. Redirects are
  rejected, origins are fixed, requests time out after 20 seconds, and responses
  are capped at 4 MB. There are no Blizzard credentials in this path.

The guild endpoint may return HTTP 200 with a GraphQL `INTERNAL_SERVER_ERROR`
instead of a roster (observed for Fel on 2026-11-05). This is reported as a
Blizzard upstream error, not an empty roster or a parser failure. Existing
rosters remain intact and the normal retry policy applies.

### Roster-first polling (verified 8 November 2026)

Read-only production checks found 3,144 visible tracked characters and 79 approved
guilds. Median successful character-check age was approximately 76 minutes (90th
percentile 137 minutes), despite two-minute eligibility. The individual queue was
saturated, with 2,758 characters due at the time of inspection.

The current public website contracts provide:

| Data | Guild `GetGuildRoster` | Character page |
| --- | --- | --- |
| Full name, level, race, class, faction | Yes, per member | Yes |
| Guild membership | Membership in the returned roster, plus guild rank | Current guild identity or no guild |
| Ruleset, portrait | No | Yes |
| Upstream character save timestamp | No | Yes |
| Outdated flag | Yes | Yes |
| Other data | Gender, average item level, achievement points, nullable spec/PvP fields | Gear, stats, professions, specs, media and PvP data (not stored here) |

The site's persisted query has only guild identity and two display-flag variables.
Its `roster` field has no pagination arguments or page metadata: it returns one
array (observed 134, 60 and 127 members in three guilds). The adapter validates the
entire response and retains its 2,000-member/4 MB safety bounds; it never accepts
GraphQL partial errors as a partial or empty roster.

These sources do **not** update together. At the same check, Hávi Hávi was level 51
in its roster but 47 on its profile; Herkku Reidet was 47 versus 36. Those profiles
carried older save timestamps. Three other sampled profiles agreed with their
rosters. This establishes that profiles can lag, not a guaranteed refresh cadence.

- Approved visible rosters now supply bulk level/race/class/faction updates and
  observed level history. Only increasing levels append history; repeated or lower
  levels never reset first-to-level ordering. Outdated members and conflicting
  guild memberships go to individual verification. Paused/rejected characters
  never resume automatically. Unapproved rosters remain previews only.
- Each guild has a stable hash-selected slot in a 15-minute period. Due rosters
  precede the individual backlog, but at most three roster turns run before an
  eligible individual turn. Admin instant refresh still goes first. Global
  request spacing, leases and Retry-After protection are unchanged.
- New members still fetch their profile for ruleset/portrait. For hydrated members
  with healthy roster coverage, individual audits run every six hours. Each roster
  also queues one rotating member with the oldest profile check as a freshness
  probe. Those probes overlap with audits rather than forming a second queue.
- Characters outside healthy approved roster coverage keep the individual
  schedule. A roster omission ends that member's coverage and queues verification;
  it does not delete the character, clear its guild speculatively or erase history.
  Profile-confirmed new guilds enter review as before.
- Coverage expires after 45 minutes without a usable roster observation. Failed
  rosters preserve prior data; expired coverage returns to individual polling.
  Hiding/pausing/rejecting a guild releases coverage immediately. None of these
  operations shortens an individual failure's retry deadline.
- A roster below an already-observed level, or a sampled profile level saved before
  a roster check but missing from that roster, triggers individual polling for that
  guild for an hour. Roster checks continue and can still contribute higher levels.
  A profile saved *after* the roster can legitimately be ahead and does not establish
  lag. No endpoint is assumed universally fresher than the other.
- Rosters have no source timestamp, so roster history stores `observedAt` and
  `source: roster`, never an invented `sourceUpdatedAt`. The profile's own level
  and timestamp remain separate. An older/lower profile can refresh metadata
  without undoing a newer roster level; regressions against its own previous
  profile snapshot are still rejected.

`profileFetchedAt`/`profileLevel` identify the last successful individual snapshot.
`rosterObservedAt`/`rosterLevel`/`rosterGuildSlug` identify the usable roster observation,
and `rosterCoverageUntil` bounds its scheduling authority. `lastFetchedAt` is the
latest accepted observation from either endpoint; `lastAttemptAt`, errors and
retry counters continue to describe individual profile requests. Guild admin API
responses include `profileComparisons`, `profileAheadCount`, `rosterAheadCount`,
`lastComparedAt`, `rosterLaggingMembers` and `individualUntil` for operational review.
These are observations, not claims about exact level-up times or upstream cache TTLs.

Initialization spreads legacy successful guild schedules across the next 15 minutes
once (`rosterPollingVersion: 1`), without bypassing failed retry deadlines. Stored
profile-only characters are upgraded lazily on their first roster check. No retail
collection is read or written.

The first version supports EU and US links. Identity is region plus full-name
slug, matching the verified Armory URL; ruleset is fetched, not inferred from
retail realms. Renames are not automatically linked. Profiles retain basic
identity, guild, level, a Blizzard portrait, source/check times, and a level history; gear and talents
are outside this first version.

The public UI follows the Forever Armory's dark earthy surfaces, gold accents,
and class-colored names. The EU-only leaderboard spans the content width, with a
compact suggestion form in its header row. Race, class, guild, faction, ruleset,
level and update time have separate columns; Twitch is the optional last column.
Guild, race, class, faction and ruleset filters apply before pagination. Their options
come from all published EU characters. On mobile the table scrolls horizontally
with character identity pinned. Dates use Finnish numeric formatting and
Europe/Helsinki time in both languages, including daylight saving time. The
leaderboard's Updated column uses minutes/hours/days ago, updating every 30
seconds, with the exact Finnish-formatted timestamp in its hover tooltip.
Both Windshaper Skyborne and High Order Skyborne display as Skyborne and share
one race filter; their original Armory race remains in storage.

Selecting a character expands its row on desktop without navigating away.
Below 1100px it opens an accessible dialog with Escape/outside-click dismissal
and focus restoration. History is fetched only when details open. The chart
plots observed levels on a proportional time axis with a fixed 1–60 level scale;
steps show the last observed level between observations, not exact level-up
times. Dots, a keyboard-operable observation selector and a dated data table
expose the same observations. Single-point and not-yet-observed histories have
explicit states. Summary gains start at the first observation; no XP percentage,
estimated completion time or missing intermediate levels are invented.
Direct name links reuse these details and place a clear return link above the
character header. Names resolve to tracked EU characters only; legacy ID lookups
continue to support existing non-EU identities.

Portrait URLs are restricted to the matching Forever region on Blizzard's render
host. Existing characters gain portraits on their next normal refresh; until then,
or if an image fails, the UI shows a bundled class icon. The same compact visual
system is used on character profiles and the hub.

The leaderboard orders by latest observed level, then the earliest observation of
that level, then stable record ID. Ranks are unique and calculated globally before
filtering/pagination. A roster observes several members at the same time; it cannot
establish their actual in-game level-up order. It is not a verified race finish
order. History records only observed levels, from first tracking onward, with
observation and upstream update times. It does not invent intermediate levels
or claim exact level-up times. Lower levels and older upstream snapshots are
rejected rather than overwriting progress.

## Storage and worker

All feature data is in `forever_characters`, `forever_guilds`, `forever_worker`,
and `forever_request_limits`. No retail model, raid, character identity, or CCG
collection is used. Only the existing Discord session/admin checks and MongoDB
connection are shared. The request-limit collection has a TTL index. Proposals
retain the submitter's internal user ID for administration, never in public
responses. Startup performs the bounded additive initialization described above;
no separate migration command or production dependency is required.

The existing `WORKER_MODE=worker` or `both` process always starts this worker;
there is no Forever enable flag. Both API and worker
processes initialize the collections and unique indexes on startup. MongoDB must
be a replica set, as already required by the application.

The durable due times survive restarts. A global 90-second lease serializes all
Forever requests across workers; transaction writes fence against the current
lease token. Expired leases recover after crashes. Shutdown waits for the active
fetch. Request starts are at least 500 milliseconds apart, including across
processes, with one request in flight (up to two requests/second). The queue starts
immediately, continues as soon as that spacing permits, and checks for new work
every five seconds when idle. Due rosters get bounded priority over individual
checks as described above.

- Individual polling without healthy roster coverage: active leveling every two
  minutes, no observed level change for 24 hours hourly, level 60 every six hours.
- Hydrated members covered by healthy rosters: six-hour profile audits plus rotating probes.
- Approved guild rosters: stable fifteen-minute slots; unapproved successful previews wait
  for an admin refresh or approval.
- Failures: exponential backoff with jitter; 404 starts at 15 minutes, other
  failures at two minutes, increasing to approximately one day. Retry-After
  (seconds or HTTP date) is honored, capped at seven days.
- Ordinary failures back off only the affected character or guild; other due
  jobs continue at normal spacing. Ten distinct failed jobs without a healthy
  response within five minutes pause the shared queue for two minutes. This
  outage evidence is persisted across worker restarts. A successful response,
  404, stale snapshot or identity mismatch clears it; those profile-specific
  issues do not establish an outage. The evidence resets after an outage pause.
- HTTP 429, 401/403 and explicit Retry-After responses pause the shared queue
  immediately for at least two minutes, respecting longer Retry-After values.
  No failure deletes data or abandons a job.

These are eligibility intervals, not freshness promises. Response times, queue
size, and upstream backoff determine actual freshness. The public
pages show actual check times and worker activity; admin views show error codes.

Blizzard publishes a [36,000 calls/hour developer API limit](https://www.blizzard.com/en-us/legal/a2989b50-5f16-43b1-abec-2ae17cc09dd6/blizzard-developer-api-terms-of-use).
That does not establish a quota for the website Armory endpoints used here. The
two-per-second budget is our own pacing policy; 429 and Retry-After still override it.

## Twitch links and launch seeds

Characters can have an optional Twitch channel, managed in the Forever admin tab
when adding a character or through its **Edit Twitch channel** control. Clearing
the field removes the association. Public suggestions cannot change channels.
The leaderboard and profile link to Twitch; a recent positive observation adds
a LIVE badge. This means the channel is broadcasting, not necessarily playing
that specific character. Unknown, offline, or stale statuses retain a plain link.

The separate Forever Twitch worker uses the existing Twitch app credentials and
stores observations only in `forever_characters`, with its lease in
`forever_worker`. It checks up to 20 due characters per request, spaces batches
15 seconds apart, and makes channels eligible again after two minutes. Requests
time out after 20 seconds. Failures pause checks for two minutes and preserve
previous observations; LIVE expires after five minutes. The Twitch worker also
starts automatically. No Twitch credentials means plain channel links.
The batch size fits the [Twitch Streams endpoint's default page size](https://dev.twitch.tv/docs/api/reference/#get-streams).

`backend/src/features/forever/forever-seeds.json` contains 100 unique EU characters:
51 friends and 50 streamer characters, with Wiba Wiba merged. The friend list is
the union of all supplied snapshots; no earlier entries are removed.
The latest snapshot adds Galardodric Felrain, Jannun Mutsi, Jonio Pyhäshokki,
Kick Kare, Morini Ikuisesti, Nasty Sock, Peikonkorvat Nokkavuotaa, Roo Perro,
Thaekor Stormcaller, Wi Bank and Zen Illusion. Bomb Kerava is also included from the subsequent snapshot. Earlier names remain tracked.
Elyriannà, Eppugrip, Flînk, Np and Perähudlari remain excluded because their surnames are missing.
Katti Mau and Zeta Cygni remain despite being absent from the later snapshot. It incorporates the
user-confirmed Kiuza Tiäksää and Zaikow Reborn spellings. The resolved Edd Shanks, Oma Quu, Flexi Pala and Bull Meato identities are now included.
Haiga Prongs remains a tentative spelling (Armory returned HTTP 500 during verification).
Warlockdrake is excluded as Retail; Tools Maldik remains unconfirmed. Names from the 2026-11-05 stream captures
are not Armory-verified; the normal queue validates them before public listing.
Tashi Washi (sekasingaming), Lancer Deadheart (rpsjesse) and Vaarattu Tv (vaarattu)
are included. Pujo and taxfree_ lack readable full names; Loremaani was playing
Retail, so these three associations remain excluded.
EU is the initial region assumption for this Finnish community list.

From `backend`, after `npm run build`:

```powershell
npm run seed:forever
npm run seed:forever -- --apply
```

The first command previews without connecting to a database. `--apply` uses the
configured `MONGODB_URI`, inserts missing characters as tracked, and leaves all
existing records untouched, including status, history and Twitch edits. If a
character already exists without a channel, add its channel through admin.
Seeding never approves guilds and does not run automatically on startup.

## Verification

From `backend`, run:

```powershell
npm run build
node --test -r ts-node/register test/forever.test.ts test/forever-auth.test.ts test/forever-twitch.test.ts test/twitch.service.test.ts
$env:FOREVER_TEST_MONGODB_URI='mongodb://127.0.0.1:27028/?directConnection=true'
node --test -r ts-node/register integration/forever.test.ts
node --test -r ts-node/register integration/forever-roster.test.ts
```

The integration suite needs a disposable MongoDB replica set. It creates and
drops only its own randomly named `forever_test_*` database. It covers approval
gates, duplicate submissions, retries, retained history, concurrent workers,
in-flight admin pauses, rate limits, and collection isolation. Frontend checks:
`npx tsc --noEmit`, ESLint on the Forever pages, components, and API client,
and `node --test test/forever-stream.test.mjs` for live badge expiry.

After deployment, run the additive seed command explicitly to import new seed
characters. Additional characters and guild approvals are managed in Forever admin.

Admin **Refresh now** starts a fetch immediately when the shared Armory lease is free.
Otherwise its durable priority request runs before ordinary characters and guilds.
It bypasses per-character cooldowns, retains global Blizzard cooldowns, and consumes
the priority after one attempt (including an upstream error). Public refreshes and
bulk queue retries keep their existing limits.

## Leaderboard population statistics

The full-width header places compact faction and ruleset pie charts between the
leveling title and the labeled character suggestion form. An adjacent count table
shows faction-by-ruleset combinations and collapses into an expandable row on
phones to keep the header short. Average observed level and characters at
level 60 remain in the summary footer. Queue size and automatic-update status
are omitted from the public header; worker status remains in admin. Aggregation uses the same
EU/tracked/fetched population and every active table filter, before pagination.
Missing faction or ruleset values remain an explicit unknown group; unfetched,
paused, rejected, pending-approval and US characters do not enter the denominator.
An empty selection returns no average, rather than a misleading level zero.
