# Ingestion leases

Report imports and guild updates use renewable MongoDB leases. A lease lasts
120 seconds and renews every 30 seconds while its owner is alive. Long imports
can continue renewing; a crashed owner becomes reclaimable without manual cleanup.
The next scheduled poll performs recovery, so a three-minute polling interval
normally catches up within about five minutes plus processing time.

The report policy document retains assignments and exclusions independently of
its lease. Guild updates and admin report corrections also lease the guild's
existing update/migration lock fields. All existing checks of those fields honor
the explicit expiry, including background queue and source-migration checks.

`ingestion-lease.service.ts` tracks active owners and propagates their scope through
async calls. Report/fight persistence and guild progress writes run in short
transactions that update the owned lease document before and after the data write.
The token and expiry must still match. The lease revision increment forces a real
write conflict with takeover; a separate ownership read would not provide this
guarantee. Mongoose's transaction AsyncLocalStorage supplies the same session to
the enclosed model writes. External API calls stay outside these transactions.

A failed heartbeat blocks further fenced writes. Releasing a lease requires the
same owner token, so late cleanup cannot unlock a successor's work. Normal polling
skips a busy report without updating its import metadata; manual imports and paged
rescans retain a retryable busy error so a skipped page is not silently completed.

On SIGINT/SIGTERM the process closes its listeners, stops scheduling, rejects new
lease acquisitions, and waits up to eight seconds for existing owners (including
in-flight acquisitions). If that budget expires, it leaves unfinished locks intact
until their leases expire. It must not unlock work that could still be writing.

## Rollout

No data backfill is required. Locks without an explicit expiry keep their original
one-hour/two-hour timeout, protecting work acquired by the previous version.
Deploy the API and worker together with the old processes stopped; old binaries
do not implement fencing or maintain the new expiry fields. Do not run mixed
versions against the same database. Restarting only the API cannot repair an old
worker's abandoned lock immediately.

MongoDB must support transactions (the production deployment uses a replica set).
There is deliberately no nontransactional fallback for fenced writes.

## Verification

Run the unit tests and backend build normally. For the isolated integration tests,
start a disposable local MongoDB replica set on port 27140:

```sh
docker run --detach --rm --name wow-ingestion-lease-test -p 127.0.0.1:27140:27017 mongo:7 mongod --replSet lease-test --bind_ip_all
docker exec wow-ingestion-lease-test mongosh --quiet --eval 'rs.initiate({_id:"lease-test",members:[{_id:0,host:"localhost:27017"}]})'
cd backend
node --test -r ts-node/register integration/ingestion-leases.test.ts
docker stop wow-ingestion-lease-test
```

The integration suite uses a unique disposable database, checks real transaction
rollback and concurrent ownership changes, and never loads production credentials.
Unit tests advance time to cover continued renewal beyond the original expiry,
renewal failure, cleanup, shutdown, and busy-report handling.
