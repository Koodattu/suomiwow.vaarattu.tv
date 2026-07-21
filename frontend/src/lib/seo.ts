export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || "https://suomiwow.vaarattu.tv"
).replace(/\/$/, "");
export const SITE_NAME = "Suomi WoW";
export const SITE_DESCRIPTION =
  "Suomi WoW tracks Finnish World of Warcraft guild progress, suomalaiset WoW-killat, raid progression, boss kills, schedules, livestreams, and events.";
export const SITE_IMAGE = `${SITE_URL}/api/og`;
export const SITE_IMAGE_ALT = "Suomi WoW Finnish World of Warcraft page preview";
export const EMBED_IMAGE_WIDTH = 512;
export const EMBED_IMAGE_HEIGHT = 512;

export const SEO_KEYWORDS = [
  "Suomi WoW",
  "SuomiWoW",
  "Finnish WoW guild",
  "Finnish WoW guilds",
  "Finnish World of Warcraft guild",
  "suomalaiset WoW-killat",
  "suomalainen WoW kilta",
  "suomi wow kilta",
  "suomi wowi kilta",
  "WoW kilta",
  "WoW raid progress Finland",
];

type Locale = "en" | "fi";

export type PageSeoMetadata = {
  title: string;
  description: string;
  embedLabel: string;
  imageAlt: string;
};

type PageSeoCopy = Pick<PageSeoMetadata, "title" | "description">;

export const PUBLIC_ROUTES = [
  { path: "/", changeFrequency: "hourly", priority: 1 },
  { path: "/guilds", changeFrequency: "daily", priority: 0.9 },
  { path: "/characters", changeFrequency: "daily", priority: 0.75 },
  { path: "/analytics/compare", changeFrequency: "daily", priority: 0.75 },
  { path: "/raid-analytics", changeFrequency: "daily", priority: 0.75 },
  { path: "/timetable", changeFrequency: "daily", priority: 0.75 },
  { path: "/livestreams", changeFrequency: "hourly", priority: 0.7 },
  { path: "/events", changeFrequency: "hourly", priority: 0.7 },
  { path: "/tierlists", changeFrequency: "weekly", priority: 0.65 },
  { path: "/pickems", changeFrequency: "daily", priority: 0.65 },
  { path: "/pickems-rules", changeFrequency: "monthly", priority: 0.35 },
  { path: "/fun/ccg", changeFrequency: "daily", priority: 0.75 },
  { path: "/fun/ccg/open", changeFrequency: "daily", priority: 0.65 },
  { path: "/fun/ccg/collection", changeFrequency: "daily", priority: 0.65 },
  { path: "/privacy", changeFrequency: "yearly", priority: 0.2 },
  { path: "/terms", changeFrequency: "yearly", priority: 0.2 },
] as const;

export function getCanonicalUrl(pathname: string = "/") {
  const normalizedPathname = pathname === "/" ? "" : pathname;
  return `${SITE_URL}${normalizedPathname}`;
}

export function getPageEmbedImageUrl(metadata: PageSeoMetadata) {
  const params = new URLSearchParams({
    title: metadata.title,
    description: metadata.description,
    label: metadata.embedLabel,
  });

  return `${SITE_IMAGE}?${params.toString()}`;
}

function decodePathSegment(segment: string) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function getEmbedLabel(pathname: string) {
  if (pathname === "/" || pathname === "/progress") return "Guild progress";
  if (pathname.startsWith("/guilds/")) return "Guild profile";
  if (pathname === "/guilds") return "Guild directory";
  if (pathname.startsWith("/characters/")) return "Character profile";
  if (pathname === "/characters") return "Character rankings";
  if (pathname === "/compare" || pathname === "/analytics/compare") return "Guild comparison";
  if (pathname === "/analytics/network") return "Guild network";
  if (pathname.startsWith("/analytics")) return "Analytics";
  if (pathname === "/raid-analytics") return "Raid analytics";
  if (pathname === "/events") return "Live events";
  if (pathname === "/livestreams") return "Livestreams";
  if (pathname === "/timetable") return "Raid timetable";
  if (pathname === "/tierlists") return "Tier lists";
  if (pathname === "/pickems") return "Pickems";
  if (pathname === "/pickems-rules") return "Pickems rules";
  if (pathname.startsWith("/fun/ccg")) return "SuomiWoW CCG";
  if (pathname === "/privacy") return "Privacy";
  if (pathname === "/terms") return "Terms";
  if (pathname.startsWith("/profile")) return "Profile";

  return "Finnish WoW";
}

function withEmbedMetadata(pathname: string, metadata: PageSeoCopy): PageSeoMetadata {
  return {
    ...metadata,
    embedLabel: getEmbedLabel(pathname),
    imageAlt: `${metadata.title} preview on ${SITE_NAME}`,
  };
}

export function getPageMetadata(
  pathname: string,
  locale: Locale,
): PageSeoMetadata {
  const isEnglish = locale === "en";

  const pages: Record<string, PageSeoCopy> = {
    "/": {
      title: isEnglish
        ? "Finnish WoW Guild Progress"
        : "Suomalaisten WoW-kiltojen edistyminen",
      description: isEnglish
        ? "Track Finnish World of Warcraft guild progress on Suomi WoW: raid progression, boss kills, schedules, livestreams, and events for suomalaiset WoW-killat."
        : "Seuraa suomalaisten World of Warcraft -kiltojen raid-edistymista: boss-tapot, aikataulut, striimit ja tapahtumat yhdessa paikassa.",
    },
    "/progress": {
      title: isEnglish
        ? "Finnish WoW Guild Progress"
        : "Suomalaisten WoW-kiltojen edistyminen",
      description: isEnglish
        ? "Track Finnish World of Warcraft guild progress on Suomi WoW: raid progression, boss kills, schedules, livestreams, and events for suomalaiset WoW-killat."
        : "Seuraa suomalaisten World of Warcraft -kiltojen raid-edistymista: boss-tapot, aikataulut, striimit ja tapahtumat yhdessa paikassa.",
    },
    "/guilds": {
      title: isEnglish ? "Finnish WoW Guilds" : "Suomalaiset WoW-killat",
      description: isEnglish
        ? "Browse Finnish WoW guilds, Suomi WoW kilta listings, realms, factions, and raid progression."
        : "Selaa suomalaisia WoW-kiltoja, realmeja, factioneita ja raid-edistymista.",
    },
    "/characters": {
      title: isEnglish ? "Character Rankings" : "Hahmorankingit",
      description: isEnglish
        ? "Rank Finnish WoW guild characters by raid performance, roles, specs, and boss progress."
        : "Katso suomalaisten WoW-kiltojen hahmorankingit roolin, specin ja raid-suoritusten mukaan.",
    },
    "/compare": {
      title: isEnglish
        ? "Compare Finnish WoW Guilds"
        : "Vertaile suomalaisia WoW-kiltoja",
      description: isEnglish
        ? "Compare Finnish WoW guild raid metrics by raid tier, progress, pulls, and boss kills."
        : "Vertaile suomalaisten WoW-kiltojen raid-mittareita raidin, edistymisen, yritysten ja boss-tappojen mukaan.",
    },
    "/analytics/compare": {
      title: isEnglish
        ? "Compare Finnish WoW Guilds"
        : "Vertaile suomalaisia WoW-kiltoja",
      description: isEnglish
        ? "Compare Finnish WoW guild raid metrics by raid tier, progress, pulls, and boss kills."
        : "Vertaile suomalaisten WoW-kiltojen raid-mittareita raidin, edistymisen, yritysten ja boss-tappojen mukaan.",
    },
    "/raid-analytics": {
      title: isEnglish
        ? "Finnish WoW Raid Analytics"
        : "Suomalaisten WoW-raidien analytiikka",
      description: isEnglish
        ? "Analyze Finnish WoW guild raid progress, boss pull counts, kill times, and performance trends."
        : "Analysoi suomalaisten WoW-kiltojen raid-edistymista, pull-maaria, tappoaikoja ja suorituskehitysta.",
    },
    "/events": {
      title: isEnglish
        ? "Finnish WoW Guild Events"
        : "Suomalaisten WoW-kiltojen tapahtumat",
      description: isEnglish
        ? "Latest boss kills, best pulls, and raid events from Finnish WoW guilds."
        : "Viimeisimmat boss-tapot, parhaat yritykset ja raid-tapahtumat suomalaisilta WoW-killoilta.",
    },
    "/livestreams": {
      title: isEnglish
        ? "Finnish WoW Livestreams"
        : "Suomalaisten WoW-kiltojen striimit",
      description: isEnglish
        ? "Watch live World of Warcraft raid streams from Finnish guild members."
        : "Katso suomalaisten kiltalaisten World of Warcraft -raidistriimeja livena.",
    },
    "/timetable": {
      title: isEnglish
        ? "Finnish WoW Raid Timetable"
        : "Suomalaisten WoW-kiltojen raid-aikataulu",
      description: isEnglish
        ? "View raid schedules for Finnish WoW guilds and suomalaiset WoW-killat."
        : "Katso suomalaisten WoW-kiltojen raid-aikataulut ja raidipaivat.",
    },
    "/tierlists": {
      title: isEnglish
        ? "Finnish WoW Guild Tier Lists"
        : "Suomalaisten WoW-kiltojen tier-listat",
      description: isEnglish
        ? "Compare Finnish WoW guild tier lists by speed, efficiency, raid progress, and boss kills."
        : "Vertaile suomalaisten WoW-kiltojen tier-listoja nopeuden, tehokkuuden, raid-edistymisen ja boss-tappojen mukaan.",
    },
    "/pickems": {
      title: isEnglish
        ? "Finnish WoW Guild Pickems"
        : "Suomalaisten WoW-kiltojen veikkaukset",
      description: isEnglish
        ? "Make and follow Finnish WoW guild raid race pickems for current raid tiers."
        : "Tee ja seuraa suomalaisten WoW-kiltojen raid race -veikkauksia nykyisille raideille.",
    },
    "/pickems-rules": {
      title: isEnglish ? "Pickems Rules" : "Veikkausten saannot",
      description: isEnglish
        ? "Rules and scoring information for Finnish WoW guild raid race pickems."
        : "Saannot ja pisteytys suomalaisten WoW-kiltojen raid race -veikkauksille.",
    },
    "/fun/ccg": {
      title: isEnglish ? "SuomiWoW Character Cards" : "SuomiWoW-hahmokortit",
      description: isEnglish
        ? "Open free raid-set character card packs and collect immutable snapshots of Finnish WoW raiders."
        : "Avaa maksuttomia raidisettien hahmokorttipakkoja ja kerää suomalaisten WoW-raidaajien snapshotteja.",
    },
    "/fun/ccg/open": {
      title: isEnglish ? "Open Character Card Packs" : "Avaa hahmokorttipakkoja",
      description: isEnglish
        ? "Open daily Current and Legacy SuomiWoW CCG packs for free."
        : "Avaa päivittäiset maksuttomat Current- ja Legacy-SuomiWoW CCG -pakat.",
    },
    "/fun/ccg/collection": {
      title: isEnglish ? "Character Card Collection" : "Hahmokorttikokoelma",
      description: isEnglish
        ? "Browse raid binders, character card finishes, quantities, and missing cards in SuomiWoW CCG."
        : "Selaa SuomiWoW CCG:n raidikansioita, korttien viimeistelyjä, määriä ja puuttuvia kortteja.",
    },
    "/privacy": {
      title: isEnglish ? "Privacy Policy" : "Tietosuojakaytanto",
      description: isEnglish
        ? "Privacy policy for Suomi WoW, the Finnish WoW guild progress tracker."
        : "Suomi WoW -sivuston tietosuojakaytanto.",
    },
    "/terms": {
      title: isEnglish ? "Terms of Service" : "Kayttoehdot",
      description: isEnglish
        ? "Terms of service for Suomi WoW, the Finnish WoW guild progress tracker."
        : "Suomi WoW -sivuston kayttoehdot.",
    },
    "/profile": {
      title: isEnglish ? "Profile" : "Profiili",
      description: isEnglish
        ? "View and manage your Suomi WoW profile."
        : "Nayta ja hallitse Suomi WoW -profiiliasi.",
    },
  };

  if (pathname.startsWith("/guilds/") && pathname.split("/").length >= 4) {
    const parts = pathname.split("/");
    const realm = decodePathSegment(parts[2] || "");
    const guildName = decodePathSegment(parts[3] || "");

    return withEmbedMetadata(pathname, {
      title: `${guildName} - ${realm}`,
      description: isEnglish
        ? `View ${guildName} raid progression, boss kills, logs, streams, and guild details on ${realm}.`
        : `Katso ${guildName}-killan raid-edistyminen, boss-tapot, logit, striimit ja tiedot realmilla ${realm}.`,
    });
  }

  if (pathname.startsWith("/characters/") && pathname.split("/").length >= 4) {
    const parts = pathname.split("/");
    const realm = decodePathSegment(parts[2] || "");
    const characterName = decodePathSegment(parts[3] || "");

    return withEmbedMetadata(pathname, {
      title: `${characterName} - ${realm}`,
      description: isEnglish
        ? `View ${characterName}'s raid rankings, guild history, mechanics, and logs on ${realm}.`
        : `Katso hahmon ${characterName} raid-rankingit, kiltahistoria, mekaniikat ja logit realmilla ${realm}.`,
    });
  }

  return withEmbedMetadata(pathname, pages[pathname] || pages["/"]);
}

export function buildWebSiteStructuredData() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    alternateName: [
      "SuomiWoW",
      "Suomi WoW Progress",
      "Finnish WoW Guild Progress",
    ],
    url: `${SITE_URL}/`,
    description: SITE_DESCRIPTION,
    inLanguage: ["en", "fi"],
    keywords: SEO_KEYWORDS,
  };
}
