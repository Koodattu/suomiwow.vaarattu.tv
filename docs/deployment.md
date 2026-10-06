# Deployment and database backups

The VM runs the Bash scripts tracked in this repository. Deployment and database
backups are independent. Normal autodeploy never creates a database backup.

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

On Linux, run the isolated operations tests with:

```sh
python3 scripts/test-operations.py
```

They use temporary directories and stub Git/Docker commands, never the live
database. For a live check, run the manual backup, inspect its successful completion
in the output, and validate the archive with the installed MongoDB restore tools
without importing into production.
