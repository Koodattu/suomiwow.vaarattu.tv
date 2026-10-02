# Mechanic magnets

`/analytics/mechanics` is a Mythic-only damage-taken leaderboard, linked from the Analytics landing page. Both English and Finnish are maintained. Players can select a raid, mechanic, guild and kills/wipes, then sort by damage, hits or hits per attended pull. Totals and percentages always belong to one mechanic and the current selection, never different raids combined.

## Catalogue

The source of truth is `backend/src/config/avoidable-mechanics.ts`. Definitions contain a stable key, version, enabled flag, WCL zone/encounter IDs, an array of **damage spell IDs**, and an icon filename. Cast IDs and names are not used as ingestion filters.

| Expansion | Raid | Boss | Mechanic | Damage spell IDs |
| --- | --- | --- | --- | --- |
| Midnight | Venomous Abyss / Tidebound Grotto | Sszorak | Tempest | 1287083 |
| Midnight | Venomous Abyss / Tidebound Grotto | The Coiled Altar | Axegrinder | 1285017 |
| Midnight | Voidspire / Dreamrift / March on Quel'Danas | Lightblinded Vanguard | Divine Toll | 1248652 |
| Midnight | Voidspire / Dreamrift / March on Quel'Danas | Midnight Falls | Heaven's Glaives | 1254076 |
| The War Within | Manaforge Omega | Forgeweaver Araz | Prime Sequence | 1237322 |
| The War Within | Manaforge Omega | Nexus-King Salhadaar | Nexus Beams | 1228080 |
| The War Within | Liberation of Undermine | One-Armed Bandit | Crushed! | 460430 |
| The War Within | Liberation of Undermine | Sprocketmonger Lockenstock | Blazing Beam / Jumbo Void Beam | 1216415, 1216679 |
| The War Within | Liberation of Undermine | Chrome King Gallywix | Giga Blast | 469326 |
| The War Within | Nerub'ar Palace | Nexus-Princess Ky'veza | Nexus Daggers | 440149 |
| The War Within | Nerub'ar Palace | Queen Ansurek | Venom Nova | 438947, 454019 |
| Dragonflight | Amirdrassil | Smolderon | World In Flames | 422243 |
| Dragonflight | Amirdrassil | Tindral Sageswift | Fire Beam | 423649 |
| Dragonflight | Aberrus | Rashok | Lava Wave | 403543 |
| Dragonflight | Aberrus | Scalecommander Sarkareth | Scouring Eternity | 403625 |
| Dragonflight | Vault of the Incarnates | Raszageth | Lightning Breath | 377597 |
| Dragonflight | Vault of the Incarnates | Dathea | Raging Tempest | 375424 |
| Shadowlands | Sepulcher of the First Ones | Anduin Wrynn | Wicked Star / Empowered Wicked Star | 365024 |
| Shadowlands | Sepulcher of the First Ones | Artificer Xy'mox | Genesis Rings | 363413, 364604 |
| Shadowlands | Sanctum of Domination | Painsmith Raznal | Spiked | 355526 |
| Shadowlands | Sanctum of Domination | Sylvanas Windrunner | Haunting Wave | 351870 |
| Shadowlands | Castle Nathria | Sire Denathrius | Massacre | 330137 |
| Shadowlands | Castle Nathria | Sludgefist | Destructive Stomp | 332318 |
| Battle for Azeroth | Ny'alotha | N'Zoth | Stupefying Glare | 318976 |
| Battle for Azeroth | Ny'alotha | Vexiona | Twilight Decimator | 307218, 307250 |
| Battle for Azeroth | The Eternal Palace | Lady Ashvane | Upsurge | 298054 |
| Battle for Azeroth | The Eternal Palace | Za'qul | Crushing Grasp | 292565 |
| Battle for Azeroth | Battle of Dazar'alor | High Tinker Mekkatorque | Buster Cannon | 282182 |
| Battle for Azeroth | Battle of Dazar'alor | Jaina Proudmoore | Icefall | 288475 |
| Battle for Azeroth | Uldir | Zek'voz | Surging Darkness | 265451, 265452, 265454 |
| Battle for Azeroth | Uldir | G'huun | Virulent Corruption | 273486 |

31 bosses in 15 tracked WCL zones. Display raid names come from the existing Raid records, including combined WCL zones.

Legion/WoD candidates remain **pending review**, not enabled: Aggramar—Wake of Flame; Goroth—Infernal Burning; Guarm—Trample; Trilliax—Annihilation; Nythendra—Infested Breath; Kormrok—Fel Outpouring; Hans'gar and Franzok—Pulverized; Twin Ogron—Blaze. Sporefall, Crucible of Storms and Mists of Pandaria are excluded.

## What the numbers mean

- Damage is WCL event `amount + absorbed + max(overkill, 0)`. WCL's `amount` already excludes overkill, so do not subtract it. See the [WCL damage-event reference](https://www.warcraftlogs.com/scripting-api-docs/warcraft/interfaces/RpgLogs.DamageEvent.html).
- Hits are landed damage events. Direct hits and periodic ticks are retained separately; misses and immunes are excluded, while fully absorbed landed hits count. A tick is **not** a distinct collision or failed dodge.
- Every player in the fight's `friendlyPlayers` roster gets a row, including zero hits. Missing or incomplete rosters fail collection instead of inventing attendance. No extra CombatantInfo or per-player requests are needed.
- Pulls and hits/pull use successfully collected attendance. They are not normalized for time alive, mechanic opportunities, role or mitigation. There is no cross-mechanic score.
- Stored guild raid exclusions and recorded regional tier dates are respected, following the application's existing raid-window policy. An absent date bound is open; maintain Raid dates before relying on historical era comparisons. Reuploads within one guild are matched by encounter, outcome, absolute pull start and duration (one-second tolerance), not duration alone.
- Archived, unavailable, failed and pending pulls never count as zero. Coverage describes the fights discovered from stored data during the latest job. Public reads also honor source-fight deletion/reassignment, guild raid exclusions and canonical character privacy.
- Character identities use existing report appearances and WCL canonical IDs when unambiguous, otherwise normalized name/realm/region/class. Missing realms stay report-local. No character API calls are made. As with any historical snapshot, later identity corrections may require a targeted refresh.

## Collection and operation

At **01:30 Europe/Helsinki**, the scheduler queues `backfill_avoidable_damage` independently of log discovery and death collection. It uses the existing persistent guild queue at priority 30 and shares WCL's existing client/user budgets and global pause controls.

The job discovers candidates from **stored Fight and closed Report records only**. It seeds compact `AvoidableDamageFight` records, skips previously completed/current-version data, and processes at most ten reports per queue turn, newest first. Requests batch at most 50 fights for the same report and mechanic. The WCL query sets explicit fight IDs, encounter ID, difficulty 5, `DamageTaken`, friendly player targets and an `ability.id IN (...)` whitelist. Resources are disabled. Raw events are reduced one page at a time and never persisted.

`nextPageTimestamp` drives pagination. Each page checks the shared budget and queue state. Results replace the entire per-fight aggregate only after the complete batch succeeds; retries cannot add the same hits twice. A restart or budget pause leaves unfinished data eligible. Failures retry after 24 hours. Archived/unavailable reports stop further requests for that report and require an explicit retry or a new definition version. Existing connected WCL user authorization is used for archive/permission fallback; this feature does not change authentication.

Public `/api/avoidable-damage/options` and `/api/avoidable-damage` read MongoDB only, with five-minute caching and bounded pagination. Saved batches invalidate the shared server cache; already-open browser tables may take a few minutes to refresh. Icons use the existing local icon cache, populated from WCL's ability-icon CDN by the worker. Page views do not call WCL or Wowhead.

### Admin collection

In **Admin → Overview → Manual Actions → Mechanic magnets — collection**, select a raid, check the mechanics and optionally choose a guild, then press **Collect selected mechanics**. The API returns `202` after saving the queue requests; WCL collection runs in the existing worker, never in the admin HTTP request. Counts and queue progress refresh every 15 seconds. Each recent job can be paused, resumed or retried using the existing admin queue controls.

Normal runs fetch missing current-version aggregates and due failures only. The explicit retry checkbox resets failed/archived/unavailable records **only for the selected guilds, mechanics and current versions**. It never resets fetched results. A new selection is merged into an active guild job; a revision checkpoint ensures the next worker turn discovers newly requested mechanics, even if the previous turn finishes concurrently. Paused jobs remain paused. Finished jobs start again with just the new selection. The nightly schedule selects all enabled mechanics and uses the same merge rules.

Both queue selection and event queries use the stored Mythic boss evidence. Immediately before fetching, the worker rechecks source-fight ownership, difficulty, encounter, closed-report eligibility, exclusions and regional tier dates. Old pending rows whose source is no longer eligible are not sent to WCL. No report-list discovery or full-log rescan is performed.

The worker refreshes both shared WCL credential buckets before each page. A hard limit or HTTP 429 yields the mechanic job instead of holding the worker inside an HTTP retry. Completed batches remain saved; an unfinished batch restarts when budget is available. Per-job/global pauses and queue removal are honored without turning a paused item back into a pending item.

Admin API (existing admin session required; responses are uncached):

- `GET /api/admin/avoidable-damage?guildId=<optional ID>`: current-version collection counts, up to 50 recent guild jobs, queue counts and shared WCL budgets.
- `POST /api/admin/avoidable-damage/queue`: `{ "mechanicKeys": ["sszorak-tempest"], "guildId": "<optional ID>", "retryUnavailable": false }`. Omit `guildId` for all matching guilds. An empty or unknown mechanic selection is rejected.

### Production rollout

Use the repository's existing release process (`scripts/deploy.sh` / `docker-compose.prod.yml`). Deploy the API, `backend-worker` and frontend from the same revision before queueing collection. The existing worker image includes the new compiled collector and CLI. No new service, production dependency, environment variable or authentication configuration is required. Mongoose creates the new aggregate collection/indexes; queue fields are additive and existing results are retained.

After rollout, first select one mechanic and one guild in the admin panel. Confirm the job moves through the shared queue, its collected-pull count increases and its public leaderboard contains the expected totals. Then select additional mechanics/guilds. Archived reports need the existing WCL user connection with access to those reports; they remain visibly unavailable if access is absent. A finished queue job means the scan finished, not that all archived/private data became accessible.

If rolling back to code that predates this queue job type, pause its queue items before starting the older worker. Keep the aggregate records; they can be reused when this version is restored.

To enqueue an initial collection after deployment, from `backend`:

```powershell
npm run build
node dist/scripts/queue-avoidable-damage.js
# Limit work to one existing guild:
node dist/scripts/queue-avoidable-damage.js --guild=<MongoDB guild ID>
# Select individual mechanics (same behavior as the admin panel):
node dist/scripts/queue-avoidable-damage.js --mechanics=sszorak-tempest,coiled-altar-axegrinder
# Retry archived/unavailable data after report access is restored:
node dist/scripts/queue-avoidable-damage.js --guild=<MongoDB guild ID> --retry-unavailable
```

These commands enqueue work; the normal background worker must be running. The nightly schedule also queues the initial backfill automatically. No full log rescan is required.

To add a mechanic, add a definition and confirm the encounter and **damage** IDs against an actual Mythic report and spell effects. Multiple IDs and multiple definitions per boss are supported. Disable or remove a definition to stop collection and remove it from public options; historical aggregates remain stored. Bump `version` when changing IDs/counting semantics. The next job collects that definition again without resetting any other mechanic. Cosmetic name/icon changes do not require a version bump.

## Spell validation

IDs and icons were checked against WCL report metadata and public spell-effect records on 2026-10-02. Older reports in the research sample were archived: their spell effects could be checked, but their event totals were not live-validated. Archive access remains a real coverage limit.

Representative evidence:

- [Sszorak report](https://www.warcraftlogs.com/reports/QVM8KDfJzhaFPcBR): implemented collector smoke-tested on Mythic fights 45–53. **137,595,834 damage, 697 landed events = 255 direct hits + 442 ticks**, matching the WCL damage table. Player Tempest 1307324 is excluded.
- [Axegrinder](https://www.warcraftlogs.com/reports/236cnwAK18brtFpL#fight=39): 1285017 damages players; 1283832/1283840/1283841 are not the measured damage spell.
- [Divine Toll](https://www.warcraftlogs.com/reports/D6RNkvp9qBZfHXYz#fight=77): 1248652 damage; 1248644 cast and player Divine Toll 375576 are excluded.
- [Heaven's Glaives](https://www.warcraftlogs.com/reports/wQ7zTqCtmRDWaAFP): 1254076 damage, not cast 1253915.
- [Prime Sequence](https://www.warcraftlogs.com/reports/2VtyDR4CF6PGLjbd#fight=42): 1237322 damage.
- [Sprocketmonger](https://www.warcraftlogs.com/reports/JhLnPMTNXCpbgxWY): 1216415 and 1216679 damage ticks; clean kills can omit both from their damage tables.
- [Giga Blast](https://www.warcraftlogs.com/reports/KJ3By1TM4jngGch9#fight=91): 469326 includes direct damage and ticks; separately named Giga Blast Residue is outside this definition.
- [Nexus Daggers](https://www.warcraftlogs.com/reports/nJWwjpD4FhA3HPdV#fight=89): 440149 damage, not cast 439576.
- [Venom Nova](https://www.wowhead.com/spell=437417/venom-nova) triggers the central blast [438947](https://www.wowhead.com/spell=438947/venom-nova); ring damage is [454019](https://www.wowhead.com/spell=454019/venom-nova). Cast/area-trigger/debuff-only IDs are excluded.
- Zek'voz's [265451](https://www.wowhead.com/spell=265451/surging-darkness), [265452](https://www.wowhead.com/spell=265452/surging-darkness) and [265454](https://www.wowhead.com/spell=265454/surging-darkness) are avoidable ring damage. **[267350](https://www.wowhead.com/spell=267350/surging-darkness) is unavoidable raid-wide damage and is deliberately excluded.**

## Verification

```powershell
# Unit and WCL protocol tests (no network/credentials required):
node --test -r ts-node/register test/avoidable-damage.test.ts test/admin-avoidable-damage.test.ts
# Optional isolated MongoDB integration test; requires a local MongoDB instance:
$env:MECHANIC_TEST_MONGO_URI = 'mongodb://127.0.0.1:27028/wow_mechanic_test_integration'
node --test -r ts-node/register test/avoidable-damage.integration.test.ts
```

The integration tests accept only a localhost database whose name begins `wow_mechanic_test_`, and drop only that test database. They check real aggregation pipelines, deduplication, roster-based zeroes, filtering, pagination, version changes, retry idempotency, privacy, exclusions, concurrent selection changes, pause/removal safety, scoped retries and recovery after quota exhaustion. Admin HTTP tests cover authentication, authorization and strict selection validation. WCL tests cover filtered pagination, archive fallback and HTTP 429 yielding.
