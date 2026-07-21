"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
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
  const pathname = usePathname();
  const { user, login } = useAuth();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  const countdown = useMemo(() => t("guest.timeRemaining", remainingParts(session.resetAt, now)), [session.resetAt, now, t]);
  if (user || session.ownerType !== "guest") return null;

  return (
    <aside className={`${styles.panel} flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between`}>
      <div>
        <div className="text-sm font-bold text-white">{t("guest.title")}</div>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-400">{t("guest.body")}</p>
        <div className="mt-2 text-xs font-semibold uppercase tracking-[0.12em] text-cyan-300">
          {t("guest.expiresIn", { time: countdown })}
        </div>
      </div>
      <button type="button" className={`${styles.primaryButton} shrink-0`} onClick={() => login(pathname)}>
        {t("guest.login")}
      </button>
    </aside>
  );
}
