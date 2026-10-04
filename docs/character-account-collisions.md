# Character account collisions

## Investigation: 4 October 2026

Production was inspected over `ssh suomiwow-server`; no production character or account data was changed during the investigation.

Jappe-Stormreaver has two separate character records:

| Character | Character ID | WCL class | Last report |
| --- | --- | --- | --- |
| Rogue | `6a24bf36305f6c34a1191f8d` | 8 | 2 June 2025 |
| Warlock | `6a259011c0d06e51ee6a0a78` | 10 | 19 December 2018 |

Both records have WCL canonical ID `72802025`. The database correctly distinguishes them by canonical ID **and class**. Sharing the WCL ID therefore does not establish character or account identity.

The achievement worker queried Blizzard using only region, realm, and name. It then saved the response under the queued historical character ID and class without checking the returned character's class. The live Blizzard profile resolves to rogue `145295547` (Blizzard class 4, which is WCL class 8). The achievement response identifies that same rogue.

The rogue and warlock have identical saved sets of 376 achievement timestamps. The warlock fingerprint and its 14 automatic account matches were first created on 17 June 2026. Both snapshots were refreshed on 8–9 July. The resulting `jape-76782833` group contains 15 characters and 105 automatic edges; no manual edge connects either Jappe record. The erroneous association originates in the imported achievement evidence, rather than the profile selector or group matching threshold.

## Measured extent

The audit inspected metadata for all 75,941 character records and 50,304 achievement fingerprints. It checked the live Armory profiles for all 121 fingerprint routes shared by multiple stored classes (265 fingerprint records).

- 115 routes returned a profile; six returned 404 and remain unresolved.
- 132 fingerprints have a different class from the current profile. Of these, 131 are represented in 106 account groups. A present-day mismatch alone does not establish that an older snapshot was invalid when fetched.
- 111 fingerprints exactly duplicate a saved fingerprint of the current class at the same route. One has fewer than 50 distinct signals and is not linked to an account, so the repair excludes it.
- The conservative repair selects **110 fingerprints in 95 account groups**, removing **834 automatic match edges** and **110 derived raid-achievement summaries**. Jappe's warlock is included; its rogue and legitimate peers are retained.
- The remaining 22 class mismatches and six unavailable routes are reported for review without mutation.

These are evidence and membership counts, not proof that every historical character belongs to a different human. Copied data cannot support an automatic account association; deliberate manual associations remain authoritative. The scan covers known cross-class name collisions. It cannot detect every same-class name reuse or reuse where the other character has never been stored. Existing fingerprints do not retain the source Blizzard character ID/class, so a complete retrospective identity proof is unavailable.

## Prevention and repair

The worker now fetches the profile first, translates Blizzard's class ID using the existing class mappings, and rejects a different or unknown class before fetching/storing achievements. It also requires the achievement response's character ID to equal the checked profile ID. Both requests use the worker's existing pacing and authentication retry handling. Transient errors leave existing evidence intact; class mismatches are terminal for that fetch.

`repair:character-account-collisions` defaults to a read-only audit. A repair candidate must have a current class mismatch and at least 50 distinct saved signals identical to a same-route fingerprint of the current class. Similar fingerprints, unavailable profiles, and cases without that peer are not automatically repaired.

Apply removes only the selected fingerprints and their derived token memberships, automatic matches, and raid-achievement summaries. It marks matching old queue snapshots as skipped and rebuilds account groups through the existing service. Characters, historical reports, WCL identities, manual edges, and continuity links are preserved. Deletions and token counts are transactional; changed fingerprint fetch timestamps abort the transaction. Repeating apply with an empty plan still rebuilds groups, recovering from a failure after the transaction committed.

When removing copied members leaves the rest of an account together, the repair preserves its document ID and existing URL, including on subsequent scheduled rebuilds. If removing false links splits or dissolves an account, the standard rebuild creates the resulting groups or removes the singleton. Review the affected slug list in the dry-run output before applying.

## Production procedure

Deployment and production repair require explicit authorization. Prepare the backend image containing this fix, then run:

```sh
docker compose -f docker-compose.prod.yml run --rm --no-deps backend npm run repair:character-account-collisions
```

Save the JSON output. Review the database, exact repair characters, affected account slugs, and unresolved cases. Take the normal MongoDB backup, then stop both processes before applying so no worker can race the repair:

```sh
docker compose -f docker-compose.prod.yml stop backend backend-worker
docker compose -f docker-compose.prod.yml run --rm --no-deps backend npm run repair:character-account-collisions -- --apply
docker compose -f docker-compose.prod.yml up -d backend backend-worker
```

Restarting both processes also clears their process-local profile/account caches. The standard group rebuild invalidates the corresponding shared caches.

Run the dry-run again: `copiedFingerprints`, `automaticMatchesToRemove`, and `raidSummariesToRemove` should be zero. Review the remaining cases separately. Check the class-specific Jappe profiles and the rebuilt account: the rogue remains linked, the warlock has no automatic account association, and the warlock's historical reports remain accessible.

## Verification

```sh
cd backend
npm run build
node --test -r ts-node/register test/character-achievement-identity.test.ts test/character-account-manual-edge.service.test.ts test/character-wcl-identity-audit.service.test.ts
node --test -r ts-node/register integration/character-account-collisions.test.ts
```

The integration test requires a disposable MongoDB replica set on `127.0.0.1:27141`. It creates and removes only its own `character_account_collisions_test_<pid>` database and never loads deployment credentials. It verifies dry-run behavior, selective removal, retained legitimate/manual links and raid history, stable account IDs/URLs, repeatability, and transaction rollback after a snapshot changes.
