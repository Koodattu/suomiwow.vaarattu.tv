# Forever leveling

## Guild directory

The Forever hub and navigation link to `/forever/guilds`. The public directory at
`GET /api/forever/guilds` includes every approved, non-hidden guild, including those
waiting for their first roster. Search, faction/ruleset filters and name/size sorting
run in the browser over the summaries; lists display 50 results per page.
Browsing choices are kept in the URL. Returning from a roster restores the filtered
page and focuses the guild's row. On phones, rows keep member counts visible without
horizontal scrolling. Unfetched roster sizes sort after known sizes in either direction.

`GET /api/forever/guilds/:id` applies the same visibility rules and returns the saved
Armory roster, including untracked members and marked outdated entries. Only publicly
tracked characters receive profile links. Neither endpoint exposes moderation data.
One verified current member can establish the guild's ruleset. Missing or conflicting
evidence leaves it unknown. The directory summary uses a server-prepared shared snapshot;
individual rosters still read the saved data directly. Neither adds external Armory requests.

## Background page caches

Analytics, Namegame and the guild directory warm at server startup, then check every
15 seconds for snapshots at least 30 seconds old, even without visitors.
API processes run the warmer. Each page refreshes
independently, with shared leases preventing duplicate builds across processes. A slow
or failed page refresh does not block the other pages; failures retry on the next tick.

These snapshots have a 60-second lifetime and use the existing isolated
`forever_leaderboard_cache` and `forever_leaderboard_leases` collections, plus an
in-process cache. Refreshing ahead of expiry keeps data ready between visits.
Fresh saved snapshots survive API process replacement. The last fresh result remains
readable during a proactive refresh; a genuinely cold or expired snapshot still waits
for a build. Shutdown stops the schedules and drains active builds.

Each read checks the indexed moderation revision. Admin visibility/status changes and
automatic guild moderation invalidate all three pages across processes immediately.
An older in-flight build cannot publish into the new revision. Normal roster, level and
name-score updates appear through the periodic refresh without requiring a page visit.
Name Game checks a revision written with score batches, roster membership changes and
rated character guild changes. An unchanged revision reuses the ranked population during
proactive refreshes. Hard expiry and a 15-minute reconciliation rebuild it from source.

`node --test -r ts-node/register test/forever-snapshot.test.ts` covers startup and idle
warming for all three pages, shared reuse, concurrency, failures, moderation and shutdown.

## Namegame

The Forever hub and navigation link to `/forever/namegame`. Its overview shows the top five overall and
in each humor category, with a **View all** link to an expanded searchable, sortable leaderboard.
`GET /api/forever/namegame/overview` returns all nine previews and their counts from the same snapshot.
The overall expanded view uses `?view=all`; category views use `?category=wordplay`, for example.
The public API at `GET /api/forever/namegame`
accepts `category`, literal case-insensitive `search`, `sort` (`score-desc`, `score-asc`, or `name`),
and a one-based `page`. Each page contains up to 48 names. The default order is overall score,
then name and character ID for stable ties. Ranks are scoped to the selected leaderboard and stay fixed
while searching or changing the sort order.
The screen keeps criteria in the URL, retains results during loading, and prefetches the next page.

One projected name population is cached for 60 seconds using the existing Forever shared snapshot/lease
collections and an in-process cache. Concurrent requests share the build; search, sort, counts and pagination
run on that snapshot. Each request checks the indexed moderation revision before using cached data.
Admin moderation invalidates it across processes; background warming refreshes worker roster/score updates.
The browser checks for updates every 30 seconds, with a 15-second query freshness window.

The backend worker automatically scores existing and newly eligible tracked characters when `OPENAI_API_KEY` is configured.
Guild imports must belong to an approved, visible guild's current roster. A profile can establish membership before
the first roster fetch. Independently confirmed characters and legacy admin/seed entries qualify on their own.
Eligibility is checked when building the snapshot, so moderation also applies to previously rated names.

Each Responses API request sends up to 64 names with their own guild context to `gpt-6-luna` at medium reasoning
effort. The rubric and strict output schema live in `forever-namegame-rating.ts`. Every character has its own
required output slot and gets one overall 0–100 score and a primary humor category. Existing scores survive
guild moves, pauses, worker restarts and rubric edits.

The worker claims character IDs and records the batch in MongoDB in one transaction. It saves the OpenAI background
response ID, polls that generation, then commits the scores and removes the job together. An explicit submission
rejection backs off and retries. An ambiguous submission, invalid result or expired response keeps its claims to
prevent duplicate scoring. Inspect `forever_namegame_batches` and the worker logs for these exceptions. If a submission
lost its acknowledgement, match the batch ID to `namegame_batch` in OpenAI request metadata, record the original
`responseId` on the batch and clear its `error` to resume polling. A process interruption before acknowledgement
can leave the same case with neither field set.

## Character profiles, records and raids

Character pages show gear, talents, professions, records, boss kills and achievements. Guild pages add
level 60 counts, class mix, average item level and raid progress. `/forever/records` ranks characters,
and `/forever/raids` shows raid progress and recent group kills. Verified 28 November 2026.

**Gear, talents and professions** come from the Armory page the worker already fetches
(`characterProfileInitialState`), so they cost no extra requests. Each item carries its name, quality, icon,
stats, equip effects, set name and required level, which is enough for tooltips. Every talent tree is
marked `active` on Forever, so pages show points per tree instead of an active spec. The page also links a
full-body character render on Blizzard's CDN. Sections are stored in `forever_character_details`, beside the
character, so leaderboard scans stay small. Only `render.worldofwarcraft.com` image URLs are kept.

**Statistics and achievements** come from the official profile API (`profile-forever-eu`):
`/achievements/statistics` and `/achievements`. The Blizzard worker (`forever-blizzard.worker.ts`, lease
`blizzard`) checks tracked EU characters from level 40. Level 60s are checked every 12 hours, others every
72 hours, each with a stable per-character phase of up to an hour. Each four-second turn checks one character,
then resolves up to two queued items, at most about 5,400 requests an hour against Blizzard's 36,000. Characters
go first so a backlog of new items never delays raid kill tracking. Item lookups are one-off. A user's **Request refresh** also brings
this check forward, at most once per half hour per character. A 404 waits a day. Rate limits and authorization
errors pause the worker. Forever achievements award no points, so records count completed achievements.

**Boss kill times** are exact. Each boss statistic holds a kill count and the second of the latest kill.
When the worker first sees a count of one, that is the first kill. Any later change of time is another kill.
Raid lockouts allow one kill per boss per reset, so 12-hour checks see every raid kill. Kills before tracking
show as "Before tracking". Up to 30 kill times per boss are kept, with the character's guild at the time.
Statistics with no kills are omitted by Blizzard, so new raids appear automatically on their first kill.

**Group kills** are tracked players' kills of the same boss dated within two minutes of each other. Guild
members who kill a boss together share the same second. A group kill is credited to a guild when at least
three of its tracked members, and half the tracked group, were there. Dungeon groups need three tracked
players.

**Raids** are listed in `forever-raid-catalog.ts`, from Blizzard's static achievement data. Barrow Deeps
(10 players, 8 bosses), Hyjal Summit (20 players, 13 bosses) and Onyxia's Lair (40 players) open on 9 December
2026, per community guides. Each raid's "Conqueror" achievement names one criterion per encounter. The
catalog keeps Blizzard's listing order, which is not a guaranteed kill order. Hyjal Summit's route can vary.
Both achievement versions per raid map to the same bosses. Vanilla raids appear only once someone has a kill.
An instance outside the catalog counts as a raid once a tracked group larger than five kills there.

**Raid kills** use the best evidence available. A boss kill statistic gives exact times, grouped as above.
When a boss has no statistic, each character's raid achievement still lists the encounters they have
completed, without times. Each criterion is stored with the check that first showed it (`seenAt`) and the
previous check (`after`). A guild is then credited once three tracked members show the boss, dated to the
check that showed the third, and the page marks it "≈". Exact credit replaces approximate credit. A "Conqueror"
achievement's completion time dates the full clear exactly; for Onyxia it is the kill itself. Achievement
evidence uses each player's current guild. Each boss shows the first Finnish guild to kill it. Guilds rank by
bosses killed, then by full clear, then by when they reached that count.

**Item level** is not in Forever's Armory data or its profile API. Each new item ID is queued in
`forever_items` and looked up once in `static-forever-eu`, then `static-classic1x-eu`. A fallback result is
accepted only when its name matches the item Forever shows. Resolved levels are permanent. Missing items are
retried weekly. Blizzard withholds many new Forever items from its catalogs, though it still serves their
icons. The average uses the 17 equipment slots: empty slots count as zero and a two-hander counts twice.
Unknown items are left out of the average. Level 60 characters with at most two unknown items are ranked,
and each row shows its unknown count.

Raid and record pages use the shared page snapshots (`forever:raids:v2`, `forever:records:v1`) and are
warmed with the other Forever pages. Their source data changes with twice-daily profile checks, so they have a
five-minute lifetime and refresh ahead after half of it, instead of the other pages' 60 seconds. Each records
board is sorted once per snapshot. Guild detail pages read the same snapshots. Guild pages also accept an
EU guild slug in place of the ID, which character profiles use for their guild link.

## Guild language estimates

In **Admin → Forever → Discovered guilds**, choose **Assess Finnish language for all guilds**.
The worker evaluates every saved Forever guild across regions and moderation states, including guilds outside the current filters.
The button queues work in MongoDB and the run continues after the panel closes. Both the API and worker use the backend `OPENAI_API_KEY`.

The guild inspector shows two GPT-6 Luna estimates of the likelihood that Finnish is the guild's main shared language.
Strict structured output uses low reasoning effort. Decisions returns a boolean choice and a probability for each option.
The percentage always refers to **Yes**. The confidence label describes the chosen answer using the API's separate confidence value
(low below 65%, medium from 65% to below 85%, high from 85%). These are model estimates from names alone.

Each method receives the guild name and every name in its saved roster. Until a roster is available, the worker uses all linked
character names in the same region, or just the guild name if none are known. The inspector records the source, number of names
and assessment time. Running again reuses completed scores for identical names and rubric, retries missing methods, and
reassesses changed inputs. Scores are available only through the Forever admin API.

Automatic moderation requires a successfully fetched, non-empty roster. Profile-only estimates and empty rosters remain
informational, even when both scores cross a threshold; the first fetched roster triggers another assessment.
Unreviewed, visible proposed/pending guilds are automatically approved when both percentages are strictly above 85%.
This queues a fresh roster and tracks current and future members through the normal roster worker, respecting fetch backoffs.
When both percentages are strictly below 30%, the guild is hidden and rejected, roster coverage is released and the leaderboard
cache is invalidated. Exact boundaries, mixed results and missing scores remain for manual review. Existing completed assessments
are also evaluated automatically without repeating paid calls for unchanged evidence. Missing results retain the hourly retry.
Manual status/visibility changes prevent subsequent automatic moderation, including changes made while scoring is in flight.
Already approved, paused, rejected or hidden guilds are never automatically changed.

Admins can **Reject and hide guild** from any guild state, including approved guilds. This records a manual review,
sets rejected/hidden together, stops roster polling and hides guild-dependent imports while preserving history and
individually confirmed characters. Resuming a rejected hidden guild requires both approval and restoring visibility.

New automatic decisions retain the exact guild/member names, evidence fingerprint, model, rubric version and roster fetch time
alongside their original scores. Later assessments cannot overwrite that snapshot. The admin detail API includes the evidence;
paginated summaries omit the name list. Older decisions retain their original scores without a fabricated evidence snapshot.

The **LLM decision history** status filter combines recorded automatic approvals and rejections;
**Auto approved** and **Auto rejected** narrow it to one outcome. Selecting any history filter defaults to
**LLM decision · newest first**, ordered by the original decision time before pagination. Guild search still applies.
Hidden guilds and guilds later changed manually remain in history. The list shows the automatic action and timestamp
alongside the current status. Each guild retains both percentages used for that action, separately from its latest assessment.
The worker commits moderation, audit evidence and assessment completion in one transaction.

## Leaderboard performance and freshness

The leveling endpoint shares a 30-second ranked snapshot across API processes,
using the same lease-based cache service as M+. Its storage remains isolated in
`forever_leaderboard_cache` and `forever_leaderboard_leases`. Each API process
warms the snapshot every 15 seconds; a shared lease prevents duplicate builds.
Expired snapshots wait for a fresh build rather than serving indefinitely stale data.

A build reads only public character fields, without histories, using MongoDB
snapshot read concern for a consistent population during concurrent worker updates.
Ranks are assigned once by level descending, with the level-60 timing rule below.
Filtering, statistics and pagination operate on that ranked population
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

The page includes faction and ruleset pies with a faction × ruleset table, all sixty
level bins, class and race counts/shares, and a centered race × class heatmap.
Skyborne is split by faction in the race bars and matrix. Unknown race/class values
remain explicit categories; zero heatmap cells are empty and transparent. Nonzero
cells use a teal-to-orange scale from the smallest to the largest observed count,
with white count labels. Bar axes start at zero. The population charts reuse the
Leveling components and this same API response, without an extra request.

The date slider defaults to today and follows live refreshes. Every Helsinki date
from the earliest valid observation is available; completed days use the final
observed level before local midnight, carrying the last known level across gaps.
Characters are absent before their first observation. Characters without valid
history appear only today. Historical views use **current metadata and current
visibility**, not archived race/class/ruleset or moderation states; only levels and
observation times are recorded historically. Days across DST have their actual
23/24/25-hour boundaries. Both sliders sit in a compact strip beneath the level
distribution. The minimum-level slider (1–60 inclusive) filters population charts
and totals, while the level histogram keeps the entire selected day's distribution:
levels below the cutoff are gray, with unchanged heights and full-population tooltip
percentages. The Leveling activity chart uses each character's level on the sampled
day and ends at the selected date. Levels 1–9 and 60 always count toward both the
active and observed totals. At levels 10–59, a first sighting or level gain in the
preceding 24 hours counts as active.

The response includes sparse daily buckets keyed by level and a shared
race/class/faction/ruleset dictionary. Each bucket stores count, active/new counts,
observed gains and history coverage, with no character identities or raw histories.
A single sweep through sorted histories builds every day; the 60-second shared
snapshot and background warmer prepare that work before viewers arrive. Both controls
fold cached buckets locally without requests or database aggregation per slider
movement. The browser checks the dataset at most every 30 seconds and schedules
the next check by its generation time, avoiding an extra minute of client staleness
on top of the API cache. No 60-fold set of
precomputed minimum-level variants or separate historical snapshot collection is needed.
The selected view's activity series uses daily samples; the legacy top-level API
activity remains sampled every six hours. A level cutoff shows the population at
or above a level, not a measured abandonment rate or the reason someone stopped.

The **Active · 24 h** summary and legacy API activity series use a rolling 24-hour count of distinct characters first observed or gaining
at least one level. First observations start an active window without inventing any
level gains. Repeated/lower levels, malformed and future observations do not extend
activity. Multiple overlapping windows per character merge so a character counts
only once. An observation at exactly `sample time - 24h` has expired. Level-one
characters are excluded from this metric. Newly observed level-60 characters and
recently capped characters are active for 24 hours, then leave the active count.
The original API series samples every six hours for up to thirty days, plus the current endpoint;
the interactive UI uses daily samples, offers 7/30-day views and shows the number of cohort members observed by each
sample. There is no invented history before the first observation. The summary also
shows first observations in the last 24 hours (including level one) and the sum of
actual observed level increases in that window. Duplicate or regressed levels never
inflate this sum, and first sightings contribute zero gains.

History is retrospective for the **currently tracked cohort**, not a historical
snapshot of all users or proof of logins/churn. Moderation/removal changes that cohort.
First discovery now contributes to activity, so bulk imports can increase that
metric without proving in-game activity. Armory delays can shift when gains become observable. Dates use
Finnish formatting in Europe/Helsinki in both languages.

The API reads only the fields needed for aggregation and caches the result in the shared
snapshot storage and in-process for 60 seconds, coalescing concurrent reads. The moderation
revision is checked before cache reuse; a changed revision triggers a new aggregate
immediately. Other updates appear through background warming. No history arrays or character identities
are returned to the browser. The sweep over merged gain intervals avoids scanning
every character for every timeline point. Tests:

```powershell
node --test -r ts-node/register test/forever-analytics.test.ts test/forever-analytics-timeline.test.ts
node --test -r ts-node/register integration/forever-analytics.test.ts
```

The integration test uses the same disposable replica-set environment variable as
the other Forever tests below.

Frontend bucket selection and minimum-level filtering:
`cd frontend; node --test test/forever-analytics.test.mjs`.

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

Roster entries provide faction but not ruleset. During an approved roster sync,
one current member's direct profile can supply the faction and ruleset for other
members with a missing ruleset. Any conflicting direct
profile or current roster faction prevents inference. `rulesetInferredFromGuild`
records which guild supplied the ruleset. A departure, outdated entry or loss of
guild consensus preserves the last confirmed faction and ruleset. A subsequent
accepted membership in a confirmed guild can update that pair. An individual
profile reporting a known faction and ruleset takes precedence. Inferred values
never count toward guild confirmation.

For older records whose ruleset was cleared, an approved guild sync restores the
pair when the character has a prior accepted roster observation for that guild,
a compatible faction and no direct profile. The repair preserves the recorded
level history and observation times. The stored guild identifies the last
observed membership. There is no separate record of the first importing guild.

Known levels 1–9 with current roster membership are roster-only; public and admin
profile refreshes remain blocked. A roster observation reaching level 10 queues
the first profile immediately. Unknown-level characters still need an initial lookup.
When roster coverage is absent (departure, guild moderation, expiry, or a guildless
character), a historical low level may no longer be current. `lowLevelRecheck`
enables a slow automatic discovery check, initially spread over 1–2 hours by identity.
Unavailable profiles wait at least six hours before another attempt; longer error
backoff/Retry-After still applies. This lane uses regular character turns, not new
character priority. Fresh roster presence cancels it, including outdated low-level
entries used only as membership hints. A successful level-10+ profile clears the
flag and resumes normal tracking. These deadlines and failures survive restart;
no speculative level changes are stored.

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
- New eligible members still get a prioritized first profile for ruleset/portrait.
  A usable roster grants coverage even before that first profile, so a successful
  fetch can immediately switch to a daily audit. Hydrated members with healthy
  coverage get identity-staggered audits 24–30 hours after their last profile.
  Each roster may queue one oldest-profile freshness probe, only if that profile
  is at least six hours old. Small guilds cannot recheck the same member every
  fifteen minutes. These probes overlap audits rather than forming a second queue.
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
  member only. Healthy guildmates retain roster coverage and daily audits.
  Roster checks continue and restore coverage once they catch up.
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
`lastComparedAt` and `rosterLaggingMembers` for operational review. The former
guild-wide `individualUntil` fallback is no longer used.
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
and class-colored names. The hub searches public characters and guilds by name,
with a suggestion form for missing entries. Its summary uses the existing analytics,
guild and Namegame snapshots. The three latest level-60 milestones require an earlier
observation below 60 and are ordered by the first observation at 60. The subpages share a header with
the brand and title, centered Leveling/Analytics/Namegame/Guilds navigation, and
an inline character/guild suggestion form on desktop. On smaller screens,
navigation occupies its own row and a Suggest button opens the form in a dialog.
Sign-in returns to the current page,
including its filters. The home card links to the Forever hub.
The EU-only leaderboard spans the content width. Race, class, guild, faction, ruleset,
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
plots observed levels on a proportional time axis with a fixed 1–60 level scale.
Chart point tooltips show each observed level and its timestamp.
Single-point and not-yet-observed histories have
explicit states. Summary gains start at the first observation; no XP percentage,
estimated completion time or missing intermediate levels are invented.
Direct name links reuse these details and place a clear return link above the
character header. Names resolve to tracked EU characters only; legacy ID lookups
continue to support existing non-EU identities.

Portrait URLs are restricted to the matching Forever region on Blizzard's render
host. Existing characters gain portraits on their next normal refresh; until then,
or if an image fails, the UI shows a bundled class icon. The same compact visual
system is used on character profiles and the hub.

The leaderboard ranks characters by observed level. Below 60, ties use the first
observation at that level, then stable record ID. At 60, ranking uses the minute
of the estimated finish when available, otherwise the minute first observed at 60.
Ties within a minute use the original first observation at 60, then stable ID.
Ranks are global before filtering and pagination.

The EU Battle.net character achievements endpoint in `profile-forever-eu`
returns a timestamp for the account’s first level 60 in each class. The worker
checks the character slug, class-specific Master achievement ID and completed
criterion. It uses a single consistent timestamp after the last lower-level
observation and no later than the earliest evidence of 60. Dated Armory profiles
can narrow the window or disprove a previously accepted estimate.
The window must be at most 24 hours. Characters first seen at 60, long gaps
and conflicting evidence use the first sighting. Two characters of the same
class on one account could finish within the same window, so the UI labels
the Legacy time as an estimate. The level history keeps its observation times.

An independent leased worker checks one visible, tracked EU level-60 character
every ten seconds using the existing Blizzard app credentials. Newly capped and
previously tracked characters enter the same queue. A missing completion or
404 is checked again after six hours. API failures retain observed ranks and
honor Retry-After. Accepted estimates appear on the next leaderboard snapshot.

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
every five seconds when idle. Each runner checks for expired roster coverage and unscheduled low-level rechecks every 30 seconds. Due rosters get bounded priority over individual
checks as described above.

First-fetch jobs have bounded priority within each job type. Up to three new
character profiles run before a due existing-profile refresh. The first two of
those turns prefer characters still missing a ruleset; the third accepts any new
profile, including members already classified from their guild. New guild rosters
similarly get up to three turns before an existing roster refresh. The existing
three-rosters/one-character fairness rule and admin instant-refresh precedence
still apply. Counters persist across worker restarts and lease handoffs.

New means no successful direct profile (both `profileFetchedAt` and
`sourceUpdatedAt` absent), or no successful roster fetch (`lastFetchedAt` absent).
Roster level updates and inferred rulesets do not remove first-profile priority.
Automatic priority never bypasses retry deadlines, moderation, visibility, or the
level-10 profile threshold. Uncovered low-level discovery is a separate slow lane.
Once a new direct profile establishes a guild's ruleset, its healthy approved roster
is scheduled immediately. The fresh roster applies the ruleset to eligible members. Failed guilds retain
their backoff. No live character or guild is assumed to have a ruleset without
the existing evidence checks.

- Individual polling without healthy roster coverage: active leveling every two
  minutes, no observed level change for 24 hours hourly, level 60 every six hours.
- Hydrated members covered by healthy rosters: 24–30-hour profile audits plus rotating probes no more often than six hours per member.
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
node --test -r ts-node/register test/forever-guild-language.test.ts integration/forever-guild-language.test.ts
node --test -r ts-node/register test/forever-guild-ruleset.test.ts
node --test -r ts-node/register test/forever-details.test.ts
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

Faction and ruleset charts and the faction-by-ruleset table appear on Analytics,
not in the leveling header. The leveling toolbar retains character count,
average observed level, and characters at level 60. Queue size and automatic-update status
are omitted from the public header; worker status remains in admin. Aggregation uses the same
EU/tracked/fetched population and every active table filter, before pagination.
Missing faction or ruleset values remain an explicit unknown group; unfetched,
paused, rejected, pending-approval and US characters do not enter the denominator.
An empty selection returns no average, rather than a misleading level zero.
