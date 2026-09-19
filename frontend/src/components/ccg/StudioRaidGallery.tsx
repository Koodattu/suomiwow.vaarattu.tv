"use client";

import Link from "next/link";
import { useState } from "react";
import { FaMagnifyingGlass } from "react-icons/fa6";
import { useLocale, useTranslations } from "next-intl";
import { getStudioRaidCards } from "@/lib/ccg-studio";
import type { StudioState } from "@/types/ccg-studio";
import CollectibleCard from "./CollectibleCard";
import CardViewer, { openCardViewer } from "./CardViewer";
import type { CardViewerOriginBounds } from "./CardViewer";
import styles from "./studio.module.css";
import cardStyles from "./ccg.module.css";

type RaidCard = StudioState["characters"][number]["cards"][number];

export default function StudioRaidGallery({ data }: { data: StudioState }) {
  const t = useTranslations("ccg.studio");
  const locale = useLocale();
  const [search, setSearch] = useState("");
  const [set, setSet] = useState("");
  const [viewer, setViewer] = useState<{ card: RaidCard; origin: HTMLElement; bounds: CardViewerOriginBounds | null; shared: boolean } | null>(null);
  const cards = getStudioRaidCards(data.characters);
  const sets = [...new Map(cards.map((card) => [card.set.slug, card.set.raidName])).entries()];
  const visible = cards.filter((card) => (!set || card.set.slug === set)
    && `${card.name} ${card.realm}`.toLocaleLowerCase(locale).includes(search.trim().toLocaleLowerCase(locale)));
  return <section className={styles.raidGallery} aria-labelledby="raid-heading">
    <div className={styles.sectionHeading}><div><h2 id="raid-heading">{t("raidGallery")}</h2><p>{t("raidGalleryDescription")}</p></div><span className={styles.galleryCount}>{cards.length}</span></div>
    {(cards.length > 6 || search || set) && <div className={styles.toolbar}><label className={styles.search}><FaMagnifyingGlass aria-hidden="true" /><input type="search" placeholder={t("searchRaidCards")} aria-label={t("searchRaidCards")} value={search} onChange={(event) => setSearch(event.target.value)} /></label>
      <select aria-label={t("raidFilter")} value={set} onChange={(event) => setSet(event.target.value)}><option value="">{t("allRaids")}</option>{sets.map(([slug, name]) => <option key={slug} value={slug}>{name}</option>)}</select></div>}
    {visible.length ? <div className={styles.slotGrid}>{visible.map((card) => <div key={card.id} className={styles.raidCard}>
      <CollectibleCard card={card} compact className={`${styles.galleryCard} ${cardStyles.scaledCardTypography}`} onSelect={(event) => {
        const origin = event.currentTarget;
        openCardViewer(origin, (shared, bounds) => setViewer({ card, origin, shared, bounds }), event);
      }} />
    </div>)}</div> : <div className={styles.galleryEmpty}><p>{t(!data.battlenetConnected ? "raidConnect" : data.rosterError ? "raidUnavailable" : cards.length ? "noRaidMatches" : "noRaidCards")}</p>
      {(search || set) && <button className={styles.textButton} onClick={() => { setSearch(""); setSet(""); }}>{t("clearFilters")}</button>}</div>}
    {viewer && <CardViewer card={viewer.card} originElement={viewer.origin} originBounds={viewer.bounds} sharedTransition={viewer.shared} showOwnershipStatus={false} showCollectionControls={false}
      footerAction={<Link href={`/ccg/collection?set=${viewer.card.set.slug}&character=${viewer.card.characterId}`}>{t("catalogueCard", { snapshots: viewer.card.snapshots, owned: viewer.card.owned })} · {t("viewCollection")}</Link>} onClose={() => setViewer(null)} />}
  </section>;
}
