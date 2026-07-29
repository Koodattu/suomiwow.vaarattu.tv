"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { FaArrowRightFromBracket, FaChevronDown, FaClockRotateLeft, FaGear, FaMagnifyingGlass, FaUser } from "react-icons/fa6";
import { useAuth } from "@/context/AuthContext";
import styles from "./ccg.module.css";

export default function CcgAccountMenu() {
  const pathname = usePathname();
  const t = useTranslations("ccg");
  const tNavigation = useTranslations("navigation");
  const { user, isLoading, login, logout } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setIsOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!isOpen) return;

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };

    document.addEventListener("mousedown", closeOnOutsideClick);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen]);

  if (isLoading) {
    return <span className={styles.accountLoading} aria-label={tNavigation("profile")}><span /></span>;
  }

  if (!user) {
    return (
      <button type="button" className={`${styles.primaryButton} ${styles.guestNoticeButton}`} onClick={() => login(pathname)}>
        {t("guest.login")}
      </button>
    );
  }

  return (
    <div ref={menuRef} className={styles.accountMenu}>
      <button
        type="button"
        className={styles.accountTrigger}
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label={tNavigation("profile")}
      >
        <img src={user.discord.avatarUrl} alt="" />
        <span className={styles.accountName}>{user.discord.username}</span>
        <FaChevronDown className={isOpen ? styles.accountChevronOpen : ""} aria-hidden="true" />
      </button>

      {isOpen ? (
        <div className={styles.accountDropdown} role="menu">
          <Link href="/profile" role="menuitem" onClick={() => setIsOpen(false)}>
            <FaUser aria-hidden="true" />
            {tNavigation("profile")}
          </Link>
          <Link href="/ccg/activity" role="menuitem" onClick={() => setIsOpen(false)}>
            <FaClockRotateLeft aria-hidden="true" />
            {t("activity.menuLabel")}
          </Link>
          <Link href="/ccg/character-checker" role="menuitem" onClick={() => setIsOpen(false)}>
            <FaMagnifyingGlass aria-hidden="true" />
            {t("characterChecker.menuLabel")}
          </Link>
          {user.isAdmin ? (
            <Link href="/admin" role="menuitem" className={styles.accountAdminLink} onClick={() => setIsOpen(false)}>
              <FaGear aria-hidden="true" />
              {tNavigation("adminPanel")}
            </Link>
          ) : null}
          <button
            type="button"
            role="menuitem"
            className={styles.accountLogout}
            onClick={() => {
              setIsOpen(false);
              void logout();
            }}
          >
            <FaArrowRightFromBracket aria-hidden="true" />
            {tNavigation("logout")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
