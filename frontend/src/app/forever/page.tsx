"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import styles from "@/components/forever/forever.module.css";

export default function ForeverHub() {
  const t = useTranslations("forever");
  return <div className={styles.world}><div className={styles.shell}>
    <header className={styles.header}><div className={styles.heading}><div className={styles.wordmark}><small>SuomiWoW</small><strong>Forever</strong></div><h1 className={styles.title}>{t("community")}</h1></div></header>
    <Link href="/forever/leveling" className={styles.hubLink}><div><h2>{t("title")}</h2><p>{t("hubDescription")}</p></div><span aria-hidden="true">→</span></Link>
  </div></div>;
}
