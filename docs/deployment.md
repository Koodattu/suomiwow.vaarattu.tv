# Deployment and database backups

## October 2026 Node.js security update

All backend and frontend Docker stages use Node.js `24.22.1`, the patched
24.x release in the [October 21 advisory](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases).
The backend worker reuses the backend image. Both Compose files build these
Dockerfiles; there are no GitHub Actions workflows or separate CI runtime pins.
The root `.nvmrc` and both package engine requirements also specify patched
Node.js 24. Updating npm packages or `@types/node` alone does not patch the runtime.

The npm lockfiles include Next.js `16.4.1`, Sharp `0.35.5`, and patched
`proxy-addr`, `brace-expansion`, and `source-map-js` dependencies. The existing
ESLint configuration is retained to avoid unrelated lint-rule changes.
The remaining npm audit findings come from development-only `braces` consumers;
[the advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) has no patched release.
Do not apply the incompatible downgrades proposed by `npm audit fix --force`.

On October 23, the server's MongoDB image was separately observed to bundle
`mongosh` 2.8.3 with Node.js `24.15.0`. Updating the application images does not
patch that embedded runtime. A MongoDB-provided shell/image containing the October
Node.js fixes remains to be verified and rolled out. No host Node.js executable
was found on the server's SSH PATH.

## Deployment overview

The VM runs the Bash scripts tracked in this repository. Deployment and database
backups are independent. Normal autodeploy never creates a database backup.

## Pickem streak rule transition

On startup, before serving requests, unversioned pickems receive a persisted
`streakConfig.rule`. Finalized competitions keep `relative-order-v1`; competitions
that are not finalized receive `exact-consecutive-v1`. Voting deadlines do not
determine whether the competition is finished. Existing versioned rules are never
overwritten by this initialization, including after a pickem is finalized.

New pickems use `exact-consecutive-v1`. Only consecutive exact positions qualify;
wrong, unranked, or missing picks break the run. Bonuses start at `minStreak`
(at least the second pick), with no bonus backfilled to earlier picks. The original
relative-order calculation remains available for historical competitions. The
frontend explains and displays the persisted rule returned by the backend.

## VM cron

The root crontab on `suomiwow-server` contains these entries:

```cron
* * * * * /bin/bash /root/wow-guild-progress-tracker/scripts/deploy.sh >> /root/wow-guild-progress-tracker/deploy.log 2>&1
0 * * * * /bin/bash /root/wow-guild-progress-tracker/scripts/backup-db.sh --scheduled >> /root/wow-guild-progress-tracker/backup.log 2>&1
0 5 * * * truncate -s 0 /root/wow-guild-progress-tracker/deploy.log
0 5 * * * truncate -s 0 /root/wow-guild-progress-tracker/backup.log
```

The backup cron checks hourly, but the script only starts the backup at **11:00
Europe/Helsinki**. This handles summer and winter time while the VM stays on UTC.
Ubuntu cron does not support setting a separate scheduling timezone per job.
Log truncation runs at 05:00 UTC; these logs hold the most recent day's output.

Both scripts acquire `/tmp/wow-guild-deploy.lock` themselves. Do not wrap them in
another `flock` on that path. Deployment skips a busy lock and retries next minute.
A backup waits up to one hour for an active deployment or backup, then fails with
a logged error if the lock is still busy. No application jobs are paused: 11:00
is a scheduled start, not a guarantee that overnight work or cache warming has
finished. The dump runs at lower CPU priority.

## Backup on demand

```sh
ssh suomiwow-server 'bash ~/wow-guild-progress-tracker/scripts/backup-db.sh'
```

Before a migration or risky data change, wait for this command to succeed **before
pushing to main** or running the data-changing command. The deployment cron can
pick up pushed code within a minute. This script does not stop application writers;
follow the migration's own maintenance instructions when writers must be stopped.

Backups are compressed MongoDB archives in `/root/wow-backups`, named
`wow_db_backup_YYYYMMDD_HHMMSS.gz`. The latest five completed archives are retained.
Manual and scheduled backups share this retention. A failed dump or gzip check
removes its temporary file and leaves existing backups intact.

New backups include the replica set oplog. Restore these full archives with
`mongorestore --archive=... --gzip --oplogReplay` into an appropriate isolated
replica set when testing recovery. Older archives created by the previous deploy
script do not include the oplog. Gzip validation checks file integrity, not a full
restore. MongoDB operations such as collection renames or `$out` during the dump
can cause an oplog backup to fail; inspect `backup.log` before relying on a backup.

## Verification

### Raid affiliation and character rankings

Character rankings now require a qualified, tier-specific raid affiliation. The
participation rebuild derives `raidNightCount`, `mythicNightCount`, and
`affiliationQualifiedAt` before atomically replacing the participation collection.
Multiple uploads between 06:00 UTC and the following 06:00 UTC count as one night.
Only Heroic/Mythic fights in the tier's character-scoring encounter pool qualify.
Where appearance fight IDs are available, the actor must appear in a qualifying
fight; report-only appearances retain the existing report-level fallback.

Two nights with a matching character-guild snapshot qualify. Without that
corroboration, qualification requires at least three nights spanning seven days
and participation in at least half of the last six observed guild nights since
the character first appeared. Qualification earned earlier in a tier is retained;
later inactivity does not erase history. Among qualified guilds, total raid nights
take precedence over Mythic nights, then existing report-count and recency ties.
This is evidence of raid affiliation, not a replacement for actual guild membership.

For rollout, complete the database backup described above and coordinate with
scheduled workers so an old worker cannot overwrite the new participation fields.
Using the new build, run
`characterService.rebuildCharacterRaidParticipations({ reconcileIdentities: false })`
before directing traffic to the new API. Rows without the new qualification field
are intentionally excluded, including historical tiers. Then run
`characterService.buildCharacterLeaderboards()` and rebuild generated character
tier lists for the tracked raids. The ranking API filters old stored rows before
counting and pagination; historical WCL leaderboard rebuilds are not required for
that exclusion. Individual ranking backfills also remove ineligible stored rows.
No report, character, actual-guild history, or raw ranking needs deletion.

Run the focused database integration test against a disposable MongoDB on
`127.0.0.1:27138` with
`node --test -r ts-node/register integration/character-raid-affiliation.test.ts`
from `backend`. It creates and removes only its process-specific test database.

On Linux, run the isolated operations tests with:

```sh
python3 scripts/test-operations.py
```

They use temporary directories and stub Git/Docker commands, never the live
database. For a live check, run the manual backup, inspect its successful completion
in the output, and validate the archive with the installed MongoDB restore tools
without importing into production.
