"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import type { CcgSession } from "@/types";
import styles from "./ccg.module.css";

export default function PackBalance({
  session,
  strip = false,
  stripOnMobile = false,
}: {
  session: CcgSession;
  strip?: boolean;
  stripOnMobile?: boolean;
}) {
  const t = useTranslations("ccg");
  const [now, setNow] = useState(() => Date.now());
  const packs = session.packs;
  const recharge = session.recharge;
  const storageFull = packs.totalRemaining >= recharge.cap;
  const rechargeRemaining = Math.max(0, new Date(recharge.nextAt).getTime() - now);
  const rechargeMinutes = Math.ceil(rechargeRemaining / (60 * 1000));

  useEffect(() => {
    if (storageFull) return;
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [storageFull]);

  return (
    <div className={`${styles.balanceCard} ${strip ? styles.balanceCardStrip : ""} ${stripOnMobile ? styles.balanceCardMobileStrip : ""}`}>
      <div className={styles.balanceLine}>
        <span className={styles.balanceCount}><strong>{packs.totalRemaining}</strong><span>{t("packsRemaining")}</span></span>
        <span className={styles.balanceRecharge}>
          {storageFull ? t("storageFull") : t("rechargeIn", { time: t("rechargeTime", { minutes: rechargeMinutes }) })}
        </span>
      </div>
    </div>
  );
}
