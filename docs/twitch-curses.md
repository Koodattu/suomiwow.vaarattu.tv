# Twitch curse easter egg

`!curse` and `!kirous` invoke the same command. Replies begin with `CURSE OF`
and the invoking viewer's Twitch login in uppercase. Arguments are ignored.
The easter egg is intentionally absent from `!commands`.

Each admitted request flips a 50/50 coin between English/Chinese copypasta and
English/Egyptian hieroglyph copypasta. The prompt contains two randomized examples
from only that style and two distinct raid situations drawn from a larger pool.
Examples demonstrate tone and format, without prescribing a particular phrase
or subject order. Generation uses the existing `OPENAI_API_KEY`, `gpt-6-luna`, low
reasoning, no response storage, a 15-second timeout, and no automatic retries.

For the hieroglyph style, the model returns exactly four cryptic English fragments
separated by `|`, each 2-5 words and at most 32 characters. The application adds
the viewer heading and five blocks of 8-12 varied hieroglyphs, including a trailing
block. Glyph density adjusts to the remaining byte budget. Curated hieroglyph
fallbacks use the same formatter. Chinese replies alternate short English
fragments with Chinese translations. Examples emphasize awkward, ominous prophecy
fragments such as `MISTAKE OF CREST` rather than ordinary raid commentary.

The last 12 successfully sent curse replies across all channels and both aliases
provide recent phrase history through the existing `TwitchChatAuditEvent` records.
English fragments are extracted locally without viewer names, channels, Chinese
translations or glyphs. The model receives these as `avoidPhrases` and is asked
to choose different images and mishaps, rather than slight paraphrases. A generated
reply that repeats any normalized English fragment uses a curated fallback without
another API call. Exact phrase repetition is checked in code; semantic variety
still depends on generation.

Prompt examples and fallbacks prefer phrases absent from that history, then fewer
overlaps, then older overlaps. Equally fresh choices are randomized. This also
rotates curated replies after the daily budget is exhausted. When every example
has appeared recently, some older wording is reused. A history lookup failure
continues with randomized examples and themes. History survives restarts through
the existing audit collection; concurrent requests can see the same history until
their replies are sent and logged.

Both aliases share a five-second cooldown per channel. Existing command-enabled
settings, channel eligibility and shared-chat deduplication still apply. A
bot-wide cap allows 100 generation attempts per Helsinki calendar day. Admission
is an atomic conditional update in the existing `RateLimitState` collection,
under `twitch:curse:daily`; the unique key prevents concurrent admissions beyond
the cap. This state survives bot restarts. Failed generations also consume an
attempt, so outages cannot bypass the cap. Over-limit requests receive a curated
curse in the randomly selected style without calling the LLM or loading progression.
The same five-second cooldown still applies.

The channel's tracked guild supplies context. The most recently pulled,
unkilled boss with logged pulls in an incomplete current Mythic raid is preferred;
without pull-history timestamps, the existing progression selector is the fallback.
Heroic progression, completed raids, no Mythic pulls, ambiguous/untracked channels
and unsupported bosses produce generic curses. Only these Mechanic Magnets entries
provide inspiration, using the canonical ability name from `avoidable-mechanics.ts`:

| Boss | Inspiration |
| --- | --- |
| Sszorak | Tempest |
| The Coiled Altar | Axegrinder |
| Ula'tek | Caustic Waves |

The prompt treats the ability as optional inspiration for an indirect image in
one fragment, rather than repeating its name verbatim or always opening with it.

Only the ability name and normalized recent English fragments are sent as dynamic
context. The viewer name is substituted locally, and chat arguments are never
sent to the model. Context lookup failures use generic inspiration.
Repeated, invalid, mixed-style, oversized, incomplete or failed
generation uses a curated example in the selected style. Replies must fit within
450 UTF-8 bytes, avoiding broken glyphs or split chat messages. Without an API key,
the command quietly returns no reply. Unexpected command errors are logged without
sending an error message to chat.

Focused checks (from `backend`):

```powershell
node --test -r ts-node/register test/twitch-curse.service.test.ts test/twitch-chat-command.service.test.ts test/twitch-chat-bot.service.test.ts test/boss-kill-prediction.service.test.ts
npm run build
```
