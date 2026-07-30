"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import type { CcgCard } from "@/types";
import { useCcgFeaturedCard, useCcgSession, useCcgSets } from "@/lib/queries";
import CcgShell from "@/components/ccg/CcgShell";
import PackBalance from "@/components/ccg/PackBalance";
import CollectibleCard from "@/components/ccg/CollectibleCard";
import CardViewer, { openCardViewer } from "@/components/ccg/CardViewer";
import type { CardViewerOriginBounds } from "@/components/ccg/CardViewer";
import CcgLoadError from "@/components/ccg/CcgLoadError";
import PackBoosterVisual, { getPackTheme } from "@/components/ccg/PackBoosterVisual";
import CcgAnalyticsPanel from "@/components/ccg/CcgAnalyticsPanel";
import CcgRedeemPanel from "@/components/ccg/CcgRedeemPanel";
import CcgTwitchPanel from "@/components/ccg/CcgTwitchPanel";
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
  return (
    <Link
      href={href}
      className={`${packStyles.packButton} ${packStyles.packButtonGrouped} ${styles.vaultPackShortcut}`}
      style={theme}
      aria-label={label}
      data-vault-pack
      draggable={false}
    >
      <PackBoosterVisual title={title} cardsLabel={cardsLabel} />
    </Link>
  );
}

function updatePackFanMotion(event: ReactPointerEvent<HTMLDivElement>) {
  if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
  if (!(event.target instanceof Element) || !event.target.closest("[data-vault-pack]")) {
    resetPackFanMotion(event.currentTarget);
    return;
  }
  const fanBounds = event.currentTarget.getBoundingClientRect();
  const x = Math.max(-1, Math.min(1, ((event.clientX - fanBounds.left) / fanBounds.width - 0.5) * 2));
  const y = Math.max(-1, Math.min(1, ((event.clientY - fanBounds.top) / fanBounds.height - 0.5) * 2));
  event.currentTarget.dataset.active = "true";
  event.currentTarget.style.setProperty("--fan-pointer-x", `${(x * 2).toFixed(2)}px`);
  event.currentTarget.style.setProperty("--fan-pointer-y", `${(y * 0.75).toFixed(2)}px`);
  event.currentTarget.style.setProperty("--fan-pointer-rotation", `${(x * 0.45).toFixed(2)}deg`);
}

function resetPackFanMotion(fan: HTMLDivElement) {
  delete fan.dataset.active;
  fan.style.setProperty("--fan-pointer-x", "0px");
  fan.style.setProperty("--fan-pointer-y", "0px");
  fan.style.setProperty("--fan-pointer-rotation", "0deg");
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
  const recentPackSets = legacy.slice(0, 3);
  const community = sets.filter((set) => set.kind === "community");
  const collectionSets = [...currentSets, ...legacy, ...community];
  const allCardCount = collectionSets.reduce((total, set) => total + set.cardCount, 0);
  const allOwnedCount = collectionSets.reduce((total, set) => total + set.ownedCards, 0);
  const allProgress = allCardCount > 0 ? Math.min(100, (allOwnedCount / allCardCount) * 100) : 0;
  const gridSets = collectionSets.filter((set) => set.id !== current?.id);
  const collectionColumns = Math.max(1, Math.ceil(gridSets.length / 3));
  const collectionRows = Math.max(2, Math.ceil(gridSets.length / collectionColumns));
  const featuredQuery = useCcgFeaturedCard(current?.slug ?? "", Boolean(current?.slug));
  const featuredCard = featuredQuery.data?.card ?? null;
  const setsLoading = setsQuery.isPending;
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
      <div className={styles.vaultDashboard} aria-busy={setsLoading || sessionQuery.isPending}>
        <section className={styles.vaultDashboardTop}>
          <div className={styles.vaultSetStack}>
            <div
              className={`${styles.vaultCurrentSet} ${setsLoading ? styles.vaultSurfaceSkeleton : ""}`}
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
                  href={current ? `/ccg/collection?set=${encodeURIComponent(current.slug)}` : "/ccg/collection"}
                  className={`${styles.secondaryButton} ${styles.vaultCurrentAction}`}
                >
                  {t("landing.viewInCollection")}
                </Link>
                {currentCardCount > 0 ? (
                  <Link href={`/ccg/open?set=${encodeURIComponent(current!.id)}`} className={`${styles.primaryButton} ${styles.vaultCurrentAction}`}>{t("landing.openCurrent")}</Link>
                ) : (
                  <span className={`${styles.primaryButton} ${styles.vaultCurrentAction} cursor-not-allowed opacity-45`} aria-disabled="true">{t("landing.openCurrent")}</span>
                )}
              </div>
            </div>

            <div
              className={`${styles.vaultAllSet} ${setsLoading ? styles.vaultSurfaceSkeleton : ""}`}
              style={{
                "--set-accent": "#9c7cff",
                "--set-glow": "rgba(126, 105, 255, 0.42)",
                backgroundImage: 'url("/ccg/general_wide.webp")',
              } as CSSProperties}
            >
              <div className={styles.vaultAllShade} aria-hidden="true" />
              <div className={styles.vaultAllContent}>
                <div className={styles.eyebrow}>{t("landing.completeCollection")}</div>
                <h2>{t("landing.allRaids")}</h2>
                <div className={styles.vaultAllProgress}>
                  <div className={styles.vaultCurrentCount}>
                    <strong>{allOwnedCount}</strong>
                    <span>/ {allCardCount} {t("landing.collected")}</span>
                  </div>
                  <div className={styles.vaultCurrentTrack} aria-label={`${allOwnedCount}/${allCardCount} ${t("landing.collected")}`}>
                    <span style={{ transform: `scaleX(${allProgress / 100})` }} />
                  </div>
                </div>
              </div>
              <div className={styles.vaultAllActions}>
                <Link href="/ccg/collection" className={`${styles.secondaryButton} ${styles.vaultCurrentAction}`}>
                  {t("landing.viewInCollection")}
                </Link>
                <Link href="/ccg/open" className={`${styles.primaryButton} ${styles.vaultCurrentAction}`}>
                  {t("landing.openAllRaids")}
                </Link>
              </div>
            </div>
          </div>

          <nav className={styles.vaultPackShortcuts} aria-label={t("nav.open")}>
            <div className={styles.vaultPackFan}>
              <div
                className={styles.vaultPackFanInteraction}
                onPointerMove={updatePackFanMotion}
                onPointerLeave={(event) => resetPackFanMotion(event.currentTarget)}
                onPointerCancel={(event) => resetPackFanMotion(event.currentTarget)}
              >
                <div className={styles.vaultPackFanMotion}>
                  {setsLoading ? (
                    Array.from({ length: 5 }, (_, index) => (
                      <span key={index} className={`${packStyles.packButton} ${styles.vaultPackShortcut} ${styles.vaultPackSkeleton}`} aria-hidden="true" />
                    ))
                  ) : (
                    <>
                      <VaultPackShortcut
                        href={current ? `/ccg/open?set=${encodeURIComponent(current.id)}` : "/ccg/open"}
                        theme={getPackTheme(current)}
                        label={t("landing.openCurrent")}
                        title={current?.raidName ?? t("landing.preparing")}
                        cardsLabel={t("landing.cards")}
                      />
                      <VaultPackShortcut
                        href="/ccg/open"
                        theme={getPackTheme(undefined, true)}
                        label={t("landing.openAllRaids")}
                        title={t("open.allRaids")}
                        cardsLabel={t("landing.cards")}
                      />
                      {recentPackSets.map((set) => (
                        <VaultPackShortcut
                          key={set.id}
                          href={`/ccg/open?set=${encodeURIComponent(set.id)}`}
                          theme={getPackTheme(set)}
                          label={`${t("nav.open")}: ${set.raidName}`}
                          title={set.raidName}
                          cardsLabel={t("landing.cards")}
                        />
                      ))}
                    </>
                  )}
                </div>
              </div>
            </div>
            {session ? <PackBalance session={session} strip /> : <div className={styles.vaultBalanceSkeleton} />}
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
                  }, event);
                }}
              />
            ) : (
              <div className={styles.vaultFeaturedStage}>
                <Link href="/ccg/collection" className={styles.vaultFeaturedEmpty}>{t("landing.collection")}</Link>
              </div>
            )}
          </aside>
        </section>

        <div className={styles.vaultDashboardBottom}>
          <div className={styles.vaultLegacy}>
            {setsLoading ? (
              <div
                className={styles.vaultLegacyGrid}
                style={{ "--legacy-columns": 7, "--legacy-rows": 3 } as CSSProperties}
                aria-hidden="true"
              >
                {Array.from({ length: 21 }, (_, index) => (
                  <span key={index} className={`${styles.vaultLegacySet} ${styles.vaultSurfaceSkeleton}`} />
                ))}
              </div>
            ) : gridSets.length > 0 ? (
              <div
                className={styles.vaultLegacyGrid}
                style={{
                  "--legacy-columns": collectionColumns,
                  "--legacy-rows": collectionRows,
                } as CSSProperties}
              >
              {gridSets.map((set) => (
                <Link
                  key={set.id}
                  href={`/ccg/collection?set=${encodeURIComponent(set.slug)}`}
                  className={styles.vaultLegacySet}
                  style={{
                    "--set-accent": set.theme.accent,
                    "--set-glow": set.theme.glow,
                    backgroundImage: set.kind === "community" ? 'url("/ccg/general_alt_wide.png")' : `url("${set.backgroundPath}")`,
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
          <aside className={styles.vaultRedeemSlot}>
            <div className={styles.vaultRedeemTop}>
              <CcgRedeemPanel sets={collectionSets} />
            </div>
            <CcgTwitchPanel />
            <CcgAnalyticsPanel />
          </aside>
        </div>
      </div>
      {viewerCard ? (
        <CardViewer
          card={viewerCard}
          initialFinish="holographic"
          originElement={viewerOriginElement}
          originBounds={viewerOriginBounds}
          sharedTransition={viewerSharedTransition}
          showCollectionControls={false}
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
