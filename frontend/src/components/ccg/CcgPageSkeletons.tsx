import styles from "./ccg.module.css";
import packStyles from "./pack-opening.module.css";

function SkeletonHeader() {
  return (
    <header className={styles.shellHeader} aria-hidden="true">
      <div className={styles.shellHeaderInner}>
        <div className={styles.initialShellBrand}>
          <span className={`${styles.initialSkeletonBlock} ${styles.initialMainLogo}`} />
          <span className={`${styles.initialSkeletonBlock} ${styles.initialCcgLogo}`} />
        </div>
        <div className={styles.initialShellNav}>
          {Array.from({ length: 4 }, (_, index) => <span key={index} className={styles.initialSkeletonBlock} />)}
        </div>
        <div className={styles.initialShellContext}>
          {Array.from({ length: 3 }, (_, index) => <span key={index} className={styles.initialSkeletonBlock} />)}
        </div>
      </div>
    </header>
  );
}

function LandingContentSkeleton() {
  return (
    <div className={styles.vaultDashboard} aria-hidden="true">
      <section className={styles.vaultDashboardTop}>
        <div className={styles.vaultSetStack}>
          <div className={`${styles.vaultCurrentSet} ${styles.vaultSurfaceSkeleton}`} />
          <div className={`${styles.vaultAllSet} ${styles.vaultSurfaceSkeleton}`} />
        </div>

        <div className={styles.vaultPackShortcuts}>
          {Array.from({ length: 2 }, (_, index) => (
            <div key={index} className={styles.vaultPackShortcutColumn}>
              <span className={`${packStyles.packButton} ${styles.vaultPackShortcut} ${styles.vaultPackSkeleton}`} />
              <span className={styles.vaultBalanceSkeleton} />
            </div>
          ))}
        </div>

        <aside className={styles.vaultFeatured}>
          <div className={styles.vaultFeaturedStage}>
            <div className={styles.vaultFeaturedCard}>
              <span className={`${styles.collectionSkeleton} ${styles.collectionCardSkeleton} ${styles.vaultFeaturedSkeleton}`} />
            </div>
          </div>
        </aside>
      </section>

      <div className={styles.vaultDashboardBottom}>
        <div className={styles.vaultLegacy}>
          <div
            className={styles.vaultLegacyGrid}
            style={{ "--legacy-columns": 7, "--legacy-rows": 3 } as React.CSSProperties}
          >
            {Array.from({ length: 21 }, (_, index) => (
              <span key={index} className={`${styles.vaultLegacySet} ${styles.vaultSurfaceSkeleton}`} />
            ))}
          </div>
        </div>
        <aside className={styles.vaultRedeemSlot}>
          {Array.from({ length: 3 }, (_, index) => (
            <span key={index} className={`${styles.initialSkeletonBlock} ${styles.initialSidePanel}`} />
          ))}
        </aside>
      </div>
    </div>
  );
}

export function CcgOpenContentSkeleton({ label }: { label?: string }) {
  return (
    <div
      className={packStyles.openWorkspace}
      role={label ? "status" : undefined}
      aria-label={label}
    >
      <div className={packStyles.packChooser}>
        <section className={`${packStyles.packStage} ${packStyles.packChooserStage}`} aria-busy="true">
          <span className={packStyles.stageArt} />
          <span className={packStyles.stageVeil} />
          <span className={packStyles.vaultRing} aria-hidden="true" />
          <span className={packStyles.vaultRingInner} aria-hidden="true" />
          <div className={packStyles.packChooserLayout} aria-hidden="true">
            <aside className={packStyles.packControls}>
              <div className={packStyles.packSkeletonChoices}>
                {Array.from({ length: 5 }, (_, index) => (
                  <span key={index} className={`${packStyles.modeChoice} ${packStyles.loadingSkeleton} ${packStyles.modeChoiceSkeleton}`} />
                ))}
              </div>
            </aside>

            <div className={packStyles.packPresentation}>
              <span className={`${packStyles.packMode} ${packStyles.loadingSkeleton} ${packStyles.packModeSkeleton}`} />
              <span className={`${packStyles.packButton} ${packStyles.loadingSkeleton} ${packStyles.packButtonSkeleton}`} />
              <span className={`${packStyles.packHint} ${packStyles.loadingSkeleton} ${packStyles.packHintSkeleton}`} />
            </div>

            <aside className={packStyles.packBalancePanel}>
              <div className={packStyles.packBalanceSummary}>
                <div className={`${packStyles.balancePlaceholder} ${packStyles.loadingSkeleton}`} />
              </div>
              <div className={packStyles.qualityDetails}>
                {Array.from({ length: 3 }, (_, groupIndex) => (
                  <div key={groupIndex} className={packStyles.qualitySkeletonGroup}>
                    <span className={`${packStyles.loadingSkeleton} ${packStyles.qualitySkeletonHeading}`} />
                    {Array.from({ length: 3 }, (_, rowIndex) => (
                      <span key={rowIndex} className={`${packStyles.loadingSkeleton} ${packStyles.qualitySkeletonRow}`} />
                    ))}
                  </div>
                ))}
              </div>
            </aside>
          </div>
        </section>
      </div>
    </div>
  );
}

function CollectionContentSkeleton() {
  return (
    <div className={styles.collectionPage} aria-hidden="true">
      <section className={styles.collectionToolbar}>
        <div className={styles.collectionSetRailViewport}>
          <div className={styles.collectionSetRail}>
            {Array.from({ length: 6 }, (_, index) => (
              <span key={index} className={`${styles.collectionSet} ${styles.collectionSetSkeleton}`} />
            ))}
          </div>
        </div>
        <div className={styles.initialCollectionFilters}>
          {Array.from({ length: 6 }, (_, index) => <span key={index} className={styles.initialSkeletonBlock} />)}
        </div>
      </section>

      <section className={styles.collectionBinder}>
        <span className={`${styles.collectionPageTurn} ${styles.initialSkeletonBlock}`} />
        <div className={styles.collectionBinderBody}>
          <div className={styles.collectionBinderLines}>
            {Array.from({ length: 12 }, (_, index) => <span key={index} />)}
          </div>
          <div className={styles.collectionBinderGrid}>
            {Array.from({ length: 12 }, (_, index) => (
              <div key={index} className={styles.collectionCardSlot}>
                <span className={`${styles.collectionSkeleton} ${styles.collectionCardSkeleton}`} />
              </div>
            ))}
          </div>
        </div>
        <span className={`${styles.collectionPageTurn} ${styles.initialSkeletonBlock}`} />
      </section>
    </div>
  );
}

function ActivityContentSkeleton() {
  return (
    <div className={styles.activityPage} aria-hidden="true">
      <header className={styles.initialActivityHeader}>
        <span className={`${styles.initialSkeletonBlock} ${styles.initialActivityEyebrow}`} />
        <span className={`${styles.initialSkeletonBlock} ${styles.initialActivityTitle}`} />
        <span className={`${styles.initialSkeletonBlock} ${styles.initialActivityBody}`} />
      </header>
      <div className={styles.initialActivityFilters}>
        {Array.from({ length: 4 }, (_, index) => <span key={index} className={styles.initialSkeletonBlock} />)}
      </div>
      <div className={styles.activityLoading}>
        {Array.from({ length: 5 }, (_, index) => <span key={index} />)}
      </div>
    </div>
  );
}

function SharedContentSkeleton() {
  return (
    <div className={styles.sharedPage} aria-hidden="true">
      <section className={`${packStyles.packStage} ${styles.sharedStage}`}>
        <span className={packStyles.stageArt} />
        <span className={packStyles.stageVeil} />
        <div className={styles.sharedCardLayout}>
          <span className={`${styles.initialSkeletonBlock} ${styles.initialSharedCard}`} />
          <div className={styles.initialSharedDetails}>
            {Array.from({ length: 6 }, (_, index) => <span key={index} className={styles.initialSkeletonBlock} />)}
          </div>
        </div>
      </section>
    </div>
  );
}

export function CcgLeaderboardLoadingSkeleton({ label }: { label?: string }) {
  return (
    <div className={styles.leaderboardLoading} aria-label={label}>
      <div className={styles.leaderboardPodium}>
        <div className={styles.leaderboardPodiumTop}>
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className={styles.leaderboardPodiumCard}>
              <span className={styles.leaderboardLoadingHeader} />
              <div className={styles.leaderboardLoadingShowcase}>
                {Array.from({ length: 3 }, (_, cardIndex) => (
                  <span key={cardIndex} className={styles.leaderboardLoadingShowcaseCard} />
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className={styles.leaderboardPodiumGrid}>
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className={styles.leaderboardPodiumCard}>
              <span className={styles.leaderboardLoadingHeader} />
              <div className={styles.leaderboardLoadingShowcase}>
                {Array.from({ length: 3 }, (_, cardIndex) => (
                  <span key={cardIndex} className={styles.leaderboardLoadingShowcaseCard} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className={`${styles.leaderboardRows} ${styles.leaderboardLoadingRows}`}>
        {Array.from({ length: 8 }, (_, index) => <span key={index} />)}
      </div>
    </div>
  );
}

function LeaderboardContentSkeleton() {
  return (
    <div className={styles.leaderboardPage} aria-hidden="true">
      <span className={`${styles.initialSkeletonBlock} ${styles.leaderboardHero}`} />
      <CcgLeaderboardLoadingSkeleton />
    </div>
  );
}

export default function CcgInitialSkeleton({ pathname }: { pathname: string }) {
  const landing = pathname === "/ccg" || pathname === "/ccg/";
  const content = pathname.startsWith("/ccg/open")
    ? <CcgOpenContentSkeleton />
    : pathname.startsWith("/ccg/collection")
      ? <CollectionContentSkeleton />
      : pathname.startsWith("/ccg/activity")
        ? <ActivityContentSkeleton />
        : pathname.startsWith("/ccg/character-checker")
          ? <ActivityContentSkeleton />
        : pathname.startsWith("/ccg/leaderboard")
          ? <LeaderboardContentSkeleton />
        : pathname.startsWith("/ccg/share/")
          ? <SharedContentSkeleton />
          : <LandingContentSkeleton />;

  return (
    <main className={`${styles.vault} ${landing ? styles.vaultViewportLocked : styles.vaultCompact}`} aria-busy="true">
      <SkeletonHeader />
      <div className={styles.shellContent}>{content}</div>
    </main>
  );
}
