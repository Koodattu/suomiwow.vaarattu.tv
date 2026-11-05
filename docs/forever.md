# Forever leveling

The first version is an unlisted community leaderboard at `/forever/leveling`,
with a small `/forever` hub and `/forever/characters/:id` profiles. These routes
are excluded from navigation and the sitemap and marked `noindex, nofollow`.
Administration lives at `/admin?tab=forever`.

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
Approval imports the current roster and checks for new members every six hours.
Explicitly paused/rejected characters remain excluded. Pausing guild imports
does not pause members already being tracked; pause those individually if needed.
Leaving a guild does not automatically end character tracking. Newly discovered
guilds always need their own approval, so discovery cannot recursively approve
an entire network of guilds.

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

The first version supports EU and US links. Identity is region plus full-name
slug, matching the verified Armory URL; ruleset is fetched, not inferred from
retail realms. Renames are not automatically linked. Profiles retain basic
identity, guild, level, a Blizzard portrait, source/check times, and a level history; gear and talents
are outside this first version.

The public UI follows the Forever Armory's dark earthy surfaces, gold accents,
and class-colored names. The EU-only leaderboard spans the content width, with a
compact suggestion form in its header row. Race, class, guild, faction, ruleset,
level and update time have separate columns; Twitch is the optional last column.
Race, class, faction and ruleset filters apply before pagination. Their options
come from all published EU characters. On mobile the table scrolls horizontally
with character identity pinned. Dates use Finnish numeric formatting and
Europe/Helsinki time in both languages, including daylight saving time. The
leaderboard's Updated column uses minutes/hours/days ago, updating every 30
seconds, with the exact Finnish-formatted timestamp in its hover tooltip.
Portrait URLs are restricted to the matching Forever region on Blizzard's render
host. Existing characters gain portraits on their next normal refresh; until then,
or if an image fails, the UI shows a bundled class icon. The same compact visual
system is used on character profiles and the hub.

The leaderboard orders by latest observed level; equal levels are tied, with
names used only for stable display ordering. It is not a verified race finish
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
responses. No data migration or production dependency is required.

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
every five seconds when idle. The oldest eligible character or guild is picked first.

- Active leveling: eligible every two minutes.
- No observed level change for 24 hours: hourly.
- Level 60: every six hours.
- Approved guild rosters: every six hours; unapproved successful previews wait
  for an admin refresh or approval.
- Failures: exponential backoff with jitter; 404 starts at 15 minutes, other
  failures at two minutes, increasing to approximately one day. Retry-After
  (seconds or HTTP date) is honored, capped at seven days.
- Non-404 source failures also pause the shared worker request schedule. A 404
  affects only that job. Neither failure type deletes data or abandons a job.

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

`backend/src/features/forever/forever-seeds.json` contains 71 unique EU characters:
34 friends and 38 streamer characters, with Wiba Wiba merged. The friend list is
the union of both supplied snapshots, including Moist Wanderer and Sysi Simsalabim;
Katti Mau and Zeta Cygni remain despite being absent from the later snapshot. It incorporates the
user-confirmed Kiuza Tiäksää and Zaikow Reborn spellings. The six unresolved names
were excluded at the user's request. Names from the 2026-11-05 stream captures
are not Armory-verified; the normal queue validates them before public listing.
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
```

The integration suite needs a disposable MongoDB replica set. It creates and
drops only its own randomly named `forever_test_*` database. It covers approval
gates, duplicate submissions, retries, retained history, concurrent workers,
in-flight admin pauses, rate limits, and collection isolation. Frontend checks:
`npx tsc --noEmit`, ESLint on the Forever pages, components, and API client,
and `node --test test/forever-stream.test.mjs` for live badge expiry.

No deployment or production seeding is performed by this change. After the normal
deployment, add the intended community characters in the Forever admin tab and
approve the desired guilds there.
