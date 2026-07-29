"use client";

import Link from "next/link";
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from "@headlessui/react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { FaCrown, FaTrophy, FaXmark } from "react-icons/fa6";
import type { CcgLeaderboardEntry, CcgLeaderboardShowcaseCard } from "@/types";
import { useAuth } from "@/context/AuthContext";
import { CCG_CLASS_COLORS, CCG_FINISH_COLORS, CCG_RARITY_COLORS, CCG_RARITY_KEYS } from "@/lib/ccg";
import { useCcgLeaderboard, useCcgLeaderboardMe } from "@/lib/queries";
import { formatRealmName } from "@/lib/utils";
import CcgShell from "@/components/ccg/CcgShell";
import CcgLoadError from "@/components/ccg/CcgLoadError";
import CollectibleCard from "@/components/ccg/CollectibleCard";
import CardViewer from "@/components/ccg/CardViewer";
import styles from "@/components/ccg/ccg.module.css";

function ShowcaseCards({
  cards,
  onSelect,
  emptyLabel,
  personal = false,
}: {
  cards: CcgLeaderboardShowcaseCard[];
  onSelect: (item: CcgLeaderboardShowcaseCard) => void;
  emptyLabel?: string;
  personal?: boolean;
}) {
  return (
    <div className={`${styles.leaderboardShowcaseCards} ${personal ? styles.leaderboardShowcaseCardsPersonal : ""}`}>
      {cards.map((item) => (
        <div className={styles.leaderboardShowcaseSlot} key={item.card.id}>
          <button
            type="button"
            className={styles.leaderboardShowcaseCard}
            onClick={() => onSelect(item)}
            aria-label={item.card.name}
          >
            <CollectibleCard card={item.card} finish={item.finish} artVariant={item.artVariant} compact hideBadges />
          </button>
        </div>
      ))}
      {Array.from({ length: Math.max(0, 3 - cards.length) }, (_, index) => (
        <div className={styles.leaderboardShowcaseEmpty} key={`empty-${index}`} aria-label={emptyLabel}>
          <span aria-hidden="true">+</span>
        </div>
      ))}
    </div>
  );
}

function CollectorStats({ entry, t }: { entry: CcgLeaderboardEntry; t: ReturnType<typeof useTranslations> }) {
  return (
    <dl className={styles.leaderboardStats}>
      <div><dt>{t("stats.cards")}</dt><dd>{entry.cardsOwned}</dd></div>
      <div><dt>{t("stats.finishes")}</dt><dd>{entry.finishesOwned}</dd></div>
      <div><dt>{t("stats.completedSets")}</dt><dd>{entry.completedSets}</dd></div>
    </dl>
  );
}

function ShowcaseSummary({ cards }: { cards: CcgLeaderboardShowcaseCard[] }) {
  const tCcg = useTranslations("ccg");

  if (cards.length === 0) return null;
  return (
    <span className={styles.leaderboardRowShowcase}>
      {cards.map((item, index) => (
        <span className={styles.leaderboardRowShowcaseItem} key={item.card.id}>
          {index > 0 ? <span className={styles.leaderboardRowShowcaseSeparator} aria-hidden="true">•</span> : null}
          <span className={styles.leaderboardRowCardIdentity}>
            <strong style={{ color: CCG_CLASS_COLORS[item.card.classID] ?? "#fff" }}>{item.card.name}</strong>
            <span>-{formatRealmName(item.card.realm)}</span>
          </span>
          <span className={styles.leaderboardRowCardFinish} style={{ color: CCG_FINISH_COLORS[item.finish] }}>
            {tCcg(`finish.${item.finish}`)}
          </span>
          <span className={styles.leaderboardRowCardRarity} style={{ color: CCG_RARITY_COLORS[item.card.tierGrade] }}>
            {tCcg(`rarity.${CCG_RARITY_KEYS[item.card.tierGrade]}`)}
          </span>
        </span>
      ))}
    </span>
  );
}

export default function CcgLeaderboardPage() {
  const t = useTranslations("ccg.leaderboard");
  const locale = useLocale();
  const { user, isLoading: authLoading, login } = useAuth();
  const leaderboardQuery = useCcgLeaderboard();
  const meQuery = useCcgLeaderboardMe(Boolean(user));
  const [viewerItem, setViewerItem] = useState<CcgLeaderboardShowcaseCard | null>(null);
  const [selectedCollector, setSelectedCollector] = useState<CcgLeaderboardEntry | null>(null);
  const [scoringOpen, setScoringOpen] = useState(false);
  const entries = leaderboardQuery.data?.entries ?? [];
  const topCollectors = entries.slice(0, 3);
  const remainingCollectors = entries.slice(3);
  const me = meQuery.data?.entry ?? null;
  const myShowcase = meQuery.data?.showcase ?? [];
  const numberFormatter = new Intl.NumberFormat(locale);
  const calculatedAt = leaderboardQuery.data?.calculatedAt
    ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(leaderboardQuery.data.calculatedAt))
    : null;

  const inspect = (item: CcgLeaderboardShowcaseCard) => setViewerItem(item);
  const inspectCollectorCard = (item: CcgLeaderboardShowcaseCard) => {
    setSelectedCollector(null);
    setViewerItem(item);
  };

  return (
    <CcgShell>
      <div className={styles.leaderboardPage}>
        <header className={styles.leaderboardHero}>
          <div>
            <span className={styles.eyebrow}>{t("eyebrow")}</span>
            <h1>{t("title")}</h1>
            <p>{t("body")}</p>
          </div>
          <div className={styles.leaderboardRefresh}>
            <span>{calculatedAt ? t("updated", { time: calculatedAt }) : t("updating")}</span>
          </div>
        </header>

        {!authLoading && !user ? (
          <section className={`${styles.panel} ${styles.leaderboardLogin}`}>
            <div>
              <h2>{t("loginTitle")}</h2>
              <p>{t("loginBody")}</p>
            </div>
            <button type="button" className={styles.primaryButton} onClick={() => void login("/ccg/leaderboard")}>
              {t("loginAction")}
            </button>
          </section>
        ) : user ? (
          <section className={`${styles.panel} ${styles.leaderboardMe}`}>
            <div className={styles.leaderboardMeStanding}>
              <span className={styles.eyebrow}>{t("yourStanding")}</span>
              {me ? (
                <>
                  <h2>{t("rank", { rank: me.rank })}</h2>
                  <strong>{t("points", { score: numberFormatter.format(me.score) })}</strong>
                  <CollectorStats entry={me} t={t} />
                </>
              ) : (
                <>
                  <h2>{t("unranked")}</h2>
                  <p>{t("unrankedBody")}</p>
                </>
              )}
            </div>
            <div className={styles.leaderboardMeShowcase}>
              <div className={styles.leaderboardMeShowcaseIntro}>
                <div>
                  <h3>{t("showcase.title")}</h3>
                  <p>{t("showcase.body")}</p>
                </div>
                <Link href="/ccg/collection" className={styles.secondaryButton}>{t("showcase.choose")}</Link>
              </div>
              <ShowcaseCards
                cards={myShowcase}
                onSelect={inspect}
                emptyLabel={t("showcase.empty")}
                personal
              />
            </div>
          </section>
        ) : null}

        <section className={styles.leaderboardBoard} aria-busy={leaderboardQuery.isPending}>
          <div className={styles.leaderboardSectionHeading}>
            <div>
              <span className={styles.eyebrow}>{t("eyebrow")}</span>
              <h2>{t("rankingTitle")}</h2>
            </div>
            <p>
              {t("rankingBody")}{" "}
              {leaderboardQuery.data ? (
                <button type="button" className={styles.leaderboardScoringLink} onClick={() => setScoringOpen(true)}>
                  {t("scoring.open")}
                </button>
              ) : null}
            </p>
          </div>

          {leaderboardQuery.isError ? (
            <CcgLoadError onRetry={() => void leaderboardQuery.refetch()} />
          ) : leaderboardQuery.isPending ? (
            <div className={styles.leaderboardLoading} aria-label={t("updating")}>
              {Array.from({ length: 3 }, (_, index) => <span key={index} />)}
            </div>
          ) : entries.length === 0 ? (
            <div className={`${styles.panel} ${styles.leaderboardEmpty}`}>
              <FaTrophy aria-hidden="true" />
              <h3>{t("emptyTitle")}</h3>
              <p>{t("emptyBody")}</p>
            </div>
          ) : (
            <>
              <div className={styles.leaderboardPodium}>
                {topCollectors.map((entry) => (
                  <article className={styles.leaderboardPodiumCard} data-rank={entry.rank} key={entry.rank}>
                    <div className={styles.leaderboardCollectorHeader}>
                      <span className={styles.leaderboardRank}>
                        {entry.rank === 1 ? <FaCrown aria-hidden="true" /> : null}
                        #{entry.rank}
                      </span>
                      <img src={entry.avatarUrl} alt="" className={styles.leaderboardAvatar} />
                      <div>
                        <h3>{entry.username}</h3>
                        <strong>{t("points", { score: numberFormatter.format(entry.score) })}</strong>
                      </div>
                    </div>
                    <ShowcaseCards cards={entry.showcase} onSelect={inspect} emptyLabel={t("showcase.empty")} />
                    <CollectorStats entry={entry} t={t} />
                  </article>
                ))}
              </div>

              {remainingCollectors.length > 0 ? (
                <ol className={styles.leaderboardRows} start={4}>
                  {remainingCollectors.map((entry) => (
                    <li
                      className={styles.leaderboardRow}
                      key={entry.rank}
                      role="button"
                      tabIndex={0}
                      aria-label={t("showcase.openCollector", { name: entry.username })}
                      onClick={() => setSelectedCollector(entry)}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        setSelectedCollector(entry);
                      }}
                    >
                      <span className={styles.leaderboardRowRank}>#{entry.rank}</span>
                      <img src={entry.avatarUrl} alt="" className={styles.leaderboardAvatar} />
                      <div className={styles.leaderboardRowIdentity}>
                        <strong>{entry.username}</strong>
                        <ShowcaseSummary cards={entry.showcase} />
                      </div>
                      <dl className={styles.leaderboardRowStats}>
                        <div data-stat="cards">
                          <dt>{t("stats.cards")}</dt>
                          <dd>{numberFormatter.format(entry.cardsOwned)}</dd>
                        </div>
                        <div>
                          <dt>{t("stats.finishes")}</dt>
                          <dd>{numberFormatter.format(entry.finishesOwned)}</dd>
                        </div>
                        <div>
                          <dt>{t("stats.completedSets")}</dt>
                          <dd>{numberFormatter.format(entry.completedSets)}</dd>
                        </div>
                      </dl>
                      <strong className={styles.leaderboardRowScore}>{numberFormatter.format(entry.score)}</strong>
                    </li>
                  ))}
                </ol>
              ) : null}
            </>
          )}
        </section>

      </div>

      {leaderboardQuery.data ? (
        <Dialog open={scoringOpen} onClose={setScoringOpen} className={styles.leaderboardScoringDialogRoot}>
          <DialogBackdrop transition className={styles.leaderboardScoringDialogBackdrop} />
          <div className={styles.leaderboardScoringDialogFrame}>
            <DialogPanel transition className={styles.leaderboardScoringDialog}>
              <div className={styles.leaderboardScoringDialogHeader}>
                <DialogTitle className={styles.leaderboardScoringDialogTitle}>{t("scoring.title")}</DialogTitle>
                <button
                  type="button"
                  className={styles.leaderboardScoringDialogClose}
                  onClick={() => setScoringOpen(false)}
                  aria-label={t("scoring.close")}
                >
                  <FaXmark aria-hidden="true" />
                </button>
              </div>
              <ul>
                <li>{t("scoring.base", { points: leaderboardQuery.data.scoring.seriesBase })}</li>
                <li>{t("scoring.rarity", {
                  min: Math.min(...Object.values(leaderboardQuery.data.scoring.grades)),
                  max: Math.max(...Object.values(leaderboardQuery.data.scoring.grades)),
                })}</li>
                <li>{t("scoring.finishes", {
                  min: Math.min(...Object.values(leaderboardQuery.data.scoring.finishes).filter((points) => points > 0)),
                  max: Math.max(...Object.values(leaderboardQuery.data.scoring.finishes)),
                })}</li>
                <li>{t("scoring.cardCompletion", { points: leaderboardQuery.data.scoring.allFinishesBonus })}</li>
                <li>{t("scoring.setCompletion", { points: leaderboardQuery.data.scoring.completeSetPerCard })}</li>
              </ul>
            </DialogPanel>
          </div>
        </Dialog>
      ) : null}

      <Dialog open={Boolean(selectedCollector)} onClose={() => setSelectedCollector(null)} className={styles.leaderboardScoringDialogRoot}>
        <DialogBackdrop transition className={styles.leaderboardScoringDialogBackdrop} />
        <div className={styles.leaderboardScoringDialogFrame}>
          <DialogPanel transition className={`${styles.leaderboardScoringDialog} ${styles.leaderboardCollectorDialog}`}>
            <div className={styles.leaderboardScoringDialogHeader}>
              <DialogTitle className={styles.leaderboardScoringDialogTitle}>
                {selectedCollector ? t("showcase.collectorTitle", { name: selectedCollector.username }) : ""}
              </DialogTitle>
              <button
                type="button"
                className={styles.leaderboardScoringDialogClose}
                onClick={() => setSelectedCollector(null)}
                aria-label={t("showcase.closeCollector")}
              >
                <FaXmark aria-hidden="true" />
              </button>
            </div>
            {selectedCollector ? (
              <ShowcaseCards
                cards={selectedCollector.showcase}
                onSelect={inspectCollectorCard}
                emptyLabel={t("showcase.empty")}
              />
            ) : null}
          </DialogPanel>
        </div>
      </Dialog>

      {viewerItem ? (
        <CardViewer
          card={viewerItem.card}
          initialFinish={viewerItem.finish}
          initialArtVariant={viewerItem.artVariant}
          canShare={false}
          showFinishControls={false}
          showOwnershipStatus={false}
          onClose={() => setViewerItem(null)}
        />
      ) : null}
    </CcgShell>
  );
}
