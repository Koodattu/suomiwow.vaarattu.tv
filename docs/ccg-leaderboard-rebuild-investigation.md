# CCG full leaderboard rebuild investigation

Investigated 2026-09-14. The initial query fix and diagnostics described below are now implemented locally. The VM database has not been modified.

## Implemented improvements

The ownership lookup now explicitly matches the partial index's ObjectId requirements. Both full and incremental recalculations use the improved lookup. Required finish lists are computed once per set rather than once per owned series. Scoring rules, the score version, rank tie breaks, refresh schedules, and locks are unchanged.

Logs now report durations for source selection, series aggregation/scoring, set completion, user loading, total entry calculation, incremental merging, sorting, writing, and cleanup. The `calculate-entries` duration includes its subphases; do not add it to those subphase durations. During series aggregation/scoring, progress logs appear every 30 seconds with processed series, collectors encountered, and elapsed time, including while waiting for the first database batch. The progress timer is cleared on success or failure. Logs contain aggregate counts, not collector identities.

Real MongoDB integration tests compare scores and ranking against the original query and verify full/incremental equivalence. They cover overlapping owners and sets, guests, absent user accounts, multiple unlocked snapshots, a locked higher grade, duplicate/missing snapshot versions, archived-only cards, null/missing availability status, disabled sets, finish and set completion, and tie breaks. An execution-plan assertion verifies use of the existing partial compound index and bounded ownership document reads.

For local integration verification, start a disposable MongoDB on the dedicated test port:

```sh
docker run --detach --rm --name ccg-leaderboard-test -p 127.0.0.1:27138:27017 mongo:7.0.40 --bind_ip_all
cd backend
npm run test:ccg-leaderboard
docker stop ccg-leaderboard-test
```

The suite does not load `.env` or use `MONGODB_URI`; it creates and removes a process-specific `ccg_leaderboard_test_*` database only on that local port.

Snapshot metadata caching remains a follow-up after measuring the VM. A local prototype with the same 100-collector fixture reduced the aggregation plus metadata resolution from 3,136 ms with the index fix to 1,509 ms and returned equivalent row contents. That prototype has not been added to the production calculation: its memory footprint, per-set batching, and behavior during publication still require validation. The initial rollout can be deployed with the normal backend/API and worker update and requires no data migration or special maintenance window if the existing index is present.

## Finding

The ownership join has an index-selection problem, reproduced on MongoDB 7.0.40 with the actual aggregation captured from `CcgLeaderboardService.calculateEntries` and the indexes declared by the repository models. This is a strong explanation for the reported scaling problem, but the VM's actual execution plan and phase timings still need verification.

The full rebuild scans user series ownership for enabled sets. For every series it looks up finish ownership and unlocked card snapshots, calculates the score, then ranks and writes one leaderboard entry per collector. It does not read pack history. Repeated duplicate pulls update quantities rather than adding another leaderboard source row; additional collectors, collected series, distinct finishes, and snapshot versions increase its workload.

The incremental refresh uses the same calculation restricted to recently changed owners. If nobody changed, it skips the aggregation entirely. Even when collectors change, it still reranks and writes the combined leaderboard, so the reported fast incremental runs point toward the collection calculation rather than rank sorting or writes.

## Ownership index mismatch

The finish `$lookup` in `backend/src/services/ccg-leaderboard.service.ts` matches `ownerType` directly and compares `ownerId`, `setId`, and `characterId` inside `$expr`. The matching compound index, `ccg_ownership_owner_series_finish`, has a partial filter requiring ObjectId `setId` and `characterId` fields.

The existing query used `characterId_1` in the local explains. Each lookup therefore examined other collectors' finishes for the same character before filtering them out. Increasing collectors multiplied both the number of series processed and the number of candidate ownership records examined per series in the tested distribution.

Adding these predicates to the finish lookup's existing `$match`, alongside `ownerType` and the unchanged `$expr`, selected the existing compound index:

```js
setId: { $type: "objectId" },
characterId: { $type: "objectId" },
```

This makes the partial-index conditions explicit. MongoDB documents that a query must imply a partial index's filter for that index to be eligible: [MongoDB partial index query coverage](https://www.mongodb.com/docs/v7.0/core/index-partial/#query-coverage). The actual lookup plan was verified experimentally; it is not an assumption that all `$expr` lookups can use partial indexes.

## Local measurements

Each synthetic collector owned the same 200 series, with six finishes per series. The shared card catalog contained 800 snapshots, of which three versions per series were unlocked. All schema-declared indexes existed. Timings measure consuming the aggregation, excluding leaderboard scoring, sorting, and writes; explain was executed separately. These are local measurements, not a prediction of VM duration.

| Collectors | Series | Existing query | Explicit type predicates | Ownership documents examined, before → after |
| --- | ---: | ---: | ---: | ---: |
| 20 | 4,000 | 899 ms | 605 ms | 480,000 → 24,000 |
| 100 | 20,000 | 11,851 ms | 3,087 ms | 12,000,000 → 120,000 |

At 100 collectors, the change reduced ownership reads 100-fold and aggregation time approximately 3.8-fold. A separate nonpartial compound index also worked (2,899 ms), but provided little additional benefit over using the existing index and would add storage and write overhead.

At 100 collectors, the existing one-owner calculation took 123 ms versus 11,851 ms for all owners, reproducing the large full/incremental gap.

Aggregation results matched across both candidate fixes after normalizing irrelevant row and nested-array ordering. Scoring does not depend on those orders. The fixtures do not establish parity for malformed legacy records or all scoring edge cases; those need integration coverage before implementation.

## Further opportunities

1. **Repeated card snapshot lookups.** The card join uses `ccg_card_character_snapshot_version`, but rereads the same catalog for each collector. At 100 collectors it examined 80,000 card documents for a catalog of only 800. A full rebuild can preload minimal snapshot metadata per enabled set, then resolve each series' explicitly unlocked versions in memory. Keep memory bounded by processing sets or batches. Preserve rarest-unlocked-snapshot scoring and the active/archived rules for set completion. The existing collection display read model selects the latest snapshot, so it is not a drop-in replacement for leaderboard scoring.
2. **Missing phase visibility.** Current logs report total duration and resulting series count. Add elapsed time for source aggregation/scoring, user loading, sorting, writes, and cleanup, plus periodic progress. `seriesScanned` currently counts rows surviving both joins, not database documents examined.
3. **Small allocation savings.** Required finish order is rebuilt for each series and finish arrays are deduplicated twice. Cache required finishes per set and reuse the normalized finish list if profiling warrants it. These are secondary to database reads.

The production Compose configuration gives MongoDB a 1 GB WiredTiger cache and the worker lower CPU priority. Unnecessary reads can become more expensive under cache pressure or competing jobs, but no VM resource measurements were collected. Hardware changes are not the first recommendation.

## Recommended implementation order

1. Inspect the VM's existing indexes and a bounded `explain("executionStats")` sample of both lookup forms. Confirm the ownership lookup changes from a broad index to `ccg_ownership_owner_series_finish`, and compare `totalDocsExamined` and `totalKeysExamined` per returned series. Use a limit before the lookups and a time limit rather than explaining an unrestricted production rebuild.
2. Implement the two explicit type predicates and phase/progress logging. Add MongoDB integration coverage with multiple owners, overlapping characters across sets, guests, multiple unlocked grades, archived snapshots, and completion/tie-break equivalence. Preserve full/incremental behavior and locking.
3. Measure one complete VM rebuild. If card lookup time remains material, introduce the bounded snapshot metadata cache and repeat parity checks.

The first fix reuses an existing index and needs no data migration or special maintenance window if that index exists on the VM. Leave the current scoring version unchanged because the intended scores do not change. Do not start by increasing concurrency or merely running full rebuilds less often.
