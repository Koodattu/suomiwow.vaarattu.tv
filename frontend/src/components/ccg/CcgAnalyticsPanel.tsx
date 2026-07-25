"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCcgAnalytics } from "@/lib/queries";
import styles from "./ccg.module.css";

export default function CcgAnalyticsPanel() {
  const t = useTranslations("ccg.landing.analytics");
  const locale = useLocale();
  const analyticsQuery = useCcgAnalytics();
  const numberFormat = new Intl.NumberFormat(locale);

  return (
    <section
      className={styles.vaultAnalyticsPanel}
      aria-labelledby="ccg-vault-analytics-title"
      aria-busy={analyticsQuery.isPending}
    >
      <h2 id="ccg-vault-analytics-title">{t("title")}</h2>
      <dl className={styles.vaultAnalyticsStats} aria-live="polite">
        <div className={styles.vaultAnalyticsStat}>
          <dt>{t("uniqueUsers")}</dt>
          <dd>
            {analyticsQuery.data
              ? numberFormat.format(analyticsQuery.data.uniqueUsers)
              : analyticsQuery.isPending
                ? <span className={styles.vaultAnalyticsValueSkeleton} aria-hidden="true" />
                : "—"}
          </dd>
        </div>
        <div className={styles.vaultAnalyticsStat}>
          <dt>{t("packOpenings")}</dt>
          <dd>
            {analyticsQuery.data
              ? numberFormat.format(analyticsQuery.data.packOpenings)
              : analyticsQuery.isPending
                ? <span className={styles.vaultAnalyticsValueSkeleton} aria-hidden="true" />
                : "—"}
          </dd>
        </div>
      </dl>
    </section>
  );
}
