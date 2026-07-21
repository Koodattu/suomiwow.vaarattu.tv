"use client";

import { useTranslations } from "next-intl";
import styles from "./ccg.module.css";

export default function CcgLoadError({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations("ccg.error");
  return (
    <div className={`${styles.panel} p-5`} role="alert">
      <h2 className="font-bold text-red-200">{t("title")}</h2>
      <p className="mt-1 text-sm leading-6 text-slate-400">{t("body")}</p>
      <button type="button" className={`${styles.secondaryButton} mt-4`} onClick={onRetry}>{t("retry")}</button>
    </div>
  );
}
