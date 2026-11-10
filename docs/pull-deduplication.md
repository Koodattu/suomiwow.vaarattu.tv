# Physical raid pulls

`backend/src/utils/fight-deduplication.ts` is the shared identity layer for physical
boss attempts. Keep raw `Fight` records keyed by report code and fight ID: different
uploaders' recordings are evidence, not redundant database rows to delete.

## Matching contract

- Scope matches by guild, raid, encounter and difficulty. Different attempts in
  the same report and different kill/wipe outcomes cannot match.
- Require overlapping absolute start times, within at most 10 seconds and at most
  one third of the shorter fight. Invalid timing is not duplicate evidence.
- With incomplete roster metadata, retain the conservative fallback: start and
  duration differences must each be at most one second.
- Wider clock differences require complete, identical rosters and identical valid
  boss health. Duration differences are limited to 1% of the shorter fight, capped
  at five seconds. Complete variable-sized Heroic rosters are supported.
- Contradictory complete rosters or known boss health reject a match. Missing/default
  zero health on a wipe does not establish a wider match.
- Every recording in a group must agree with every other recording. A recording
  matching multiple groups stays separate. Uncertain evidence can therefore leave
  an overcount; it must not erase a genuine attempt.

`groupPulls` sorts a copy of its input. `groupSortedPulls` accepts a chronological
cursor and retains only the active ten-second window, so cursor and consumer batch
boundaries cannot split a pull. Both return all recordings in each group. Select
one recording for a metric, and preserve aliases needed by other calculations.

## Consumers

Guild statistics, boss history, mechanic damage, character death analysis,
character survival statistics, guild profile eligibility and best-pull VOD
selection use the shared groups. Re-progress events count physical pulls between
physical kills. Report-specific summaries and raw-record ingestion remain keyed
by report/fight identity.

Guild progression counts through the first physical kill. Boss history applies the
same raid content dates. Combat time counts one recording per pull; raid elapsed
time retains every recording's report-sequence membership before merging time
intervals. Removing aliases first can incorrectly remove downtime between attempts.

Character calculations use the available recordings' participant/identity evidence,
but count each character once per group. Events and phase/death times always come
from one recording's clock; they are not concatenated across uploads. Survival
coverage counts physical groups in both numerator and denominator.

Raid schedule inference gives each raid night one vote, using the same six-hour
UTC day boundary as raid affiliation. Split reports and additional uploaders do
not add votes.

The `physical_pull_chronology` index supports raid/difficulty scans in timestamp,
report and fight order without a blocking sort. The mechanics rebuild ensures this
index before opening its cursor. Existing indexes are retained.

## Existing data after deployment

No raw-record migration or WCL refetch is required for records with sufficient
metadata. Use the existing admin actions to recalculate guild statistics, reseed
selected mechanic damage collections, rebuild character mechanics, then rebuild
guild profile highlights and derived analytics/tier lists as appropriate.

Guild statistics recalculation reconciles existing first-kill events' pull count,
combat time and first-kill timestamp even when `createEvents` is false. It never
creates a replacement event during reconciliation, preserves other event fields,
and invalidates event caches only when a snapshot changed. Existing re-progress
and best-pull event snapshots are not rewritten by this reconciliation.

For TURTLES KIMBLE Mythic Ula'tek, the anonymised 306-record fixture resolves to
292 physical pulls. The earlier 291 event omitted a genuine October attempt;
302 included eleven duplicate November recordings while still omitting that attempt.

## Verification

From `backend`, run `npm run build` and `npm test`. Focused regressions include
`fight-deduplication.test.ts`, `mechanic-pull-deduplication.test.ts`,
`pull-deduplication-consumers.test.ts`, and the character/highlight suites.

For database verification, start a disposable local MongoDB on port 27141 and run:

```powershell
node --test -r ts-node/register integration/pull-deduplication.test.ts
```

The integration test uses only `127.0.0.1:27141/wow_pull_dedup_test_<pid>` and drops
only its own test database. It checks persisted progress/events, repeatability,
raw-record preservation, the history endpoint, physical coverage and the real
index execution plan. The production-derived fixture contains no player names;
roster equality is represented by synthetic roster IDs.
