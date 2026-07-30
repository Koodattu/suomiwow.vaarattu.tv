import "server-only";

import type { Metadata } from "next";
import enMessages from "../../messages/en.json";
import fiMessages from "../../messages/fi.json";
import type { CcgFinish, CcgOpening, CcgShare, CcgTierGrade } from "@/types";
import { hydrateCcgShare, type CcgShareWire } from "@/lib/ccg-wire";
import { CCG_FINISH_ORDER, CCG_RARITY_KEYS } from "@/lib/ccg";
import {
  CCG_EMBED_IMAGE,
  CCG_EMBED_IMAGE_ALT,
  CCG_EMBED_IMAGE_HEIGHT,
  CCG_EMBED_IMAGE_WIDTH,
  SITE_NAME,
  SITE_URL,
} from "@/lib/seo";

export type CcgEmbedLocale = "en" | "fi";
export type CcgShareSearchParams = Record<string, string | string[] | undefined> & {
  lang?: string | string[];
};

const EMBED_COPY = {
  en: enMessages.ccg,
  fi: fiMessages.ccg,
} as const;

const GRADE_ORDER: readonly CcgTierGrade[] = ["F", "E", "D", "C", "B", "A", "S", "H"];

function interpolate(template: string, values: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match
  ));
}

export function resolveCcgEmbedLocale(value: string | string[] | undefined): CcgEmbedLocale {
  const locale = Array.isArray(value) ? value[0] : value;
  return locale === "fi" ? "fi" : "en";
}

export function getCcgSharePath(shareId: string, searchParams?: CcgShareSearchParams) {
  const path = `/ccg/share/${encodeURIComponent(shareId)}`;
  if (!searchParams) return path;

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (Array.isArray(value)) {
      value.forEach((item) => query.append(key, item));
    } else if (value !== undefined) {
      query.set(key, value);
    }
  }

  const serializedQuery = query.toString();
  return serializedQuery ? `${path}?${serializedQuery}` : path;
}

export function getCcgEmbedCopy(locale: CcgEmbedLocale) {
  return EMBED_COPY[locale];
}

export function getCcgFinishLabel(locale: CcgEmbedLocale, finish: CcgFinish) {
  return (EMBED_COPY[locale].finish as Record<CcgFinish, string>)[finish];
}

export function getCcgRarityLabel(locale: CcgEmbedLocale, grade: CcgTierGrade) {
  const rarity = CCG_RARITY_KEYS[grade];
  return (EMBED_COPY[locale].rarity as Record<(typeof CCG_RARITY_KEYS)[CcgTierGrade], string>)[rarity];
}

export function getCcgPackType(pack: CcgOpening, locale: CcgEmbedLocale) {
  const targetSetId = pack.selection.type === "raid" ? pack.selection.setId : null;
  const primarySet = targetSetId
    ? pack.sets.find((set) => set.id === targetSetId) ?? pack.sets[0]
    : pack.sets[0];

  if (pack.selection.type === "all") return EMBED_COPY[locale].open.allRaids;
  return primarySet?.raidName ?? EMBED_COPY[locale].share.embed.raidPack;
}

export function getBestPackResult(pack: CcgOpening) {
  return [...pack.results].sort((left, right) => (
    CCG_FINISH_ORDER.indexOf(right.finish) - CCG_FINISH_ORDER.indexOf(left.finish)
    || GRADE_ORDER.indexOf(right.card.tierGrade) - GRADE_ORDER.indexOf(left.card.tierGrade)
    || left.position - right.position
  ))[0] ?? null;
}

export async function fetchCcgShare(shareId: string): Promise<CcgShare | null> {
  const apiUrl = process.env.API_URL || "http://localhost:3001";

  try {
    const response = await fetch(`${apiUrl}/api/ccg/shares/${encodeURIComponent(shareId)}`, {
      next: { revalidate: 3600 },
    });
    if (!response.ok) return null;
    return hydrateCcgShare(await response.json() as CcgShareWire);
  } catch {
    return null;
  }
}

function getShareCopy(share: CcgShare, locale: CcgEmbedLocale) {
  const copy = EMBED_COPY[locale].share.embed;

  if (share.kind === "card") {
    const { card, finish } = share.card;
    const values = {
      name: card.name,
      finish: getCcgFinishLabel(locale, finish),
      rarity: getCcgRarityLabel(locale, card.tierGrade),
      raid: card.set.raidName,
      username: share.unboxedBy.username,
    };
    return {
      title: interpolate(copy.cardTitle, values),
      description: interpolate(copy.cardDescription, values),
      imageAlt: interpolate(copy.cardAlt, values),
    };
  }

  const bestResult = getBestPackResult(share.pack);
  const packType = getCcgPackType(share.pack, locale);
  const values = {
    username: share.unboxedBy.username,
    packType,
    finish: bestResult ? getCcgFinishLabel(locale, bestResult.finish) : "",
    rarity: bestResult ? getCcgRarityLabel(locale, bestResult.card.tierGrade) : "",
    name: bestResult?.card.name ?? "",
  };
  return {
    title: interpolate(copy.packTitle, values),
    description: interpolate(copy.packDescription, values),
    imageAlt: interpolate(copy.packAlt, values),
  };
}

export async function buildCcgShareMetadata({
  shareId,
  locale,
}: {
  shareId: string;
  locale: CcgEmbedLocale;
}): Promise<Metadata> {
  const share = await fetchCcgShare(shareId);
  const canonicalUrl = `${SITE_URL}${getCcgSharePath(share?.id ?? shareId)}`;
  const localeCode = locale === "fi" ? "fi_FI" : "en_US";
  const alternateLocale = locale === "fi" ? "en_US" : "fi_FI";

  if (!share) {
    const copy = EMBED_COPY[locale].share.embed;
    return {
      title: `${copy.unavailableTitle} | ${SITE_NAME}`,
      description: copy.unavailableDescription,
      alternates: { canonical: canonicalUrl },
      robots: { index: false, follow: false },
    };
  }

  const copy = getShareCopy(share, locale);
  const title = `${copy.title} | SuomiWoW CCG`;
  const image = {
    url: CCG_EMBED_IMAGE,
    width: CCG_EMBED_IMAGE_WIDTH,
    height: CCG_EMBED_IMAGE_HEIGHT,
    alt: CCG_EMBED_IMAGE_ALT,
    type: "image/png",
  };

  return {
    title,
    description: copy.description,
    applicationName: SITE_NAME,
    alternates: { canonical: canonicalUrl },
    robots: { index: false, follow: true },
    openGraph: {
      type: "website",
      url: canonicalUrl,
      title,
      description: copy.description,
      siteName: SITE_NAME,
      locale: localeCode,
      alternateLocale: [alternateLocale],
      images: [image],
    },
    twitter: {
      card: "summary",
      title,
      description: copy.description,
      images: [image],
    },
  };
}
