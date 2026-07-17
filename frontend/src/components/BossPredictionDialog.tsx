"use client";

import { Dialog, DialogBackdrop, DialogDescription, DialogPanel, DialogTitle } from "@headlessui/react";
import { useLocale, useTranslations } from "next-intl";
import { FaRedo, FaTimes } from "react-icons/fa";
import { useBossPrediction } from "@/lib/queries";

interface BossPredictionDialogProps {
  guildName: string;
  realm: string;
  raidId: number;
  bossId: number;
  bossName: string;
  difficulty: "mythic" | "heroic";
  onClose: () => void;
}

function PredictionSkeleton() {
  return (
    <div className="space-y-4 animate-pulse" aria-hidden="true">
      <div className="rounded-xl border border-gray-700 bg-gray-800/60 p-4">
        <div className="h-3 w-24 rounded bg-gray-700" />
        <div className="mt-3 h-8 w-36 rounded bg-gray-700" />
        <div className="mt-2 h-4 w-52 rounded bg-gray-700/80" />
      </div>
      <div className="space-y-3 rounded-xl border border-gray-800 bg-gray-950/40 p-4">
        {[0, 1, 2].map((row) => (
          <div key={row} className="flex items-center justify-between gap-4">
            <div className="h-4 w-28 rounded bg-gray-800" />
            <div className="h-4 w-36 rounded bg-gray-800" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function BossPredictionDialog({
  guildName,
  realm,
  raidId,
  bossId,
  bossName,
  difficulty,
  onClose,
}: BossPredictionDialogProps) {
  const t = useTranslations("raidDetailModal");
  const locale = useLocale();
  const { data, isLoading, isError, isFetching, refetch } = useBossPrediction(realm, guildName, raidId, bossId, difficulty);
  const numberFormat = new Intl.NumberFormat(locale);
  const percentFormat = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });

  const unavailableMessage =
    data && !data.available
      ? data.reason === "raid_not_current"
        ? t("prediction.unavailableRaidNotCurrent")
        : data.reason === "boss_not_progressing"
          ? t("prediction.unavailableBossNotProgressing")
          : t("prediction.unavailableGuildOrBoss")
      : null;

  return (
    <Dialog open onClose={onClose} className="relative z-[70]">
      <DialogBackdrop
        transition
        className="fixed inset-0 bg-black/75 backdrop-blur-[2px] transition-opacity duration-200 ease-out data-closed:opacity-0 motion-reduce:transition-none"
      />
      <div className="fixed inset-0 w-screen overflow-y-auto p-4">
        <div className="flex min-h-full items-center justify-center">
          <DialogPanel
            transition
            className="w-full max-w-lg rounded-xl border border-gray-700 bg-gray-900 shadow-2xl shadow-black/50 transition duration-200 ease-out data-closed:translate-y-2 data-closed:scale-[0.98] data-closed:opacity-0 motion-reduce:transition-none"
          >
            <div className="flex items-start gap-4 border-b border-gray-800 px-5 py-4">
              <div className="min-w-0 flex-1">
                <DialogTitle className="text-lg font-semibold text-white">{t("prediction.title")}</DialogTitle>
                <DialogDescription className="mt-1 truncate text-sm text-gray-400">
                  {t("prediction.subtitle", {
                    guild: guildName,
                    boss: bossName,
                    difficulty: t(difficulty),
                  })}
                </DialogDescription>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-400 transition-colors duration-150 hover:bg-gray-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 active:bg-gray-700"
                aria-label={t("close")}
              >
                <FaTimes className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="p-5">
              {isLoading ? (
                <>
                  <span className="sr-only" role="status">
                    {t("prediction.loading")}
                  </span>
                  <PredictionSkeleton />
                </>
              ) : isError ? (
                <div className="rounded-xl border border-red-900/60 bg-red-950/30 p-5 text-center" role="alert">
                  <p className="text-sm text-red-200">{t("prediction.error")}</p>
                  <button
                    type="button"
                    onClick={() => void refetch()}
                    disabled={isFetching}
                    className="mt-4 inline-flex items-center gap-2 rounded-lg bg-gray-100 px-3 py-2 text-sm font-semibold text-gray-950 transition-colors duration-150 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:cursor-not-allowed disabled:opacity-60 active:bg-gray-200"
                  >
                    <FaRedo className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} aria-hidden="true" />
                    {t("prediction.retry")}
                  </button>
                </div>
              ) : unavailableMessage ? (
                <div className="rounded-xl border border-amber-900/50 bg-amber-950/20 p-5 text-sm leading-6 text-amber-100">{unavailableMessage}</div>
              ) : data?.available ? (
                <div className="space-y-4">
                  <section className="rounded-xl border border-blue-500/30 bg-blue-950/30 p-4" aria-live="polite">
                    <div className="text-xs font-semibold uppercase tracking-wide text-blue-300">{t("prediction.estimatedKill")}</div>
                    <div className="mt-1 flex flex-wrap items-end justify-between gap-2">
                      <div className="text-3xl font-bold tabular-nums text-white">
                        {t("prediction.pullNumber", { count: numberFormat.format(data.estimate.killPull) })}
                      </div>
                      <span
                        className={`rounded-md px-2 py-1 text-xs font-semibold ${
                          data.estimate.confidence === "high"
                            ? "bg-green-500/15 text-green-300"
                            : data.estimate.confidence === "medium"
                              ? "bg-amber-500/15 text-amber-200"
                              : "bg-gray-700 text-gray-300"
                        }`}
                      >
                        {t("prediction.confidence", {
                          confidence: t(`prediction.confidence${data.estimate.confidence.charAt(0).toUpperCase()}${data.estimate.confidence.slice(1)}`),
                        })}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-blue-100">{t("prediction.remaining", { count: data.estimate.remainingPulls })}</p>
                  </section>

                  <section className="rounded-xl border border-gray-800 bg-gray-950/40 p-4">
                    <h3 className="text-sm font-semibold text-gray-200">{t("prediction.factsTitle")}</h3>
                    <dl className="mt-2 divide-y divide-gray-800">
                      <div className="grid grid-cols-1 gap-1 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-4">
                        <dt className="text-sm text-gray-400">{t("prediction.currentProgress")}</dt>
                        <dd className="text-left text-sm font-medium tabular-nums text-gray-100 sm:text-right">
                          {t("prediction.pullCount", { count: data.facts.currentPulls })} ·{" "}
                          {t("prediction.bestValue", { value: percentFormat.format(data.facts.bestPercent) })}
                        </dd>
                      </div>
                      <div className="grid grid-cols-1 gap-1 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-4">
                        <dt className="text-sm text-gray-400">{t("prediction.peerSample")}</dt>
                        <dd className="text-left text-sm font-medium tabular-nums text-gray-100 sm:text-right">
                          {t("prediction.killedGuilds", { count: data.facts.killedGuilds })} ·{" "}
                          {t("prediction.progressingGuilds", { count: data.facts.progressingGuilds })}
                        </dd>
                      </div>
                      <div className="grid grid-cols-1 gap-1 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-4">
                        <dt className="text-sm text-gray-400">{t("prediction.medianKill")}</dt>
                        <dd className="text-left text-sm font-medium tabular-nums text-gray-100 sm:text-right">
                          {data.facts.medianKillPull === null
                            ? t("prediction.noKillSample")
                            : t("prediction.pullNumber", { count: numberFormat.format(data.facts.medianKillPull) })}
                        </dd>
                      </div>
                    </dl>

                    <div className="border-t border-gray-800 pt-3">
                      <div className="text-sm text-gray-400">{t("prediction.phaseEndings")}</div>
                      {data.facts.phaseCounts.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {data.facts.phaseCounts.map((phase) => (
                            <span
                              key={phase.phase}
                              className="inline-flex items-center gap-1.5 rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-200"
                            >
                              <span className="font-semibold text-white">{phase.phase}</span>
                              <span className="tabular-nums text-gray-400">{t("prediction.phasePulls", { count: phase.count })}</span>
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-1 text-sm text-gray-500">{t("prediction.noPhaseData")}</p>
                      )}
                      <p className="mt-2 text-xs leading-5 text-gray-500">
                        {data.facts.usedPhaseData ? t("prediction.phaseUsed") : t("prediction.phaseNotUsed")}
                      </p>
                    </div>
                  </section>

                  <p className="text-center text-xs leading-5 text-gray-500">{t("prediction.disclaimer")}</p>
                </div>
              ) : null}
            </div>

            <div className="flex justify-end border-t border-gray-800 px-5 py-3">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm font-medium text-gray-200 transition-colors duration-150 hover:border-gray-600 hover:bg-gray-700 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 active:bg-gray-600"
              >
                {t("prediction.close")}
              </button>
            </div>
          </DialogPanel>
        </div>
      </div>
    </Dialog>
  );
}
