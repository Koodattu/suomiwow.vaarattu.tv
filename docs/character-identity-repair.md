# Character identity repair

This repair corrects canonical character names and realms from the newest raw Warcraft Logs report appearance, seeds the observation timestamp used to reject out-of-order identity writes, synchronizes existing CCG card media, rebuilds account-group member snapshots, queues only stale Blizzard media and achievement records, and reconciles Raider.IO jobs and scores with the repaired identity. Mythic+ rows attached to an old identity are hidden immediately and a replacement profile fetch is queued.

The command is dry-run by default. It prints the database name, exact affected counts, and sample changes. `--apply` is the only mode that writes data.

## Production procedure

Build and deploy the backend image containing the repair first:

```sh
docker compose -f docker-compose.prod.yml build backend
```

Run the read-only audit against production and save its JSON output:

```sh
docker compose -f docker-compose.prod.yml run --rm --no-deps backend npm run repair:character-identities
```

Review the reported database name, `identityMismatches`, samples, and downstream counts. Before applying, take the normal MongoDB backup and stop both backend processes so no report or Blizzard queue worker can race the repair:

```sh
docker compose -f docker-compose.prod.yml stop backend backend-worker
docker compose -f docker-compose.prod.yml run --rm --no-deps backend npm run repair:character-identities -- --apply
docker compose -f docker-compose.prod.yml up -d backend backend-worker
```

Keep the worker running until the queued media, achievement, and Mythic+ refreshes drain. The apply output reports how many were queued. A backend restart is part of the procedure because process-local cache entries cannot be cleared by a one-off repair container.

Finally, run the dry-run command again. `identityMismatches`, `characterUpdatesPlanned`, stale card count, and stale account-group member count should be zero. Media and achievement requests that Blizzard rejects, and profile requests that Raider.IO rejects, remain governed by their normal bounded retry/cooldown behavior; inspect the existing admin queue statuses and worker logs for those outcomes.

The operation is idempotent. If the apply container exits partway through, run the dry-run again and repeat `--apply` after reviewing the remaining counts.

## Direct Node invocation

Outside Docker, build the backend and provide the target connection through `MONGODB_URI` or `--mongo=`:

```sh
cd backend
npm run build
npm run repair:character-identities
npm run repair:character-identities -- --apply
```

Do not put credentials in shell history through `--mongo=` on production; prefer the existing `MONGODB_URI` environment configuration.
