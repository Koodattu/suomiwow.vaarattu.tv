"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCcgSession, useCcgSets } from "@/lib/queries";
import CcgShell from "@/components/ccg/CcgShell";
import GuestNotice from "@/components/ccg/GuestNotice";
import PackBalance from "@/components/ccg/PackBalance";
import CcgLoadError from "@/components/ccg/CcgLoadError";
import styles from "@/components/ccg/ccg.module.css";

export default function CcgLandingPage() {
  const t = useTranslations("ccg");
  const sessionQuery = useCcgSession();
  const setsQuery = useCcgSets();
  const session = sessionQuery.data;
  const sets = setsQuery.data?.sets ?? [];
  const currentSets = sets.filter((set) => set.state === "current");
  const current = currentSets[0];
  const currentCardCount = currentSets.reduce((total, set) => total + set.cardCount, 0);
  const currentOwnedCount = currentSets.reduce((total, set) => total + set.ownedCards, 0);
  const legacy = sets.filter((set) => set.state === "legacy");
  const queryFailed = sessionQuery.isError || setsQuery.isError;

  if (queryFailed) {
    return <CcgShell><div className="mx-auto max-w-3xl px-4 py-12"><CcgLoadError onRetry={() => { void sessionQuery.refetch(); void setsQuery.refetch(); }} /></div></CcgShell>;
  }

  return (
    <CcgShell>
      <div className="mx-auto max-w-[1500px] space-y-6 px-4 py-8 sm:px-6 lg:px-8">
        {session ? <GuestNotice session={session} /> : null}
        <section className="grid gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(290px,0.75fr)]">
          <div
            className={`${styles.setCover} ${styles.featuredSet}`}
            style={{
              "--set-accent": current?.theme.accent ?? "#46CFFF",
              "--set-glow": current?.theme.glow ?? "rgba(70,207,255,.25)",
              backgroundImage: current ? `url("${current.backgroundPath}")` : undefined,
            } as React.CSSProperties}
          >
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_72%_42%,transparent_0_10rem,rgba(2,6,15,.46)_34rem)]" />
            <div className={`${styles.setCoverContent} max-w-2xl`}>
              <div className={styles.eyebrow}>{t("landing.currentSet")}</div>
              <h1 className="mt-2 text-4xl font-black tracking-[-0.03em] text-white sm:text-5xl">
                {currentSets.length > 1 ? t("landing.currentRaids", { count: currentSets.length }) : current?.raidName ?? t("landing.preparing")}
              </h1>
              <p className="mt-3 max-w-xl text-sm leading-6 text-slate-300 sm:text-base">{t("landing.body")}</p>
              <div className="mt-6 flex flex-wrap gap-3">
                {currentCardCount > 0 ? (
                  <Link href="/fun/ccg/open?mode=current" className={styles.primaryButton}>{t("landing.openCurrent")}</Link>
                ) : (
                  <span className={`${styles.primaryButton} cursor-not-allowed opacity-45`} aria-disabled="true">{t("landing.openCurrent")}</span>
                )}
                <Link href="/fun/ccg/collection" className={styles.secondaryButton}>{t("landing.collection")}</Link>
              </div>
              {current ? (
                <div className="mt-5 flex gap-5 text-xs text-slate-400">
                  <span><strong className="font-bold tabular-nums text-white">{currentCardCount}</strong> {t("landing.cards")}</span>
                  <span><strong className="font-bold tabular-nums text-white">{currentOwnedCount}</strong> {t("landing.collected")}</span>
                </div>
              ) : null}
            </div>
          </div>
          <aside className={`${styles.panel} p-5`}>
            <div className={styles.eyebrow}>{t("landing.dailyPacks")}</div>
            <h2 className="mt-2 text-xl font-black text-white">{t("landing.title")}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-400">{t("landing.packBody")}</p>
            <div className="mt-5 grid gap-3">
              {session ? (
                <>
                  <PackBalance session={session} mode="current" />
                  <PackBalance session={session} mode="legacy" />
                </>
              ) : (
                <div className="space-y-3" aria-label={t("loading")}>
                  <div className="h-32 animate-pulse rounded-lg bg-white/5" />
                  <div className="h-32 animate-pulse rounded-lg bg-white/5" />
                </div>
              )}
            </div>
          </aside>
        </section>

        <section>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className={styles.eyebrow}>{t("mode.legacy")}</div>
              <h2 className="mt-1 text-2xl font-black tracking-tight text-white">{t("landing.legacyTitle")}</h2>
              <p className="mt-1 text-sm text-slate-400">{t("landing.legacyBody")}</p>
            </div>
            <Link href="/fun/ccg/open?mode=legacy" className={styles.secondaryButton}>{t("landing.openLegacy")}</Link>
          </div>
          {legacy.length > 0 ? (
            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {legacy.map((set) => (
                <Link
                  key={set.id}
                  href={`/fun/ccg/collection?set=${encodeURIComponent(set.slug)}`}
                  className={`${styles.setCover} group min-h-48 transition-transform hover:-translate-y-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300`}
                  style={{
                    "--set-accent": set.theme.accent,
                    "--set-glow": set.theme.glow,
                    backgroundImage: `url("${set.backgroundPath}")`,
                  } as React.CSSProperties}
                >
                  <div className={styles.setCoverContent}>
                    <div className="text-[0.65rem] font-bold uppercase tracking-[0.16em]" style={{ color: set.theme.accent }}>{set.theme.mark}</div>
                    <h3 className="mt-1 text-lg font-black text-white">{set.raidName}</h3>
                    <div className="mt-2 text-xs tabular-nums text-slate-400">{set.ownedCards}/{set.cardCount} {t("landing.collected")}</div>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className={`${styles.panel} mt-5 p-8 text-center text-sm text-slate-500`}>{t("landing.legacyEmpty")}</div>
          )}
        </section>
      </div>
    </CcgShell>
  );
}
