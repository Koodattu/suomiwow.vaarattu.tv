"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import styles from "./fun-feedback.module.css";

type ClueItem = { label: string; content: ReactNode };

export default function ProgressiveClues({ items, revealed }: { items: ClueItem[]; revealed: number }) {
  const t = useTranslations("fun");

  return (
    <ul className="divide-y divide-white/8 text-sm">
      {items.map((item, index) => {
        const visible = index < revealed;
        return (
          <li key={item.label} className={`flex min-h-11 items-center gap-2 py-2 ${visible ? `${styles.reveal} text-slate-200` : "text-slate-400"}`}>
            {visible ? (
              <><span className="grid size-5 shrink-0 place-items-center rounded-full bg-emerald-400/15 text-xs font-black text-emerald-300" aria-hidden="true">✓</span><span className="font-bold text-blue-200">{item.label}:</span><span className="min-w-0">{item.content}</span></>
            ) : (
              <><span className="grid size-5 shrink-0 place-items-center rounded-full border border-white/15 text-[10px] font-bold" aria-hidden="true">{index + 1}</span><span>{index === revealed ? t("common.nextMissReveals", { clue: item.label }) : t("common.lockedClue", { clue: item.label })}</span></>
            )}
          </li>
        );
      })}
    </ul>
  );
}
