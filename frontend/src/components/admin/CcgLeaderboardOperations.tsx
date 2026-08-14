"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";

type Props = {
  onError: (message: string) => void;
  onNotice: (message: string) => void;
};

const actionButton =
  "min-h-10 rounded-md bg-amber-600 px-3 py-2 text-sm font-bold text-white transition-transform duration-150 ease-out hover:bg-amber-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50";

export default function CcgLeaderboardOperations({ onError, onNotice }: Props) {
  const t = useTranslations("admin.ccg.leaderboard");
  const [starting, setStarting] = useState<"full" | "incremental" | null>(null);

  const trigger = async (mode: "full" | "incremental") => {
    setStarting(mode);
    try {
      await api.triggerAdminCcgLeaderboard(mode);
      onNotice(t(`${mode}.started`));
    } catch (error) {
      onError(error instanceof Error ? error.message : t("startError"));
    } finally {
      setStarting(null);
    }
  };

  return (
    <section className="space-y-4" aria-labelledby="ccg-leaderboard-operations-title">
      <div className="rounded-lg bg-gray-800/70 p-5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
        <h3 id="ccg-leaderboard-operations-title" className="text-lg font-bold text-white text-balance">{t("title")}</h3>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-400 text-pretty">{t("description")}</p>
        <p className="mt-2 max-w-3xl text-xs leading-5 text-gray-500 text-pretty">{t("automaticSchedule")}</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {(["incremental", "full"] as const).map((mode) => (
          <article key={mode} className="flex flex-col rounded-lg bg-gray-800/70 p-5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
            <h4 className="font-bold text-white">{t(`${mode}.title`)}</h4>
            <p className="mt-2 flex-1 text-sm leading-6 text-gray-400 text-pretty">{t(`${mode}.description`)}</p>
            <button
              type="button"
              className={`${actionButton} mt-4 self-start`}
              onClick={() => void trigger(mode)}
              disabled={starting !== null}
            >
              {starting === mode ? t(`${mode}.starting`) : t(`${mode}.action`)}
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
