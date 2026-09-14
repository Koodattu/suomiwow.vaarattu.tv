# Mythic+ leaderboard cold-load investigation

Investigated 2026-09-14 for `/characters?tab=mythic-plus`. Application code and VM data were not changed. VM diagnostics were read-only and time-limited; no application cache was cleared or warmed. Database reads can naturally warm MongoDB's own working set.

## Findings

The user's description matches the implementation. Mythic+ responses are populated by visitor requests, without a registered warmer or scheduled response refresh. The most expensive measured dependency is the options endpoint, which the default page must finish loading before requesting leaderboard rows.

### Cache lifecycle

- `backend/src/routes/mythic-plus.ts` caches `mythic-plus:options:v2` for 24 hours and each `mythic-plus:leaderboard:v3:*` response for five minutes.
- The shared cache permits one additional TTL of stale use. Without invalidation, a leaderboard entry becomes unusable after approximately ten minutes; an options entry after approximately 48 hours.
- `CacheService.triggerBackgroundRefresh` returns without doing anything when a key has no registered warmer. No Mythic+ warmer is registered anywhere in the current source. `CacheWarmerService.warmAllCaches` does not include Mythic+.
- Including `/^mythic-plus:/` in the L1 hot-path patterns only enables memory caching; it does not register computation or schedule refreshes.
- Score imports, dungeon-run imports, static synchronization, and identity reconciliation call `invalidatePattern(/^mythic-plus:/)`. This deletes every matching shared response, including options, rather than refreshing it in place. Individual character updates can therefore recreate a cold options request long before its nominal expiry.
- The generic HTTP cache middleware does not coalesce concurrent misses. Several cold visitors can execute the expensive options computation simultaneously. The eligibility helper's in-flight promise does not cover the whole response, and `getOptions` calls the uncached eligibility method directly.

The VM's actual cache collection is `api_cache`. At 12:12 UTC it contained options and the exact default-page key, both generated around 12:08:53 UTC. The page key included `season=season-mn-2`, `bucket=all`, `dungeonSort=score`, `page=1`, and `limit=50`. A future warmer must match the real key, including page size.

### Expensive options dependency

The frontend enables the leaderboard query only after a season has been resolved from options. `MythicPlusService.getOptions`:

1. Resolves eligible character IDs from raid participation.
2. Finds score seasons across those characters.
3. Groups matching dungeon runs across all seasons into season/dungeon pairs.
4. Loads season and dungeon metadata, supplementing discovered pairs with static season data.

This work is performed just to build filters and choose a default season. The ordinary leaderboard reads already stored score/run records; opening this page does not trigger an external Raider.IO crawl. A direct leaderboard request that omits a season also calls `getOptions` internally, bypassing the options route's response cache.

## VM measurements

Approximate collection sizes: 119,107 participation rows, 783,540 season-score rows, and 2,171,043 dungeon-run rows. The eligibility query returned 27,313 character IDs.

| Database operation | Observed duration | Result |
| --- | ---: | --- |
| Eligible characters | 184 ms | 27,313 IDs |
| Options: available score seasons | 6,288 ms | 21 seasons |
| Options: season/dungeon grouping | More than 15 seconds | Diagnostic terminated at its explicit time limit |
| Default-season leaderboard count | 178 ms | 850 characters |
| Default-season first page | 569 ms | 50 characters |
| First-page dungeon details | 45 ms | 400 rows |

These are sequential diagnostic database reads, not end-to-end HTTP timings or a fully cold disk benchmark. The real implementation runs count and row loading concurrently. The application options query itself has no corresponding 15-second limit; the diagnostic limit prevented a long investigation query from burdening the VM. These results substantiate a slow options dependency but do not measure the user's entire multi-minute wait.

## Recommended changes

1. **Make options a background-maintained response.** Use the existing persistent API cache and static season/dungeon catalog, preserving discovered historical seasons and dungeon availability. Warm at startup and after relevant crawler batches; retain the previous response while calculating a replacement. Avoid rescanning all historical run records on a visitor request whenever a last-good response is available.
2. **Separate invalidation by purpose.** Ordinary score/run updates should not delete the whole options catalog. Refresh affected leaderboard responses in place and rebuild options only when available seasons/dungeons or eligibility meaningfully change. Batch refreshes at crawler boundaries instead of per imported character.
3. **Warm the actual default leaderboard and options independently of traffic.** Schedule refresh before expiry, use the same canonical key builder as the routes, and retain stale data during refresh failures. Initially warm a bounded set of popular first pages rather than every possible filter combination. Register refresh callbacks in whichever processes can serve stale responses, or explicitly delegate refresh to the worker. Preserve the options TTL: current `inferTTLFromKey` otherwise falls back to five minutes for Mythic+ keys.
4. **Coalesce cold response builds.** Share an in-flight promise per key within a process and coordinate worker/API rebuild ownership where needed. Search requests should remain outside the shared public response cache.
5. **Add timings and regression tests.** Verify zero-traffic warmup, expiry and invalidation behavior, failed-refresh fallback, simultaneous cold visits, historical option completeness, default-season changes, and exact `limit=50` cache-key matching. Measure options and leaderboard latency separately after rollout.

Extending TTL alone does not address broad deletion, absent warmers, or the expensive visitor-triggered options scan. Adding more leaderboard indexes is not the first recommendation: the measured default page query was already below one second.

## Implemented optimization

- Mythic+ now reads shared `api_cache` snapshots directly, so API processes immediately observe worker publications rather than retaining an older L1 copy. The existing options and leaderboard key versions and response shapes are preserved. HTTP responses require revalidation; React Query retains its existing client freshness policy.
- The worker warms on scheduler startup and checks every two minutes. The current season's actual first page (`all`, score sorting, page 1, limit 50) refreshes ahead of its five-minute expiry, normally every four minutes. Full startup/nightly cache warming also includes Mythic+. Other public filter combinations refresh on demand. Searches and identity filters bypass shared response caching.
- Options retain a 24-hour fresh TTL. Static imports and participation rebuilds mark options stale without deleting them. Crawler batches request refresh at most hourly while data is changing. A time-based season rollover is detected by the scheduled warmer even without another static import. Historical score-only seasons and run-only dungeon availability remain included.
- Successful snapshots remain usable during refresh: options for seven additional days, leaderboard variants for one additional hour. Failed rebuilds leave their timestamps and data untouched. These are bounded fallback windows, not normal freshness targets.
- Same-process calls share one promise. Separate API/worker instances coordinate with expiring, renewed MongoDB leases in `api_cache_refresh_leases`. Cold readers wait for the publication; abandoned leases can be reclaimed without waiting for TTL cleanup. A builder checks ownership before publication. Lease cleanup and failures are logged.
- Default-page warming runs before the expensive historical options refresh, so an options failure does not prevent refreshing the common leaderboard. Calls to `getLeaderboard` without a season reuse the persistent options snapshot.
- The two expensive options queries each have a two-minute database execution limit. The full historical discovery scan remains, but it runs on scheduled/batched refresh rather than repeated visitor cache misses. Start and completion logs report the cache key and elapsed milliseconds. A truly empty cache still requires its initial build; production latency after rollout has not yet been measured.

## Verification and rollout

Run the focused unit tests from `backend`:

```powershell
node --test -r ts-node/register test/mythic-plus-season-options.test.ts test/mythic-plus-leaderboard-performance.test.ts test/mythic-plus-lifecycle.test.ts test/mythic-plus-queue-actions.test.ts test/mythic-plus-rate-limit.test.ts test/mythic-plus-utils.test.ts
npm run build
```

The integration suite uses only disposable MongoDB at `127.0.0.1:27139`, a process-specific database, and no deployment credentials:

```powershell
docker run --detach --rm --name wow-mplus-cache-test --publish 127.0.0.1:27139:27017 mongo:7
npm run test:mythic-plus-cache
docker stop wow-mplus-cache-test
```

Coverage includes concurrent API/worker cache instances, immediate stale reads, failed-refresh preservation/retry, hard expiry, abandoned/lost leases, pre-expiry zero-traffic warming, actual HTTP reuse of the warmed page, free-text bypass, time-based season rollover, historical options, and the omitted-season service path.

Deploy the rebuilt backend and worker together through the normal deployment process. No manual data migration, leaderboard rebuild, or cache deletion is required. The small lease collection/index is created through the existing Mongoose initialization. Check `[Mythic+ Cache] Building` / `Published ... in ...ms` logs after startup and without visiting the page. A slow or failed options build is visible in these logs and keeps the existing snapshot available within its stale window. No production changes were made during this implementation.

Local verification completed: backend TypeScript build passed; 22 focused unit tests and 10 MongoDB/HTTP integration tests passed. The disposable MongoDB container was stopped after testing.
