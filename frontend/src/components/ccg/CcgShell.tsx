"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import styles from "./ccg.module.css";

export default function CcgShell({ children, context, compact = false }: { children: ReactNode; context?: ReactNode; compact?: boolean }) {
  const pathname = usePathname();
  const t = useTranslations("ccg");
  const links = [
    { href: "/fun/ccg", label: t("nav.home") },
    { href: "/fun/ccg/open", label: t("nav.open") },
    { href: "/fun/ccg/collection", label: t("nav.collection") },
  ];

  return (
    <main className={`${styles.vault} ${compact ? styles.vaultCompact : ""}`}>
      <header className={styles.shellHeader}>
        <div className={styles.shellHeaderInner}>
          <div className={styles.shellBrand}>
            <div className={styles.eyebrow}>{t("eyebrow")}</div>
            <Link href="/fun/ccg" className="mt-0.5 inline-block text-2xl font-black tracking-[-0.035em] text-white">
              SuomiWoW <span className="text-cyan-300">CCG</span>
            </Link>
            <p className={styles.shellSubtitle}>{t("subtitle")}</p>
          </div>
          <nav className={styles.shellNav} aria-label={t("nav.label")}>
            {links.map((link) => {
              const active = link.href === "/fun/ccg" ? pathname === link.href : pathname.startsWith(link.href);
              return (
                <Link key={link.href} href={link.href} className={`${styles.subnavLink} ${active ? styles.subnavLinkActive : ""}`}>
                  {link.label}
                </Link>
              );
            })}
          </nav>
          {context ? <div className={styles.shellContext}>{context}</div> : null}
        </div>
      </header>
      {children}
    </main>
  );
}
