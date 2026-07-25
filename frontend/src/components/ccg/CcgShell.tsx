"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { FaArrowLeft } from "react-icons/fa6";
import { CCG_INSPECT_AUDIO_ID } from "@/lib/ccg-audio";
import CcgAccountMenu from "./CcgAccountMenu";
import CcgControls from "./CcgControls";
import styles from "./ccg.module.css";

export default function CcgShell({ children, context, compact = false, viewportLocked = false }: { children: ReactNode; context?: ReactNode; compact?: boolean; viewportLocked?: boolean }) {
  const pathname = usePathname();
  const t = useTranslations("ccg");
  const links = [
    { href: "/fun/ccg", label: t("nav.home") },
    { href: "/fun/ccg/open", label: t("nav.open") },
    { href: "/fun/ccg/collection", label: t("nav.collection") },
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
            <span className={styles.shellBrandTitle}>
              <span>{t("brandTitleTop")}</span>
              <span>{t("brandTitleBottom")}</span>
            </span>
          </div>
          <nav className={styles.shellNav} aria-label={t("nav.label")}>
            {links.map((link) => {
              const active = link.href === "/fun/ccg" ? pathname === link.href : pathname.startsWith(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
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
      {children}
      <audio id={CCG_INSPECT_AUDIO_ID} src="/ccg/audio/inspect.mp3" preload="auto" aria-hidden="true" />
    </main>
  );
}
