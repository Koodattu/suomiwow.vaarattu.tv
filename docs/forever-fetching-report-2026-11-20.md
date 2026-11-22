# WoW Forever guild and character fetching

On 20 November 2026, the production worker recorded **379 Blizzard Armory attempts in 15 minutes**. Guild rosters kept levels current for most players. **205 of 210 approved guilds** had refreshed within 15 minutes, and **96.4% of characters with a saved observation** had been seen within that time. Direct character profiles followed a slower schedule. Their median age was **17 hours 21 minutes**, with **1,257 profile checks due** at the snapshot.

## Measured Blizzard traffic

The measurement covers completed production attempts from 17:29:53 to 17:44:53 Helsinki time.

| Blizzard website request | Successful | Failed | Total | Hourly rate at this pace |
| --- | ---: | ---: | ---: | ---: |
| Guild roster, one GraphQL POST for the entire guild | 205 | 2 | 207 | 828 |
| Character profile, one HTML GET for one character | 171 | 1 | 172 | 688 |
| **Armory total** | **376** | **3** | **379** | **1,516** |

This pace sustained for 24 hours would produce **36,384 Armory attempts**. The 15-minute window counts committed worker outcomes, including repeated attempts on the same job. An hour of change history was unavailable. The hourly and daily figures are extrapolations, and a request interrupted before the worker saves its outcome would escape the count.

The authenticated **Battle.net developer API** serves a separate purpose. A second worker checks eligible EU level-60 characters for their class achievement when the observation history gives a usable finish window. It recorded **two milestone checks** in the same 15 minutes. Both scheduled a retry. It processes at most one candidate every ten seconds (360 per hour), skips the external request when the timing evidence is insufficient, and reuses a cached OAuth token. The records do not separately count outbound achievement and token requests. Reading a leaderboard, guild page or saved character profile makes **zero worker fetches**. [Blizzard request implementations](../backend/src/features/forever/forever-armory.ts) · [Milestone worker](../backend/src/features/forever/forever-level60.worker.ts) · [Token cache](../backend/src/services/blizzard.service.ts)

## Guild refresh timeline

Production had **444 saved guilds**. The **210 approved, visible guilds** get stable slots spread across each 15-minute cycle. That calls for **840 roster requests per hour**, or **20,160 per day**, if every slot runs. The other guilds were 3 pending, 5 paused and 226 rejected. A pending guild can receive a preview. After a successful preview, it waits for approval or an explicit refresh. Paused, rejected and hidden guilds have no recurring roster poll. [Queue selection and scheduling](../backend/src/features/forever/forever.worker.ts)

At 17:43:58, **209** approved guilds had a saved roster. **205** had refreshed in the previous 15 minutes, **four** had gone more than 45 minutes since their last success, and **one** had never succeeded. Five approved guilds had recorded failures. Among fetched rosters the median age was **7.3 minutes**, the 90th percentile was **13.6 minutes**, and the oldest successful roster dated from **14 November**. There is no fixed completion time for all 210 while retries are outstanding.

The directory held **14,068 roster entries**. Each successful roster supplies level, class, race, faction and membership in bulk. Eligible members still need a direct profile for information such as their portrait and Blizzard save timestamp. An outdated entry, conflicting guild or regressing roster level can send a member to individual verification. [Roster processing](../backend/src/features/forever/forever-roster-sync.ts) · [Public guild directory](https://suomiwow.vaarattu.tv/forever/guilds)

## Character refresh timeline

At 17:45:30, the visible tracked population was **14,183 characters**, all EU. Of those, **14,161** had a saved observation and **22** were waiting for one. **13,581** had current roster coverage, including **1,479 below level 10**.

| What the worker updates | When it becomes eligible |
| --- | --- |
| Level and membership of a covered character | Every usable guild roster, normally every 15 minutes. Coverage expires after 45 minutes without a usable observation. |
| First direct profile | Queued for an eligible new member or when a roster shows the character reaching level 10. An unknown level also qualifies. |
| Direct profile of a covered character | A staggered audit 24–30 hours after the last successful profile. Each roster can also queue one member whose profile is at least six hours old. A successful probe resets the audit clock. |
| Uncovered character at level 10–59 | Every two minutes while gaining levels. After 24 hours without an observed level gain, hourly. |
| Uncovered level-60 character | Every six hours for the direct profile. The achievement check runs independently. |
| Known level 1–9 | Roster updates supply the level while covered. Once uncovered, a discovery check is due in 1–2 hours. A failed check waits at least six hours before retrying. |

These intervals set the earliest normal queue turn. An individual failure backs off with jitter, starting at 15 minutes for a 404 and two minutes for most other errors. Rate limits, authorization errors and explicit Retry-After responses can pause the whole Armory queue. [Polling policy](../backend/src/features/forever/forever-policy.ts) · [Queue and retry handling](../backend/src/features/forever/forever.worker.ts)

| Production freshness | Population with a successful observation | Median age | 90th percentile | 99th percentile |
| --- | ---: | ---: | ---: | ---: |
| Latest usable roster or direct character observation | 14,161 | 7.5 min | 14.0 min | 4 h 25 min |
| Latest successful direct profile | 12,606 | 17 h 21 min | 26 h 27 min | About 8 days |

Of the **1,257 due** character checks, **874** belonged to roster-covered characters and **217** were more than an hour overdue. Median overdue time was **30 minutes**. There were **30 eligible characters** with no successful direct profile, and none of their first checks was due at that instant. The leaderboard's Updated time can advance after a roster observation. Blizzard's own save timestamp can be older. [Leaderboard fields](../backend/src/features/forever/forever-leaderboard.ts) · [Roster and profile timestamps](forever.md#roster-first-polling-verified-8-november-2026)

## How long a full pass would take

**Guild levels already refresh in bulk.** The observed roster rate was close to the 840/hour target. One worker lease serializes guild and character Armory requests, with starts at least 500 ms apart. That gives a theoretical ceiling of **7,200 attempts/hour** across both. The sample delivered **1,516/hour** including upstream response time and database work. When both queues have due jobs, up to three rosters run before a character gets a turn. Admin instant refresh has priority. Within each type, up to three first fetches get priority before an existing refresh. [Armory scheduler](../backend/src/features/forever/forever.worker.ts)

**A direct profile pass is a different workload.** At the observed 688 profile attempts/hour, one attempt for each of the 12,606 previously fetched profiles would take **18 hours 19 minutes** if every profile turn went to a different character. Serving the 1,257 already-due checks once would take **about 1 hour 50 minutes** at that rate. Neither figure is a deadline. New work keeps arriving, failures retry, and different characters qualify at different intervals. For scale, the **220 uncovered characters** in the active-leveling group alone would use **660 profile requests/hour** if each received a two-minute check. That leaves little room at the sampled rate for the rest of the profile queue.

Traffic counts come from production MongoDB change events for completed guild and direct-profile attempts. Freshness and queue figures come from separate, read-only production aggregates taken within two minutes of each other. Character aggregates apply the worker's visibility and level rules. Percentiles are approximate. The public guild directory and leveling API independently confirmed the population scale. [Worker visibility rules](../backend/src/features/forever/forever-visibility.ts) · [Public leveling API](https://suomiwow.vaarattu.tv/api/forever/leveling)
