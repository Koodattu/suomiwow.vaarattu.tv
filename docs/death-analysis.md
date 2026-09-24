# Character death analysis

Open `/death-analysis` from Characters or select a boss icon in a character profile's Mechanics tab. Character, class, region, raid, boss, difficulty, outcome, and pagination are encoded in the URL.

The page uses stored data only. `GET /api/characters/:realm/:name/deaths` accepts `class`, `region`, `zoneId`, `encounterId`, `difficulty` (3/4/5), `outcome` (all/kills/wipes), and `page`. It returns full-selection aggregates and 50 individual deaths per page.

The default Timeline view uses the separate, unpaginated `timeline` response containing every confirmed pull in the selection: duration, outcome, completeness, character deaths, known other-player death times, and phase transitions. Records filters do not truncate this dataset. Its session, focus, time scale, selected interval, pull, and death are stored in the URL. Session/focus/interval controls affect the timeline; the Records view retains its own event filters. The inspector never treats an unfetched death list as survival, and only shows other deaths for known roster members.

See [interface decisions](death-analysis/DECISIONS.md) for the design and acceptance scenarios.

The individual-deaths table also accepts `orderFilter` (all/first/firstThree/later/unknown), `timingFilter` (all or a zero-based quarter 0–3), `phaseFilter` (all/unknown/phase:NAME), `sortBy` (date/isKill/deathTime/deathPercent/duration/order/phase), and `sortDirection` (asc/desc). Filtering and sorting happen before pagination. Summary totals and phase options cover the full selection; pagination counts only matching deaths. Unknown sort values remain last in either direction. Table changes reset pagination, and changing the character or encounter selection clears the phase filter.

Report appearances resolve historical names and linked character identities using the profile's existing identity helpers. A fight roster, death, or ranking for that specific fight must confirm participation; appearing somewhere in a report is insufficient. Only fights with fetched death data contribute deaths or survival. Unconfirmed report pulls and missing death-data coverage are shown separately.

Timing uses elapsed fight time. Death order counts unique roster members, ties share an order, and repeated deaths retain the player's first-death order. Missing or incomplete rosters produce unknown order. Raw analysis includes all roles, resets, raid-wide wipes, and resurrection deaths; it does not reproduce the mechanics score's exclusions.

Death records currently retain only `name`, `server`, `timestamp`, and `deathTime` (plus MongoDB's subdocument ID). A read-only production sample on 2026-09-24 confirmed these fields in 3,790 deaths across 200 recent fights. Killing abilities, attackers, damage, healing, and pre-death health are not retained. Investigate links open the original fight's Warcraft Logs deaths view. Adding local cause-of-death analysis would require collecting and storing additional combat-event data and backfilling reports where available.
