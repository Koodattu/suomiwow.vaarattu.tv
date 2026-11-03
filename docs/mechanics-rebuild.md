# Mechanics scoring and rebuilding

## Character-profile boss roles

The character profile now has a separate `profileBossScores` array on each rebuilt
overall mechanics record. It retains boss results for every known role and
normalizes that population separately. The existing raid-dominant role, `bossScores`,
leaderboard scores, tier lists, CCG eligibility and score version remain unchanged.
Profile parses must match the played role and its metric; the legacy off-role
damage-parse fallback is retained only for the existing scoring consumers.

The profile's **All / DPS / HPS** control selects one role per boss using recorded
pull counts, including wipes and likely resets (resets still do not contribute to
the mechanics evaluation). Equal counts prefer DPS, then healer, then tank,
independently of score quality. DPS includes tanks but never pools their mechanics
with damage-dealer mechanics. All three Performance tabs use the same selection.
Parse-only boss results have zero known pulls and no mechanics/combined score.
Unknown hybrid roles are still included only when role evidence is unambiguous.

Profile Rankings totals sum the selected parses' All Star points. Mechanics
summaries average the available selected boss percentiles; Combined summaries
average the available selected combined boss scores, without treating missing
values as zero. These display summaries are not inputs to tier lists or CCG.

No database migration or index change is required. The existing nightly mechanics
job populates the optional field for **current raids**, using already stored data.
Use **Admin → Manual Actions → All Raids → Calculate Mechanics Scores** to populate
historical raids as well. The existing 90% coverage gate applies. Until a raid is
rebuilt, the profile retains its previous display. No full-history/WCL refresh or
CCG snapshot/publication is required just to enable this display.

Score version 5 aggregates Mythic survival by character, boss, and role. Specializations within the same role share mechanics; tank, DPS, and healer pulls stay separate. The character's most-played raid role is selected by summing its known-role pulls across specs. A representative spec within that role remains available for display.

Each boss retains the spec of its selected performance parse. Overall spec filters select the character's representative spec without recalculating mechanics from a subset of bosses.

Roles use the existing class/spec mapping, Blizzard spec IDs, and stored combatant roles. A class with only one role can be classified without a spec. Older hybrid-class pulls with no role are included only when the raid's available role evidence is unambiguous.

Fetched, complete fight rosters and death events supply the boss population, including bosses without a kill parse. Survival scores and percentiles include progression bosses. Performance uses the best available role-compatible parse per boss across specs and averages only bosses with a parse. Missing performance and combined boss scores remain null, not zero. A character with no role-compatible kill parses can have a mechanics score but cannot satisfy the existing complete-score requirement for a CCG card.

Bosses retain equal weight in the overall survival score. Existing death timing, early deaths, raid-wide wipe handling, likely-reset exclusions from evaluated pulls, and the 90% fight-detail coverage requirement are unchanged.

## History

The original mechanics implementation (`d761144b`, 2026-06-16) accumulated survival by character and boss without a combatant-spec gate. The dominant-spec restriction was introduced in `b16e1168` on 2026-07-30; `43237155` on 2026-08-02 repaired missing-spec handling but retained the selected-spec output restriction. The omission of unkilled bosses is older: the original builder already created boss entries from qualifying kill parses and summed those entries for overall pulls. Version 5 fixes both the later spec restriction and that original parse-dependent boss population.

## After deployment

1. Open **Admin → Manual Actions**, select **All Raids**, then click **Calculate Mechanics Scores**. To validate the current case first, select **The Venomous Abyss** (zone 53) instead.
2. Wait for **Rebuild Character Mechanics Leaderboard** in Tasks. Check the per-zone results: a zone marked `skipped` has retained its old data because coverage is insufficient. Successful zones automatically rebuild their character tier lists and invalidate the related caches. A separate **Rebuild Character Tier Lists** action is unnecessary.
3. Verify the character checker and mechanics leaderboard. Yolobolt's inspected raid data contains 111 Mythic pulls, including 39 on Sszorak. His three Warlock specs are all DPS.
4. To publish updated cards immediately, open **Admin → CCG → Snapshot preview**. Optionally use **Calculate preview**, then **Create snapshots now** and confirm **Create snapshots**. Wait for **CCG Weekly Raid Snapshot** to complete.
5. Click **Publish cards now**, confirm **Publish cards**, and wait for **CCG Weekly Raid Publication**. Snapshot/publication actions process all enabled Current and Legacy raid sets, not just the raid chosen for the mechanics rebuild. Publication also rebuilds active pack pools.
6. If collector leaderboard totals should be refreshed immediately, use **CCG → Leaderboard → Run full rebuild** after publication.

The mechanics rebuild uses stored data without WCL requests. A full-history refresh is only needed if required fight or ranking data is missing; it is not necessary merely to apply the new scoring logic. Mechanics and tier-list rebuilding do not rewrite published CCG cards. Their normal snapshot/publication cycle can be used instead of steps 4–6.

The score version change from 4 to 5 makes existing eligible cards candidates for a new snapshot even if their rarity is unchanged. Review the snapshot preview before publishing; this update can produce new versions across all rebuilt, enabled raid sets.

Authenticated admin endpoints corresponding to the core actions:

| Action | Request |
| --- | --- |
| Rebuild all mechanics and successful zones' tier lists | `POST /api/admin/trigger/rebuild-character-mechanics-leaderboards` with `{"scope":"all"}` |
| Rebuild only The Venomous Abyss | Same endpoint with `{"raidId":53}` |
| Create CCG snapshots | `POST /api/admin/ccg/snapshots` |
| Publish CCG cards | `POST /api/admin/ccg/publications` |
| Refresh collector leaderboard | `POST /api/admin/ccg/leaderboard/full` |
