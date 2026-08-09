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
export const CCG_EMBED_IMAGE = `${SITE_URL}/suomiwow-share.png`;
export const CCG_EMBED_IMAGE_ALT = "SuomiWoW";
export const CCG_EMBED_IMAGE_WIDTH = 512;
export const CCG_EMBED_IMAGE_HEIGHT = 512;

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
  embedCta?: string;
  embedVariant?: "vault" | "open" | "collection";
};

type PageSeoCopy = Pick<PageSeoMetadata, "title" | "description" | "embedCta" | "embedVariant">;

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
  { path: "/ccg", changeFrequency: "daily", priority: 0.75 },
  { path: "/ccg/open", changeFrequency: "daily", priority: 0.65 },
  { path: "/ccg/collection", changeFrequency: "daily", priority: 0.65 },
  { path: "/privacy", changeFrequency: "yearly", priority: 0.2 },
  { path: "/terms", changeFrequency: "yearly", priority: 0.2 },
] as const;

export function getCanonicalUrl(pathname: string = "/") {
  const normalizedPathname = pathname === "/" ? "" : pathname;
  return `${SITE_URL}${normalizedPathname}`;
}

export function getPageEmbedImageUrl(metadata: PageSeoMetadata) {
  if (metadata.embedLabel === "SuomiWoW CCG") {
    return CCG_EMBED_IMAGE;
  }

  const params = new URLSearchParams({
    title: metadata.title,
    description: metadata.description,
    label: metadata.embedLabel,
  });

  return `${SITE_IMAGE}?${params.toString()}`;
}

export function getPageEmbedImageAlt(metadata: PageSeoMetadata) {
  return metadata.embedLabel === "SuomiWoW CCG"
    ? CCG_EMBED_IMAGE_ALT
    : metadata.imageAlt;
}

export function getPageEmbedImageSize(metadata: PageSeoMetadata) {
  return metadata.embedLabel === "SuomiWoW CCG"
    ? { width: CCG_EMBED_IMAGE_WIDTH, height: CCG_EMBED_IMAGE_HEIGHT }
    : { width: EMBED_IMAGE_WIDTH, height: EMBED_IMAGE_HEIGHT };
}

export function getPageTwitterCard() {
  return "summary";
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
  if (pathname === "/search") return "Search";
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
  if (pathname.startsWith("/ccg")) return "SuomiWoW CCG";
  if (pathname.startsWith("/fun")) return "Game prototype";
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
    "/search": {
      title: isEnglish ? "Search Guilds and Characters" : "Hae kiltoja ja hahmoja",
      description: isEnglish
        ? "Search current and historical Finnish WoW guilds and characters, including names with accented letters."
        : "Hae nykyisiä ja historiallisia suomalaisia WoW-kiltoja ja hahmoja myös ilman nimien erikoismerkkejä.",
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
    "/ccg": {
      title: isEnglish ? "SuomiWoW CCG — Free Character Card Packs" : "SuomiWoW CCG — Maksuttomia hahmokorttipakkoja",
      description: isEnglish
        ? "Open free packs, collect familiar names from Finland's WoW scene across every raid tier, and share your best pulls. Packs recharge automatically."
        : "Avaa maksuttomia pakkoja, kerää tuttuja nimiä Suomen WoW-skenestä eri raid-tiereiltä ja jaa parhaat nostosi. Pakat latautuvat automaattisesti.",
      embedCta: isEnglish ? "Open free packs" : "Avaa maksuttomia pakkoja",
      embedVariant: "vault",
    },
    "/ccg/open": {
      title: isEnglish ? "Open a Free SuomiWoW CCG Pack" : "Avaa maksuton SuomiWoW CCG -pakka",
      description: isEnglish
        ? "Your packs are ready. Choose Current, Legacy, or a favourite raid, reveal five character cards, and share your best pull."
        : "Pakkasi odottavat. Valitse Current, Legacy tai suosikkiraidisi, paljasta viisi hahmokorttia ja jaa paras nostosi.",
      embedCta: isEnglish ? "Reveal five cards" : "Paljasta viisi korttia",
      embedVariant: "open",
    },
    "/ccg/collection": {
      title: isEnglish ? "Explore SuomiWoW Character Cards" : "Tutustu SuomiWoW-hahmokortteihin",
      description: isEnglish
        ? "Browse Finnish WoW raiders across Current, Legacy, and Community sets—then open a free pack and start your own collection."
        : "Selaa Suomen WoW-skenen hahmokortteja Current-, Legacy- ja Community-seteissä — avaa maksuton pakka ja aloita oma kokoelmasi.",
      embedCta: isEnglish ? "Explore the card vault" : "Tutustu korttiholviin",
      embedVariant: "collection",
    },
    "/fun": {
      title: isEnglish ? "Game Prototypes" : "Peliprototyypit",
      description: isEnglish
        ? "Try experimental guessing games built from Finnish WoW guild and character data."
        : "Kokeile suomalaisten WoW-kiltojen ja hahmojen tiedoista tehtyjä kokeellisia arvauspelejä.",
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

  if (pathname.startsWith("/fun/")) {
    return withEmbedMetadata(pathname, pages["/fun"]);
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
