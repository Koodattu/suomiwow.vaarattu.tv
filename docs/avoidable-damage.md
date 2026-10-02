# Mechanic magnets

`/analytics/mechanics` is a Mythic-only damage-taken leaderboard, linked from the Analytics landing page. Both English and Finnish are maintained. Players can select a mechanic and guild, filter roles and minimum pulls, then sort by damage, hits or hits per attended pull. Kills and wipes are included. Totals and percentages always belong to one mechanic and the current selection, never different raids combined.

## Catalogue

The source of truth is `backend/src/config/avoidable-mechanics.ts`. Definitions contain a stable key, version, enabled flag, WCL zone/encounter IDs, an array of **damage spell IDs**, and an icon filename. Cast IDs and names are not used as ingestion filters.

| Expansion | Raid | Boss | Mechanic | Damage spell IDs |
| --- | --- | --- | --- | --- |
| Midnight | Venomous Abyss / Tidebound Grotto | Sszorak | Tempest | 1287083 |
| Midnight | Venomous Abyss / Tidebound Grotto | The Coiled Altar | Axegrinder | 1285017 |
| Midnight | Venomous Abyss / Tidebound Grotto | Ula'tek | Caustic Waves | 1292403 |
| Midnight | Voidspire / Dreamrift / March on Quel'Danas | Fallen-King Salhadaar | Umbral Beams | 1260030 |
| Midnight | Voidspire / Dreamrift / March on Quel'Danas | Lightblinded Vanguard | Divine Toll | 1248652 |
| Midnight | Voidspire / Dreamrift / March on Quel'Danas | Midnight Falls | Heaven's Glaives | 1254076 |
| Midnight | Voidspire / Dreamrift / March on Quel'Danas | Midnight Falls | Dark Quasar | 1282469 |
| The War Within | Manaforge Omega | Plexus Sentinel | Atomize | 1219223 |
| The War Within | Manaforge Omega | Forgeweaver Araz | Prime Sequence | 1237322 |
| The War Within | Manaforge Omega | Nexus-King Salhadaar | Nexus Beams | 1228080 |
| The War Within | Liberation of Undermine | Cauldron of Carnage | Blastburn Roarcannon | 472242 |
| The War Within | Liberation of Undermine | Rik Reverb | Resonant Echoes | 468120 |
| The War Within | Liberation of Undermine | One-Armed Bandit | Crushed! | 460430 |
| The War Within | Liberation of Undermine | Sprocketmonger Lockenstock | Blazing Beam / Jumbo Void Beam | 1216415, 1216679 |
| The War Within | Liberation of Undermine | Sprocketmonger Lockenstock | Screw Up (Screwed!) | 1217261 |
| The War Within | Liberation of Undermine | Chrome King Gallywix | Giga Blast | 469326 |
| The War Within | Nerub'ar Palace | Rasha'nan | Rolling Acid (Corrosion) | 439785 |
| The War Within | Nerub'ar Palace | Nexus-Princess Ky'veza | Nexus Daggers | 440149 |
| The War Within | Nerub'ar Palace | Queen Ansurek | Venom Nova | 438947, 454019 |
| The War Within | Nerub'ar Palace | Queen Ansurek | Web Blades | 439536 |
| Dragonflight | Amirdrassil | Nymue, Weaver of the Cycle | Impending Loom | 429785 |
| Dragonflight | Amirdrassil | Smolderon | World In Flames | 422243 |
| Dragonflight | Amirdrassil | Tindral Sageswift | Fire Beam | 423649 |
| Dragonflight | Aberrus | Kazzara, the Hellforged | Hellbeam | 400432 |
| Dragonflight | Aberrus | Rashok | Lava Wave | 403543 |
| Dragonflight | Aberrus | Scalecommander Sarkareth | Scorching Bomb | 401621 |
| Dragonflight | Aberrus | Scalecommander Sarkareth | Abyssal Breath | 410243 |
| Dragonflight | Aberrus | Scalecommander Sarkareth | Scouring Eternity | 403625 |
| Dragonflight | Vault of the Incarnates | Raszageth | Lightning Breath | 377597 |
| Dragonflight | Vault of the Incarnates | Dathea | Raging Tempest | 375424 |
| Shadowlands | Sepulcher of the First Ones | Anduin Wrynn | Wicked Star / Empowered Wicked Star | 365024 |
| Shadowlands | Sepulcher of the First Ones | Artificer Xy'mox | Genesis Rings | 363413, 364604 |
| Shadowlands | Sanctum of Domination | Painsmith Raznal | Spiked | 355526 |
| Shadowlands | Sanctum of Domination | Sylvanas Windrunner | Haunting Wave | 351870 |
| Shadowlands | Castle Nathria | Shriekwing | Echoing Screech / Echoing Sonar | 342866, 343022 |
| Shadowlands | Castle Nathria | Sire Denathrius | Massacre | 330137 |
| Shadowlands | Castle Nathria | Sludgefist | Destructive Stomp | 332318 |
| Battle for Azeroth | Ny'alotha | N'Zoth | Stupefying Glare | 318976 |
| Battle for Azeroth | Ny'alotha | Vexiona | Twilight Decimator | 307218, 307250 |
| Battle for Azeroth | Ny'alotha | Dark Inquisitor Xanesh | Torment | 311369, 311383 |
| Battle for Azeroth | Ny'alotha | The Hivemind | Acidic Aqir (Corrosion) | 313461 |
| Battle for Azeroth | Ny'alotha | Carapace of N'Zoth | Growth-Covered Tentacle | 313564 |
| Battle for Azeroth | The Eternal Palace | Lady Ashvane | Upsurge | 298054 |
| Battle for Azeroth | The Eternal Palace | Za'qul | Crushing Grasp | 292565 |
| Battle for Azeroth | The Eternal Palace | Queen Azshara | Piercing Gaze | 300785 |
| Battle for Azeroth | Battle of Dazar'alor | High Tinker Mekkatorque | Buster Cannon | 282182 |
| Battle for Azeroth | Battle of Dazar'alor | Jaina Proudmoore | Icefall | 288475 |
| Battle for Azeroth | Uldir | Zek'voz | Surging Darkness | 265451, 265452, 265454 |
| Battle for Azeroth | Uldir | Mythrax | Obliteration Beam | 274113 |
| Battle for Azeroth | Uldir | G'huun | Virulent Corruption | 273486 |
| Legion | Antorus | Portal Keeper Hasabel | Felstorm Barrage | 244001 |
| Legion | Antorus | Argus the Unmaker | Edge of Obliteration / Edge of Annihilation | 251815, 258834 |
| Legion | Antorus | Argus the Unmaker | Sweeping Scythe | 248499 |
| Legion | Tomb of Sargeras | Sisters of the Moon | Glaive Storm | 236480 |
| Legion | Tomb of Sargeras | Kil'jaeden | Demonic Obelisk | 239852 |
| Legion | The Nighthold | Tichondrius | Carrion Nightmare | 215988 |
| Legion | The Nighthold | Star Augur Etraeus | World-Devouring Force | 216909 |
| Legion | The Nighthold | Grand Magistrix Elisande | Arcanetic Ring | 208659 |
| Legion | Trial of Valor | Guarm | Trample | 227843 |
| Legion | Trial of Valor | Helya | Corrupted Breath | 228566 |
| Legion | The Emerald Nightmare | Cenarius | Nightmare Brambles | 210315, 210337, 214308 |
| Legion | The Emerald Nightmare | Xavius | Nightmare Blades | 206656 |

62 mechanic definitions across 56 bosses in 20 tracked WCL zones. Display raid names come from the existing Raid records, including combined WCL zones.

The saved `mechanic-magnets-selections-2026-10-02.html` selects 38 choices across 34 bosses. All are covered: 19 new definitions join the existing catalogue, and Sprocketmonger's two selected beams remain one combined definition. The subsequent Legion selection adds 12 definitions across 11 bosses. Previously enabled mechanics are retained. Existing keys, spell families and versions are unchanged, so this expansion does not reset their collected pulls.

Other Legion/WoD candidates remain **pending review**, not enabled: Aggramar—Wake of Flame; Goroth—Infernal Burning; Trilliax—Annihilation; Nythendra—Infested Breath; Kormrok—Fel Outpouring; Hans'gar and Franzok—Pulverized; Twin Ogron—Blaze. Sporefall, Crucible of Storms and Mists of Pandaria are excluded.

## What the numbers mean

- Damage is WCL event `amount + absorbed + max(overkill, 0)`. WCL's `amount` already excludes overkill, so do not subtract it. See the [WCL damage-event reference](https://www.warcraftlogs.com/scripting-api-docs/warcraft/interfaces/RpgLogs.DamageEvent.html). This literal event sum includes all reported absorbs and can differ from WCL's displayed damage-taken table: the archived Argus sample's table excluded a substantial portion of event-level absorbed damage. This catalogue expansion retains the existing calculation.
- Hits are landed damage events. Direct hits and periodic ticks are retained separately; misses and immunes are excluded, while fully absorbed landed hits count. A tick is **not** a distinct collision or failed dodge.
- Every player in the fight's `friendlyPlayers` roster gets a row, including zero hits. Missing or incomplete rosters fail collection instead of inventing attendance. No extra CombatantInfo or per-player requests are needed.
- Pulls and hits/pull use successfully collected attendance. They are not normalized for time alive, mechanic opportunities, role or mitigation. There is no cross-mechanic score.
- Argus's Sweeping Scythe and Helya's Corrupted Breath intentionally include normal tank hits. Collection includes every role; use the existing role filter to hide tanks. These two tables are not automatically lists of mistakes.
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

IDs and icons were checked against WCL report metadata and public spell-effect records on 2026-10-02. Bounded, read-only samples used the production collector's existing archive fallback on `suomiwow-server`; credentials stayed on the server and no collection jobs or aggregate writes were started. Archive access worked for the sampled reports, including Shriekwing and the selected Legion bosses. It still depends on report availability and the connected user's permissions.

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

### Saved-selection additions, 2026-10-02

Encounter IDs were checked through WCL `worldData.zone.encounters`, with representative difficulty-5 report metadata checked separately. Damage effects and icon filenames were cross-checked against the spell records below. The boundaries are deliberately narrower than the encounter-journal umbrella names.

| Addition | Damage-effect evidence | Counting boundary |
| --- | --- | --- |
| Ula'tek — Caustic Waves | [1292403](https://www.wowhead.com/spell=1292403/caustic-waves) | Wave impact and its damage-over-time effect; not wave casts. |
| Fallen-King Salhadaar — Umbral Beams | [1260030](https://www.wowhead.com/spell=1260030/umbral-beams) | Beam contact ticks; 1260015 is the journal/cast entry. |
| Midnight Falls — Dark Quasar | [1282469](https://www.wowhead.com/spell=1282469/dark-quasar) | Beam damage; excludes 1282470/1285561 and Rygelon's unrelated ability of the same name. |
| Plexus Sentinel — Atomize | [1219223](https://www.wowhead.com/spell=1219223/atomize) | Failed energy-wall crossings; immune events remain excluded. |
| Cauldron of Carnage — Blastburn Roarcannon | [472242](https://www.wowhead.com/spell=472242/blastburn-roarcannon) | Beam-contact ticks; 472231/472233 are setup/cast entries. |
| Rik Reverb — Resonant Echoes | [468120](https://www.wowhead.com/spell=468120/resonant-echoes) | Damage triggered by the contact debuff; excludes the 468119 aura and projectile casts. |
| Sprocketmonger — Screw Up | [1217261](https://www.wowhead.com/spell=1217261/screwed) | Screwed! bleed after touching a drill. **Exclude unavoidable marking damage 1216509.** |
| Rasha'nan — Rolling Acid | [439785](https://www.wowhead.com/spell=439785/corrosion) | Corrosion from touching the moving wave. **Exclude initial marked-target Acidic Stupor 439787**, web explosions and pools. |
| Queen Ansurek — Web Blades | [439536](https://www.wowhead.com/spell=439536/web-blades) | Projectile collision; 439299 is the cast. |
| Nymue — Impending Loom | [429785](https://www.wowhead.com/spell=429785/impending-loom) | Damage from the moving-line stun; not Verdant Matrix crossings. |
| Kazzara — Hellbeam | [400432](https://www.wowhead.com/spell=400432/hellbeam) | Damage inside the beam. **Exclude unavoidable raid-wide Hellbeam 404813** and cast 400430. |
| Sarkareth — Scorching Bomb | [401621](https://www.wowhead.com/spell=401621/scorching-bomb) | Proximity damage while the bomb is active. **Exclude raid-wide Scorching Detonation 401525**; later Burning Ground 406989 is a separate mechanic. |
| Sarkareth — Abyssal Breath | [410243](https://www.wowhead.com/spell=410243/abyssal-breath) | Flyover impact/knockback. **Exclude residue 404499**, which players intentionally use for Oblivion stacks. 404456 is the movement cast. |
| Shriekwing — bouncing discs | [342866](https://www.wowhead.com/spell=342866/echoing-screech), [343022](https://www.wowhead.com/spell=343022/echoing-sonar) | Disc damage in both phases; excludes casts 342863/329362, Descent and Bloodlight. |
| Xanesh — Torment | [311369](https://www.wowhead.com/spell=311369/torment), [311383](https://www.wowhead.com/spell=311383/torment) | Both damaging floor-sector variants, not unrelated Torment abilities. |
| Hivemind — Acidic Aqir | [313461](https://www.wowhead.com/spell=313461/corrosion) | Corrosion ticks after contact with rolling bugs; excludes egg hatching and acid pools. |
| Carapace — Growth-Covered Tentacle | [313564](https://www.wowhead.com/spell=313564/growth-covered-tentacle) | Large tentacle landing impact; excludes summon 307131, tank Mandible Slam and phase-three Thrashing Tentacle. |
| Queen Azshara — Piercing Gaze | [300785](https://www.wowhead.com/spell=300785/piercing-gaze) | Beam damage; 300768 is the cast. |
| Mythrax — Obliteration Beam | [274113](https://www.wowhead.com/spell=274113/obliteration-beam) | Beam-contact ticks; excludes casts 272115/279887 and the separate Obliteration Blast. |

Representative Mythic metadata: [Ula'tek](https://www.warcraftlogs.com/reports/fvqyDzgPW8xZQmwR#fight=61), [Fallen-King](https://www.warcraftlogs.com/reports/k2YL7RG89c3MTWnF#fight=25), [Plexus](https://www.warcraftlogs.com/reports/CzjWarTyb1JRPNHY#fight=8), [Undermine](https://www.warcraftlogs.com/reports/WVxhXzNmTb4pGkQK), [Nerub'ar Palace](https://www.warcraftlogs.com/reports/WgYbA1r7fXdZKtPF), [Amirdrassil/Aberrus](https://www.warcraftlogs.com/reports/TzYwKfxJFym2ba3H), [Sarkareth impact](https://www.warcraftlogs.com/reports/nmaVrqftXK8T4BpJ#fight=48), [Shriekwing](https://www.warcraftlogs.com/reports/RLbZTArYPgCzm7yt#fight=5), [Ny'alotha](https://www.warcraftlogs.com/reports/txHLdN2JZ7YQMC6r), [Azshara](https://www.warcraftlogs.com/reports/zYHW6PdGw7fMqxta#fight=12), [Mythrax](https://www.warcraftlogs.com/reports/X4JvthyFMbW2Krcj#fight=35). A clean sample can omit an avoidable damage ID; absence is not evidence for substituting a cast ID.

Live filtered collector samples returned 71 landed events for Ula'tek (14 direct / 57 periodic), 52 for Plexus and 13 for Rik. Through the archive fallback, Shriekwing returned 1, Xanesh 7, Azshara 1 and Mythrax 62. Zero-hit attendees remained present. Clean Hivemind and Carapace samples returned zeroes; archived progression damage tables then confirmed Hivemind's 313461 with **578 ticks** ([report, fights 1–9 and 11](https://www.warcraftlogs.com/reports/1Rgx8cCHZz2b49rM)) and Carapace's 313564 with **33 hits** ([report, fights 34–43](https://www.warcraftlogs.com/reports/KmqMwLcTZ3aBDb7v)). These are sample validations, not a production backfill.

### Legion additions, 2026-10-02

The original Legion zones and encounter IDs were confirmed against stored Mythic fights. Every row below was exercised through the existing collector and archive fallback, without writing aggregates. Most samples use one kill; Guarm and Star Augur include stored wipes because their clean kills had no landed hits. Counts below exclude misses/immunes and include periodic damage events.

| Boss / mechanic | Damage-effect evidence | Mythic collector sample | Boundary |
| --- | --- | --- | --- |
| Cenarius — Nightmare Brambles | [210315](https://www.wowhead.com/spell=210315/nightmare-brambles), [210337](https://www.wowhead.com/spell=210337/nightmare-brambles), [214308](https://www.wowhead.com/spell=214308/nightmare-brambles) | [Fight 24](https://www.warcraftlogs.com/reports/x6brhaVw9LgXn1mA#fight=24): 106 events (78 direct / 28 periodic) | Living bramble contact, root impact and its DoT. Immunity-based clearing does not count immune events; absorbed hits still count. |
| Xavius — Nightmare Blades | [206656](https://www.wowhead.com/spell=206656/nightmare-blades) | [Fight 21](https://www.warcraftlogs.com/reports/pFkKaQ7YCzRbMxHZ#fight=21): 39 hits | Blade collision, excluding target marker 211802. |
| Guarm — Trample | [227843](https://www.wowhead.com/spell=227843/trample) | [Fights 53–62](https://www.warcraftlogs.com/reports/Rk1hdCFY68n3jraz): 68 hits | Charge collision only. **Exclude unavoidable Headlong Charge 228344** and Berserk Trample 232197/232224. |
| Helya — Corrupted Breath | [228566](https://www.wowhead.com/spell=228566/corrupted-breath) | [Fight 14](https://www.warcraftlogs.com/reports/B2xNGLAPyKnDf1Z3#fight=14): 6 hits | Includes normal tank targets, per selection. Excludes cast 228565, axion launcher 232418 and other bosses' Corrupted Breath. |
| Tichondrius — Carrion Nightmare | [215988](https://www.wowhead.com/spell=215988/carrion-nightmare) | [Fight 45](https://www.warcraftlogs.com/reports/RKZTFXAYCLMy7qc4#fight=45): 5 hits | Intermission line damage; excludes unrelated Carrion Plague and Seeker Swarm. |
| Star Augur — World-Devouring Force | [216909](https://www.wowhead.com/spell=216909/world-devouring-force) | [Fights 1–7](https://www.warcraftlogs.com/reports/CtrynRvahBj6xfqk): 1 hit | Eye beam only; excludes the summoned Remnant's attacks and dummy aura 217039. |
| Elisande — Arcanetic Ring | [208659](https://www.wowhead.com/spell=208659/arcanetic-ring) | [Fight 8](https://www.warcraftlogs.com/reports/Kr7pPyaY9fRAZjnJ#fight=8): 12 ticks | Ring contact damage, excluding the many similarly named casts/area triggers. |
| Sisters of the Moon — Glaive Storm | [236480](https://www.wowhead.com/spell=236480/glaive-storm) | [Fight 15](https://www.warcraftlogs.com/reports/Nd7mw8bvgL9q4fn6#fight=15): 23 hits | Shared damage from the splitting glaives; excludes cast/area triggers 239379/239383/239386 and player trinket Umbral Glaive Storm. |
| Kil'jaeden — Demonic Obelisk | [239852](https://www.wowhead.com/spell=239852/demonic-obelisk) | [Fight 13](https://www.warcraftlogs.com/reports/tThpXJM1PR8F73cG#fight=13): 7 hits | Cross-shaped blast damage; 239785 is setup. |
| Hasabel — Felstorm Barrage | [244001](https://www.wowhead.com/spell=244001/felstorm-barrage) | [Fight 26](https://www.warcraftlogs.com/reports/a9HjcQWZYB7kNpfL#fight=26): 6 hits | Beam damage and knockback; excludes setup 244000 and area trigger 244004. |
| Argus — Edge of Obliteration / Annihilation | [251815](https://www.wowhead.com/spell=251815/edge-of-obliteration), [258834](https://www.wowhead.com/spell=258834/edge-of-annihilation) | [Fight 4](https://www.warcraftlogs.com/reports/d7tWCyDQz8TvxV2H#fight=4): 12 ticks | Both blade-phase bleeds grouped; excludes summon 255826 and tank scythes. |
| Argus — Sweeping Scythe | [248499](https://www.wowhead.com/spell=248499/sweeping-scythe) | [Fight 4](https://www.warcraftlogs.com/reports/d7tWCyDQz8TvxV2H#fight=4): 29 hits | Includes normal tank targets, per selection. Soulrending Scythe 258838 remains a separate, unselected mechanic. |

Archive access was verified using the existing server connection. All sampled Legion calls completed in one event page after the client-to-user fallback. Research respected shared budget checks and stopped well below the configured limits; it did not bypass production pauses or start a backfill.

For this catalogue expansion, deploy the API and worker together, then select the new mechanics or all mechanics in the existing admin collection panel. Leave **Retry failed and inaccessible pulls** unchecked for a normal initial run. Completed current-version pulls are reused. No migration, full report rediscovery, new dependency or new environment setting is needed; the nightly job also picks up the enabled additions. Completion overnight depends on available WCL budget, other queued work and archive access; saved progress survives pauses and restarts.

## Verification

For the 2026-10-02 expansion, `npm run build` passed and 46 focused tests passed across `avoidable-damage`, `admin-avoidable-damage`, `mechanic-cache`, `mechanic-options` and `mechanic-leaderboard`. Coverage includes full-catalogue admin selection, same-boss mechanics, spell-family exclusions, archive fallback, quota yielding and cached public filtering. A catalogue comparison confirmed all 31 existing definitions unchanged. The MongoDB integration suite was not run because the local test database was unavailable; the read-only archived samples above do not replace that suite.

```powershell
# Unit and WCL protocol tests (no network/credentials required):
node --test -r ts-node/register test/avoidable-damage.test.ts test/admin-avoidable-damage.test.ts
# Optional isolated MongoDB integration test; requires a local MongoDB instance:
$env:MECHANIC_TEST_MONGO_URI = 'mongodb://127.0.0.1:27028/wow_mechanic_test_integration'
node --test -r ts-node/register test/avoidable-damage.integration.test.ts
```

The integration tests accept only a localhost database whose name begins `wow_mechanic_test_`, and drop only that test database. They check real aggregation pipelines, deduplication, roster-based zeroes, filtering, pagination, version changes, retry idempotency, privacy, exclusions, concurrent selection changes, pause/removal safety, scoped retries and recovery after quota exhaustion. Admin HTTP tests cover authentication, authorization and strict selection validation. WCL tests cover filtered pagination, archive fallback and HTTP 429 yielding.
