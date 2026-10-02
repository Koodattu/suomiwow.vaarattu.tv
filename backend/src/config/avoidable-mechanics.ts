export interface AvoidableMechanic {
  key: string;
  version: number;
  enabled: boolean;
  zoneId: number;
  encounterId: number;
  boss: string;
  name: string;
  damageSpellIds: readonly number[];
  icon: string;
}

// Damage IDs, not casts or localized spell names. Bump version when changing
// the measured spell family; only that mechanic will be collected again.
// Evidence and catalogue maintenance: docs/avoidable-damage.md.
function mechanic(key: string, zoneId: number, encounterId: number, boss: string, name: string, damageSpellIds: number[], icon: string): AvoidableMechanic {
  return { key, version: 1, enabled: true, zoneId, encounterId, boss, name, damageSpellIds, icon: `${icon}.jpg` };
}

export const AVOIDABLE_MECHANICS: readonly AvoidableMechanic[] = [
  mechanic("sszorak-tempest", 53, 3420, "Sszorak", "Tempest", [1287083], "inv_ability_poison_beam"),
  mechanic("coiled-altar-axegrinder", 53, 3429, "The Coiled Altar", "Axegrinder", [1285017], "ability_warrior_bladestorm"),
  mechanic("vanguard-divine-toll", 46, 3180, "Lightblinded Vanguard", "Divine Toll", [1248652], "inv_ability_paladin_divinetoll"),
  mechanic("midnight-falls-glaives", 46, 3183, "Midnight Falls", "Heaven's Glaives", [1254076], "inv_glaive_1h_darknaaru_d_01"),
  mechanic("araz-prime-sequence", 44, 3132, "Forgeweaver Araz", "Prime Sequence", [1237322], "spell_arcane_blast"),
  mechanic("salhadaar-nexus-beams", 44, 3134, "Nexus-King Salhadaar", "Nexus Beams", [1228080], "inv_cosmicvoid_beam"),
  mechanic("bandit-crushed", 42, 3014, "One-Armed Bandit", "Crushed!", [460430], "ability_smash"),
  mechanic("sprocketmonger-beams", 42, 3013, "Sprocketmonger Lockenstock", "Blazing Beam / Jumbo Void Beam", [1216415, 1216679], "spell_shaman_lavasurge"),
  mechanic("gallywix-giga-blast", 42, 3016, "Chrome King Gallywix", "Giga Blast", [469326], "ability_siege_engineer_magnetic_crush"),
  mechanic("kyveza-nexus-daggers", 38, 2920, "Nexus-Princess Ky'veza", "Nexus Daggers", [440149], "ability_rogue_focusedattacks"),
  mechanic("ansurek-venom-nova", 38, 2922, "Queen Ansurek", "Venom Nova", [438947, 454019], "spell_nature_elementalshields"),
  mechanic("smolderon-world-in-flames", 35, 2824, "Smolderon", "World In Flames", [422243], "ability_racial_foregedinflames"),
  mechanic("tindral-fire-beam", 35, 2786, "Tindral Sageswift", "Fire Beam", [423649], "ability_mage_firestarter"),
  mechanic("rashok-lava-wave", 33, 2680, "Rashok", "Lava Wave", [403543], "spell_shaman_lavasurge"),
  mechanic("sarkareth-scouring-eternity", 33, 2685, "Scalecommander Sarkareth", "Scouring Eternity", [403625], "inv_cosmicvoid_nova"),
  mechanic("raszageth-lightning-breath", 31, 2607, "Raszageth", "Lightning Breath", [377597], "ability_thunderking_thunderstruck"),
  mechanic("dathea-raging-tempest", 31, 2635, "Dathea", "Raging Tempest", [375424], "ability_skyreach_four_wind"),
  // Both star casts apply the same damaging debuff; 367631 is a cast, not damage.
  mechanic("anduin-wicked-star", 29, 2546, "Anduin Wrynn", "Wicked Star / Empowered Wicked Star", [365024], "spell_priest_divinestar_shadow2"),
  mechanic("xymox-genesis-rings", 29, 2553, "Artificer Xy'mox", "Genesis Rings", [363413, 364604], "spell_progenitor_areadenial"),
  mechanic("painsmith-spiked", 28, 2430, "Painsmith Raznal", "Spiked", [355526], "ability_fomor_boss_pillar02"),
  mechanic("sylvanas-haunting-wave", 28, 2435, "Sylvanas Windrunner", "Haunting Wave", [351870], "ui_darkshore_warfront_horde_banshee"),
  mechanic("denathrius-massacre", 26, 2407, "Sire Denathrius", "Massacre", [330137], "ability_revendreth_warrior"),
  mechanic("sludgefist-destructive-stomp", 26, 2399, "Sludgefist", "Destructive Stomp", [332318], "spell_nature_earthquake"),
  mechanic("nzoth-stupefying-glare", 24, 2344, "N'Zoth", "Stupefying Glare", [318976], "spell_priest_voidsear"),
  mechanic("vexiona-twilight-decimator", 24, 2336, "Vexiona", "Twilight Decimator", [307218, 307250], "ability_rogue_envelopingshadows"),
  mechanic("ashvane-upsurge", 23, 2304, "Lady Ashvane", "Upsurge", [298054], "ability_shawaterelemental_swirl"),
  mechanic("zaqul-crushing-grasp", 23, 2293, "Za'qul", "Crushing Grasp", [292565], "spell_priest_voidtendrils"),
  mechanic("mekkatorque-buster-cannon", 21, 2276, "High Tinker Mekkatorque", "Buster Cannon", [282182], "spell_mage_flameorb_blue"),
  mechanic("jaina-icefall", 21, 2281, "Jaina Proudmoore", "Icefall", [288475], "spell_frost_frozencore"),
  // 267350 is unavoidable raid-wide damage and MUST NOT be included.
  mechanic("zekvoz-surging-darkness", 19, 2136, "Zek'voz", "Surging Darkness", [265451, 265452, 265454], "ability_priest_voidentropy"),
  mechanic("ghuun-virulent-corruption", 19, 2122, "G'huun", "Virulent Corruption", [273486], "ability_deathknight_desecratedground"),
];

export const activeAvoidableMechanics = () => AVOIDABLE_MECHANICS.filter((entry) => entry.enabled);
export const findAvoidableMechanic = (key: string) => activeAvoidableMechanics().find((entry) => entry.key === key);
