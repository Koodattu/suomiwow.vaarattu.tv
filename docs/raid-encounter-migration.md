# Main encounters and lairs

WCL zone 53 remains one source zone. `backend/src/config/raid-encounters.ts`
defines the eight progression encounters in order, Ula'tek as the final boss,
and Nymrissa/Kith'ix as lairs. A separate `characterScoring` list preserves the
original nine-boss character scoring pool: main eight plus Nymrissa, excluding
Kith'ix. Other raids retain their existing order and scoring membership.
New encounters in a configured zone require an explicit membership decision.

`Guild.progress` contains only main encounters. `Guild.lairProgress` holds each
lair and difficulty under the same source raid ID. Raw raid metadata, reports,
fights and per-boss character rankings keep their original source identities.
Guild progression scores, completion, raid time, guild ordering and Pick'ems
exclude lairs. Character scores include Nymrissa. A whole-zone WCL world rank
cannot break ties for the main raid; its
Raider.IO main-raid rank can. Existing raw WCL ranks remain stored.

This is an additive field plus a data rebuild, not a new raid-ID migration.
Predictions and published cards are not rewritten. The active regular Pick'em
uses the rebuilt standings through its existing scoring and family-consolidation
rules. Historical finalized results remain intact.

## Effects on scores and views

- Main guild standings, completion, race, comparisons and Pick'em inputs use
  eight bosses. Correcting Nymrissa can change existing scores or positions;
  adding Kith'ix cannot contribute to them.
- Character AllStars and overall mechanics/combined scores use the main eight
  plus Nymrissa. Survival, coverage and role/spec selection use this same pool.
  Raw WCL parse values are retained. Individual-boss leaderboards can still show
  either lair; lair mechanics require sufficient fetched fight-detail coverage.
- Automatic character tiers inherit the corrected overall mechanics scores.
  Guild speed/efficiency tiers inherit main progress, ranks, pulls and time; the
  overall guild tier list consequently reflects the corrected raid contribution.
  Existing scoring formulas and manually arranged tier lists are not rewritten.
- Raid analytics show the eight main bosses. Character profile and aggregate
  leaderboard columns show nine scoring bosses. Guild details show lairs
  separately. There is no separate lair analytics page.
- CCG publication candidates read character tiers and rebuilt participation.
  Fresh candidates therefore use the nine-boss performance, mechanics and combined
  scores. Nymrissa reports and pulls still count toward eligibility; Kith'ix-only
  reports do not qualify as raid participation. For mixed
  reports, characters with fight IDs must appear on a retained scoring fight;
  appearances without fight IDs retain the existing report-level fallback.
- Existing CCG cards retain their saved stats and grade. Pack opening uses
  published cards, not live character scores. New candidates can change grades
  or eligibility, but numeric score changes alone do not trigger publication:
  existing grade, identity, score-version and first M+ score rules still apply.
  This change does not bump the mechanics score version or force a card wave.
  M+ scores, pack odds, ownership and community/supporter card scoring are unchanged.

Before resuming CCG publication after the rebuild, capture and review a fresh
candidate snapshot for this raid using the existing CCG workflow. Do not publish
an older pending candidate snapshot: the migration intentionally does not alter
CCG candidates or cards. Publishing any new wave remains a separate action.

## Local rehearsal

Use an explicit disposable `MONGODB_URI`; the migration never loads `.env` files.
Do not start the application or worker against a production clone. It contains
real job state and credentials. The migration calls only the named rebuilds and
suppresses events, schedule changes and VOD jobs.

Bound the test container **before** starting MongoDB:

```sh
docker run -d --name suomiwow-raid-scope-test --memory 3g --memory-swap 3g --cpus 2 \
  -p 127.0.0.1:27028:27017 mongo:7 \
  --replSet rs0 --bind_ip_all --wiredTigerCacheSizeGB 1
```

Restore with one parallel collection and one insertion worker. A full recovery
rehearsal uses `--oplogReplay`; a collection-filtered restore tests application
behavior only and is not a point-in-time recovery test. Run heavy checks
sequentially. Inspect `docker stats` and MongoDB's cache limit before proceeding.
Never change unrelated local containers or Docker's global settings.

Build the backend, then capture public provider data and run a preview:

```sh
node --max-old-space-size=1536 dist/scripts/migrate-raid-encounters.js --capture-rio=/safe/path/rio.json
node --max-old-space-size=1536 dist/scripts/migrate-raid-encounters.js \
  --rio-snapshot=/safe/path/rio.json --report=/safe/path/preview.json
```

The script needs the existing service constructor environment variables
(`RAIDER_IO_API_KEY`, `BLIZZARD_CLIENT_ID`, `BLIZZARD_CLIENT_SECRET`). On the
isolated clone, use dummy values: these services must not call authenticated
providers. RIO capture uses the public guild-profile endpoint. No production
credentials need to be copied out of the backup or server environment.

Review every guild's before/after count and rank, plus the before/after Pick'em
rankings. A missing RIO profile with an ambiguous old combined total stops the
script rather than guessing. `missingReports` identifies existing reports with
lair encounters that were never imported; those need targeted source recovery,
not fabricated kill records. Capture them with `--capture-wcl=/safe/path/wcl.json`
using the existing server-side WCL client environment. Export only the resulting
report/fight snapshot for the local rehearsal, never credentials. The migration
validates report identity, encounter, difficulty and fight IDs before inserting
missing rows. Existing fight rows are not overwritten. Use the same provider
snapshots when applying:

```sh
node --max-old-space-size=1536 dist/scripts/migrate-raid-encounters.js \
  --rio-snapshot=/safe/path/rio.json --report=/safe/path/applied.json \
  --wcl-snapshot=/safe/path/wcl.json \
  --apply --writers-stopped
```

Apply rebuilds guild progress/ranks, participation, character leaderboards,
mechanics, character tiers, raid analytics and guild tiers. Existing raw fight
rows, identity repair and card publishing are not part of this migration. A failed rebuild leaves the
operation incomplete: keep writers stopped, fix the cause and rerun, or restore
the backup. Do not restart production merely because guild counts were updated.

Verify the second dry-run has the same ranks and counts, main totals are eight,
both lairs are separate, and changing only lair results cannot change main
standings or Pick'em inputs. The report records both encounter lists. Verify
Nymrissa contributes to character scores/eligibility exactly once, and Kith'ix
contributes to neither. Apply checks aggregate boss-score membership after the
rebuild. Remove the named test container with its test
volumes and delete only the verified local temporary backup directory when done.

## Production maintenance (not performed by local implementation)

1. Review the local rehearsal and resolve recovery gaps. Check disk space for a
   separate compressed backup plus build headroom. The inspected VM had only
   about 3.7 GB free; recheck and resolve space before maintenance.
2. Acquire `/tmp/wow-guild-deploy.lock` in a maintenance shell **before making the
   new revision available to autodeploy**. Hold it through backup, migration and
   verification. The normal deploy cron can otherwise deploy main within a
   minute. Record the old revision/images for rollback.
3. Stop backend, backend-worker, frontend and nginx. Keep MongoDB running.
4. Make a new uniquely named archive under `/root/wow-migration-backups`, outside
   the daily five-backup retention. With writers stopped, use
   `docker exec wow-prog-db mongodump --archive --gzip --oplog`, redirect to a
   `.partial` file, check success and `gzip -t`, then rename to its final name.
   Do **not** call `backup-db.sh` while holding its lock: it acquires that lock
   itself and also applies daily retention.
5. Build the approved revision without starting its services. Run the migration
   as a one-off backend container with the production environment and mounted
   snapshot/report directory. Capture fresh RIO data, preview, inspect, apply.
6. Start the API and frontend for smoke tests while the worker remains stopped.
   Check 8/8 counts, Ula'tek race, main guild order, both lairs, Pick'em rankings,
   character aggregates and logs. Complete the CCG candidate snapshot review
   described above before resuming scheduled publication. Then start the worker and watch one normal
   update cycle; it must retain the separation.
7. Release the maintenance lock only after the running revision and database
   agree. Keep the independent backup until the release is accepted. If rollback
   is required, stop writers and restore both the recorded code version and its
   complete backup; old code alone would reintroduce the combined totals.


## Initial local verification — 21 October 2026

This rehearsal preceded the decision to retain Nymrissa in character scoring.
Its guild/Pick'em results remain relevant; its eight-boss character results below
do not validate the revised nine-boss scoring policy. No production clone was
restored again for the follow-up change.

The resource-limited rehearsal restored 4,196,538 selected application documents
with zero restore failures, plus the original Pick'em/user collections in a
separate comparison database. Only predictions and anonymized display identities
were copied into the application test database. This was a collection-scoped
application rehearsal, not a full oplog recovery certification.

- The migration recovered 251 missing Kith'ix fights from 50 stored reports using
  captured WCL evidence. Inserting them did not change main Pick'em inputs.
- All main progress totals are eight; no Nymrissa/Kith'ix records appear in main
  guild progress, AllStars boss totals or overall mechanics scores.
- A separate injection test added a Kith'ix kill and verified identical main
  counts, boss results and all raid-time totals.
- A repeated preview produced identical guild counts/ranks and Pick'em rankings,
  with no remaining supported lair encounters to recover.
- All four Pick'em definitions and all 367 submissions from 174 prediction owners
  matched the original backup. Scores for all 132 active-Pick'em participants
  were unchanged in this snapshot. The top ten remained unchanged; seven lower
  guild positions changed after the Nymrissa correction and refreshed RIO data.
- Main mechanics rebuilt from 12,081 of 12,133 eligible fights (99.57% coverage).
  Missing lair fight details are not treated as ready mechanics scores.
- The main API returned eight-boss progress and the detail API returned both
  lairs separately. No background workers were started against the clone.

MongoDB used a 1 GB cache inside a 3 GB / two-CPU container. Heavy checks were run
sequentially, with a maximum 1.5 GB Node heap for the rebuild. The temporary test
container, volumes and downloaded archive were deleted after verification.
Production raid data was not migrated and no code was pushed or deployed.

Backend compilation, frontend type-checking and the production frontend build passed.
The focused suites passed 79 backend tests and 10 frontend tests, plus the
production-clone isolation test.

## Nine-boss character scoring follow-up

The follow-up keeps the eight-boss guild definition, but restores Nymrissa to
character AllStars, mechanics, automatic character tiers, CCG candidate inputs
and qualifying participation. Existing cards and publication rules are untouched.
The individual boss selector retains both lairs; character aggregate columns use
the API's explicit scoring flag instead of excluding every lair.

Focused regression coverage exercises the mechanics build with Nymrissa and
then adds Kith'ix parses/pulls, verifies separate per-boss rows without duplicate
Nymrissa entries, checks the AllStars queries for each partition and combined
partitions, and checks the participation pipeline and frontend column selection.
The earlier production-clone character counts and coverage figures must not be
presented as results of this revised rebuild.

Follow-up verification passed backend compilation, frontend type-checking,
82 focused backend tests and 12 frontend tests. These ran sequentially with
Node heap limits of at most 1.5 GB. The updated migration was compiled but not
applied to another production clone or to production.
