"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { CcgSession } from "@/types";
import { useAuth } from "@/context/AuthContext";
import styles from "./ccg.module.css";

function remainingParts(resetAt: string, now: number): { hours: number; minutes: number } {
  const remaining = Math.max(0, new Date(resetAt).getTime() - now);
  const hours = Math.floor(remaining / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);
  return { hours, minutes };
}

export default function GuestNotice({ session }: { session: CcgSession }) {
  const t = useTranslations("ccg");
  const { user } = useAuth();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  const countdown = useMemo(() => t("guest.timeRemaining", remainingParts(session.resetAt, now)), [session.resetAt, now, t]);
  if (user || session.ownerType !== "guest") return null;

  return (
    <aside className={styles.guestNoticeCompact}>
      <div className={styles.guestNoticeMeta}>
        <div className={styles.guestNoticeTitle}>{t("guest.title")}</div>
        <div className={styles.guestNoticeCountdown}>{t("guest.expiresIn", { time: countdown })}</div>
      </div>
    </aside>
  );
}
