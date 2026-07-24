"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import type { CcgCard } from "@/types";
import { useCcgCatalog, useCcgSession, useCcgSets } from "@/lib/queries";
import CcgShell from "@/components/ccg/CcgShell";
import GuestNotice from "@/components/ccg/GuestNotice";
import PackBalance from "@/components/ccg/PackBalance";
import CollectibleCard from "@/components/ccg/CollectibleCard";
import CardViewer, { openCardViewer } from "@/components/ccg/CardViewer";
import type { CardViewerOriginBounds } from "@/components/ccg/CardViewer";
import CcgLoadError from "@/components/ccg/CcgLoadError";
import PackBoosterVisual, { getPackTheme } from "@/components/ccg/PackBoosterVisual";
import styles from "@/components/ccg/ccg.module.css";
import packStyles from "@/components/ccg/pack-opening.module.css";

function FeaturedCard({ card, onSelect }: { card: CcgCard; onSelect: (event: ReactMouseEvent<HTMLButtonElement>) => void }) {
  const [ready, setReady] = useState(false);
  const markReady = useCallback(() => setReady(true), []);

  return (
    <div className={styles.vaultFeaturedStage} aria-busy={!ready}>
      <div className={styles.vaultFeaturedCard}>
        <div
          className={`${styles.collectionSkeleton} ${styles.collectionCardSkeleton} ${styles.vaultFeaturedSkeleton} ${ready ? styles.collectionCardSkeletonHidden : ""}`}
          aria-hidden="true"
        />
        <CollectibleCard
          card={card}
          finish="holographic"
          compact
          className={ready ? "" : styles.collectionCardAssetLoading}
          onReady={markReady}
          onSelect={onSelect}
        />
      </div>
    </div>
  );
}

export default function CcgLandingPage() {
  const t = useTranslations("ccg");
  const sessionQuery = useCcgSession();
  const setsQuery = useCcgSets();
  const session = sessionQuery.data;
  const sets = setsQuery.data?.sets ?? [];
  const currentSets = sets.filter((set) => set.state === "current");
  const current = currentSets[0];
  const currentCardCount = currentSets.reduce((total, set) => total + set.cardCount, 0);
  const currentOwnedCount = currentSets.reduce((total, set) => total + set.ownedCards, 0);
  const currentProgress = currentCardCount > 0 ? Math.min(100, (currentOwnedCount / currentCardCount) * 100) : 0;
  const legacy = sets.filter((set) => set.state === "legacy").sort((left, right) => right.zoneId - left.zoneId);
  const collectionSets = [...currentSets, ...legacy];
  const allCardCount = collectionSets.reduce((total, set) => total + set.cardCount, 0);
  const allOwnedCount = collectionSets.reduce((total, set) => total + set.ownedCards, 0);
  const collectionItemCount = collectionSets.length + 1;
  const collectionRows = Math.max(2, Math.ceil(collectionItemCount / 8));
  const featuredQuery = useCcgCatalog(current?.slug ?? "", 1, "all", "S", "", "", Boolean(current?.slug), 50);
  const featuredCards = featuredQuery.data?.cards ?? [];
  const featuredCard = featuredCards.length > 0
    ? featuredCards[Math.floor(featuredQuery.dataUpdatedAt / 1000) % featuredCards.length]
    : null;
  const [viewerCard, setViewerCard] = useState<CcgCard | null>(null);
  const [viewerOriginElement, setViewerOriginElement] = useState<HTMLElement | null>(null);
  const [viewerOriginBounds, setViewerOriginBounds] = useState<CardViewerOriginBounds | null>(null);
  const [viewerSharedTransition, setViewerSharedTransition] = useState(false);
  const queryFailed = sessionQuery.isError || setsQuery.isError;

  if (queryFailed) {
    return <CcgShell><div className="mx-auto max-w-3xl px-4 py-12"><CcgLoadError onRetry={() => { void sessionQuery.refetch(); void setsQuery.refetch(); }} /></div></CcgShell>;
  }

  return (
    <CcgShell viewportLocked context={session ? <GuestNotice session={session} /> : null}>
      <div className={styles.vaultDashboard}>
        <section className={styles.vaultDashboardTop}>
          <div className={styles.vaultMainColumn}>
            <div
              className={styles.vaultCurrentSet}
              style={{
                "--set-accent": current?.theme.accent ?? "#46CFFF",
                "--set-glow": current?.theme.glow ?? "rgba(70,207,255,.25)",
                backgroundImage: current ? `url("${current.backgroundPath}")` : undefined,
              } as CSSProperties}
            >
              <div className={styles.vaultCurrentShade} aria-hidden="true" />
              <div className={styles.vaultCurrentContent}>
                <div className={styles.eyebrow}>{t("landing.currentSet")}</div>
                <h1>
                  {currentSets.length > 1 ? t("landing.currentRaids", { count: currentSets.length }) : current?.raidName ?? t("landing.preparing")}
                </h1>
                <div className={styles.vaultCurrentProgress}>
                  <div className={styles.vaultCurrentCount}>
                    <strong>{currentOwnedCount}</strong>
                    <span>/ {currentCardCount} {t("landing.collected")}</span>
                  </div>
                  <div className={styles.vaultCurrentTrack} aria-label={`${currentOwnedCount}/${currentCardCount} ${t("landing.collected")}`}>
                    <span style={{ transform: `scaleX(${currentProgress / 100})` }} />
                  </div>
                </div>
              </div>
              {currentCardCount > 0 ? (
                <Link href="/fun/ccg/open?mode=current" className={`${styles.primaryButton} ${styles.vaultCurrentOpen}`}>{t("landing.openCurrent")}</Link>
              ) : (
                <span className={`${styles.primaryButton} ${styles.vaultCurrentOpen} cursor-not-allowed opacity-45`} aria-disabled="true">{t("landing.openCurrent")}</span>
              )}
            </div>

            <aside className={styles.vaultPackStrip}>
              <div className={styles.vaultPackBalances}>
                {session ? (
                  <>
                    <PackBalance session={session} mode="current" strip />
                    <PackBalance session={session} mode="legacy" strip />
                  </>
                ) : (
                  <>
                    <div className={styles.vaultBalanceSkeleton} />
                    <div className={styles.vaultBalanceSkeleton} />
                  </>
                )}
              </div>
            </aside>
          </div>

          <nav className={styles.vaultPackShortcuts} aria-label={t("nav.open")}>
            <Link
              href="/fun/ccg/open?mode=current"
              className={`${packStyles.packButton} ${styles.vaultPackShortcut}`}
              style={getPackTheme(current)}
              aria-label={t("landing.openCurrent")}
            >
              <PackBoosterVisual title={current?.raidName ?? t("landing.preparing")} cardsLabel={t("landing.cards")} />
            </Link>
            <Link
              href="/fun/ccg/open?mode=legacy"
              className={`${packStyles.packButton} ${styles.vaultPackShortcut}`}
              style={getPackTheme(undefined, true)}
              aria-label={t("landing.openLegacy")}
            >
              <PackBoosterVisual title={t("open.legacyPackTitle")} cardsLabel={t("landing.cards")} />
            </Link>
          </nav>

          <aside className={styles.vaultFeatured} aria-label={t("landing.featuredCard")}>
            {featuredQuery.isPending ? (
              <div className={styles.vaultFeaturedStage}>
                <div className={styles.vaultFeaturedCard}>
                  <div className={`${styles.collectionSkeleton} ${styles.collectionCardSkeleton} ${styles.vaultFeaturedSkeleton}`} aria-hidden="true" />
                </div>
              </div>
            ) : featuredCard ? (
              <FeaturedCard
                key={`${featuredCard.id}:${featuredCard.renderUrl ?? ""}`}
                card={featuredCard}
                onSelect={(event) => {
                  const originElement = event.currentTarget;
                  openCardViewer(originElement, (sharedTransition, originBounds) => {
                    setViewerOriginElement(originElement);
                    setViewerOriginBounds(originBounds);
                    setViewerSharedTransition(sharedTransition);
                    setViewerCard(featuredCard);
                  });
                }}
              />
            ) : (
              <div className={styles.vaultFeaturedStage}>
                <Link href="/fun/ccg/collection" className={styles.vaultFeaturedEmpty}>{t("landing.collection")}</Link>
              </div>
            )}
          </aside>
        </section>

        <section className={styles.vaultLegacy}>
          <div className={styles.vaultLegacyHeader}>
            <h2>{t("nav.collection")}</h2>
            <Link href="/fun/ccg/collection" className={styles.vaultCollectionAction}>
              {t("landing.collection")} <span aria-hidden="true">→</span>
            </Link>
          </div>
          {collectionSets.length > 0 ? (
            <div
              className={styles.vaultLegacyGrid}
              style={{
                "--legacy-columns": Math.ceil(collectionItemCount / collectionRows),
                "--legacy-rows": collectionRows,
              } as CSSProperties}
            >
              <Link
                href="/fun/ccg/collection"
                className={styles.vaultLegacySet}
                style={{
                  "--set-accent": "#9c7cff",
                  "--set-glow": "rgba(126, 105, 255, 0.42)",
                  backgroundImage: 'url("/ccg/general_wide.webp")',
                } as CSSProperties}
              >
                <span className={styles.vaultLegacyShade} aria-hidden="true" />
                <span className={styles.vaultLegacyContent}>
                  <strong>{t("landing.all")}</strong>
                  <small>{allOwnedCount}/{allCardCount}</small>
                </span>
              </Link>
              {collectionSets.map((set) => (
                <Link
                  key={set.id}
                  href={`/fun/ccg/collection?set=${encodeURIComponent(set.slug)}`}
                  className={styles.vaultLegacySet}
                  style={{
                    "--set-accent": set.theme.accent,
                    "--set-glow": set.theme.glow,
                    backgroundImage: `url("${set.backgroundPath}")`,
                  } as CSSProperties}
                >
                  <span className={styles.vaultLegacyShade} aria-hidden="true" />
                  <span className={styles.vaultLegacyContent}>
                    <strong>{set.raidName}</strong>
                    <small>{set.ownedCards}/{set.cardCount}</small>
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <div className={styles.vaultLegacyEmpty}>{t("landing.legacyEmpty")}</div>
          )}
        </section>
      </div>
      {viewerCard ? (
        <CardViewer
          card={viewerCard}
          initialFinish="holographic"
          originElement={viewerOriginElement}
          originBounds={viewerOriginBounds}
          sharedTransition={viewerSharedTransition}
          onClose={() => {
            setViewerCard(null);
            setViewerOriginElement(null);
            setViewerOriginBounds(null);
            setViewerSharedTransition(false);
          }}
        />
      ) : null}
    </CcgShell>
  );
}
