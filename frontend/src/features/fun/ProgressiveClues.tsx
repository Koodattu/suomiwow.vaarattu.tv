"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

type ClueItem = { label: string; content: ReactNode };

export default function ProgressiveClues({ items, revealed }: { items: ClueItem[]; revealed: number }) {
  const t = useTranslations("fun");

  return (
    <ul className="divide-y divide-white/8 text-sm">
      {items.map((item, index) => {
        const visible = index < revealed;
        return (
          <li key={item.label} className={`flex min-h-10 items-center gap-2 py-2 ${visible ? "text-slate-200" : "text-slate-400"}`}>
            {visible ? (
              <><span className="font-bold text-blue-200">{item.label}:</span><span className="min-w-0">{item.content}</span></>
            ) : (
              <><span aria-hidden="true">○</span><span>{index === revealed ? t("common.nextMissReveals", { clue: item.label }) : t("common.lockedClue", { clue: item.label })}</span></>
            )}
          </li>
        );
      })}
    </ul>
  );
}
