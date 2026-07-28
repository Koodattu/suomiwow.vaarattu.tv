"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { FaArrowLeft } from "react-icons/fa6";
import CcgAccountMenu from "./CcgAccountMenu";
import CcgControls from "./CcgControls";
import styles from "./ccg.module.css";

export default function CcgShell({
  children,
  context,
  compact = false,
  viewportLocked = false,
  onOpenPacksClick,
}: {
  children: ReactNode;
  context?: ReactNode;
  compact?: boolean;
  viewportLocked?: boolean;
  onOpenPacksClick?: () => void;
}) {
  const pathname = usePathname();
  const t = useTranslations("ccg");
  const links = [
    { href: "/ccg", label: t("nav.home") },
    { href: "/ccg/open", label: t("nav.open") },
    { href: "/ccg/collection", label: t("nav.collection") },
  ];

  return (
    <main className={`${styles.vault} ${compact ? styles.vaultCompact : ""} ${viewportLocked ? styles.vaultViewportLocked : ""}`}>
      <header className={styles.shellHeader}>
        <div className={styles.shellHeaderInner}>
          <div className={styles.shellBrand}>
            <Link href="/" className={styles.shellBrandLink} aria-label={t("nav.backToMain")}>
              <span className={styles.shellBackLabel} aria-hidden="true">
                <span>{t("nav.backLabelTop")}</span>
                <FaArrowLeft />
                <span>{t("nav.backLabelBottom")}</span>
              </span>
              <Image src="/logo.png" alt="SuomiWoW" width={112} height={20} priority />
            </Link>
            <Link href="/ccg" className={styles.shellVaultLink}>
              <Image className={styles.shellCcgLogo} src="/ccg/ccg_logo.png" alt="CCG" width={491} height={351} priority />
              <span className={styles.shellBrandTitle}>
                <span>{t("brandTitleTop")}</span>
                <span>{t("brandTitleBottom")}</span>
              </span>
            </Link>
          </div>
          <nav className={styles.shellNav} aria-label={t("nav.label")}>
            {links.map((link) => {
              const active = link.href === "/ccg" ? pathname === link.href : pathname.startsWith(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={link.href === "/ccg/open" ? onOpenPacksClick : undefined}
                  aria-current={active ? "page" : undefined}
                  className={`${styles.subnavLink} ${active ? styles.subnavLinkActive : ""}`}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
          <div className={styles.shellContext}>
            {context}
            <CcgControls />
            <CcgAccountMenu />
          </div>
        </div>
      </header>
      <div className={styles.shellContent}>{children}</div>
    </main>
  );
}
