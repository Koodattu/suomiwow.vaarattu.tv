"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import styles from "./ccg.module.css";

export default function CcgLeaderboardNav() {
  const pathname = usePathname();
  const t = useTranslations("ccg.leaderboard.tabs");
  const links = [
    { href: "/ccg/leaderboard", label: t("overall"), active: pathname === "/ccg/leaderboard" },
    { href: "/ccg/leaderboard/records", label: t("records"), active: pathname.startsWith("/ccg/leaderboard/records") },
  ];

  return (
    <nav className={styles.leaderboardViewNav} aria-label={t("label")}>
      <div className={styles.leaderboardViewTabs}>
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            aria-current={link.active ? "page" : undefined}
            className={`${styles.leaderboardViewTab} ${link.active ? styles.leaderboardViewTabActive : ""}`}
          >
            {link.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
