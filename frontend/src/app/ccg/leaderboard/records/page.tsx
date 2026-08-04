"use client";

import { useLocale, useTranslations } from "next-intl";
import type { CSSProperties } from "react";
import type { CcgLeaderboardRecordBoard, CcgLeaderboardRecordMetric } from "@/types";
import { CCG_FINISH_COLORS } from "@/lib/ccg";
import { useCcgLeaderboardRecords } from "@/lib/queries";
import CcgShell from "@/components/ccg/CcgShell";
import CcgLoadError from "@/components/ccg/CcgLoadError";
import CcgLeaderboardNav from "@/components/ccg/CcgLeaderboardNav";
import { CcgLeaderboardRecordsLoadingSkeleton } from "@/components/ccg/CcgPageSkeletons";
import styles from "@/components/ccg/ccg.module.css";

const METRIC_ACCENTS: Record<CcgLeaderboardRecordMetric, string> = {
  uniqueCards: "#7ddcff",
  finishes: "#d8b4fe",
  completedSets: "#f4c152",
};

function RecordBoard({
  board,
  numberFormatter,
}: {
  board: CcgLeaderboardRecordBoard;
  numberFormatter: Intl.NumberFormat;
}) {
  const t = useTranslations("ccg.leaderboard.records");
  const tCcg = useTranslations("ccg");
  const title = board.kind === "metric"
    ? t(`metrics.${board.metric}`)
    : t("mostFinish", { finish: tCcg(`finish.${board.finish}`) });
  const context = board.kind === "finish"
    ? board.raidName ?? t("rareFinish")
    : t("collectionMetric");
  const accent = board.kind === "finish" ? CCG_FINISH_COLORS[board.finish] : METRIC_ACCENTS[board.metric];
  const slots = Array.from({ length: 3 }, (_, index) => board.entries[index] ?? null);

  return (
    <article
      className={styles.leaderboardRecordCard}
      style={{ "--leaderboard-record-accent": accent } as CSSProperties}
    >
      <header className={styles.leaderboardRecordHeader}>
        <span title={context}>{context}</span>
        <h3>{title}</h3>
      </header>
      <ol className={styles.leaderboardRecordEntries} aria-label={title}>
        {slots.map((entry, index) => entry ? (
          <li key={`${board.key}-${entry.username}-${entry.rank}`} data-rank={entry.rank}>
            <span className={styles.leaderboardRecordRank}>#{entry.rank}</span>
            <img src={entry.avatarUrl} alt="" className={styles.leaderboardRecordAvatar} />
            <strong title={entry.username}>{entry.username}</strong>
            <span className={styles.leaderboardRecordValue}>{numberFormatter.format(entry.value)}</span>
          </li>
        ) : (
          <li className={styles.leaderboardRecordEmpty} key={`${board.key}-empty-${index}`}>
            <span className={styles.leaderboardRecordRank}>#{index + 1}</span>
            <span className={styles.leaderboardRecordEmptyAvatar} aria-hidden="true" />
            <span>{t("unclaimed")}</span>
            <span className={styles.leaderboardRecordValue}>—</span>
          </li>
        ))}
      </ol>
    </article>
  );
}

export default function CcgLeaderboardRecordsPage() {
  const t = useTranslations("ccg.leaderboard");
  const locale = useLocale();
  const recordsQuery = useCcgLeaderboardRecords();
  const numberFormatter = new Intl.NumberFormat(locale);
  const calculatedAt = recordsQuery.data?.calculatedAt
    ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(recordsQuery.data.calculatedAt))
    : null;

  return (
    <CcgShell>
      <div className={styles.leaderboardPage}>
        <header className={styles.leaderboardHero}>
          <div>
            <span className={styles.eyebrow}>{t("records.eyebrow")}</span>
            <h1>{t("records.title")}</h1>
            <p>{t("records.body")}</p>
          </div>
          <div className={styles.leaderboardRefresh}>
            <span>{calculatedAt ? t("updated", { time: calculatedAt }) : t("updating")}</span>
          </div>
        </header>

        <CcgLeaderboardNav />

        <section className={styles.leaderboardRecordsSection} aria-busy={recordsQuery.isPending}>
          <div className={styles.leaderboardSectionHeading}>
            <div>
              <span className={styles.eyebrow}>{t("records.eyebrow")}</span>
              <h2>{t("records.sectionTitle")}</h2>
            </div>
            <p>{t("records.sectionBody")}</p>
          </div>

          {recordsQuery.isError ? (
            <CcgLoadError onRetry={() => void recordsQuery.refetch()} />
          ) : recordsQuery.isPending ? (
            <CcgLeaderboardRecordsLoadingSkeleton label={t("records.loading")} />
          ) : (
            <div className={styles.leaderboardRecordsGrid}>
              {(recordsQuery.data?.boards ?? []).map((board) => (
                <RecordBoard key={board.key} board={board} numberFormatter={numberFormatter} />
              ))}
            </div>
          )}
        </section>
      </div>
    </CcgShell>
  );
}
