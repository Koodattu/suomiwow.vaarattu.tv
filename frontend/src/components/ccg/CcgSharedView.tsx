"use client";

import Link from "next/link";
import { useState } from "react";
import type { CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { FaArrowUpRightFromSquare, FaChevronRight, FaVolumeHigh } from "react-icons/fa6";
import type { CcgOpening, CcgShare, CcgShareAttribution } from "@/types";
import { api } from "@/lib/api";
import { playCcgQuip } from "@/lib/ccg-audio";
import { CCG_RARITY_KEYS, combineCcgOpenings } from "@/lib/ccg";
import { getMultiFanLayout } from "@/lib/ccg-pack-fan";
import { formatRealmName } from "@/lib/utils";
import CardViewer, { openCardViewer, type CardViewerOriginBounds } from "./CardViewer";
import CollectibleCard from "./CollectibleCard";
import CcgShell from "./CcgShell";
import { getPackTheme } from "./PackBoosterVisual";
import styles from "./ccg.module.css";
import packStyles from "./pack-opening.module.css";

const SNAPSHOT_DATE_FORMATTER = new Intl.DateTimeFormat("fi-FI", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

function Attribution({ person, className = "" }: { person: CcgShareAttribution; className?: string }) {
  const t = useTranslations("ccg.share");
  return (
    <div className={`${styles.sharedAttribution} ${className}`}>
      <span>{t("unboxedBy")}</span>
      <img src={person.avatarUrl} alt="" />
      <strong>{person.username}</strong>
    </div>
  );
}

function StageBackground({ showRings = true }: { showRings?: boolean }) {
  return (
    <>
      <span className={packStyles.stageArt} />
      <span className={packStyles.stageVeil} />
      {showRings ? (
        <>
          <span className={packStyles.vaultRing} aria-hidden="true" />
          <span className={packStyles.vaultRingInner} aria-hidden="true" />
        </>
      ) : null}
    </>
  );
}

function SharedCard({ share }: { share: Extract<CcgShare, { kind: "card" }> }) {
  const t = useTranslations("ccg");
  const { card, finish, artVariant } = share.card;
  const characterHref = `/characters/${encodeURIComponent(card.realm)}/${encodeURIComponent(card.name)}?class=${encodeURIComponent(String(card.classID))}`;
  return (
    <section
      className={`${packStyles.packStage} ${styles.sharedStage}`}
      style={getPackTheme(card.set)}
      aria-labelledby="ccg-shared-card-title"
    >
      <StageBackground showRings={false} />
      <div className={styles.sharedCardLayout}>
        <CollectibleCard card={card} finish={finish} artVariant={artVariant} width={520} className={styles.sharedCardAsset} />
        <div className={styles.sharedCardDetails}>
          <div className={`${styles.viewerInfo} ${styles.sharedCardInfo}`}>
            <div className={styles.viewerSet} style={{ color: card.set.theme.accent }}>{card.set.raidName}</div>
            <h1 id="ccg-shared-card-title">{card.name}</h1>
            {card.guildName ? <p className={styles.viewerIdentity}>{`<${card.guildName}>`}</p> : null}

            {card.quip ? (
              <div className={styles.viewerQuip}>
                {card.quip.audioPath ? (
                  <button
                    type="button"
                    className={styles.viewerQuipButton}
                    onClick={() => playCcgQuip(card.quip?.audioPath)}
                    aria-label={t("playQuip", { name: card.name })}
                    title={t("playQuip", { name: card.name })}
                  >
                    <FaVolumeHigh aria-hidden="true" />
                  </button>
                ) : null}
                {card.quip.text ? <blockquote>{card.quip.text}</blockquote> : null}
              </div>
            ) : null}

            <dl className={`${styles.viewerFacts} ${styles.viewerFactsWithoutTopBorder}`}>
              <div><dt>{t("collection.quality")}</dt><dd>{t(`finish.${finish}`)}</dd></div>
              <div><dt>{t("collection.rarity")}</dt><dd>{t(`rarity.${CCG_RARITY_KEYS[card.tierGrade]}`)}</dd></div>
              <div><dt>{t("realm")}</dt><dd>{formatRealmName(card.realm)}</dd></div>
              <div><dt>{t("snapshot")}</dt><dd>{SNAPSHOT_DATE_FORMATTER.format(new Date(card.performanceSnapshotAt))}</dd></div>
            </dl>
            <div className={styles.viewerActions}>
              <div>
                <Link
                  href={characterHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.viewerCharacterLink}
                  aria-label={t("viewCharacterLabel", { name: card.name })}
                >
                  <span>{t("viewCharacter")}</span>
                  <FaArrowUpRightFromSquare aria-hidden="true" />
                </Link>
              </div>
              <div><Attribution person={share.unboxedBy} className={styles.sharedAttributionAction} /></div>
            </div>
          </div>
          <Link href="/ccg/open" className={`${styles.primaryButton} ${styles.sharedCta} ${styles.sharedCardCta}`}>
            {t("share.openPacksNow")}
            <FaChevronRight aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  );
}

// A shared batch renders as its combined opening in the same fan as the opening reveal.
function SharedPack({ pack, packCount, unboxedBy }: { pack: CcgOpening; packCount: number; unboxedBy: CcgShareAttribution }) {
  const t = useTranslations("ccg.share");
  const openT = useTranslations("ccg.open");
  const [viewer, setViewer] = useState<{
    index: number;
    originElement: HTMLElement | null;
    originBounds: CardViewerOriginBounds | null;
    sharedTransition: boolean;
  } | null>(null);
  const targetSetId = pack.selection.type === "raid" ? pack.selection.setId : null;
  const primarySet = targetSetId
    ? pack.sets.find((set) => set.id === targetSetId) ?? pack.sets[0]
    : pack.sets[0];
  const packType = pack.selection.type === "all"
    ? openT("allRaids")
    : primarySet?.raidName;
  const inspectedResult = viewer ? pack.results[viewer.index] : null;
  const fanLayout = packCount > 1 ? getMultiFanLayout(pack.results.length) : null;
  const renderCard = (result: CcgOpening["results"][number], index: number, className: string) => (
    <CollectibleCard
      key={`${result.card.id}:${result.position}`}
      card={result.card}
      finish={result.finish}
      artVariant={result.artVariant}
      compact
      className={className}
      onSelect={(event) => {
        const originElement = event.currentTarget;
        openCardViewer(originElement, (sharedTransition, originBounds) => {
          setViewer({ index, originElement, originBounds, sharedTransition });
        }, event.nativeEvent);
      }}
    />
  );
  return (
    <>
      <section
        className={`${packStyles.packStage} ${styles.sharedStage}`}
        style={getPackTheme(primarySet, pack.selection.type === "all")}
        aria-labelledby="ccg-shared-pack-title"
      >
        <StageBackground />
        <div className={styles.sharedPackContent}>
          <header className={styles.sharedPackHeader}>
            <div className={styles.sharedPackType}>{packType}</div>
            <h1 id="ccg-shared-pack-title" className={styles.sharedPackTitle}>
              <img src={unboxedBy.avatarUrl} alt="" />
              <span>{packCount > 1
                ? t("sharedBatchBy", { username: unboxedBy.username, count: packCount })
                : t("sharedPackBy", { username: unboxedBy.username })}</span>
            </h1>
          </header>
          <div className={styles.sharedPackScroller}>
            {fanLayout ? (
              <div
                className={`${packStyles.cardFan} ${packStyles.multiFan} ${packStyles.multiFanSwipe}`}
                style={{ "--multi-fan-height": fanLayout.heightUnits } as CSSProperties}
              >
                {pack.results.map((result, index) => {
                  const slot = fanLayout.slots[index];
                  return (
                    <div
                      key={`${result.card.id}:${result.position}`}
                      className={packStyles.multiFanCard}
                      style={{
                        "--multi-x": slot.x,
                        "--multi-y": slot.y,
                        "--multi-z": slot.zIndex,
                        "--fan-angle": `${slot.angle}deg`,
                      } as CSSProperties}
                    >
                      {renderCard(result, index, `${styles.sharedFanCard} ${styles.scaledCardTypography}`)}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className={styles.sharedPackCards}>
                {pack.results.map((result, index) => renderCard(result, index, styles.sharedPackCard))}
              </div>
            )}
          </div>
          <Link href="/ccg/open" className={`${styles.primaryButton} ${styles.sharedCta} ${styles.sharedPackCta}`}>
            {t("openPacksNow")}
            <FaChevronRight aria-hidden="true" />
          </Link>
        </div>
      </section>
      {viewer && inspectedResult ? (
        <CardViewer
          card={{
            ...inspectedResult.card,
            ownership: [{
              finish: inspectedResult.finish,
              artVariant: inspectedResult.artVariant,
              quantity: 1,
            }],
          }}
          initialFinish={inspectedResult.finish}
          initialArtVariant={inspectedResult.artVariant}
          originElement={viewer.originElement}
          originBounds={viewer.originBounds}
          sharedTransition={viewer.sharedTransition}
          canShare={false}
          footerAction={<Attribution person={unboxedBy} className={styles.sharedAttributionAction} />}
          showFinishControls={false}
          onClose={() => setViewer(null)}
        />
      ) : null}
    </>
  );
}

export default function CcgSharedView({
  shareId,
  initialShare,
}: {
  shareId: string;
  initialShare?: CcgShare;
}) {
  const t = useTranslations("ccg.share");
  const shareQuery = useQuery({
    queryKey: ["ccg", "share", shareId],
    queryFn: () => api.getCcgShare(shareId),
    initialData: initialShare,
    retry: false,
    staleTime: Infinity,
  });
  const share = shareQuery.data ?? null;

  return (
    <CcgShell compact>
      <div className={styles.sharedPage}>
        {share ? (
          share.kind === "card" ? <SharedCard share={share} />
            : share.kind === "batch"
              ? <SharedPack pack={combineCcgOpenings(share.batch.openings)} packCount={share.batch.openings.length} unboxedBy={share.unboxedBy} />
              : <SharedPack pack={share.pack} packCount={1} unboxedBy={share.unboxedBy} />
        ) : shareQuery.isPending ? (
          <div className={styles.sharedLoading} role="status">{t("loading")}</div>
        ) : (
          <div className={styles.sharedError} role="alert">
            <h1>{t("notFoundTitle")}</h1>
            <p>{t("notFoundBody")}</p>
          </div>
        )}
      </div>
    </CcgShell>
  );
}
