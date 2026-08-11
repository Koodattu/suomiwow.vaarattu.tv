"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import styles from "./fun-feedback.module.css";

export default function FunOutcome({
  status,
  title,
  children,
  className = "",
}: {
  status: "won" | "lost";
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const t = useTranslations("fun");
  const won = status === "won";

  return (
    <div
      className={`${styles.outcome} rounded-xl border p-4 ${
        won
          ? "border-emerald-300/25 bg-emerald-950/30 shadow-[0_14px_38px_rgba(16,185,129,0.1)]"
          : "border-red-300/20 bg-red-950/25 shadow-[0_14px_38px_rgba(239,68,68,0.08)]"
      } ${className}`}
      role="status"
    >
      <div className="flex items-start gap-3">
        <span
          className={`grid size-9 shrink-0 place-items-center rounded-full text-lg font-black ${
            won ? "bg-emerald-400/15 text-emerald-200" : "bg-red-400/15 text-red-200"
          }`}
          aria-hidden="true"
        >
          {won ? "✓" : "×"}
        </span>
        <div className="min-w-0">
          <p className={`text-lg font-black ${won ? "text-emerald-200" : "text-red-200"}`}>
            {title ?? (won ? t("common.youWon") : t("common.gameOver"))}
          </p>
          {children ? <div className="mt-1 text-sm leading-5 text-slate-300">{children}</div> : null}
        </div>
      </div>
    </div>
  );
}
