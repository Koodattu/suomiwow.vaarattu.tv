"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type { CcgMode, CcgOpening } from "@/types";
import { api } from "@/lib/api";
import { queryKeys, useCcgOpening, useCcgSession, useCcgSets } from "@/lib/queries";
import CcgShell from "@/components/ccg/CcgShell";
import GuestNotice from "@/components/ccg/GuestNotice";
import PackBalance from "@/components/ccg/PackBalance";
import CollectibleCard from "@/components/ccg/CollectibleCard";
import CardViewer from "@/components/ccg/CardViewer";
import CcgLoadError from "@/components/ccg/CcgLoadError";
import styles from "@/components/ccg/ccg.module.css";

function makeIdempotencyKey(): string {
  return `pack_${window.crypto.randomUUID()}`;
}

export default function CcgOpenPage() {
  const t = useTranslations("ccg");
  const queryClient = useQueryClient();
  const sessionQuery = useCcgSession();
  const setsQuery = useCcgSets();
  const [mode, setMode] = useState<CcgMode>("current");
  const [opening, setOpening] = useState<CcgOpening | null>(null);
  const [recoveryId, setRecoveryId] = useState("");
  const [recoveryInitialized, setRecoveryInitialized] = useState(false);
  const [visibleCards, setVisibleCards] = useState(0);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const recoveryQuery = useCcgOpening(recoveryId);
  const session = sessionQuery.data;
  const sets = setsQuery.data?.sets ?? [];
  const modeSets = sets.filter((set) => set.state === mode && set.cardCount > 0);
  const selectedSet = mode === "current" ? modeSets[0] : undefined;
  const poolTitle =
    mode === "legacy"
      ? t("open.legacyPool", { count: modeSets.length })
      : modeSets.length === 1
        ? modeSets[0].raidName
        : t("open.currentPool", { count: modeSets.length });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("mode") === "legacy") setMode("legacy");
    const requestedOpening = params.get("opening");
    if (requestedOpening && /^[a-f\d]{24}$/i.test(requestedOpening)) setRecoveryId(requestedOpening);
    else if (requestedOpening) {
      params.delete("opening");
      const search = params.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`);
    }
    setRecoveryInitialized(true);
  }, []);

  useEffect(() => {
    const recovered = recoveryQuery.data;
    if (!recovered || opening?.id === recovered.id) return;
    setMode(recovered.mode);
    setOpening(recovered);
  }, [opening?.id, recoveryQuery.data]);

  useEffect(() => {
    if (!opening) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setVisibleCards(opening.results.length);
      return;
    }
    setVisibleCards(0);
    const interval = window.setInterval(() => {
      setVisibleCards((count) => {
        if (count >= opening.results.length) {
          window.clearInterval(interval);
          return count;
        }
        return count + 1;
      });
    }, 420);
    return () => window.clearInterval(interval);
  }, [opening]);

  const mutation = useMutation({
    mutationFn: async () => {
      const result = await api.openCcgPack({ mode, idempotencyKey: makeIdempotencyKey() });
      queryClient.setQueryData(queryKeys.ccg.opening(result.id), result);
      const url = new URL(window.location.href);
      url.searchParams.set("mode", result.mode);
      url.searchParams.set("opening", result.id);
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
      await Promise.all(
        result.results.map(
          (row) =>
            new Promise<void>((resolve) => {
              if (!row.card.renderUrl) return resolve();
              const image = new window.Image();
              const timeout = window.setTimeout(resolve, 2500);
              const finish = () => {
                window.clearTimeout(timeout);
                resolve();
              };
              image.onload = finish;
              image.onerror = finish;
              image.src = row.card.renderUrl;
            }),
        ),
      );
      return result;
    },
    onSuccess: (result) => {
      setOpening(result);
      queryClient.invalidateQueries({ queryKey: queryKeys.ccg.session });
      queryClient.invalidateQueries({ queryKey: ["ccg", "catalog"] });
      queryClient.invalidateQueries({ queryKey: ["ccg", "collection"] });
      queryClient.invalidateQueries({ queryKey: queryKeys.ccg.sets });
    },
  });

  const queryFailed = sessionQuery.isError || setsQuery.isError;
  const noPacks = session ? session.packs[mode].totalRemaining <= 0 : false;
  const clearSavedOpening = () => {
    setOpening(null);
    setVisibleCards(0);
    setRecoveryId("");
    const url = new URL(window.location.href);
    url.searchParams.delete("opening");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  };

  const canOpen = recoveryInitialized && !recoveryId && Boolean(session) && !queryFailed && modeSets.length > 0 && !noPacks && !mutation.isPending;
  const revealedSummary = useMemo(
    () => opening?.results.slice(0, visibleCards).map((row) => `${row.card.name}, ${row.finish}, ${row.isDuplicate ? t("open.duplicate") : t("open.newCard")}`).join(". ") ?? "",
    [opening, visibleCards, t],
  );

  if (queryFailed) {
    return <CcgShell><div className="mx-auto max-w-3xl px-4 py-12"><CcgLoadError onRetry={() => { void sessionQuery.refetch(); void setsQuery.refetch(); }} /></div></CcgShell>;
  }

  return (
    <CcgShell>
      <div className="mx-auto max-w-[1500px] space-y-6 px-4 py-8 sm:px-6 lg:px-8">
        {session ? <GuestNotice session={session} /> : null}
        <header>
          <div className={styles.eyebrow}>{t("nav.open")}</div>
          <h1 className="mt-1 text-3xl font-black tracking-tight text-white sm:text-4xl">{t("open.title")}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">{t("open.body")}</p>
        </header>

        {!opening ? (
          <div className="grid gap-6 lg:grid-cols-[minmax(250px,340px)_1fr]">
            <aside className={`${styles.panel} h-fit p-5`}>
              <label className="text-xs font-bold uppercase tracking-[0.13em] text-slate-500">{t("open.chooseMode")}</label>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {(["current", "legacy"] as CcgMode[]).map((option) => (
                  <button key={option} type="button" aria-pressed={mode === option} onClick={() => setMode(option)} className={mode === option ? styles.primaryButton : styles.secondaryButton}>
                    {t(`mode.${option}`)}
                  </button>
                ))}
              </div>
              <p className="mt-4 text-sm leading-5 text-slate-400">{t(mode === "legacy" ? "open.legacyPoolBody" : "open.currentPoolBody", { count: modeSets.length })}</p>
              <div className="mt-5">{session ? <PackBalance session={session} mode={mode} /> : <div className="h-32 animate-pulse rounded-lg bg-white/5" />}</div>
              {noPacks ? <p className="mt-4 text-sm text-amber-200">{t("open.noPacks")}</p> : null}
              {recoveryQuery.isError ? (
                <div className="mt-4 rounded-md border border-amber-300/20 bg-amber-300/[0.05] p-3" role="alert">
                  <p className="text-sm leading-5 text-amber-100">{t("open.recoveryFailed")}</p>
                  <button type="button" className={`${styles.secondaryButton} mt-3 w-full`} onClick={clearSavedOpening}>
                    {t("open.dismissRecovery")}
                  </button>
                </div>
              ) : null}
              {mutation.error ? <p className="mt-4 text-sm text-red-300" role="alert">{mutation.error.message}</p> : null}
            </aside>
            <section className={styles.packStage}>
              <button
                type="button"
                className={styles.sealedPack}
                disabled={!canOpen}
                onClick={() => mutation.mutate()}
                aria-label={t("open.openPack")}
                style={selectedSet ? { boxShadow: `0 28px 80px rgba(0,0,0,.55), 0 0 48px ${selectedSet.theme.glow}` } : undefined}
              >
                <span className="absolute inset-6 flex flex-col items-center justify-center rounded-lg border border-white/15 bg-slate-950/25 px-4 text-center">
                  <span className="text-[0.65rem] font-black uppercase tracking-[0.24em] text-cyan-200">SuomiWoW CCG</span>
                  <span className="mt-4 text-2xl font-black leading-tight">{modeSets.length > 0 ? poolTitle : t("landing.preparing")}</span>
                  <span className="mt-3 text-xs uppercase tracking-widest text-slate-300">{mutation.isPending ? t("open.opening") : t("open.openPack")}</span>
                  <span className="mt-5 text-4xl font-black tabular-nums text-white">5</span>
                  <span className="text-[0.65rem] uppercase tracking-[0.15em] text-slate-300">{t("landing.cards")}</span>
                </span>
              </button>
            </section>
          </div>
        ) : (
          <section className={`${styles.packStage} py-6`}>
            <div className="w-full">
              <div className={styles.revealGrid}>
                {opening.results.map((result, index) => (
                  <div key={`${result.card.id}-${index}`} className={`${styles.revealCard} ${index < visibleCards ? styles.revealCardVisible : ""}`}>
                    <CollectibleCard card={result.card} finish={result.finish} compact onSelect={() => setViewerIndex(index)} />
                    <div className="mt-2 flex items-center justify-between gap-2 px-1 text-[0.68rem]">
                      <span className={result.isDuplicate ? "text-slate-500" : "font-bold text-cyan-200"}>{t(result.isDuplicate ? "open.duplicate" : "open.newCard")}</span>
                      <span className="capitalize text-slate-500">{t(`finish.${result.finish}`)}</span>
                    </div>
                  </div>
                ))}
              </div>
              {visibleCards >= opening.results.length ? (
                <div className="relative z-10 mx-auto flex max-w-lg flex-col items-center px-5 pb-5 text-center">
                  {opening.duplicateRewards > 0 ? <p className="mb-3 text-sm font-bold text-violet-200">{t("open.bonusEarned", { count: opening.duplicateRewards })}</p> : null}
                  <button
                    type="button"
                    className={styles.primaryButton}
                    onClick={clearSavedOpening}
                  >
                    {t("open.openAnother")}
                  </button>
                </div>
              ) : null}
            </div>
            <p className="sr-only" aria-live="polite">{revealedSummary}</p>
          </section>
        )}
      </div>
      {opening && viewerIndex !== null ? (
        <CardViewer
          card={{ ...opening.results[viewerIndex].card, ownership: [{ finish: opening.results[viewerIndex].finish, quantity: 1 }] }}
          initialFinish={opening.results[viewerIndex].finish}
          onClose={() => setViewerIndex(null)}
        />
      ) : null}
    </CcgShell>
  );
}
