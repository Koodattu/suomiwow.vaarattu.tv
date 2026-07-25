# Blizzard to Raider.IO Spec Slot Mapping

Generated from Blizzard Playable Class API on 2026-06-22T19:30:25.680Z.

## Source

- Region: `us`
- Namespace: `static-us`
- Locale: `en_US`
- Playable class index: https://us.api.blizzard.com/data/wow/playable-class/index?namespace=static-us&locale=en_US

## Mapping Rule

- Raider.IO spec_N fields are zero-based in-game specialization slots; spec_0 maps to specialization position 1, spec_1 to position 2, and so on.
- The Blizzard class IDs in this document come from the Blizzard Playable Class API and are not interchangeable with WarcraftLogs/internal class IDs.
- The Blizzard Playable Class API does not always return specializations in Raider.IO slot order; Monk is explicitly reordered to Brewmaster, Mistweaver, Windwalker.
- Unused Raider.IO fields are represented as null in the JSON artifact and as unused rows in the Markdown table.

## Mapping

| Blizzard class ID | Class | Raider.IO field | Blizzard spec index | Blizzard spec ID | Spec name | Spec slug |
| ---: | --- | --- | ---: | ---: | --- | --- |
| 1 | Warrior | `spec_0` | 1 | 71 | Arms | `arms` |
| 1 | Warrior | `spec_1` | 2 | 72 | Fury | `fury` |
| 1 | Warrior | `spec_2` | 3 | 73 | Protection | `protection` |
| 1 | Warrior | `spec_3` | - | - | unused | - |
| 2 | Paladin | `spec_0` | 1 | 65 | Holy | `holy` |
| 2 | Paladin | `spec_1` | 2 | 66 | Protection | `protection` |
| 2 | Paladin | `spec_2` | 3 | 70 | Retribution | `retribution` |
| 2 | Paladin | `spec_3` | - | - | unused | - |
| 3 | Hunter | `spec_0` | 1 | 253 | Beast Mastery | `beast-mastery` |
| 3 | Hunter | `spec_1` | 2 | 254 | Marksmanship | `marksmanship` |
| 3 | Hunter | `spec_2` | 3 | 255 | Survival | `survival` |
| 3 | Hunter | `spec_3` | - | - | unused | - |
| 4 | Rogue | `spec_0` | 1 | 259 | Assassination | `assassination` |
| 4 | Rogue | `spec_1` | 2 | 260 | Outlaw | `outlaw` |
| 4 | Rogue | `spec_2` | 3 | 261 | Subtlety | `subtlety` |
| 4 | Rogue | `spec_3` | - | - | unused | - |
| 5 | Priest | `spec_0` | 1 | 256 | Discipline | `discipline` |
| 5 | Priest | `spec_1` | 2 | 257 | Holy | `holy` |
| 5 | Priest | `spec_2` | 3 | 258 | Shadow | `shadow` |
| 5 | Priest | `spec_3` | - | - | unused | - |
| 6 | Death Knight | `spec_0` | 1 | 250 | Blood | `blood` |
| 6 | Death Knight | `spec_1` | 2 | 251 | Frost | `frost` |
| 6 | Death Knight | `spec_2` | 3 | 252 | Unholy | `unholy` |
| 6 | Death Knight | `spec_3` | - | - | unused | - |
| 7 | Shaman | `spec_0` | 1 | 262 | Elemental | `elemental` |
| 7 | Shaman | `spec_1` | 2 | 263 | Enhancement | `enhancement` |
| 7 | Shaman | `spec_2` | 3 | 264 | Restoration | `restoration` |
| 7 | Shaman | `spec_3` | - | - | unused | - |
| 8 | Mage | `spec_0` | 1 | 62 | Arcane | `arcane` |
| 8 | Mage | `spec_1` | 2 | 63 | Fire | `fire` |
| 8 | Mage | `spec_2` | 3 | 64 | Frost | `frost` |
| 8 | Mage | `spec_3` | - | - | unused | - |
| 9 | Warlock | `spec_0` | 1 | 265 | Affliction | `affliction` |
| 9 | Warlock | `spec_1` | 2 | 266 | Demonology | `demonology` |
| 9 | Warlock | `spec_2` | 3 | 267 | Destruction | `destruction` |
| 9 | Warlock | `spec_3` | - | - | unused | - |
| 10 | Monk | `spec_0` | 1 | 268 | Brewmaster | `brewmaster` |
| 10 | Monk | `spec_1` | 2 | 270 | Mistweaver | `mistweaver` |
| 10 | Monk | `spec_2` | 3 | 269 | Windwalker | `windwalker` |
| 10 | Monk | `spec_3` | - | - | unused | - |
| 11 | Druid | `spec_0` | 1 | 102 | Balance | `balance` |
| 11 | Druid | `spec_1` | 2 | 103 | Feral | `feral` |
| 11 | Druid | `spec_2` | 3 | 104 | Guardian | `guardian` |
| 11 | Druid | `spec_3` | 4 | 105 | Restoration | `restoration` |
| 12 | Demon Hunter | `spec_0` | 1 | 577 | Havoc | `havoc` |
| 12 | Demon Hunter | `spec_1` | 2 | 581 | Vengeance | `vengeance` |
| 12 | Demon Hunter | `spec_2` | 3 | 1480 | Devourer | `devourer` |
| 12 | Demon Hunter | `spec_3` | - | - | unused | - |
| 13 | Evoker | `spec_0` | 1 | 1467 | Devastation | `devastation` |
| 13 | Evoker | `spec_1` | 2 | 1468 | Preservation | `preservation` |
| 13 | Evoker | `spec_2` | 3 | 1473 | Augmentation | `augmentation` |
| 13 | Evoker | `spec_3` | - | - | unused | - |
