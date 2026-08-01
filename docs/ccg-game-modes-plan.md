# SuomiWoW CCG Game Modes Plan

## Status

Planning document only. No rules, names, rewards, data models, or rollout dates in this document are locked.

This document explores a post-collection gameplay layer for SuomiWoW CCG. It does not replace the existing [`ccg-implementation-plan.md`](./ccg-implementation-plan.md), whose initial release deliberately excludes card battles and deck building. The existing pack, immutable snapshot, collection, finish, sharing, and leaderboard behavior remains the foundation.

## Executive recommendation

Do not turn SuomiWoW into a conventional card battler in which character cards attack one another.

Build a **raid-leading and party-management game** in which:

- Owned cards are the player's roster.
- The player assembles WoW-shaped tank, healer, and damage compositions.
- Encounters test throughput, execution, utility coverage, and tactical choices.
- A readable simulation produces pulls, deaths, wipes, kills, and combat reports.
- Collection depth creates more strategic options rather than permanent card power.

The working title for the shared game is **SuomiWoW Raid Director**.

The recommended product sequence is:

1. Prove the encounter engine with a five-card dungeon mode.
2. Expand the same engine into twenty-card raid progression.
3. Use parallel boss races for asynchronous PvP.
4. Add a stats-free Transmog Ring as a social collection mode.
5. Turn the raid engine into a live Twitch crowd-raid event.

The strongest first playable product is **Mythic+ Expedition**. The strongest long-term identity is **Raid Night**.

## Why this fits SuomiWoW

SuomiWoW's advantage is not card-game mechanics by themselves. Its advantage is that each card is a recognizable, historically grounded Finnish WoW character.

The existing card contract already contains:

- An immutable character snapshot from one raid tier.
- Class, specialization, and tank, healer, or damage role.
- Normalized DPS or HPS performance.
- Mechanics and survival performance.
- A combined performance-mechanics score.
- A raid-matched Mythic+ score when historical data is available.
- Guild, realm, tier grade, raid set, artwork, and snapshot history.
- Cosmetic finishes, alternative artwork, quips, and quantities.

The current player loop is principally:

`Open packs -> collect cards and finishes -> complete binders -> showcase favorites -> climb the collection leaderboard`

A roster game adds a second loop without invalidating the first:

`Collect options -> build a composition -> read an encounter -> assign mechanics -> simulate a pull -> adjust -> progress`

This supports the product principles in [`PRODUCT.md`](../PRODUCT.md): community recognition, transparent scoring, meaningful spectacle, preserved history, and no pay-to-progress pressure.

## WoW design vocabulary

The proposed modes should feel recognizably WoW-shaped without attempting to reproduce the live game's combat system exactly.

Relevant structures include:

- Fixed twenty-player Mythic raids, which allow encounters to be designed around a known roster size.
- Five-player dungeon parties made from tank, healer, and damage roles.
- Boss mechanics such as tank swaps, interrupts, dispels, soaks, spreads, stacks, adds, movement, healing checks, and enrages.
- Role-specific responsibilities such as protecting allies, timing cooldowns, interrupting casts, avoiding hazards, and sustaining the party.
- Raid progression through repeated pulls, incremental learning, composition changes, and eventually a kill.
- Mythic+ routing, pull-size decisions, timers, death penalties, affixes, and shared seasonal leaderboards.
- Social collection play such as Trial of Style, where contestants present appearances and other players vote.

Useful official references:

- [Blizzard: fixed-size twenty-player Mythic raiding](https://worldofwarcraft.blizzard.com/en-us/news/13942448/coffee-with-the-devs-raiding-azeroth-part-3-warlords-of-draenor)
- [Blizzard: five-player Follower Dungeons and party roles](https://worldofwarcraft.blizzard.com/en-us/news/24054790)
- [Blizzard: role challenges in Proving Grounds](https://worldofwarcraft.blizzard.com/en-us/news/10405142)
- [Blizzard: six-player Trial of Style voting format](https://worldofwarcraft.blizzard.com/en-us/news/23841480)
- [Blizzard: March on Quel'Danas raid overview](https://worldofwarcraft.blizzard.com/en-us/news/24264416/resumen-y-cronograma-de-las-bandas-de-midnight)

## Product goals

- Give owned cards an ongoing purpose beyond binder completion and collection score.
- Make the game feel like leading a WoW group rather than playing a generic fantasy card game.
- Make role, specialization, performance, and mechanics scores visibly meaningful.
- Reward roster construction and tactical decisions, not only owning the highest grades.
- Support Current and Legacy cards without making old cards inherently obsolete.
- Make wipes understandable enough that the player knows what to change.
- Support short solo sessions first and social or competitive play later.
- Reuse one versioned simulation engine across dungeons, raids, PvP races, and live events.
- Keep finishes, alternative artwork, and rare presentations exciting without making them stronger.
- Preserve the free, non-tradable, and non-commercial product position.

## Non-goals

- A Hearthstone-style mana curve, hand, spell deck, or face-damage game.
- Directly reproducing every live WoW spell, talent, balance patch, or encounter script.
- Turning finish rarity, duplicate quantity, or alternative artwork into combat power.
- Making raw item level comparable across expansions.
- Requiring a perfectly complete collection before a player can form a party.
- Real-time competitive matchmaking in the first version.
- Trading, card lending that changes ownership, a marketplace, or purchasable power.
- Publicly labeling real community members as bad players because a simulation failed.
- Replacing the existing collection leaderboard with a combat-only ranking.

## Core design principles

### The player is the raid leader

The player's interesting decisions are composition, assignments, route, cooldown timing, and risk. The cards execute the plan.

An autobattler presentation is appropriate, but the game must not become a passive comparison of twenty power totals. The player should make at least one meaningful decision before each encounter and receive actionable information afterward.

### Collection depth means options

A larger collection can provide more classes, specs, roles, historical snapshots, and utility combinations. It must not create an insurmountable numerical advantage.

Competitive modes need one or more of:

- Roster budgets.
- Strength-band matchmaking.
- Shared encounter seeds.
- Encounter-specific utility requirements.
- Limited identity duplication.
- Challenge rules that make lower-grade cards useful.

### Failure must be explainable

Bad result:

> Raid power was 18,420. Required power was 18,700. Defeat.

Good result:

> The second Void Eruption was not interrupted. Three damage dealers died, leaving the boss at 7.8% when the enrage began.

Every pull should show:

- The phase reached.
- Boss health remaining.
- Deaths and battle resurrections.
- Passed and failed mechanics.
- Throughput and healing checks.
- Major cooldown use.
- One or two suggested adjustments.

### Historical data remains historical

Card values remain the values captured at publication. Game-rule changes are versioned separately and never rewrite published cards.

### Real people remain the emotional center

Cards can have dramatic entrances, quips, clutch saves, and memorable kills. Failure language should describe the roster or assignment instead of humiliating an individual character.

## Shared encounter engine

All combat-oriented modes should use one deterministic, server-authoritative engine.

### Basic loop

1. The player selects an owned-card roster.
2. The server validates ownership, snapshots, identity limits, roles, and mode rules.
3. The encounter exposes its known mechanic profile.
4. The player chooses assignments and tactical options.
5. The server runs a seeded simulation using versioned rules.
6. The immutable result is stored before the reveal animation begins.
7. The client presents the pull as a timeline and combat report.
8. The player changes the plan and pulls again, or advances after a kill.

### Encounter structure

An encounter consists of phases. Each phase may contain one or more checks:

- **Damage check:** total relevant damage throughput.
- **Healing check:** healer throughput plus defensive support.
- **Tank check:** tank mechanics, mitigation utility, and healer support.
- **Execution check:** mechanics scores of assigned or randomly targeted cards.
- **Interrupt check:** sufficient interrupt coverage and assignment.
- **Dispel check:** correct dispel type and enough execution.
- **Soak check:** correct number of assigned cards, weighted by mechanics.
- **Movement check:** mechanics plus mobility utility.
- **Add check:** burst or sustained damage, target assignment, and control.
- **Composition check:** melee/ranged balance or a required utility category.
- **Enrage check:** remaining boss health compared with available final-phase throughput.

Checks should be data-driven rather than implemented as one-off code branches for every boss.

### Player decisions

Keep individual encounters legible by limiting the decision count. Examples:

- Assign four soakers.
- Select two interrupt groups.
- Choose the dispeller.
- Choose the tank order.
- Choose which phase receives Heroism.
- Spend a raid defensive now or save it.
- Choose safe, standard, or aggressive strategy.

An optional Auto-Assign action can create a valid starting plan. Manual assignment should provide optimization, not be mandatory busywork.

### Determinism and randomness

The simulation should be mostly deterministic with small seeded variance.

- Replaying the exact same roster, assignments, rules version, and seed returns the exact same result.
- Changing an assignment or card can change the result.
- Weekly competitions use a shared seed.
- Private practice may generate a new seed per pull.
- Randomness must not dominate a carefully built roster.

### Deaths and cascading failure

A failed mechanic can:

- Deal raid damage.
- Kill one or more cards.
- Apply a temporary debuff.
- Consume a defensive or battle resurrection.
- Reduce later throughput.
- Accelerate an enrage.

This creates recognizable WoW pull narratives instead of a single success roll.

### Combat report

The result contract should be sufficient to reconstruct the same replay without rerunning the simulation. Conceptually it needs:

- Rules and encounter versions.
- Seed.
- Submitted roster and assignments.
- Phase and event timeline.
- Check inputs and outcomes.
- Death and resurrection events.
- Boss health timeline.
- Final score, time, or remaining health.
- Human-readable failure reasons.

## Card stat rules

### Recommended mapping

| Existing card property | Gameplay meaning |
| --- | --- |
| Role | Formation slot and encounter responsibilities |
| DPS/HPS performance | Throughput in damage or healing checks |
| Mechanics | Execution, survival, and assignment success |
| Combined | Roster preview, recommendation, and auto-fill only |
| Mythic+ | Dungeon pace or adaptability after historical normalization |
| Class and specialization | Versioned utility tags |
| Tier grade | Roster cost, challenge condition, or matchmaking band |
| Raid set | Historical identity, themed bonuses, and challenge eligibility |
| Guild | Social filters and optional low-power cohesion bonuses |
| Finish and alternative art | Visual presentation only |
| Duplicate quantity | Collection display only |
| Item level | Detail display only; never cross-expansion power |

### Performance and mechanics

Performance and mechanics are the two primary combat axes.

- High performance, lower mechanics: strong on stationary throughput checks but risky when assigned difficult mechanics.
- Lower performance, high mechanics: reliable soaker, interrupter, or progression card.
- High in both: premium all-rounder with a high roster cost in competitive modes.
- Lower in both: still useful for cheap roster cost, utility coverage, themes, or challenge objectives.

The existing Combined score already weights Performance and Mechanics equally. It must not also be added to combat contributions, because that would count the same inputs twice.

### Mythic+ normalization

Raw Mythic+ scores cannot be compared directly between expansions or seasons.

Before Mythic+ affects gameplay:

1. Group cards by the exact season mapped to their raid set.
2. Convert positive scores into a percentile or stable 0-100 normalized band within that season.
3. Version the normalization algorithm.
4. Treat unavailable historical scores as neutral, or disable the M+ contribution for all cards in that ruleset.

Missing Mythic+ data must never make early Legacy sets categorically worse.

### Class and specialization utility

The initial engine should derive a small, deliberately game-like utility profile from the snapshotted class and specialization.

Possible tags:

- Short interrupt.
- Ranged interrupt.
- Magic dispel.
- Curse, poison, or disease removal.
- Battle resurrection.
- Heroism effect.
- Immunity.
- High mobility.
- Raid defensive.
- External tank defensive.
- Crowd control.
- Melee or ranged.
- Burst or sustained damage profile.

These tags should be:

- Versioned independently from the card.
- Stable for the duration of a game season.
- Transparent in the roster builder.
- Inspired by WoW class identity without tracking every live patch change.

The first version should not claim that an individual character historically performed a specific number of interrupts or dispels unless that information is later captured and published as immutable data.

### Tier grade and roster budgets

Tier grade already summarizes historical strength. It should not grant another hidden combat multiplier.

In unrestricted solo PvE, players may use any owned roster.

In competitive modes, grade can become roster cost. An illustrative scale is:

| Grade | Illustrative cost |
| --- | ---: |
| S | 7 |
| A | 6 |
| B | 5 |
| C | 4 |
| D | 3 |
| E | 2 |
| F | 1 |

The actual budget must be simulated against real card distributions before being locked.

### Snapshot identity

A roster should normally allow only one version of the same real character identity. The player chooses which owned raid-tier snapshot to use.

This prevents a roster from being filled with several historical versions of one high-performing character while making snapshot selection strategically meaningful.

Special time-anomaly events may deliberately lift this rule.

### Community cards

Community cards intentionally have no verified performance metrics. Do not synthesize fake DPS, HPS, or mechanics scores from their admin-selected rarity.

Recommended uses:

- One optional **Captain** or **Mascot** slot outside the active combat formation.
- Small tactical effects such as one assignment reroll or a morale recovery.
- Quips and special encounter presentation.
- Full participation in Transmog Ring and other stats-free modes.
- Special community-only challenges.

An alternate casual-only rule could provide standardized neutral combat stats, but such values must be visibly labeled as mode rules rather than historical performance.

### Finishes, artwork, and duplicates

These remain cosmetic.

They may affect:

- Card entrance animation.
- Combat-board material effects.
- Victory presentation.
- Stream overlay prominence.
- Transmog Ring selection.
- Share-card and result imagery.

They must not affect:

- Damage.
- Healing.
- Survival.
- Utility.
- Matchmaking.
- Simulation variance.

## New-player and incomplete-roster handling

Forty initial packs do not guarantee every required role, especially for a twenty-player raid.

Every PvE mode needs free, non-collectible **PUG mercenaries**:

- Available only when the player lacks a required role or minimum roster size.
- Fixed neutral stats and basic utility.
- Visually distinct from collectible community characters.
- Never added to the collection.
- Sufficient to play Story or Normal difficulty.
- Weaker than an intentional owned-card roster, but not frustratingly bad.

Possible additional aids:

- Auto-fill from owned cards.
- Starter role challenges that guarantee no card rewards but teach composition.
- A practice sandbox with unrestricted sample cards.
- Later cooperative contribution from friends without transferring ownership.

## Mode 1: Mythic+ Expedition

### Recommendation

Build this first.

It uses only five active cards, produces short sessions, exercises every important engine concept, and has a natural shared-seed leaderboard.

### Formation

- One tank.
- One healer.
- Three damage dealers.

### Run structure

An expedition lasts roughly eight to fifteen minutes and contains:

- A route choice.
- Several trash pulls.
- Two or three bosses.
- One or more rest or reward nodes.
- A timer and death penalty.
- Temporary run-only effects.

The route can branch between safer and riskier packs. The player sees enough information to make a decision without requiring external dungeon-guide knowledge.

### Pull decisions

Examples:

- Small, standard, or large pull.
- Interrupt order.
- Primary crowd-control target.
- Defensive cooldown use.
- Skip resource use.
- Heroism timing.
- Safe route versus score route.

### Affixes

Start with a small original set inspired by WoW's dungeon pressures:

- Bosses gain additional health and damage.
- Trash packs gain additional health and damage.
- Failed interrupts deal party-wide damage.
- Deaths empower the remaining pack.
- Periodic hazards test movement and mechanics.
- Healing becomes less effective until a mechanic is completed.

Avoid copying the full live affix schedule. The CCG rules should be stable and understandable.

### Temporary run effects

Examples:

- The first interrupt each pull immediately refreshes.
- A successful large pull grants tank mechanics for the next encounter.
- The healer's first raid-wide cooldown is stronger.
- Battle resurrection does not add a time penalty once.
- Ranged damage increases against adds.

These disappear when the expedition ends and never alter the owned card.

### Scoring

Possible result order:

1. Highest completed key level.
2. Timed completion before untimed completion.
3. Fastest time.
4. Fewest deaths.
5. Earliest submitted result as the final tie-breaker.

Everyone on a weekly leaderboard uses the same dungeon, modifiers, and seed.

### Rewards

Prefer:

- Profile titles.
- Weekly result badges.
- Binder or showcase decorations.
- Shareable party-result images.
- Cosmetic board themes.

If packs are awarded, keep them modest, capped, and participation-oriented rather than making high-ranked players collect stronger rosters faster.

### First-version acceptance criteria

- A collector can form a legal 1/1/3 party using owned cards and mercenaries.
- Performance and mechanics visibly influence different checks.
- At least three utility tags affect outcomes.
- The same seed and submission reproduce the same result.
- The result identifies why the party succeeded or failed.
- The player can make a meaningful roster or strategy change and observe a changed result.
- A weekly leaderboard compares identical encounter conditions.

## Mode 2: Raid Night

### Recommendation

This should become the flagship mode after the dungeon engine proves fun.

### Roster and active formation

- Twenty-five-card lockout roster.
- Twenty active cards per boss.
- Five-card bench between bosses.
- Default active formation: two tanks, four healers, fourteen damage dealers.

Boss rules may encourage:

- Three or five healers.
- A third tank.
- More ranged or melee.
- Additional dispels, immunities, mobility, interrupts, or battle resurrections.
- Different individual assignments without changing role counts.

Composition changes should be a major part of progression.

### Raid structure

- A raid contains multiple bosses in a fixed order or partially branching wings.
- A lockout has a finite number of practice pulls, raid energy, or real-time attempts.
- Earlier bosses teach mechanics used in more complex combinations later.
- The roster can change between bosses but not freely during a pull.
- Kills create permanent lockout progress until the reset.

Avoid harsh daily energy systems. If attempts are limited, the limit should create an event cadence, not purchasing or retention pressure.

### Progression loop

The desired emotional sequence is:

`Pull -> wipe -> understand -> adjust -> reach a new phase -> near kill -> kill`

A player should be able to improve without opening another pack by:

- Changing assignments.
- Moving Heroism.
- Swapping utility.
- Adding or removing a healer.
- Benching a fragile high-output card for a reliable mechanics card.
- Selecting a safer strategy.

### Illustrative fictional boss

The following is a CCG design example, not a claim about an actual WoW encounter.

**Midnight Falls**

1. **Phase one: Fractured Light**
   - Tank swap every two events.
   - Four assigned soakers.
   - Moderate raid damage.
2. **Phase two: Void Choir**
   - Two interrupt groups alternate.
   - One magic dispeller handles a priority debuff.
   - Ranged movement check targets five cards.
3. **Phase three: Sunwell Collapse**
   - Sustained healing check.
   - Increasing execution pressure.
   - Hard enrage rewards saving Heroism and offensive cooldowns.

A high-output raid might reach phase three quickly but collapse to movement. A safer raid might survive but fail the enrage. The player chooses the tradeoff.

### Difficulty

Possible difficulties:

- **Story:** mercenaries allowed, generous checks, teaches assignments.
- **Normal:** complete owned roster encouraged, broad compositions viable.
- **Heroic:** stronger mechanic overlap and tighter enrage.
- **Mythic:** fixed shared seed, explicit roster budget, seasonal leaderboard.

Difficulty should change mechanics and tactical pressure, not only multiply boss health.

### Raid rewards

- Boss-kill stamps in the relevant binder.
- Raid-specific showcase backgrounds.
- Titles for Ahead of the Curve-style and Cutting Edge-style completion.
- Shareable progression and kill reports.
- Cosmetic card entrance effects.
- Guild or friend leaderboard placement.

## Mode 3: Raid Race PvP

### Recommendation

Use parallel PvE as the first PvP format.

Direct combat between cards of real community members risks feeling personal and would require a much larger balance surface. A race preserves competition while keeping the objective recognizably WoW-like.

### Match format

- Two collectors receive the same boss, difficulty, modifiers, and seed.
- Each submits a legal roster and assignments before seeing the opponent's solution.
- The simulations run independently.
- The better boss result wins.

Possible result order:

1. Kill beats wipe.
2. Faster kill wins.
3. Lower boss health remaining wins among wipes.
4. Fewer deaths.
5. Fewer failed mechanics.

### Fairness

Use one or more of:

- Grade-based roster budget.
- Matchmaking by available collection strength.
- Separate unrestricted and capped queues.
- Weekly curated roster restrictions.
- Drafting from a random subset of each player's owned collection.

### Asynchronous first

Asynchronous matches avoid:

- Low-concurrency queue problems.
- Disconnects.
- Long twenty-card setup waits.
- Time-zone coordination.
- Pressure to add real-time networking before the core simulation is fun.

### Later PvP experiments

- Best-of-three boss series.
- Pick and ban one encounter modifier.
- Guild-versus-guild aggregate raid race.
- Eight-player tournament resolved during a Twitch broadcast.
- Five-card objective battleground where parties contest nodes instead of directly attacking real-character cards.

## Mode 4: Transmog Ring

### Recommendation

Build as a separate stats-free social mode. It can ship before full raid combat if moderation and voting protections are ready.

### Live six-player format

- Six collectors enter a room.
- A theme is selected.
- Each submits an owned card, finish, and available art variant.
- Two contestants appear in the ring at a time.
- The remaining four vote.
- First, second, and third place are determined across the rounds.

This deliberately mirrors the understandable social shape of WoW's Trial of Style.

### Example themes

- Void.
- Fire.
- Royalty.
- Villain Arc.
- Old Gods.
- Raid Leader Energy.
- Most Finnish.
- Best Legacy Look.
- Accidental Fashion Icon.
- Final Boss Material.

### Voting presentation

Hide until the vote is complete:

- Performance scores.
- Tier grade.
- Collection score.
- Owner username.
- Vote totals.

Possible formats:

- **Single-card runway:** one card per contestant.
- **Three-card ensemble:** headliner plus two supporting cards.
- **Guild look:** three cards from one snapshotted guild.
- **Finish challenge:** every contestant must use the same finish category.

### Historical-art limitation

The existing CCG does not guarantee that a Legacy card's render matches the character's historical transmog. The mode must be described as judging captured card artwork, not verifying period-authentic transmog.

### Low-population fallback

If six live players are unavailable:

- Accept daily asynchronous submissions.
- Build anonymous head-to-head voting pairs.
- Prevent users from voting for themselves.
- Limit repeat exposure of the same entry.
- Require a minimum number of independent votes before ranking.

### Rewards and abuse protection

Use cosmetic rewards only:

- Winner ribbons.
- Showcase trophies.
- Titles.
- Runway backgrounds.
- Seasonal profile frames.

Do not attach large pack rewards to public votes. That would encourage brigading and popularity farming.

## Additional mode ideas

### Guild Lockout

Collectors from the same guild contribute one owned card each to a shared weekly roster. Officers or elected raid leaders assign the group. The guild progresses through a boss together.

This creates cooperative collection value without transferring ownership.

### Binder Draft Night

The game shows three random owned cards at a time. The player chooses one and gradually builds a five- or twenty-card roster before seeing the final boss modifier.

This makes broad collections useful and prevents players from always selecting the same optimal roster.

### Timewalking Gauntlet

A roster fights bosses inspired by several expansions. Cards from the matching raid era receive thematic utility rather than raw power.

Possible rule: one active card from every expansion represented in the configured archive.

### What-If Machine

Create alternate-history rosters such as:

- Could a Warlords-era roster clear a Midnight encounter?
- Can one guild's snapshots across several tiers form a complete raid?
- Can a raid made entirely from mechanics specialists beat an extreme enrage?

Results are framed as playful simulations, not claims about real player capability.

### Daily Raid Puzzle

Provide a fixed partial roster and one encounter problem. The player chooses the final three cards or assigns one mechanic. Everyone receives the same puzzle and can share a compact result grid.

This is inexpensive repeatable content once the encounter engine exists.

## Completely crazy mode: 20 Viewers, One Pull

### Concept

A Twitch streamer opens a live raid lobby. Twenty viewers each contribute one owned card and collectively become the raid.

### Event flow

1. The streamer selects a boss and difficulty.
2. Viewers join role queues with an owned card.
3. The system assembles two tanks, four healers, and fourteen damage dealers.
4. Missing roles are filled by PUG mercenaries.
5. The stream overlay reveals every contributed card.
6. The streamer assigns major mechanics as raid leader.
7. Chat votes on one strategic decision, such as Heroism timing.
8. The pull runs live as a readable timeline.
9. Quips and card entrances punctuate important moments.
10. Every participant receives a shareable team result after the pull.

### Why it fits

- SuomiWoW already has Twitch authentication, channel-point, overlay, and CCG integration foundations.
- Each viewer contributes something they own without lending or trading it.
- The content celebrates recognizable people and guilds.
- Rare finishes create spectacle without adding power.
- The twenty-player formation is immediately understandable to raiders.

### Extensions

- Streamer-versus-streamer raid races.
- Eight-stream tournament bracket.
- Weekend global world boss with shared health.
- Real Finnish guild progression events charge a temporary community meter.
- A successful kill generates a poster containing all twenty cards.

### Risks

- Real-time state and moderation complexity.
- Role queues may fill unevenly.
- A twenty-card overlay can become visually noisy.
- Failure must not encourage chat to blame the viewer attached to one card.
- This should be an event format after the deterministic engine is mature, not the first implementation.

## Economy and rewards

Gameplay should deepen collection use without creating a runaway loop where the strongest collectors earn substantially more packs and become even stronger.

Recommended reward hierarchy:

1. Titles and achievements.
2. Binder stamps and boss-kill seals.
3. Showcase frames and backgrounds.
4. Shareable result art.
5. Cosmetic board and entrance variants.
6. Small, capped pack rewards for participation or major milestones.

Avoid:

- Unlimited packs from ranked wins.
- Card stat upgrades.
- Consumable cards.
- Duplicate-sacrifice power systems.
- Rewards that require maintaining a win streak every day.
- Ranking rewards that imply real-world value.

## Social safety and community tone

The subjects of the cards are real community members. The game must avoid turning performance data into harassment material.

Guidelines:

- Attribute failures to assignments, composition, or encounter events.
- Avoid public lists of most deaths, worst cards, or weakest players.
- Do not produce mocking automated copy tied to a named character.
- Let users share positive highlights such as clutch saves, successful soaks, and kill rosters.
- Keep direct competitive modes focused on collector decisions.
- Provide reporting and moderation for names, submissions, and Transmog Ring abuse.
- Make public combat history opt-in or aggregate it at roster level.

## Conceptual technical architecture

No schema below is locked. The purpose is to identify boundaries.

### Rules configuration

Versioned configuration should describe:

- Utility mapping by class and specialization.
- Stat normalization.
- Mode roster rules.
- Roster budgets.
- Encounter phases and checks.
- Difficulty scaling.
- Seasonal modifiers.
- Reward rules.

Published cards remain unchanged when these versions advance.

### Possible domain objects

- `CcgGameSeason`
- `CcgEncounter`
- `CcgEncounterVersion`
- `CcgGameRoster`
- `CcgGameSubmission`
- `CcgGameResult`
- `CcgDungeonRun`
- `CcgRaidLockout`
- `CcgRaceMatch`
- `CcgStyleSubmission`
- `CcgStyleVote`
- `CcgLiveRaidLobby`

Names and storage boundaries should be chosen only after the headless prototype reveals the actual query patterns.

### Server authority

The client may submit:

- Owned card IDs and selected snapshot versions.
- Assignments.
- Strategy options.
- Idempotency key.

The client must not submit:

- Resolved stats.
- Utility tags.
- Grade costs.
- Random outcomes.
- Encounter thresholds.
- Final scores.
- Rewards.

### Idempotency

Every run or pull submission must be idempotent. Retrying after a network failure must return the already committed result rather than create a new seed, consume another attempt, or award rewards twice.

### Simulation performance

The headless engine should be:

- Pure or close to pure.
- Independent of MongoDB for the actual calculation.
- Unit-testable with serializable inputs and outputs.
- Fast enough to simulate large balance samples offline.
- Deterministic across supported Node versions.
- Explicit about numeric rounding.

## Frontend experience

### Navigation

Add a top-level **Play** destination only when at least one mode is genuinely playable. Do not clutter the current CCG navigation with disabled future-mode links.

Possible hierarchy:

- Play
  - Expedition
  - Raid Night
  - Raid Race
  - Transmog Ring
- Open packs
- Collection
- Leaderboard

### Roster builder

The builder needs:

- Role lanes.
- Active and bench slots.
- Search and existing collection filters.
- Utility coverage summary.
- Encounter requirement summary.
- Warnings for missing roles or duplicate identities.
- Auto-fill and suggested swaps.
- Visible stat explanations.
- Keyboard and touch support.

### Encounter presentation

Prefer a raid-frame or encounter-board metaphor over a generic card-game battlefield.

The presentation can show:

- Boss health and phase.
- Twenty compact raid frames.
- Active casts and assignment groups.
- Cooldown timeline.
- Death and resurrection states.
- Cards expanding only for important events.

The full card artwork should appear for entrances, inspected details, clutch events, and results. Showing twenty full vertical cards simultaneously would be difficult to read.

### Accessibility

- Every visual replay also has a text event log.
- Color is not the only indicator of role, assignment, pass, or failure.
- Reduced motion skips sweeping cards and replays the result as a concise timeline.
- Auto-assign remains available for users who cannot manage drag-and-drop interactions.
- The simulation result is screen-reader navigable by phase and event.
- All new copy is maintained in Finnish and English.

## Rollout plan

### Phase 0 — validate the fun

Build a disposable headless prototype using representative card fixtures.

Questions to answer:

- Does choosing between performance and mechanics produce real tradeoffs?
- Can a user understand a wipe without reading formulas?
- Do utility tags create composition choices without requiring encyclopedic WoW knowledge?
- Can lower-grade cards be strategically useful?
- How much randomness feels alive without erasing decisions?

Exit criteria:

- At least three materially different valid solutions to one encounter.
- Test users can explain why their roster wiped.
- Changing an assignment can turn a near wipe into a kill.
- Balance simulations do not show one grade or class dominating every encounter.

### Phase 1 — simulation foundation

- Define versioned stat normalization.
- Define initial utility tags.
- Implement pure seeded simulation.
- Implement data-driven phase checks.
- Produce a structured combat report.
- Add large offline balance simulations.

### Phase 2 — Mythic+ Expedition MVP

- Owned-card 1/1/3 roster builder.
- PUG mercenaries.
- One dungeon with branching route.
- Several trash and boss check types.
- Weekly shared seed.
- Personal and public leaderboard.
- Cosmetic or badge rewards.
- Finnish and English copy.

### Phase 3 — Raid Night MVP

- Twenty-five-card roster and twenty-card active team.
- Two-boss pilot raid.
- Bench swaps between encounters.
- Multi-phase pulls and progression state.
- Story, Normal, and one competitive difficulty.
- Kill report sharing.

### Phase 4 — competition and social modes

- Asynchronous Raid Race.
- Roster caps and matchmaking experiments.
- Transmog Ring asynchronous voting.
- Moderation and abuse controls.

### Phase 5 — live event layer

- Twitch lobby and role queues.
- Streamer assignment controls.
- Overlay replay.
- Chat decision integration.
- Twenty-viewer result artifact.
- Global or tournament events after production hardening.

## Verification strategy

### Unit tests

- Identical inputs and seed produce identical results.
- Performance influences only intended throughput checks.
- Mechanics influences only intended execution and survival checks.
- Combined score is not double-counted.
- Missing Mythic+ data receives the configured neutral behavior.
- Utility tags resolve from the correct version.
- Duplicate character identities are rejected when the mode requires uniqueness.
- Finish and quantity never affect combat results.
- Community-card support rules never invent historical performance.
- Rounding is stable.

### Statistical tests

- Expected pass rates by difficulty.
- Class and specialization representation among successful rosters.
- Win rate by total roster grade cost.
- Frequency with which lower-grade cards appear in optimal rosters.
- Impact of mechanics versus performance.
- Variance across seeds.
- Mercenary completion rate.
- PvP first-player or early-submission advantage.

### Integration tests

- Ownership and snapshot validation.
- Idempotent pull submission.
- Committed result recovery after refresh.
- Reward idempotency.
- Weekly seed and reset boundaries in Helsinki time.
- Leaderboard ordering and tie-breaks.
- Guest versus authenticated access rules.
- Raid lockout progression.
- Style-vote self-vote and duplicate-vote prevention.

### Manual tests

- Five-card roster building on mobile.
- Twenty-card roster readability on desktop and mobile.
- Keyboard-only assignment.
- Screen-reader combat report.
- Reduced-motion pull result.
- Long Finnish text expansion.
- Twenty-card Twitch overlay at common stream resolutions.

## Success metrics

Early product metrics should measure whether players are making and revising decisions, not merely claiming rewards.

- Percentage of collectors who submit a first expedition.
- Percentage who change a roster or assignment after a wipe.
- Runs per active player.
- Distinct cards used per player over a season.
- Percentage of successful rosters containing C-F cards.
- Weekly shared-seed participation.
- Shared result rate.
- Raid boss progression and return rate.
- Transmog votes per valid submission.
- Mercenary usage and eventual replacement by owned cards.

Guardrail metrics:

- Class or grade dominance.
- Reward-driven farming patterns.
- Vote brigading.
- Reports involving named-character harassment.
- Simulation errors or unrecoverable submissions.

## Primary risks

### The highest grades always win

Mitigations:

- Roster budgets.
- Utility requirements.
- Mechanics-heavy encounters.
- Shared seeds.
- Challenge restrictions.
- Matchmaking bands.

### The simulation feels arbitrary

Mitigations:

- Small seeded variance.
- Previewed encounter requirements.
- Event-level combat reports.
- Visible formulas or contribution explanations.
- Reproducible results.

### Twenty cards become spreadsheet work

Mitigations:

- Prove the game with five cards first.
- Strong auto-fill.
- Limit tactical choices per boss.
- Reuse saved rosters.
- Show only relevant utility warnings.

### New players cannot form valid groups

Mitigations:

- Free PUG mercenaries.
- Story difficulty.
- Practice mode.
- Clear role filters.
- No requirement to own twenty cards before entering the mode.

### Cross-era values are unfair

Mitigations:

- Use normalized 0-100 raid scores already stored on cards.
- Normalize Mythic+ within its source season.
- Ignore item level.
- Version game rules separately from snapshots.

### Real people become targets

Mitigations:

- Roster-level failure language.
- Positive individual highlights only.
- No public worst-card statistics.
- Parallel rather than direct PvP.
- Moderation and reporting.

### Too many modes dilute development

Mitigation:

Build one shared engine and ship one mode at a time. Do not implement Raid Night, PvP, style voting, and Twitch events as separate foundations.

## Open product decisions

- Is Raid Director the final product name or only an internal working title?
- Should the first prototype be themed as a real configured dungeon or an original training scenario?
- Should raid lockouts limit pulls, use a weekly schedule, or allow unlimited practice with one scored submission?
- Are guild cohesion bonuses desirable, or would they over-favor large represented guilds?
- Does competitive roster cost use grade, normalized stats, or both?
- Should Community cards always be support-only, or receive standardized casual-mode stats?
- How much information about encounter thresholds is shown before a pull?
- Are utility tags defined per specialization or more broadly per class?
- Can users contribute cards to guild and Twitch rosters while retaining full ownership?
- Which rewards belong in the existing collection score, if any?
- Should a Transmog Ring entry expose the character name before voting?
- Are live Twitch participants required to authenticate with both SuomiWoW and Twitch?

## Recommended first prototype

Build one headless five-card encounter before committing to any persistent game schema.

Prototype rules:

- Formation: one tank, one healer, three damage dealers.
- Inputs: role, Performance, Mechanics, class/spec utility, and normalized M+ when available.
- Utilities: interrupt, dispel, mobility, battle resurrection, raid defensive, Heroism.
- Encounters: two trash pulls and one three-phase boss.
- Decisions: pull size, interrupt assignment, defensive timing, Heroism phase.
- Output: time, deaths, boss health, phase timeline, passed checks, failed checks, and one suggested adjustment.
- Simulation: deterministic and seeded.
- Test data: representative S-F fixtures across several roles and specs, including missing M+ and one Community support card.

Do not build rewards, seasons, public leaderboards, Twitch integration, or production persistence until this prototype demonstrates that changing a roster or assignment is genuinely fun.

## Final direction

The best version of SuomiWoW CCG is not a game where collectible characters hit each other.

It is a game where the player opens a binder, recognizes real raiders from different eras, assembles an improbable Finnish supergroup, assigns the soaks, calls for Heroism, wipes at 2%, changes one player, and finally kills the boss.

That is a fantasy only SuomiWoW can deliver.
