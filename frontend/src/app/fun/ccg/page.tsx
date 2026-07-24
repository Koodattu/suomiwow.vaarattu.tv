"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import type { CcgCard } from "@/types";
import { applyPackPointerMotion, resetPackMotion } from "@/lib/ccg-pack-motion";
import { useCcgCatalog, useCcgSession, useCcgSets } from "@/lib/queries";
import CcgShell from "@/components/ccg/CcgShell";
import PackBalance from "@/components/ccg/PackBalance";
import CollectibleCard from "@/components/ccg/CollectibleCard";
import CardViewer, { openCardViewer } from "@/components/ccg/CardViewer";
import type { CardViewerOriginBounds } from "@/components/ccg/CardViewer";
import CcgLoadError from "@/components/ccg/CcgLoadError";
import PackBoosterVisual, { getPackTheme } from "@/components/ccg/PackBoosterVisual";
import styles from "@/components/ccg/ccg.module.css";
import packStyles from "@/components/ccg/pack-opening.module.css";

function VaultPackShortcut({
  href,
  theme,
  label,
  title,
  cardsLabel,
}: {
  href: string;
  theme: CSSProperties;
  label: string;
  title: string;
  cardsLabel: string;
}) {
  const updateMotion = (event: ReactPointerEvent<HTMLAnchorElement>) => {
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    applyPackPointerMotion(event.currentTarget, event.clientX, event.clientY);
  };

  return (
    <Link
      href={href}
      className={`${packStyles.packButton} ${styles.vaultPackShortcut}`}
      style={theme}
      aria-label={label}
      draggable={false}
      onPointerMove={updateMotion}
      onPointerLeave={(event) => resetPackMotion(event.currentTarget)}
      onPointerCancel={(event) => resetPackMotion(event.currentTarget)}
      onBlur={(event) => resetPackMotion(event.currentTarget)}
    >
      <PackBoosterVisual title={title} cardsLabel={cardsLabel} />
    </Link>
  );
}

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
  const currentSets = sets.filter((set) => set.kind === "raid" && set.state === "current");
  const current = currentSets[0];
  const currentCardCount = currentSets.reduce((total, set) => total + set.cardCount, 0);
  const currentOwnedCount = currentSets.reduce((total, set) => total + set.ownedCards, 0);
  const currentProgress = currentCardCount > 0 ? Math.min(100, (currentOwnedCount / currentCardCount) * 100) : 0;
  const legacy = sets.filter((set) => set.kind === "raid" && set.state === "legacy").sort((left, right) => right.zoneId - left.zoneId);
  const community = sets.filter((set) => set.kind === "community");
  const collectionSets = [...currentSets, ...community, ...legacy];
  const allCardCount = collectionSets.reduce((total, set) => total + set.cardCount, 0);
  const allOwnedCount = collectionSets.reduce((total, set) => total + set.ownedCards, 0);
  const allProgress = allCardCount > 0 ? Math.min(100, (allOwnedCount / allCardCount) * 100) : 0;
  const collectionItemCount = collectionSets.length + 1;
  const collectionColumns = Math.max(1, Math.ceil(collectionItemCount / 2) - 1);
  const collectionRows = Math.max(2, Math.ceil(collectionItemCount / collectionColumns));
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
    <CcgShell viewportLocked>
      <div className={styles.vaultDashboard}>
        <section className={styles.vaultDashboardTop}>
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
            <div className={styles.vaultCurrentActions}>
              <Link
                href={current ? `/fun/ccg/collection?set=${encodeURIComponent(current.slug)}` : "/fun/ccg/collection"}
                className={`${styles.secondaryButton} ${styles.vaultCurrentAction}`}
              >
                {t("landing.viewInCollection")}
              </Link>
              {currentCardCount > 0 ? (
                <Link href="/fun/ccg/open?mode=current" className={`${styles.primaryButton} ${styles.vaultCurrentAction}`}>{t("landing.openCurrent")}</Link>
              ) : (
                <span className={`${styles.primaryButton} ${styles.vaultCurrentAction} cursor-not-allowed opacity-45`} aria-disabled="true">{t("landing.openCurrent")}</span>
              )}
            </div>
          </div>

          <nav className={styles.vaultPackShortcuts} aria-label={t("nav.open")}>
            <div className={styles.vaultPackShortcutColumn}>
              <VaultPackShortcut
                href="/fun/ccg/open?mode=current"
                theme={getPackTheme(current)}
                label={t("landing.openCurrent")}
                title={current?.raidName ?? t("landing.preparing")}
                cardsLabel={t("landing.cards")}
              />
              {session ? <PackBalance session={session} mode="current" strip /> : <div className={styles.vaultBalanceSkeleton} />}
            </div>
            <div className={styles.vaultPackShortcutColumn}>
              <VaultPackShortcut
                href="/fun/ccg/open?mode=legacy"
                theme={getPackTheme(undefined, true)}
                label={t("landing.openLegacy")}
                title={t("open.legacyPackTitle")}
                cardsLabel={t("landing.cards")}
              />
              {session ? <PackBalance session={session} mode="legacy" strip /> : <div className={styles.vaultBalanceSkeleton} />}
            </div>
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

        <div className={styles.vaultDashboardBottom}>
          <div className={styles.vaultLegacy}>
            {collectionSets.length > 0 ? (
              <div
                className={styles.vaultLegacyGrid}
                style={{
                  "--legacy-columns": collectionColumns,
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
                  <span className={styles.vaultLegacySummary}>
                    <strong>{t("landing.all")}</strong>
                    <small>{allOwnedCount}/{allCardCount}</small>
                  </span>
                  <span className={styles.vaultLegacyTrack} aria-label={`${allOwnedCount}/${allCardCount} ${t("landing.collected")}`}>
                    <i style={{ transform: `scaleX(${allProgress / 100})` }} />
                  </span>
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
                    <span className={styles.vaultLegacySummary}>
                      <strong>{set.raidName}</strong>
                      <small>{set.ownedCards}/{set.cardCount}</small>
                    </span>
                    <span className={styles.vaultLegacyTrack} aria-label={`${set.ownedCards}/${set.cardCount} ${t("landing.collected")}`}>
                      <i style={{ transform: `scaleX(${set.cardCount > 0 ? Math.min(1, set.ownedCards / set.cardCount) : 0})` }} />
                    </span>
                  </span>
                </Link>
              ))}
              </div>
            ) : (
              <div className={styles.vaultLegacyEmpty}>{t("landing.legacyEmpty")}</div>
            )}
          </div>
          <aside className={styles.vaultBottomPlaceholder} aria-hidden="true" />
        </div>
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
