# Character identity repair

## Automatic rename reconciliation

The WCL identity audit runs at 01:15 Europe/Helsinki when `CHARACTER_WCL_IDENTITY_AUDIT_NIGHTLY_ENABLED` is not `false`. Nightly discovery starts with the existing `lastReportSeenAt` index and selects characters whose latest imported raid took place in the last 48 hours. The overlapping window avoids relying on an exact midnight boundary. It then uses indexed account-group membership to include only same-class, same-region possible old identities belonging to those raiders. This is necessary because a renamed character's old name stops appearing in new logs. It does not scan all characters or include the historical Armory-failure backlog; that remains an explicit backfill operation.

Candidate IDs are deduplicated, and terminal audits have a 24-hour cooldown. Completed redirects are excluded from subsequent checks; their current character remains eligible. Pending and running work is preserved. At most 1,000 eligible candidates are queued per night, using the existing WCL background rate budget and bounded retries. No new database indexes or ingestion writes are required.

For a WCL response whose `canonicalID` differs from the requested ID, the worker fetches the canonical profile separately. The alias response can still contain the old name. Both profiles must match the stored class and region, and hidden or inconsistent redirects are skipped. A verified redirect uses the existing continuity-link checks, including shared-report collision detection, to join the old identity to the current character. Historical character IDs and report rows remain intact. Profile/account caches, account groups, and enabled CCG identities are reconciled; retries can finish that work after a link was saved.

This depends on WCL recognizing the rename. Account membership only narrows the candidate list and never proves a rename. Without an existing account association, the inactive old identity is not discovered by this targeted job; it can be found when account evidence becomes available and the current character raids again, or through an explicit backfill. Reports uploaded after the 48-hour activity window and older existing duplicates also need subsequent activity or a targeted repair. Blizzard IDs can corroborate same-realm renames, but are not reliable identifiers across realm transfers.

On 18 October 2026, read-only production checks confirmed that Alexstrussy (`71682117`) redirects to Morinicar (`113151706`) in WCL. Both stored Blizzard render URLs contain character ID `206811510`. The continuity preview found 94 appearances across six raids and no shared-report collision. Production had the nightly audit explicitly disabled, and both characters' successful Armory fetches excluded them from the old candidate selection. Enabling the old implementation alone would not repair this case.

The pair already shares an account group and is its only two members of that class. When Morinicar raids, the targeted discovery therefore includes Alexstrussy even though that name is inactive. The existing duplicate can be repaired once directly instead of widening the nightly scan to historical characters.

A read-only production query-plan check on the same date examined 128 character documents and 47 account-group documents, producing 137 candidate IDs before cooldown filtering. MongoDB reported 3 ms for activity selection and 2 ms for account selection. These are database discovery measurements, not WCL processing time.

Deployment must include this updated worker and enable its existing nightly flag. The investigation did not deploy code, enable the flag, or mutate production character data.

Verification uses a disposable MongoDB instance at `127.0.0.1:27141`:

```sh
cd backend
npm run build
node --test -r ts-node/register test/character-wcl-identity-audit.service.test.ts test/character-continuity.service.test.ts
node --test -r ts-node/register integration/character-renames.test.ts
```

## One-off observed-name repair

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
