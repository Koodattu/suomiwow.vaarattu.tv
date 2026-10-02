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
  mechanic("ulatek-caustic-waves", 53, 3492, "Ula'tek", "Caustic Waves", [1292403], "inv_ability_poison_wave"),
  mechanic("fallen-king-umbral-beams", 46, 3179, "Fallen-King Salhadaar", "Umbral Beams", [1260030], "inv_cosmicvoid_beam"),
  mechanic("vanguard-divine-toll", 46, 3180, "Lightblinded Vanguard", "Divine Toll", [1248652], "inv_ability_paladin_divinetoll"),
  mechanic("midnight-falls-glaives", 46, 3183, "Midnight Falls", "Heaven's Glaives", [1254076], "inv_glaive_1h_darknaaru_d_01"),
  mechanic("midnight-falls-dark-quasar", 46, 3183, "Midnight Falls", "Dark Quasar", [1282469], "inv_cosmicvoid_beam"),
  mechanic("plexus-atomize", 44, 3129, "Plexus Sentinel", "Atomize", [1219223], "ability_mage_invisibility"),
  mechanic("araz-prime-sequence", 44, 3132, "Forgeweaver Araz", "Prime Sequence", [1237322], "spell_arcane_blast"),
  mechanic("salhadaar-nexus-beams", 44, 3134, "Nexus-King Salhadaar", "Nexus Beams", [1228080], "inv_cosmicvoid_beam"),
  mechanic("cauldron-blastburn-roarcannon", 42, 3010, "Cauldron of Carnage", "Blastburn Roarcannon", [472242], "spell_shaman_shockinglava"),
  mechanic("rik-resonant-echoes", 42, 3011, "Rik Reverb", "Resonant Echoes", [468120], "inv_sonic_wave"),
  mechanic("bandit-crushed", 42, 3014, "One-Armed Bandit", "Crushed!", [460430], "ability_smash"),
  mechanic("sprocketmonger-beams", 42, 3013, "Sprocketmonger Lockenstock", "Blazing Beam / Jumbo Void Beam", [1216415, 1216679], "spell_shaman_lavasurge"),
  // Drill-contact bleed only; Screw Up's mandatory marking damage is 1216509.
  mechanic("sprocketmonger-screwed", 42, 3013, "Sprocketmonger Lockenstock", "Screw Up (Screwed!)", [1217261], "ability_ironmaidens_whirlofblood"),
  mechanic("gallywix-giga-blast", 42, 3016, "Chrome King Gallywix", "Giga Blast", [469326], "ability_siege_engineer_magnetic_crush"),
  // Wave-contact Corrosion; 439787 is the required marked-target eruption.
  mechanic("rashanan-rolling-acid", 38, 2918, "Rasha'nan", "Rolling Acid (Corrosion)", [439785], "inv_ability_poison_wave"),
  mechanic("kyveza-nexus-daggers", 38, 2920, "Nexus-Princess Ky'veza", "Nexus Daggers", [440149], "ability_rogue_focusedattacks"),
  mechanic("ansurek-venom-nova", 38, 2922, "Queen Ansurek", "Venom Nova", [438947, 454019], "spell_nature_elementalshields"),
  mechanic("ansurek-web-blades", 38, 2922, "Queen Ansurek", "Web Blades", [439536], "inv_ability_web_missile"),
  mechanic("nymue-impending-loom", 35, 2708, "Nymue, Weaver of the Cycle", "Impending Loom", [429785], "inv_10_tailoring_craftingoptionalreagent_enhancedspellthread_color3"),
  mechanic("smolderon-world-in-flames", 35, 2824, "Smolderon", "World In Flames", [422243], "ability_racial_foregedinflames"),
  mechanic("tindral-fire-beam", 35, 2786, "Tindral Sageswift", "Fire Beam", [423649], "ability_mage_firestarter"),
  // The beam's unavoidable raid-wide pulse is 404813, not 400432.
  mechanic("kazzara-hellbeam", 33, 2688, "Kazzara, the Hellforged", "Hellbeam", [400432], "ability_warlock_shadowflame"),
  mechanic("rashok-lava-wave", 33, 2680, "Rashok", "Lava Wave", [403543], "spell_shaman_lavasurge"),
  // Bomb proximity damage, excluding the raid-wide Scorching Detonation (401525).
  mechanic("sarkareth-scorching-bomb", 33, 2685, "Scalecommander Sarkareth", "Scorching Bomb", [401621], "spell_fire_lavaspawn"),
  // Flyover impact only; 404499 is residue used intentionally for Oblivion stacks.
  mechanic("sarkareth-abyssal-breath", 33, 2685, "Scalecommander Sarkareth", "Abyssal Breath", [410243], "inv_cosmicvoid_missile"),
  mechanic("sarkareth-scouring-eternity", 33, 2685, "Scalecommander Sarkareth", "Scouring Eternity", [403625], "inv_cosmicvoid_nova"),
  mechanic("raszageth-lightning-breath", 31, 2607, "Raszageth", "Lightning Breath", [377597], "ability_thunderking_thunderstruck"),
  mechanic("dathea-raging-tempest", 31, 2635, "Dathea", "Raging Tempest", [375424], "ability_skyreach_four_wind"),
  // Both star casts apply the same damaging debuff; 367631 is a cast, not damage.
  mechanic("anduin-wicked-star", 29, 2546, "Anduin Wrynn", "Wicked Star / Empowered Wicked Star", [365024], "spell_priest_divinestar_shadow2"),
  mechanic("xymox-genesis-rings", 29, 2553, "Artificer Xy'mox", "Genesis Rings", [363413, 364604], "spell_progenitor_areadenial"),
  mechanic("painsmith-spiked", 28, 2430, "Painsmith Raznal", "Spiked", [355526], "ability_fomor_boss_pillar02"),
  mechanic("sylvanas-haunting-wave", 28, 2435, "Sylvanas Windrunner", "Haunting Wave", [351870], "ui_darkshore_warfront_horde_banshee"),
  mechanic("shriekwing-echoing-sonar", 26, 2398, "Shriekwing", "Echoing Screech / Echoing Sonar", [342866, 343022], "spell_nature_wispsplode"),
  mechanic("denathrius-massacre", 26, 2407, "Sire Denathrius", "Massacre", [330137], "ability_revendreth_warrior"),
  mechanic("sludgefist-destructive-stomp", 26, 2399, "Sludgefist", "Destructive Stomp", [332318], "spell_nature_earthquake"),
  mechanic("nzoth-stupefying-glare", 24, 2344, "N'Zoth", "Stupefying Glare", [318976], "spell_priest_voidsear"),
  mechanic("vexiona-twilight-decimator", 24, 2336, "Vexiona", "Twilight Decimator", [307218, 307250], "ability_rogue_envelopingshadows"),
  mechanic("xanesh-torment", 24, 2328, "Dark Inquisitor Xanesh", "Torment", [311369, 311383], "ability_priest_cascade_shadow"),
  mechanic("hivemind-acidic-aqir", 24, 2333, "The Hivemind", "Acidic Aqir (Corrosion)", [313461], "ability_creature_poison_05"),
  mechanic("carapace-tentacle-slam", 24, 2337, "Carapace of N'Zoth", "Growth-Covered Tentacle", [313564], "ability_golemthunderclap"),
  mechanic("ashvane-upsurge", 23, 2304, "Lady Ashvane", "Upsurge", [298054], "ability_shawaterelemental_swirl"),
  mechanic("zaqul-crushing-grasp", 23, 2293, "Za'qul", "Crushing Grasp", [292565], "spell_priest_voidtendrils"),
  mechanic("azshara-piercing-gaze", 23, 2299, "Queen Azshara", "Piercing Gaze", [300785], "spell_priest_void-flay"),
  mechanic("mekkatorque-buster-cannon", 21, 2276, "High Tinker Mekkatorque", "Buster Cannon", [282182], "spell_mage_flameorb_blue"),
  mechanic("jaina-icefall", 21, 2281, "Jaina Proudmoore", "Icefall", [288475], "spell_frost_frozencore"),
  // 267350 is unavoidable raid-wide damage and MUST NOT be included.
  mechanic("zekvoz-surging-darkness", 19, 2136, "Zek'voz", "Surging Darkness", [265451, 265452, 265454], "ability_priest_voidentropy"),
  mechanic("mythrax-obliteration-beam", 19, 2135, "Mythrax", "Obliteration Beam", [274113], "spell_priest_voidsear"),
  mechanic("ghuun-virulent-corruption", 19, 2122, "G'huun", "Virulent Corruption", [273486], "ability_deathknight_desecratedground"),
  mechanic("hasabel-felstorm-barrage", 17, 2064, "Portal Keeper Hasabel", "Felstorm Barrage", [244001], "ability_bossfelmagnaron_handempowered"),
  mechanic("argus-edges", 17, 2092, "Argus the Unmaker", "Edge of Obliteration / Edge of Annihilation", [251815, 258834], "ability_argus_edgeofobliteration"),
  // Tank hits are intentional here; the public role filter can exclude tanks.
  mechanic("argus-sweeping-scythe", 17, 2092, "Argus the Unmaker", "Sweeping Scythe", [248499], "inv_polearm_2h_titanargus_d_01"),
  mechanic("sisters-glaive-storm", 13, 2050, "Sisters of the Moon", "Glaive Storm", [236480], "ability_upgrademoonglaive"),
  mechanic("kiljaeden-demonic-obelisk", 13, 2051, "Kil'jaeden", "Demonic Obelisk", [239852], "spell_fire_felflamering"),
  mechanic("tichondrius-carrion-nightmare", 11, 1862, "Tichondrius", "Carrion Nightmare", [215988], "ability_warlock_burningembersgreen"),
  mechanic("star-augur-world-devouring-force", 11, 1863, "Star Augur Etraeus", "World-Devouring Force", [216909], "spell_priest_void-blast"),
  mechanic("elisande-arcanetic-ring", 11, 1872, "Grand Magistrix Elisande", "Arcanetic Ring", [208659], "spell_mage_arcaneorb"),
  // Collision only, not unavoidable Headlong Charge (228344) or Berserk Trample.
  mechanic("guarm-trample", 12, 1962, "Guarm", "Trample", [227843], "spell_druid_feralchargecat"),
  // Includes the intended tank target, as with Argus's Sweeping Scythe.
  mechanic("helya-corrupted-breath", 12, 2008, "Helya", "Corrupted Breath", [228566], "spell_shadow_shadetruesight"),
  mechanic("cenarius-nightmare-brambles", 10, 1877, "Cenarius", "Nightmare Brambles", [210315, 210337, 214308], "spell_druid_massentanglement_nightmare"),
  mechanic("xavius-nightmare-blades", 10, 1864, "Xavius", "Nightmare Blades", [206656], "ability_xavius_nightmareblades"),
];

export const activeAvoidableMechanics = () => AVOIDABLE_MECHANICS.filter((entry) => entry.enabled);
export const findAvoidableMechanic = (key: string) => activeAvoidableMechanics().find((entry) => entry.key === key);
