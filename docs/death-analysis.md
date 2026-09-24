# Character death analysis

Open `/death-analysis` from Characters or select a boss icon in a character profile's Mechanics tab. Character, class, region, raid, boss, difficulty, outcome, and pagination are encoded in the URL.

The page uses stored data only. `GET /api/characters/:realm/:name/deaths` accepts `class`, `region`, `zoneId`, `encounterId`, `difficulty` (3/4/5), `outcome` (all/kills/wipes), and `page`. It returns full-selection aggregates and 50 individual deaths per page.

Report appearances resolve historical names and linked character identities using the profile's existing identity helpers. A fight roster, death, or ranking for that specific fight must confirm participation; appearing somewhere in a report is insufficient. Only fights with fetched death data contribute deaths or survival. Unconfirmed report pulls and missing death-data coverage are shown separately.

Timing uses elapsed fight time. Death order counts unique roster members, ties share an order, and repeated deaths retain the player's first-death order. Missing or incomplete rosters produce unknown order. Raw analysis includes all roles, resets, raid-wide wipes, and resurrection deaths; it does not reproduce the mechanics score's exclusions.

Death records currently retain only `name`, `server`, `timestamp`, and `deathTime` (plus MongoDB's subdocument ID). A read-only production sample on 2026-09-24 confirmed these fields in 3,790 deaths across 200 recent fights. Killing abilities, attackers, damage, healing, and pre-death health are not retained. Investigate links open the original fight's Warcraft Logs deaths view. Adding local cause-of-death analysis would require collecting and storing additional combat-event data and backfilling reports where available.
