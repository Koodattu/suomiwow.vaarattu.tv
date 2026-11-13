"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import styles from "@/components/forever/forever.module.css";
import analytics from "@/components/forever/analytics.module.css";

export default function ForeverHub() {
  const t = useTranslations("forever");
  return <div className={styles.world}><div className={styles.shell}>
    <header className={styles.header}><div className={styles.heading}><div className={styles.wordmark}><small>SuomiWoW</small><strong>Forever</strong></div><h1 className={styles.title}>{t("community")}</h1></div></header>
    <div className={analytics.hubGrid}>
      <Link href="/forever/leveling" className={styles.hubLink}><div><h2>{t("title")}</h2><p>{t("hubDescription")}</p></div><span aria-hidden="true">→</span></Link>
      <Link href="/forever/analytics" className={styles.hubLink}><div><h2>{t("analytics.title")}</h2><p>{t("analytics.hubDescription")}</p></div><span aria-hidden="true">→</span></Link>
      <Link href="/forever/namegame" className={styles.hubLink}><div><h2>{t("namegame.title")}</h2><p>{t("namegame.description")}</p></div><span aria-hidden="true">→</span></Link>
    </div>
  </div></div>;
}
