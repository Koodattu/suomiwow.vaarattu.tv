"use client";

import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { FaCrown, FaTrophy, FaXmark } from "react-icons/fa6";
import type { CcgLeaderboardEntry, CcgLeaderboardShowcaseCard, CcgShowcaseCardInput } from "@/types";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { queryKeys, useCcgLeaderboard, useCcgLeaderboardMe } from "@/lib/queries";
import CcgShell from "@/components/ccg/CcgShell";
import CcgLoadError from "@/components/ccg/CcgLoadError";
import CollectibleCard from "@/components/ccg/CollectibleCard";
import CardViewer from "@/components/ccg/CardViewer";
import styles from "@/components/ccg/ccg.module.css";

function ShowcaseCards({
  cards,
  onInspect,
  onRemove,
  emptyLabel,
  removeLabel,
}: {
  cards: CcgLeaderboardShowcaseCard[];
  onInspect: (item: CcgLeaderboardShowcaseCard) => void;
  onRemove?: (item: CcgLeaderboardShowcaseCard) => void;
  emptyLabel?: string;
  removeLabel?: string;
}) {
  return (
    <div className={styles.leaderboardShowcaseCards}>
      {cards.map((item) => (
        <div className={styles.leaderboardShowcaseSlot} key={item.card.id}>
          <button
            type="button"
            className={styles.leaderboardShowcaseCard}
            onClick={() => onInspect(item)}
            aria-label={item.card.name}
          >
            <CollectibleCard card={item.card} finish={item.finish} artVariant={item.artVariant} compact hideBadges />
          </button>
          {onRemove ? (
            <button
              type="button"
              className={styles.leaderboardShowcaseRemove}
              onClick={() => onRemove(item)}
              aria-label={`${removeLabel ?? "Remove"}: ${item.card.name}`}
              title={removeLabel}
            >
              <FaXmark aria-hidden="true" />
            </button>
          ) : null}
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

export default function CcgLeaderboardPage() {
  const t = useTranslations("ccg.leaderboard");
  const locale = useLocale();
  const { user, isLoading: authLoading, login } = useAuth();
  const queryClient = useQueryClient();
  const leaderboardQuery = useCcgLeaderboard();
  const meQuery = useCcgLeaderboardMe(Boolean(user));
  const [viewerItem, setViewerItem] = useState<CcgLeaderboardShowcaseCard | null>(null);
  const saveShowcase = useMutation({
    mutationFn: (cards: CcgShowcaseCardInput[]) => api.updateCcgShowcase(cards),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.ccg.leaderboardMe, data);
      void queryClient.invalidateQueries({ queryKey: queryKeys.ccg.leaderboard });
    },
  });
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
  const removeFavorite = (item: CcgLeaderboardShowcaseCard) => {
    saveShowcase.mutate(myShowcase
      .filter((favorite) => favorite.card.id !== item.card.id)
      .map((favorite) => ({ cardId: favorite.card.id, finish: favorite.finish, artVariant: favorite.artVariant })));
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
              <div>
                <h3>{t("showcase.title")}</h3>
                <p>{t("showcase.body")}</p>
              </div>
              <ShowcaseCards
                cards={myShowcase}
                onInspect={inspect}
                onRemove={saveShowcase.isPending ? undefined : removeFavorite}
                emptyLabel={t("showcase.empty")}
                removeLabel={t("showcase.remove")}
              />
              <Link href="/ccg/collection" className={styles.secondaryButton}>{t("showcase.choose")}</Link>
              {saveShowcase.isError ? <p className={styles.leaderboardSaveError}>{t("showcase.error")}</p> : null}
            </div>
          </section>
        ) : null}

        <section className={styles.leaderboardBoard} aria-busy={leaderboardQuery.isPending}>
          <div className={styles.leaderboardSectionHeading}>
            <div>
              <span className={styles.eyebrow}>{t("eyebrow")}</span>
              <h2>{t("rankingTitle")}</h2>
            </div>
            <p>{t("rankingBody")}</p>
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
                    <ShowcaseCards cards={entry.showcase} onInspect={inspect} emptyLabel={t("showcase.empty")} />
                    <CollectorStats entry={entry} t={t} />
                  </article>
                ))}
              </div>

              {remainingCollectors.length > 0 ? (
                <ol className={styles.leaderboardRows} start={4}>
                  {remainingCollectors.map((entry) => (
                    <li className={styles.leaderboardRow} key={entry.rank}>
                      <span className={styles.leaderboardRowRank}>#{entry.rank}</span>
                      <img src={entry.avatarUrl} alt="" className={styles.leaderboardAvatar} />
                      <div className={styles.leaderboardRowIdentity}>
                        <strong>{entry.username}</strong>
                        <span>{entry.showcase.map((item) => item.card.name).join(" · ")}</span>
                      </div>
                      <span className={styles.leaderboardRowCards}>{numberFormatter.format(entry.cardsOwned)} {t("stats.cards")}</span>
                      <strong className={styles.leaderboardRowScore}>{numberFormatter.format(entry.score)}</strong>
                    </li>
                  ))}
                </ol>
              ) : null}
            </>
          )}
        </section>

        {leaderboardQuery.data ? (
          <section className={`${styles.panel} ${styles.leaderboardScoring}`}>
            <div className={styles.leaderboardScoringIntro}>
              <h2>{t("scoring.title")}</h2>
              <p>{t("scoring.body")}</p>
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
            <aside>
              <strong>{t("scoring.luckTitle")}</strong>
              <p>{t("scoring.luckBody")}</p>
            </aside>
          </section>
        ) : null}
      </div>

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
