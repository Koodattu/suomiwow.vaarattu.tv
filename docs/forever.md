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
class-colored names and `race class` identity lines. The leaderboard takes the
main column; suggestions sit beside it on desktop and collapse on mobile.
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

The existing `WORKER_MODE=worker` or `both` process starts this worker by default.
`FOREVER_WORKER_ENABLED=false` stops automatic fetching. Both API and worker
processes initialize the collections and unique indexes on startup. MongoDB must
be a replica set, as already required by the application.

The durable due times survive restarts. A global 90-second lease serializes all
Forever requests across workers; transaction writes fence against the current
lease token. Expired leases recover after crashes. Shutdown waits for the active
fetch. Every request is at least 15 seconds apart, including across processes.
The oldest eligible character or guild is picked first.

- Active leveling: eligible every 15 minutes.
- No observed level change for 24 hours: hourly.
- Level 60: every six hours.
- Approved guild rosters: every six hours; unapproved successful previews wait
  for an admin refresh or approval.
- Failures: exponential backoff with jitter; 404 starts at 15 minutes, other
  failures at two minutes, increasing to approximately one day. Retry-After
  (seconds or HTTP date) is honored, capped at seven days.
- Non-404 source failures also pause the shared worker request schedule. A 404
  affects only that job. Neither failure type deletes data or abandons a job.

These are eligibility intervals, not freshness promises. At four requests per
minute, a large approved roster takes time to import and refresh. The public
pages show actual check times and worker activity; admin views show error codes.

## Verification

From `backend`, run:

```powershell
npm run build
node --test -r ts-node/register test/forever.test.ts test/forever-auth.test.ts
$env:FOREVER_TEST_MONGODB_URI='mongodb://127.0.0.1:27028/?directConnection=true'
node --test -r ts-node/register integration/forever.test.ts
```

The integration suite needs a disposable MongoDB replica set. It creates and
drops only its own randomly named `forever_test_*` database. It covers approval
gates, duplicate submissions, retries, retained history, concurrent workers,
in-flight admin pauses, rate limits, and collection isolation. Frontend checks:
`npx tsc --noEmit` and ESLint on the Forever pages, components, and API client.

No deployment or production seeding is performed by this change. After the normal
deployment, add the intended community characters in the Forever admin tab and
approve the desired guilds there.
