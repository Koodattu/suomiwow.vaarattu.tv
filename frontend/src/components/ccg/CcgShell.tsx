"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { FaArrowLeft, FaClockRotateLeft, FaMagnifyingGlass, FaTrophy, FaVault } from "react-icons/fa6";
import CcgAccountMenu from "./CcgAccountMenu";
import CcgControls from "./CcgControls";
import styles from "./ccg.module.css";

function VaultOverviewIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2.75 2.75 10.3l1.5 1.84 1.25-1.02v8.63c0 .83.67 1.5 1.5 1.5h10c.83 0 1.5-.67 1.5-1.5v-8.63l1.25 1.02 1.5-1.84L12 2.75Zm-4.25 9H11V15H7.75v-3.25Zm5.25 0h3.25V15H13v-3.25Zm-5.25 5H11V20H7.75v-3.25Zm5.25 0h3.25V20H13v-3.25Z"
      />
    </svg>
  );
}

function CardPackIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M6.5 2.5h11c.97 0 1.75.78 1.75 1.75v15.5c0 .97-.78 1.75-1.75 1.75h-11a1.75 1.75 0 0 1-1.75-1.75V4.25c0-.97.78-1.75 1.75-1.75ZM5.75 6h12.5v1.5H5.75V6Zm0 10.5h12.5V18H5.75v-1.5ZM9 9h6v6H9V9Zm1.5 1.5v3h3v-3h-3Z"
      />
    </svg>
  );
}

export default function CcgShell({
  children,
  context,
  compact = false,
  viewportLocked = false,
  immersiveOnMobile = false,
  onOpenPacksClick,
}: {
  children: ReactNode;
  context?: ReactNode;
  compact?: boolean;
  viewportLocked?: boolean;
  immersiveOnMobile?: boolean;
  onOpenPacksClick?: () => void;
}) {
  const pathname = usePathname();
  const t = useTranslations("ccg");
  const links = [
    { href: "/ccg", label: t("nav.home"), icon: VaultOverviewIcon },
    { href: "/ccg/open", label: t("nav.open"), icon: CardPackIcon },
    { href: "/ccg/collection", label: t("nav.collection"), icon: FaVault },
    { href: "/ccg/leaderboard", label: t("nav.leaderboard"), icon: FaTrophy },
  ];

  return (
    <main className={`${styles.vault} ${compact ? styles.vaultCompact : ""} ${viewportLocked ? styles.vaultViewportLocked : ""} ${immersiveOnMobile ? styles.vaultMobileImmersive : ""}`}>
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
              const Icon = link.icon;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={link.href === "/ccg/open" ? onOpenPacksClick : undefined}
                  aria-current={active ? "page" : undefined}
                  className={`${styles.subnavLink} ${active ? styles.subnavLinkActive : ""}`}
                >
                  <span className={styles.subnavIcon} aria-hidden="true">
                    <Icon />
                  </span>
                  <span className={styles.subnavLabel}>{link.label}</span>
                </Link>
              );
            })}
          </nav>
          <div className={styles.shellContext}>
            {context}
            <div className={styles.shellPromotedLinks}>
              <Link
                href="/ccg/character-checker"
                aria-current={pathname.startsWith("/ccg/character-checker") ? "page" : undefined}
                className={styles.shellPromotedLink}
              >
                <FaMagnifyingGlass aria-hidden="true" />
                {t("characterChecker.menuLabel")}
              </Link>
              <Link
                href="/ccg/activity"
                aria-current={pathname.startsWith("/ccg/activity") ? "page" : undefined}
                className={styles.shellPromotedLink}
              >
                <FaClockRotateLeft aria-hidden="true" />
                {t("activity.menuLabel")}
              </Link>
            </div>
            <CcgControls />
            <CcgAccountMenu />
          </div>
        </div>
      </header>
      <div className={styles.shellContent}>{children}</div>
    </main>
  );
}
