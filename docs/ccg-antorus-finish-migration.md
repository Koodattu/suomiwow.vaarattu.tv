# Antorus: Worldcore to Felforged

Antorus now awards **Felforged**. Hellfire Citadel retains **Felscorched**. The former **Worldcore** finish is now displayed as **Worldsoul**, with a yellow-and-cyan Azerite treatment, reserved for The Worldcore raid. Its stored `worldcore` key remains supported for existing community rewards and this migration. That future set is not enabled or configured by this change. The display rename requires no additional migration.

## Maintenance window

Stop **all API and worker processes that can write to this database** before applying the migration. Keep MongoDB running. This includes Twitch reward assignment/grants, redemption processing, guest claims, publication, and leaderboard jobs. A feature flag or disabling pack opening alone does not stop every writer.

The data conversion uses one MongoDB transaction. A short maintenance window avoids old processes writing Worldcore back into Antorus or serving cached finish mappings. The new backend checks readiness before set reconciliation and before starting its API or background jobs. It refuses startup if Antorus still uses Worldcore or the migration's leaderboard refresh is unfinished.

Build the new backend and frontend ahead of the window. Take a database backup using the normal deployment backup procedure. Run the dry run first; it is safe while the old application is running, but its counts can change until writers stop. Use the **new build** for the script and restart both backend services on that same build after success.

## Production Docker Compose

Run from the repository root on the deployment host. These commands use the existing service environment and MongoDB connection; no credentials need to be copied into commands.

```sh
docker compose -f docker-compose.prod.yml build backend frontend
docker compose -f docker-compose.prod.yml run --rm --no-deps backend node dist/scripts/migrate-ccg-antorus-finish.js --dry-run
```

Inspect the dry-run counts and confirm both conflict counts are zero. Once the backup is ready, begin the maintenance window:

```sh
docker compose -f docker-compose.prod.yml stop backend backend-worker
docker compose -f docker-compose.prod.yml run --rm --no-deps backend node dist/scripts/migrate-ccg-antorus-finish.js --apply --writers-stopped
```

Only after the script exits successfully and reports verification plus leaderboard refresh:

```sh
docker compose -f docker-compose.prod.yml up -d --no-deps backend backend-worker frontend
```

Use the deployment's normal health checks. Confirm an existing Antorus card displays Felforged, existing card/pack shares resolve, and the Antorus collection still has its expected completion. Reload existing browser tabs to load the new finish renderer and labels.

## Direct Node deployment

From `backend`, with the target database's `MONGODB_URI` already configured:

```sh
npm run build
npm run migrate:ccg-antorus-finish -- --dry-run
```

Stop API and workers using the deployment's process manager, then run:

```sh
npm run migrate:ccg-antorus-finish -- --apply --writers-stopped
```

Restart on the new build only after successful verification. Omitting flags defaults to a dry run. `--writers-stopped` is an operator acknowledgement, not an automatic process check. The script requires a replica set or sharded MongoDB deployment supporting transactions, as the CCG already does.

## What is migrated

Only Antorus (zone 17, slug `antorus`) changes. Card references are resolved across **all Antorus snapshots**, including retired cards. The migration updates:

- The stored set's custom finish key, preserving its hard-pity setting.
- User and guest finish ownership. Quantities, alternative quantities, acquisition dates, card IDs, and series identity remain unchanged.
- Matching elements in mixed-raid pack histories, showcases, and Twitch assigned-card arrays, plus the legacy single assigned-card field.
- Card shares, redeem codes and claims, queued/historical Twitch overlay records, and structured ledger reward references. Public IDs, redemption state and idempotency keys remain unchanged.
- Daily finish analytics for already-recorded Antorus results, using Helsinki day boundaries. Pending openings retain their pending state and will record Felforged later. Uninitialized daily analytics are left for the existing analytics initializer.
- A full leaderboard recalculation after the transaction, so finish counts and completion use the new mapping without altering acquisition dates to trigger a refresh.

Published card snapshots and series unlocks are untouched. Pity needs **no rewrite**: the custom counter is stored under `custom.antorus`, not under the finish name. Pack balances and duplicate rewards are untouched. The `worldcore` key on community or other non-Antorus cards remains unchanged and displays as Worldsoul.

The script prints aggregate counts only. The `documents` counts represent matching documents, not the number of matching elements inside arrays.

## Failure and retry

- A conflicting Worldcore/Felforged ownership pair or share pair aborts before writes. The script does not silently merge ownership or delete a public link. These should not exist when migrating before the new release starts; investigate them if reported.
- Unexpected set identity/finish or inconsistent daily analytics also aborts. Resolve the reported inconsistency before applying.
- An error inside the data transaction rolls back every data change and the migration marker together.
- If data commits but leaderboard refresh fails or is locked, keep services stopped and rerun the same apply command. The marker makes data conversion a no-op; the unfinished leaderboard refresh resumes. An expired leaderboard lock is removed by the existing refresh service. Do not delete a live job's lock.
- A fully successful rerun makes no changes. If old Antorus references reappear after the marker, the script fails and requires investigation of old writers.
- Do not restart the old backend against converted data: its publisher would restore the old set mapping. Prefer completing the new rollout; a full rollback requires the pre-migration database backup and matching old application build.

## Isolated integration tests

The integration suite connects only to `127.0.0.1:27137`, creates a process-specific `ccg_antorus_test_*` database, and removes that test database afterward. It does not load `.env` or use `MONGODB_URI`.

```sh
docker run --detach --rm --name ccg-antorus-migration-test -p 127.0.0.1:27137:27017 mongo:7.0 --replSet ccgtest --bind_ip_all
docker exec ccg-antorus-migration-test mongosh --quiet --eval 'rs.initiate({_id:"ccgtest",members:[{_id:0,host:"localhost:27017"}]})'
```

Once the replica set has elected its primary, run from `backend`:

```sh
npm run test:ccg-antorus-migration
```

Remove the disposable container afterward:

```sh
docker stop ccg-antorus-migration-test
```
