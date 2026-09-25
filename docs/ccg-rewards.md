# CCG Rewards

`/ccg/rewards` lists historical duplicate packs, eligible Pick'em rewards, individual
Card Studio creation rewards, active public redeem codes, and all codes claimed by
the signed-in user (including codes later made private or inactive). Existing claim
locations and manual code entry share the same claim records. Public visibility
defaults to false and is editable in the admin redeem-code manager.

The page uses a compact claim list and code entry. Full activity lives in Activity; claimed codes also remain visible on Rewards.
Duplicate rules and the historical breakdown are available on demand. The desktop
Rewards navigation link has a gift icon, without a count badge.

## Duplicate rules

- Progress belongs to one account, set, and character. Finishes, alternative art,
  and snapshot versions share that counter. Raid, Community, and Supporter cards
  are eligible.
- After all pack-obtainable finishes are unlocked, every ten subsequent duplicate
  acquisitions grant one pack immediately. The acquisition that unlocks the last
  finish does not count. Additional duplicates in that same pack do count.
- The existing once-only Raid completion bonus remains independent. Its triggering
  duplicate also contributes to the recurring counter.
- Adding a required finish pauses progress until it is unlocked, preserving earned
  packs and the existing counter.
- Character identity reconciliation transfers counters. If two identities merge,
  their duplicate counts and processed milestones are combined; any newly crossed
  threshold is credited on the next eligible acquisition.

## Lazy historical baseline

There is no startup task or all-user migration. The first authenticated CCG session
or Rewards request initializes the account. Card acquisition also runs this guard
inside its transaction before changing ownership, so direct code/Twitch grants
cannot bypass initialization.

For each currently completed card, the baseline is:

```
duplicates = sum(owned quantities) - number of distinct owned finishes
historical packs = floor(duplicates / 10)
ongoing remainder = duplicates % 10
```

The historical calculation uses current collection quantities, including copies
collected before the last finish was unlocked; it does not reconstruct a historical
completion timestamp. Incomplete cards have no historical entitlement. Going
forward, only acquisitions after completion count.

The saved historical entitlement is claimable later and never recalculated, even
when zero. It does not affect recharge until claimed. Guest collection transfer
into an otherwise empty account seeds this baseline after the transfer, including
when the empty account had already initialized.

## Transactions and rollout

Initialization, acquisition, progress, credits, and ledger records use the existing
MongoDB replica-set transactions. Initialization serializes on the user row; later
acquisitions and claims serialize on the duplicate-reward account row. Unique
account/progress indexes and the existing unique credit and ledger source keys
prevent duplicate rewards. Historical and recurring rewards use separate keys.

Reward claims settle earned recharge before adding packs. Rewards can exceed the
100-pack storage cap; normal recharge remains paused at or above that cap.

Deploy the API and acquisition workers from the same revision. The new Mongoose
models create their indexes through the repository's normal model initialization.
Do not run a global backfill or reset the saved account/progress documents.
Existing redeem codes remain private unless explicitly made public.

## Verification

`npm run build` in both `backend` and `frontend` checks compilation. The rewards
integration suite exercises the actual claim routes, pack opening, acquisition,
retries, concurrency, rollback, guest import, public/private visibility, card
availability, recharge, and character identity reconciliation.

Run a disposable MongoDB replica set on `127.0.0.1:27140`, then run
`npm run test:ccg-rewards` from `backend`. The suite never loads `.env`; it creates
and drops only its own `ccg_rewards_test_<pid>` database. The existing Supporter
integration suite uses a separate disposable replica set on port 27139.
