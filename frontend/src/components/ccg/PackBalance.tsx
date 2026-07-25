"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import type { CcgMode, CcgSession } from "@/types";
import styles from "./ccg.module.css";

export default function PackBalance({ session, mode, strip = false }: { session: CcgSession; mode: CcgMode; strip?: boolean }) {
  const t = useTranslations("ccg");
  const [now, setNow] = useState(() => Date.now());
  const packs = session.packs[mode];
  const recharge = session.recharge[mode];
  const storageFull = packs.totalRemaining >= recharge.cap;
  const rechargeRemaining = Math.max(0, new Date(recharge.nextAt).getTime() - now);
  const rechargeHours = Math.floor(rechargeRemaining / (60 * 60 * 1000));
  const rechargeMinutes = Math.max(0, Math.ceil((rechargeRemaining % (60 * 60 * 1000)) / (60 * 1000)));

  useEffect(() => {
    if (storageFull) return;
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [storageFull]);

  return (
    <div className={`${styles.balanceCard} ${strip ? styles.balanceCardStrip : ""}`}>
      <div className={styles.balanceLine}>
        <span className={styles.balanceCount}><strong>{packs.totalRemaining}</strong><span>{t("packsRemaining")}</span></span>
        <span className={styles.balanceRecharge}>
          {storageFull ? t("storageFull") : t("rechargeIn", { time: t("rechargeTime", { hours: rechargeHours, minutes: rechargeMinutes }) })}
        </span>
      </div>
    </div>
  );
}
