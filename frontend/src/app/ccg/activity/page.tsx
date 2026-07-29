"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { FaArrowUpRightFromSquare, FaGift, FaTicket, FaTwitch } from "react-icons/fa6";
import CcgLoadError from "@/components/ccg/CcgLoadError";
import CcgShareButton from "@/components/ccg/CcgShareButton";
import CcgShell from "@/components/ccg/CcgShell";
import CollectibleCard from "@/components/ccg/CollectibleCard";
import PackBoosterVisual, { getPackTheme } from "@/components/ccg/PackBoosterVisual";
import styles from "@/components/ccg/ccg.module.css";
import packStyles from "@/components/ccg/pack-opening.module.css";
import { useAuth } from "@/context/AuthContext";
import { CCG_CLASS_COLORS, CCG_FINISH_COLORS, CCG_FINISH_ORDER, CCG_RARITY_COLORS, CCG_RARITY_KEYS } from "@/lib/ccg";
import { useCcgActivity } from "@/lib/queries";
import { formatRealmName } from "@/lib/utils";
import type { CcgActivityFilter, CcgActivityItem, CcgActivityReward, CcgActivitySummary } from "@/types";

const ACTIVITY_FILTERS: readonly CcgActivityFilter[] = ["all", "packs", "codes", "twitch"];

function ActivitySummary({ summary, numberFormatter }: {
  summary: CcgActivitySummary;
  numberFormatter: Intl.NumberFormat;
}) {
  const t = useTranslations("ccg.activity.summary");
  const tCcg = useTranslations("ccg");
  const totals = [
    { label: t("packsOpened"), value: summary.packsTotal },
    { label: t("cardsTotal"), value: summary.cardsTotal },
    { label: t("uniqueCards"), value: summary.uniqueCards },
  ];

  return (
    <section className={styles.activitySummary} aria-labelledby="activity-summary-title">
      <div className={styles.activitySummaryHeader}>
        <h2 id="activity-summary-title">{t("title")}</h2>
        <dl className={styles.activitySummaryTotals}>
          {totals.map((total) => (
            <div key={total.label}>
              <dt>{total.label}</dt>
              <dd>{numberFormatter.format(total.value)}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div className={styles.activitySummaryBreakdowns}>
        <div className={styles.activitySummaryGroup}>
          <h3>{t("raidPacks")}</h3>
          {summary.raidPacks.length > 0 ? (
            <ul className={styles.activitySummaryPills}>
              {summary.raidPacks.map((pack) => {
                const label = pack.packArt?.raidName
                  ?? (pack.mode === "legacy" ? t("mixedLegacy") : tCcg("open.currentTier"));
                return (
                  <li
                    key={`${pack.mode}:${pack.packArt?.slug ?? "mixed"}`}
                    style={{ "--activity-summary-accent": pack.packArt?.theme.accent ?? "#7ddcff" } as CSSProperties}
                  >
                    <span>{label}</span>
                    <strong>{numberFormatter.format(pack.count)}</strong>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className={styles.activitySummaryEmpty}>{t("noPacks")}</p>
          )}
        </div>
        <div className={styles.activitySummaryGroup}>
          <h3>{t("finishes")}</h3>
          <ul className={styles.activitySummaryPills}>
            {CCG_FINISH_ORDER.map((finish) => (
              <li
                key={finish}
                style={{ "--activity-summary-accent": CCG_FINISH_COLORS[finish] } as CSSProperties}
              >
                <span>{tCcg(`finish.${finish}`)}</span>
                <strong>{numberFormatter.format(summary.finishes[finish])}</strong>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function getLocalDayKey(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function ActivityThumbnail({ kind, fallback }: {
  kind: CcgActivityItem["kind"];
  fallback: ReactNode;
}) {
  return (
    <span
      className={styles.activityThumbnail}
      data-kind={kind}
      aria-hidden="true"
    >
      {fallback}
    </span>
  );
}

function ActivityRewardCardThumbnail({ reward }: {
  reward: Extract<CcgActivityReward, { type: "card" }>;
}) {
  if (!reward.card) return null;
  return (
    <span className={styles.activityRewardCardThumbnail} aria-hidden="true">
      <span className={styles.activityRewardCardScale}>
        <CollectibleCard
          card={reward.card}
          finish={reward.finish ?? "standard"}
          artVariant={reward.artVariant ?? "standard"}
          width={400}
        />
      </span>
    </span>
  );
}

function ActivityRewardPackThumbnails({ reward }: {
  reward: Extract<CcgActivityReward, { type: "packs" }>;
}) {
  const tCcg = useTranslations("ccg");
  const entries = [
    reward.currentPacks > 0
      ? {
          key: "current",
          title: reward.currentPackArt?.raidName ?? tCcg("open.currentTier"),
          theme: getPackTheme(reward.currentPackArt ?? undefined),
        }
      : null,
    reward.legacyPacks > 0
      ? {
          key: "legacy",
          title: tCcg("open.legacyPackTitle"),
          theme: getPackTheme(undefined, true),
        }
      : null,
  ].filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

  return (
    <span className={styles.activityRewardPacks} data-count={entries.length} aria-hidden="true">
      {entries.map((entry) => (
        <span key={entry.key} className={styles.activityRewardPack}>
          <span className={styles.activityRewardPackScale}>
            <span className={packStyles.packButton} style={entry.theme}>
              <PackBoosterVisual title={entry.title} cardsLabel={tCcg("landing.cards")} />
            </span>
          </span>
        </span>
      ))}
    </span>
  );
}

function RewardSummary({ reward }: { reward: CcgActivityReward }) {
  const t = useTranslations("ccg.activity");
  const tCcg = useTranslations("ccg");

  if (reward.type === "packs") {
    const rewards = [
      reward.currentPacks > 0
        ? t("reward.currentPacksFrom", {
            count: reward.currentPacks,
            set: reward.currentPackArt?.raidName ?? tCcg("open.currentTier"),
          })
        : null,
      reward.legacyPacks > 0 ? t("reward.legacyPacks", { count: reward.legacyPacks }) : null,
    ].filter((value): value is string => Boolean(value));
    return <p className={styles.activityLead}>{rewards.join(" · ")}</p>;
  }

  if (!reward.card) return <p className={styles.activityLead}>{t("reward.cardUnavailable")}</p>;
  const finish = reward.finish ?? "standard";
  return (
    <>
      <div className={styles.activityRewardCardLine}>
        <span className={styles.activityPackCardIdentity}>
          <strong style={{ color: CCG_CLASS_COLORS[reward.card.classID] ?? "#fff" }}>{reward.card.name}</strong>
          <span>-{formatRealmName(reward.card.realm)}</span>
        </span>
        <span className={styles.activityPackCardFinish} style={{ color: CCG_FINISH_COLORS[finish] }}>
          {tCcg(`finish.${finish}`)}
        </span>
        <span className={styles.activityPackCardRarity} style={{ color: CCG_RARITY_COLORS[reward.card.tierGrade] }}>
          {tCcg(`rarity.${CCG_RARITY_KEYS[reward.card.tierGrade]}`)}
        </span>
      </div>
      <p className={styles.activityCardDetail}>{reward.card.set.raidName}</p>
    </>
  );
}

function ActivityPackThumbnail({ item }: { item: Extract<CcgActivityItem, { kind: "pack" }> }) {
  const t = useTranslations("ccg");
  const isRandomLegacy = item.mode === "legacy" && !item.packArt;
  const title = item.packArt?.raidName ?? t("open.legacyPackTitle");
  return (
    <span className={styles.activityPackThumbnail} aria-hidden="true">
      <span className={styles.activityPackScale}>
        <span className={packStyles.packButton} style={getPackTheme(item.packArt ?? undefined, isRandomLegacy)}>
          <PackBoosterVisual title={title} cardsLabel={t("landing.cards")} />
        </span>
      </span>
    </span>
  );
}

function ActivityRow({ item, timeFormatter }: { item: CcgActivityItem; timeFormatter: Intl.DateTimeFormat }) {
  const t = useTranslations("ccg.activity");
  const tCcg = useTranslations("ccg");
  const occurredAt = new Date(item.occurredAt);
  const time = <time dateTime={item.occurredAt}>{timeFormatter.format(occurredAt)}</time>;

  if (item.kind === "pack") {
    const title = item.packArt
      ? t("pack.titleSet", { set: item.packArt.raidName })
      : item.mode === "legacy"
        ? t("pack.titleMixedLegacy")
        : t("pack.title", { mode: tCcg(`mode.${item.mode}`) });
    return (
      <article className={`${styles.activityRow} ${styles.activityPackRow}`}>
        <ActivityPackThumbnail item={item} />
        <div className={styles.activityRowContent}>
          <div className={styles.activityRowHeading}>
            <h3>{title}</h3>
            <span className={styles.activityPackSummary}>
              {t("pack.summary", { newCount: item.newCards, duplicateCount: item.duplicates })}
            </span>
            {item.bonusPacks > 0 ? <span className={styles.activityBonus}>{t("pack.bonus", { count: item.bonusPacks })}</span> : null}
            {time}
          </div>
          {(item.cards ?? []).length > 0 ? (
            <ul className={styles.activityPackCardList}>
              {item.cards.map((card, index) => {
                return (
                  <li key={`${item.id}:${index}`}>
                    <span className={styles.activityPackCardIdentity}>
                      <strong style={{ color: CCG_CLASS_COLORS[card.classID] ?? "#fff" }}>{card.name}</strong>
                      <span>-{formatRealmName(card.realm)}</span>
                    </span>
                    <span className={styles.activityPackCardFinish} style={{ color: CCG_FINISH_COLORS[card.finish] }}>
                      {tCcg(`finish.${card.finish}`)}
                    </span>
                    <span className={styles.activityPackCardRarity} style={{ color: CCG_RARITY_COLORS[card.tierGrade] }}>
                      {tCcg(`rarity.${CCG_RARITY_KEYS[card.tierGrade]}`)}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
        <div className={styles.activityActions}>
          <Link href={`/ccg/open?opening=${encodeURIComponent(item.openingId)}&revealed=true`} className={styles.activityViewAction}>
            <FaArrowUpRightFromSquare aria-hidden="true" />
            <span>{t("pack.view")}</span>
          </Link>
          <CcgShareButton
            target={{ kind: "pack", openingId: item.openingId }}
            className={styles.activityShareAction}
          />
        </div>
      </article>
    );
  }

  const rewardCard = item.reward.type === "card" ? item.reward.card : null;
  const packRewardCount = item.reward.type === "packs"
    ? Number(item.reward.currentPacks > 0) + Number(item.reward.legacyPacks > 0)
    : 0;
  const isTwitch = item.kind === "twitch";
  const rewardRowClass = rewardCard
    ? styles.activityRewardCardRow
    : item.reward.type === "packs"
      ? styles.activityRewardPackRow
      : "";
  return (
    <article
      className={`${styles.activityRow} ${rewardRowClass}`}
      data-reward-pack-count={packRewardCount || undefined}
    >
      {item.reward.type === "packs" ? (
        <ActivityRewardPackThumbnails reward={item.reward} />
      ) : rewardCard ? (
        <ActivityRewardCardThumbnail reward={item.reward} />
      ) : (
        <ActivityThumbnail kind={item.kind} fallback={isTwitch ? <FaTwitch /> : <FaTicket />} />
      )}
      <div className={styles.activityRowContent}>
        <div className={styles.activityRowHeading}>
          <h3>{t(isTwitch ? "twitch.title" : "code.title")}</h3>
          {time}
        </div>
        {isTwitch ? <p className={styles.activitySource}>{item.rewardTitle}</p> : null}
        <RewardSummary reward={item.reward} />
        {isTwitch ? (
          <div className={styles.activityMeta}>
            <span>{t("twitch.channel", { channel: item.broadcasterLogin })}</span>
          </div>
        ) : null}
      </div>
    </article>
  );
}

export default function CcgActivityPage() {
  const t = useTranslations("ccg.activity");
  const locale = useLocale();
  const { user, isLoading: authLoading, login } = useAuth();
  const [filter, setFilter] = useState<CcgActivityFilter>("all");
  const activityQuery = useCcgActivity(filter, !authLoading && Boolean(user));
  const timeFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }),
    [locale],
  );
  const numberFormatter = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { weekday: "long", year: "numeric", month: "long", day: "numeric" }),
    [locale],
  );
  const items = useMemo(
    () => activityQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [activityQuery.data],
  );
  const summary = activityQuery.data?.pages[0]?.summary ?? null;
  const groups = useMemo(() => {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const todayKey = getLocalDayKey(today);
    const yesterdayKey = getLocalDayKey(yesterday);
    const grouped = new Map<string, { label: string; items: CcgActivityItem[] }>();
    items.forEach((item) => {
      const date = new Date(item.occurredAt);
      const key = getLocalDayKey(date);
      const label = key === todayKey ? t("today") : key === yesterdayKey ? t("yesterday") : dateFormatter.format(date);
      const existing = grouped.get(key);
      if (existing) existing.items.push(item);
      else grouped.set(key, { label, items: [item] });
    });
    return Array.from(grouped.entries());
  }, [dateFormatter, items, t]);

  return (
    <CcgShell>
      <div className={styles.activityPage}>
        <header className={styles.activityHeader}>
          <span className={styles.eyebrow}>{t("eyebrow")}</span>
          <h1>{t("title")}</h1>
          <p>{t("body")}</p>
        </header>

        {authLoading ? (
          <div className={styles.activityLoading} aria-label={t("loading")}>
            {Array.from({ length: 5 }, (_, index) => <span key={index} />)}
          </div>
        ) : !user ? (
          <section className={styles.activityEmpty}>
            <FaGift aria-hidden="true" />
            <h2>{t("loginTitle")}</h2>
            <p>{t("loginBody")}</p>
            <button type="button" className={styles.primaryButton} onClick={() => void login("/ccg/activity")}>
              {t("loginAction")}
            </button>
          </section>
        ) : (
          <>
            {activityQuery.isPending ? (
              <div className={styles.activitySummaryLoading} aria-label={t("summary.loading")}>
                <span />
                <span />
                <span />
              </div>
            ) : summary ? (
              <ActivitySummary summary={summary} numberFormatter={numberFormatter} />
            ) : null}

            <div className={styles.activityFilters} role="group" aria-label={t("filtersLabel")}>
              {ACTIVITY_FILTERS.map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value)}
                >
                  {t(`filters.${value}`)}
                </button>
              ))}
            </div>

            {activityQuery.isPending ? (
              <div className={styles.activityLoading} aria-label={t("loading")}>
                {Array.from({ length: 5 }, (_, index) => <span key={index} />)}
              </div>
            ) : activityQuery.isError ? (
              <CcgLoadError onRetry={() => { void activityQuery.refetch(); }} />
            ) : groups.length === 0 ? (
              <section className={styles.activityEmpty}>
                <FaGift aria-hidden="true" />
                <h2>{t("emptyTitle")}</h2>
                <p>{t("emptyBody")}</p>
              </section>
            ) : (
              <div className={styles.activityGroups}>
                {groups.map(([key, group]) => (
                  <section key={key} className={styles.activityGroup} aria-labelledby={`activity-day-${key}`}>
                    <h2 id={`activity-day-${key}`}>{group.label}</h2>
                    <ol>
                      {group.items.map((item) => (
                        <li key={item.id}>
                          <ActivityRow item={item} timeFormatter={timeFormatter} />
                        </li>
                      ))}
                    </ol>
                  </section>
                ))}
                {activityQuery.hasNextPage ? (
                  <button
                    type="button"
                    className={styles.activityLoadMore}
                    disabled={activityQuery.isFetchingNextPage}
                    onClick={() => { void activityQuery.fetchNextPage(); }}
                  >
                    {activityQuery.isFetchingNextPage ? t("loadingMore") : t("loadMore")}
                  </button>
                ) : null}
              </div>
            )}
          </>
        )}
      </div>
    </CcgShell>
  );
}
