export interface TrackedGuild {
  name: string;
  realm: string;
  region: string;
  parent_guild?: string;
  streamers?: string[]; // Twitch channel names
}

export const GUILDS_DEV: TrackedGuild[] = [
  {
    name: "Tuju",
    realm: "Kazzak",
    region: "EU",
    streamers: ["vaarattu", "forsen", "b0aty", "wiba"],
  },
  {
    name: "Sorvan Kylä",
    realm: "Ravencrest",
    region: "EU",
  },
  {
    name: "Twilight Sentinels",
    realm: "Ravencrest",
    region: "EU",
  },
];

export const GUILDS_PROD: TrackedGuild[] = [
  {
    name: "Tuju",
    realm: "Kazzak",
    region: "EU",
    streamers: ["vaarattu", "kahvig", "forsen"],
  },
  { name: "IHAN SAMA", realm: "Stormreaver", region: "EU" },
  {
    name: "ST-Raid",
    realm: "Stormreaver",
    region: "EU",
    parent_guild: "IHAN SAMA",
    streamers: ["kukkis12"],
  },
  {
    name: "PH-Tiimi",
    realm: "Stormreaver",
    region: "EU",
    parent_guild: "IHAN SAMA",
    streamers: ["suhruu"],
  },
  {
    name: "SPH-Tiimi",
    realm: "Stormreaver",
    region: "EU",
    parent_guild: "IHAN SAMA",
    streamers: ["suhruu"],
  },
  {
    name: "CE-Tiimi",
    realm: "Stormreaver",
    region: "EU",
    parent_guild: "IHAN SAMA",
    streamers: ["zetabeachh"],
  },
  { name: "Kilta", realm: "Ravencrest", region: "EU", streamers: ["nasuxi"] },
  {
    name: "käsipainoilla bodaus",
    realm: "Stormreaver",
    region: "EU",
    streamers: ["ventrixi", "kermisgg", "apepforever"],
  },
  { name: "Nave", realm: "Kazzak", region: "EU" },
  { name: "Pohjoinen", realm: "Kazzak", region: "EU" },
  { name: "Marras", realm: "Kazzak", region: "EU" },
  {
    name: "LkaksP Issue",
    realm: "Stormreaver",
    region: "EU",
    streamers: ["diskopallo"],
  },
  {
    name: "TURTLES KIMBLE",
    realm: "Tarren-Mill",
    region: "EU",
    streamers: ["baldoora", "heiqs"],
  },
  {
    name: "Beyond Harmless",
    realm: "Sylvanas",
    region: "EU",
    streamers: ["jonim0", "deeheals"],
  },
  {
    name: "HinausYhtiö",
    realm: "Twisting-Nether",
    region: "EU",
    streamers: ["aamunkajo_", "rrrrage"],
  },
  {
    name: "Kultzipuppelit",
    realm: "Stormreaver",
    region: "EU",
    streamers: ["janeli"],
  },
  { name: "Taikaolennot", realm: "Outland", region: "EU" },
  {
    name: "Hakkapeliitta",
    realm: "Darkspear",
    region: "EU",
    streamers: ["xofe"],
  },
  { name: "Urheilujätkät", realm: "Stormreaver", region: "EU" },
  {
    name: "Näkijän taru",
    realm: "Bloodfeather",
    region: "EU",
    streamers: ["croukou"],
  },
  { name: "Forbidden", realm: "Vashj", region: "EU", streamers: ["byrchi"] },
  {
    name: "Tony Halme Pro Skater",
    realm: "Stormreaver",
    region: "EU",
    streamers: ["lakuclap", "mjog", "iyni"],
  },
  {
    name: "Slack",
    realm: "Stormreaver",
    region: "EU",
    streamers: ["realriski"],
  },
  {
    name: "Kelacity",
    realm: "Stormreaver",
    region: "EU",
    parent_guild: "Tony Halme Pro Skater",
  },
  {
    name: "Muisted",
    realm: "Stormreaver",
    region: "EU",
    streamers: ["alfamyscars", "purelysofie"],
  },
  {
    name: "TURBO SAAB",
    realm: "Stormreaver",
    region: "EU",
    streamers: ["kartssa"],
  },
  { name: "Rennosti", realm: "Stormreaver", region: "EU" },
  { name: "Winland", realm: "Silvermoon", region: "EU" },
  { name: "Kaaos", realm: "Argent-Dawn", region: "EU" },
  {
    name: "Noni",
    realm: "Stormreaver",
    region: "EU",
    streamers: ["suomimeme"],
  },
  { name: "Memento", realm: "Stormreaver", region: "EU" },
  { name: "Memento", realm: "Frostwhisper", region: "EU" },
  { name: "Karanteeni", realm: "Ravencrest", region: "EU" },
  { name: "Intervention", realm: "Stormreaver", region: "EU" },
  { name: "Saunan Taakse", realm: "Stormreaver", region: "EU" },
  { name: "Northern", realm: "Frostmane", region: "EU" },
  { name: "Anatidaephobia", realm: "Stormreaver", region: "EU" },
  { name: "ei ollu safe", realm: "Stormreaver", region: "EU" },
  {
    name: "Afterburst",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Anatidaephobia",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Angry Moose",
    realm: "Argent-Dawn",
    region: "EU",
  },
  {
    name: "Anonyymi",
    realm: "Darksorrow",
    region: "EU",
  },
  {
    name: "Anonyymi",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "AoK",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Arctic Circle",
    realm: "Darkspear",
    region: "EU",
  },
  {
    name: "Arktiset Olosuhteet",
    realm: "Frostwhisper",
    region: "EU",
  },
  {
    name: "Babylonia",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Barricade",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Beyond Harmless",
    realm: "Sylvanas",
    region: "EU",
  },
  {
    name: "Blackguard",
    realm: "Ravencrest",
    region: "EU",
  },
  {
    name: "Booty Bois",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Delirium",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Diskohuone",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Ebrius",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Eduskunta",
    realm: "Ravencrest",
    region: "EU",
  },
  {
    name: "ei ollu safe",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Enthyn Mussukat",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Epidemia",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Eternium",
    realm: "Argent-Dawn",
    region: "EU",
  },
  {
    name: "Excido",
    realm: "Frostwhisper",
    region: "EU",
  },
  {
    name: "Exploding Labrats",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Farssi",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Fear the Rabbit",
    realm: "Defias-Brotherhood",
    region: "EU",
  },
  {
    name: "Finlandia",
    realm: "Wildhammer",
    region: "EU",
  },
  {
    name: "Finnish Brute Force",
    realm: "Aszune",
    region: "EU",
  },
  {
    name: "FINSTACK",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Forbidden",
    realm: "Vashj",
    region: "EU",
  },
  {
    name: "Gear Factory",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Gentle Wipes",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Gifu",
    realm: "AlAkir",
    region: "EU",
  },
  {
    name: "Gilta",
    realm: "Ravencrest",
    region: "EU",
  },
  {
    name: "graveyard momentum",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Hakkapeliitta",
    realm: "Darkspear",
    region: "EU",
  },
  {
    name: "Hashtag Risuaita",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Herska",
    realm: "Frostwhisper",
    region: "EU",
  },
  {
    name: "Herska",
    realm: "Frostwhisper",
    region: "EU",
  },
  {
    name: "Hikivirta",
    realm: "Tarren-Mill",
    region: "EU",
  },
  {
    name: "HILDA",
    realm: "Silvermoon",
    region: "EU",
  },
  {
    name: "HinausYhtiö",
    realm: "Twisting-Nether",
    region: "EU",
  },
  {
    name: "Horna",
    realm: "Twisting-Nether",
    region: "EU",
  },
  {
    name: "HUHUU",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Hunsvotit",
    realm: "Shattered-Hand",
    region: "EU",
  },
  {
    name: "hyvät ucot",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Härdelli",
    realm: "Twisting-Nether",
    region: "EU",
  },
  {
    name: "IHAN SAMA",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Immersio",
    realm: "Draenor",
    region: "EU",
  },
  {
    name: "Intervention",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Ipit",
    realm: "Lightbringer",
    region: "EU",
  },
  {
    name: "Irstaat Sauvakävelijät",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "ISKÄ TUU TAKAS",
    realm: "Ravencrest",
    region: "EU",
  },
  {
    name: "Kaamos",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Kaaos",
    realm: "Argent-Dawn",
    region: "EU",
  },
  {
    name: "Kalmankaarti",
    realm: "Shattered-Hand",
    region: "EU",
  },
  {
    name: "Kalmankaartí",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Kannunkulma",
    realm: "Twisting-Nether",
    region: "EU",
  },
  {
    name: "Karanteeni",
    realm: "Ravencrest",
    region: "EU",
  },
  {
    name: "Kattotuuletin",
    realm: "Magtheridon",
    region: "EU",
  },
  {
    name: "KHG",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Kilta",
    realm: "Ravencrest",
    region: "EU",
  },
  {
    name: "Kipinä",
    realm: "Twisting-Nether",
    region: "EU",
  },
  {
    name: "Kirous",
    realm: "Twisting-Nether",
    region: "EU",
  },
  {
    name: "Kissanviikset",
    realm: "Silvermoon",
    region: "EU",
  },
  {
    name: "Kitty Cat Death Squad",
    realm: "Chamber-of-Aspects",
    region: "EU",
  },
  {
    name: "Kitty Cat Death Squad",
    realm: "Silvermoon",
    region: "EU",
  },
  {
    name: "Kohmelo",
    realm: "Wildhammer",
    region: "EU",
  },
  {
    name: "Kolmiolääke",
    realm: "Ravencrest",
    region: "EU",
  },
  {
    name: "Kompromissi",
    realm: "Sylvanas",
    region: "EU",
  },
  {
    name: "Korruptio",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Kortisto",
    realm: "Sylvanas",
    region: "EU",
  },
  {
    name: "Koskenkorva",
    realm: "Kazzak",
    region: "EU",
  },
  {
    name: "Kossukolalla",
    realm: "The Maelstrom",
    region: "EU",
  },
  {
    name: "Kovisjengi",
    realm: "Wildhammer",
    region: "EU",
  },
  {
    name: "Kukko",
    realm: "Stormscale",
    region: "EU",
  },
  {
    name: "Kultzipuppelit",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Kuura",
    realm: "Argent-Dawn",
    region: "EU",
  },
  {
    name: "Kyy",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "käsipainoilla bodaus",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Lakko",
    realm: "Defias-Brotherhood",
    region: "EU",
  },
  {
    name: "Legio Pro Fennia",
    realm: "Draenor",
    region: "EU",
  },
  {
    name: "Legioona",
    realm: "Balnazzar",
    region: "EU",
  },
  {
    name: "Legioona",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Leipäjuusto Oy",
    realm: "Argent-Dawn",
    region: "EU",
  },
  {
    name: "Level One",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Liekkiö",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Likasimmat",
    realm: "Defias-Brotherhood",
    region: "EU",
  },
  {
    name: "LkaksP Issue",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Los Ratardos",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Luottamuspula",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "M A N I A C XD",
    realm: "Twisting-Nether",
    region: "EU",
  },
  {
    name: "Mambo",
    realm: "Tarren-Mill",
    region: "EU",
  },
  {
    name: "Materia",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Memento",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Memento",
    realm: "Frostwhisper",
    region: "EU",
  },
  {
    name: "Metalocalypse",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Metsien Kusipäät",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Metsäbileet",
    realm: "Draenor",
    region: "EU",
  },
  {
    name: "MONGO",
    realm: "Stormscale",
    region: "EU",
  },
  {
    name: "Morian Dwarfs",
    realm: "Twisting-Nether",
    region: "EU",
  },
  {
    name: "Moti",
    realm: "Kazzak",
    region: "EU",
  },
  {
    name: "Muisted",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Myrsky",
    realm: "Silvermoon",
    region: "EU",
  },
  {
    name: "Naapurit",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Naava",
    realm: "Frostwhisper",
    region: "EU",
  },
  {
    name: "Napalmikuolema",
    realm: "Zenedar",
    region: "EU",
  },
  {
    name: "Napista",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Nave",
    realm: "Kazzak",
    region: "EU",
  },
  {
    name: "Nestehukka",
    realm: "Magtheridon",
    region: "EU",
  },
  {
    name: "Nimettömät",
    realm: "Silvermoon",
    region: "EU",
  },
  {
    name: "Ninjapartio",
    realm: "Darksorrow",
    region: "EU",
  },
  {
    name: "Niskalaukaus",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Noni",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Northsky",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "NYRKEILLÄ",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Näkijän taru",
    realm: "Bloodfeather",
    region: "EU",
  },
  {
    name: "Olohuone",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Omituisten Otusten Kerho",
    realm: "Silvermoon",
    region: "EU",
  },
  {
    name: "Original",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Original Double Salted",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Papan synttärit",
    realm: "Silvermoon",
    region: "EU",
  },
  {
    name: "Pari Pelikaljaa",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Pari Pelikaljaa",
    realm: "Ravencrest",
    region: "EU",
  },
  {
    name: "Perspektiivi",
    realm: "Silvermoon",
    region: "EU",
  },
  {
    name: "Pimento",
    realm: "Twisting-Nether",
    region: "EU",
  },
  {
    name: "Pirtti",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Pohjoinen",
    realm: "Darksorrow",
    region: "EU",
  },
  {
    name: "Pohjoinen",
    realm: "Kazzak",
    region: "EU",
  },
  {
    name: "Pohjola",
    realm: "Frostwhisper",
    region: "EU",
  },
  {
    name: "Pohjosen Susilauma",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "POINTY HAT CREW",
    realm: "QuelThalas",
    region: "EU",
  },
  {
    name: "Pro Finlandia",
    realm: "Nordrassil",
    region: "EU",
  },
  {
    name: "Pro Finlandia",
    realm: "Silvermoon",
    region: "EU",
  },
  {
    name: "Pulumafia",
    realm: "Stormscale",
    region: "EU",
  },
  {
    name: "Päiväkoti",
    realm: "Silvermoon",
    region: "EU",
  },
  {
    name: "Quarantine",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Raging Pandas",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Rajatila",
    realm: "Bladefist",
    region: "EU",
  },
  {
    name: "Raukka Painaa Jarrua",
    realm: "Zenedar",
    region: "EU",
  },
  {
    name: "Rauta",
    realm: "Twisting-Nether",
    region: "EU",
  },
  {
    name: "RDH",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Remnant",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Rennosti",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Retkikunta",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Ripcord",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Riskiryhmä",
    realm: "Tarren-Mill",
    region: "EU",
  },
  {
    name: "Roistot",
    realm: "Twisting-Nether",
    region: "EU",
  },
  {
    name: "Rooster Ranch",
    realm: "Lightnings-Blade",
    region: "EU",
  },
  {
    name: "Rotko",
    realm: "Darksorrow",
    region: "EU",
  },
  {
    name: "Routa",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Ruojat",
    realm: "Kazzak",
    region: "EU",
  },
  {
    name: "Rupusakki",
    realm: "Frostwhisper",
    region: "EU",
  },
  {
    name: "Rustlers",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Ryöstöretki",
    realm: "Darksorrow",
    region: "EU",
  },
  {
    name: "Satanolla",
    realm: "Silvermoon",
    region: "EU",
  },
  {
    name: "Saunan Taakse",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Saunatauko",
    realm: "Bladefist",
    region: "EU",
  },
  {
    name: "Schwein",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Selkäsauna",
    realm: "Draenor",
    region: "EU",
  },
  {
    name: "Send Help",
    realm: "Frostwhisper",
    region: "EU",
  },
  {
    name: "SEPON KALASEURA",
    realm: "Ravencrest",
    region: "EU",
  },
  {
    name: "SHC",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Sheldonia",
    realm: "Draenor",
    region: "EU",
  },
  {
    name: "Silmitön Nuke",
    realm: "Wildhammer",
    region: "EU",
  },
  {
    name: "Sinister",
    realm: "Kazzak",
    region: "EU",
  },
  {
    name: "Sinners Inc",
    realm: "Bloodfeather",
    region: "EU",
  },
  {
    name: "Sisu",
    realm: "Draenor",
    region: "EU",
  },
  {
    name: "Sisu",
    realm: "Veknilash",
    region: "EU",
  },
  {
    name: "Sisu",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Sisäpiiri",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Slack",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Slummatti",
    realm: "Chamber-of-Aspects",
    region: "EU",
  },
  {
    name: "Soppa",
    realm: "Sylvanas",
    region: "EU",
  },
  {
    name: "Soppa",
    realm: "Emerald Dream",
    region: "EU",
  },
  {
    name: "Sotkamon Jymy",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "SOULKEEPERS",
    realm: "Kazzak",
    region: "EU",
  },
  {
    name: "Sydäntalvi",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Synergia",
    realm: "Outland",
    region: "EU",
  },
  {
    name: "Taikaolennot",
    realm: "Outland",
    region: "EU",
  },
  {
    name: "Talotaikurit",
    realm: "Twisting-Nether",
    region: "EU",
  },
  {
    name: "Talvisota",
    realm: "Draenor",
    region: "EU",
  },
  {
    name: "Tervaleijona",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Tervaleijona",
    realm: "Burning-Steppes",
    region: "EU",
  },
  {
    name: "The Arctica",
    realm: "Darksorrow",
    region: "EU",
  },
  {
    name: "The Chain of Dogs",
    realm: "Vashj",
    region: "EU",
  },
  {
    name: "The Karelian Isthmus",
    realm: "Khadgar",
    region: "EU",
  },
  {
    name: "Thousands Of Lakes",
    realm: "Vashj",
    region: "EU",
  },
  {
    name: "Thy Flesh Consumed",
    realm: "Earthen Ring",
    region: "EU",
  },
  {
    name: "Tony Halme Pro Skater",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Traditio",
    realm: "Draenor",
    region: "EU",
  },
  {
    name: "Travestia",
    realm: "Ragnaros",
    region: "EU",
  },
  {
    name: "Tröllin Likaiset Varpaat",
    realm: "Laughing-Skull",
    region: "EU",
  },
  {
    name: "Tuju",
    realm: "Kazzak",
    region: "EU",
  },
  {
    name: "Tulikaste",
    realm: "Chamber-of-Aspects",
    region: "EU",
  },
  {
    name: "Tunnel Vision",
    realm: "Ravencrest",
    region: "EU",
  },
  {
    name: "TURBO SAAB",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Turpasauna",
    realm: "Lightnings-Blade",
    region: "EU",
  },
  {
    name: "TURTLES KIMBLE",
    realm: "Tarren-Mill",
    region: "EU",
  },
  {
    name: "Twilight Sentinels",
    realm: "Ravencrest",
    region: "EU",
  },
  {
    name: "Työmaa",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Uimakoulu Titanic",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Underdogs",
    realm: "Ravencrest",
    region: "EU",
  },
  {
    name: "Unit of FaceRollers",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Univaje",
    realm: "Kul Tiras",
    region: "EU",
  },
  {
    name: "Univelka",
    realm: "Tarren-Mill",
    region: "EU",
  },
  {
    name: "Usva",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Vaakamambo",
    realm: "Tarren-Mill",
    region: "EU",
  },
  {
    name: "Valiojoukko",
    realm: "Argent-Dawn",
    region: "EU",
  },
  {
    name: "Valkoiset Mitsut",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Valo",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "VIIKATE",
    realm: "Sunstrider",
    region: "EU",
  },
  {
    name: "Visio",
    realm: "Darksorrow",
    region: "EU",
  },
  {
    name: "VMTL",
    realm: "Twisting-Nether",
    region: "EU",
  },
  {
    name: "Voimafantasiat",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Väkívaltakunta",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Winland",
    realm: "Silvermoon",
    region: "EU",
  },
  {
    name: "Wipe Circus",
    realm: "Silvermoon",
    region: "EU",
  },
  {
    name: "Wowikyyry",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Ykkösellä",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Yövuoro",
    realm: "Ravencrest",
    region: "EU",
  },
  {
    name: "YSKÄ",
    realm: "Stormreaver",
    region: "EU",
  },
  {
    name: "Sorvan Kylä",
    realm: "Ravencrest",
    region: "EU",
  },
  {
    name: "Anonyymit Wowittajat",
    realm: "Ravencrest",
    region: "EU",
  },
];

// Raid zones to track (IDs only - names and encounter info come from DB)
export const TRACKED_RAIDS = [
  53, // The Venomous Abyss / The Tidebound Grotto
  50, // Sporefall
  46, // Voidspire / Dreamrift / March on Quel'Danas
  44, // Manaforge Omega
  42, // Liberation of Undermine
  38, // Nerubar Palace
  35, // Amirdrassil the Dreams Hope
  33, // Aberrus, the Shadowed Crucible
  31, // Vault of the Incarnates
  29, // Sepulcher of the First Ones
  28, // Sanctum of Domination
  26, // Castle Nathria
  24, // Ny'alotha, the Waking City
  23, // The Eternal Palace
  22, // Crucible of Storms
  21, // Battle of Dazar'alor
  19, // Uldir
  17, // Antorus, the Burning Throne
  13, // Tomb of Sargeras
  12, // Trial of Valor
  11, // The Nighthold
  10, // Emerald Nightmare
  8, // Hellfire Citadel
  7, // Blackrock Foundry
  6, // Highmaul
  5, // Siege of Orgrimmar
  4, // Throne of Thunder
];

// Raider.IO expansion IDs to query (newest to oldest)
export const RAIDER_IO_EXPANSION_IDS = [11, 10, 9, 8, 7, 6];

// WarcraftLogs zone ID -> Raider.IO raid slug.
// Raider.IO only exposes retail raid static data from Legion onward.
export const RAID_RIO_SLUG_OVERRIDES: Record<number, string> = {
  53: "the-venomous-abyss",
  50: "sporefall",
  46: "tier-mn-1",
  44: "manaforge-omega",
  42: "liberation-of-undermine",
  38: "nerubar-palace",
  35: "amirdrassil-the-dreams-hope",
  33: "aberrus-the-shadowed-crucible",
  31: "vault-of-the-incarnates",
  29: "sepulcher-of-the-first-ones",
  28: "sanctum-of-domination",
  26: "castle-nathria",
  24: "nyalotha-the-waking-city",
  23: "the-eternal-palace",
  22: "crucible-of-storms",
  21: "battle-of-dazaralor",
  19: "uldir",
  17: "antorus-the-burning-throne",
  13: "tomb-of-sargeras",
  12: "trial-of-valor",
  11: "the-nighthold",
  10: "the-emerald-nightmare",
};

// Some WarcraftLogs zones are split into multiple raid tiers by Raider.IO.
// These slugs are combined into one official progress entry for the WCL zone.
export const RAID_RIO_PROGRESS_SLUG_OVERRIDES: Record<number, readonly string[]> = {
  53: ["the-tidebound-grotto", "the-venomous-abyss"],
};

// Raider.IO rankings use the configured primary raid slug even when progress
// is aggregated from multiple Raider.IO raids into one WarcraftLogs zone.
export const RAID_RIO_RANKING_DISABLED_IDS = new Set<number>();

// Current raids that are actively being tracked for updates
// Multiple raids can be current at the same time during expansion transitions.
// PRIMARY_RAID_ID is the raid used for single-raid defaults and featured views.
export const PRIMARY_RAID_ID = 53;
export const CURRENT_RAID_IDS = [53];

// Main raid tier(s) used to find likely returning guilds during the launch
// window. Side raids such as Sporefall are intentionally excluded.
export const TIER_TRANSITION_PREVIOUS_RAID_IDS = [46];
export const RECENT_RAID_DATE_REFRESH_IDS = [
  ...CURRENT_RAID_IDS,
  ...TRACKED_RAIDS.filter((raidId) => !CURRENT_RAID_IDS.includes(raidId)).slice(0, 2),
];

export const DIFFICULTIES = {
  MYTHIC: 5,
  HEROIC: 4,
  NORMAL: 3,
  LFR: 1,
};

// Manual raid dates for raids not available in Raider.IO API
// These are EU region dates only for now
export const MANUAL_RAID_DATES = [
  {
    id: 4,
    name: "Throne of Thunder",
    euStartDate: "2013-03-06",
    euEndDate: "2013-09-11",
  },
  {
    id: 5,
    name: "Siege of Orgrimmar",
    euStartDate: "2013-09-11",
    euEndDate: "2014-12-03",
  },
  {
    id: 6,
    name: "Highmaul",
    euStartDate: "2014-12-03",
    euEndDate: "2015-02-04",
  },
  {
    id: 7,
    name: "Blackrock Foundry",
    euStartDate: "2015-02-04",
    euEndDate: "2015-06-24",
  },
  {
    id: 8,
    name: "Hellfire Citadel",
    euStartDate: "2015-06-24",
    euEndDate: "2016-07-20",
  },
];

// Custom PickEms, pick world first guild, top 3, this is hardcoded to: options being: Liquid, Echo, Method, 火 锅 英 雄, FatSharkYes
export const PICK_EM_RWF_GUILDS = [
  "Liquid",
  "Echo",
  "Method",
  "Instant Dollars",
  "FatSharkYes",
  "Synergy",
  "Mate",
  "Huoguo Yingxiong (火锅英雄)",
  "Ji Tian Hong (佶天鸿)",
  "Banhammer",
  "LAGET",
  "Advance",
  "Xiang Yu (项羽)",
  "Honestly",
  "Gnev Anarkhii (Гнев Анархии)",
  "xD",
  "poptart corndoG",
  "Northern Sky",
  "Rak Geyming (Рак Гейминг)",
  "Evolve",
  "Project",
  "Ethical",
  "Exposed",
  "End Myth (燃烧之刃)",
  "Wave",
  "JSUUG",
  "Identity",
  "Mate",
  "Banhammer",
];
