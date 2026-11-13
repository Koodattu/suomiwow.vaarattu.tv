"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import styles from "./analytics.module.css";

export default function ForeverNav({ current }: { current: "leveling" | "analytics" | "namegame" }) {
  const t = useTranslations("forever");
  return <nav className={styles.nav} aria-label={t("brand")}>
    <Link href="/forever/leveling" aria-current={current === "leveling" ? "page" : undefined}>{t("title")}</Link>
    <Link href="/forever/analytics" aria-current={current === "analytics" ? "page" : undefined}>{t("analytics.title")}</Link>
    <Link href="/forever/namegame" aria-current={current === "namegame" ? "page" : undefined}>{t("namegame.title")}</Link>
  </nav>;
}
