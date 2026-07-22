"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import Link from "next/link";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import type { CcgMode, CcgOpening, CcgSet } from "@/types";
import { api } from "@/lib/api";
import { queryKeys, useCcgOpening, useCcgSession, useCcgSets } from "@/lib/queries";
import CcgShell from "@/components/ccg/CcgShell";
import GuestNotice from "@/components/ccg/GuestNotice";
import PackBalance from "@/components/ccg/PackBalance";
import CollectibleCard from "@/components/ccg/CollectibleCard";
import CardViewer from "@/components/ccg/CardViewer";
import CcgLoadError from "@/components/ccg/CcgLoadError";
import styles from "@/components/ccg/ccg.module.css";
import packStyles from "@/components/ccg/pack-opening.module.css";

type RevealPhase = "idle" | "tearing" | "dealing" | "ready";

const fanAngles = [-5.5, -2.5, 0, 2.5, 5.5];
const fanOffsets = [15, 5, 0, 5, 15];
const tearParticles = [
  { x: -132, y: -74, rotate: -34, delay: 90 },
  { x: -98, y: -126, rotate: -18, delay: 120 },
  { x: -48, y: -146, rotate: 12, delay: 145 },
  { x: 24, y: -154, rotate: 28, delay: 110 },
  { x: 86, y: -118, rotate: 46, delay: 135 },
  { x: 138, y: -62, rotate: 65, delay: 95 },
  { x: -142, y: 30, rotate: -58, delay: 150 },
  { x: -82, y: 82, rotate: -26, delay: 170 },
  { x: 88, y: 76, rotate: 34, delay: 160 },
  { x: 146, y: 24, rotate: 62, delay: 130 },
];

function makeIdempotencyKey(): string {
  return `pack_${window.crypto.randomUUID()}`;
}

function randomIndex(length: number): number {
  if (length <= 1) return 0;
  const value = new Uint32Array(1);
  window.crypto.getRandomValues(value);
  return value[0] % length;
}

function packTheme(set: CcgSet | undefined): CSSProperties {
  return {
    "--pack-accent": set?.theme.accent ?? "#5baeff",
    "--pack-glow": set?.theme.glow ?? "rgba(91, 174, 255, 0.38)",
    "--pack-art": set ? `url("${set.backgroundPath}")` : "none",
  } as CSSProperties;
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
  const [revealPhase, setRevealPhase] = useState<RevealPhase>("idle");
  const [dealtCards, setDealtCards] = useState(0);
  const [revealedCards, setRevealedCards] = useState<Set<number>>(() => new Set());
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [legacyArtSetId, setLegacyArtSetId] = useState("");
  const [showPrototypeLab, setShowPrototypeLab] = useState(false);
  const cardRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const packDragRef = useRef({ pointerId: -1, startX: 0, startY: 0, dragging: false, suppressClick: false });
  const recoveryQuery = useCcgOpening(recoveryId);
  const session = sessionQuery.data;
  const sets = setsQuery.data?.sets;
  const modeSets = useMemo(() => (sets ?? []).filter((set) => set.state === mode && set.cardCount > 0), [mode, sets]);
  const legacyPoolKey = modeSets.map((set) => set.id).join("|");
  const featuredPackSet = mode === "legacy"
    ? modeSets.find((set) => set.id === legacyArtSetId) ?? modeSets[0]
    : modeSets[0];
  const poolTitle =
    mode === "legacy"
      ? t("open.legacyPackTitle")
      : modeSets.length === 1
        ? modeSets[0].raidName
        : t("open.currentPool", { count: modeSets.length });

  useEffect(() => {
    if (mode !== "legacy" || modeSets.length === 0) return;
    setLegacyArtSetId((current) => modeSets.some((set) => set.id === current) ? current : modeSets[randomIndex(modeSets.length)].id);
  }, [legacyPoolKey, mode, modeSets]);

  useEffect(() => {
    setShowPrototypeLab(["localhost", "127.0.0.1", "::1"].includes(window.location.hostname));
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
    const total = opening.results.length;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setViewerIndex(null);

    if (reduced) {
      setRevealPhase("ready");
      setDealtCards(total);
      setRevealedCards(new Set(opening.results.map((_, index) => index)));
      return;
    }

    setRevealPhase("tearing");
    setDealtCards(0);
    setRevealedCards(new Set());
    let readyTimer: number | undefined;
    const tearTimer = window.setTimeout(() => {
      setRevealPhase("dealing");
      setDealtCards(total);
      readyTimer = window.setTimeout(() => setRevealPhase("ready"), 560);
    }, 640);

    return () => {
      window.clearTimeout(tearTimer);
      if (readyTimer) window.clearTimeout(readyTimer);
    };
  }, [opening]);

  useEffect(() => {
    if (revealPhase !== "ready" || revealedCards.size > 0) return;
    cardRefs.current[0]?.focus({ preventScroll: true });
  }, [revealPhase, revealedCards.size]);

  const mutation = useMutation({
    mutationFn: async () => {
      const result = await api.openCcgPack({ mode, idempotencyKey: makeIdempotencyKey() });
      queryClient.setQueryData(queryKeys.ccg.opening(result.id), result);
      const url = new URL(window.location.href);
      url.searchParams.set("mode", result.mode);
      url.searchParams.set("opening", result.id);
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
      result.results.forEach((row) => {
        if (!row.card.renderUrl) return;
        const image = new window.Image();
        image.src = row.card.renderUrl;
      });
      return result;
    },
    onSuccess: (result) => {
      setOpening(result);
      queryClient.invalidateQueries({ queryKey: queryKeys.ccg.session });
      queryClient.invalidateQueries({ queryKey: ["ccg", "catalog"] });
      queryClient.invalidateQueries({ queryKey: ["ccg", "collection"] });
      queryClient.invalidateQueries({ queryKey: ["ccg", "guilds"] });
      queryClient.invalidateQueries({ queryKey: queryKeys.ccg.sets });
    },
  });

  const queryFailed = sessionQuery.isError || setsQuery.isError;
  const noPacks = session ? session.packs[mode].totalRemaining <= 0 : false;
  const clearSavedOpening = () => {
    setOpening(null);
    setRevealPhase("idle");
    setDealtCards(0);
    setRevealedCards(new Set());
    setViewerIndex(null);
    setRecoveryId("");
    if (mode === "legacy" && modeSets.length > 0) setLegacyArtSetId(modeSets[randomIndex(modeSets.length)].id);
    const url = new URL(window.location.href);
    url.searchParams.delete("opening");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  };

  const revealCard = (index: number) => {
    if (revealPhase !== "ready" || index >= dealtCards) return;
    if (revealedCards.has(index)) {
      setViewerIndex(index);
      return;
    }
    setRevealedCards((current) => new Set(current).add(index));
  };

  const revealAll = () => {
    if (!opening || revealPhase !== "ready") return;
    setRevealedCards(new Set(opening.results.map((_, index) => index)));
  };

  const canOpen = recoveryInitialized && !recoveryId && Boolean(session) && !queryFailed && modeSets.length > 0 && !noPacks && !mutation.isPending;
  const allRevealed = Boolean(opening) && revealedCards.size >= (opening?.results.length ?? 0);
  const revealedSummary = useMemo(
    () => opening?.results
      .filter((_, index) => revealedCards.has(index))
      .map((row) => `${row.card.name}, ${t(`finish.${row.finish}`)}, ${row.isDuplicate ? t("open.duplicate") : t("open.newCard")}`)
      .join(". ") ?? "",
    [opening, revealedCards, t],
  );
  const openingSet = opening?.results[0]?.card.set ?? opening?.sets[0] ?? featuredPackSet;
  const stageTheme = packTheme(opening?.mode === "legacy" ? featuredPackSet : openingSet);

  const resetPackMotion = (target: HTMLButtonElement) => {
    delete target.dataset.dragging;
    target.style.setProperty("--pack-drag-x", "0px");
    target.style.setProperty("--pack-drag-y", "0px");
    target.style.setProperty("--pack-tilt-x", "0deg");
    target.style.setProperty("--pack-tilt-y", "0deg");
    target.style.setProperty("--pack-shine-x", "50%");
    target.style.setProperty("--pack-shine-y", "38%");
  };

  const updatePackLight = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    const target = event.currentTarget;
    const bounds = target.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    const y = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
    target.style.setProperty("--pack-tilt-x", `${((0.5 - y) * 16).toFixed(2)}deg`);
    target.style.setProperty("--pack-tilt-y", `${((x - 0.5) * 18).toFixed(2)}deg`);
    target.style.setProperty("--pack-shine-x", `${(x * 100).toFixed(1)}%`);
    target.style.setProperty("--pack-shine-y", `${(y * 100).toFixed(1)}%`);

    const drag = packDragRef.current;
    if (drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.dragging && Math.hypot(dx, dy) >= 7) drag.dragging = true;
    if (!drag.dragging) return;
    event.preventDefault();
    target.dataset.dragging = "true";
    target.style.setProperty("--pack-drag-x", `${Math.max(-76, Math.min(76, dx)).toFixed(1)}px`);
    target.style.setProperty("--pack-drag-y", `${Math.max(-52, Math.min(52, dy)).toFixed(1)}px`);
  };

  const startPackDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!canOpen || event.button !== 0 || event.pointerType !== "mouse") return;
    packDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      dragging: false,
      suppressClick: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const finishPackDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = packDragRef.current;
    if (drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    drag.suppressClick = drag.dragging;
    drag.pointerId = -1;
    drag.dragging = false;
    resetPackMotion(event.currentTarget);
  };

  const cancelPackDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = packDragRef.current;
    if (drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    drag.pointerId = -1;
    drag.dragging = false;
    drag.suppressClick = false;
    resetPackMotion(event.currentTarget);
  };

  const openPack = () => {
    if (packDragRef.current.suppressClick) {
      packDragRef.current.suppressClick = false;
      return;
    }
    mutation.mutate();
  };

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

            <section className={packStyles.packStage} style={packTheme(featuredPackSet)}>
              <span className={packStyles.stageArt} />
              <span className={packStyles.stageVeil} />
              <span className={packStyles.vaultRing} aria-hidden="true" />
              <span className={packStyles.vaultRingInner} aria-hidden="true" />
              <div className={packStyles.packPresentation}>
                <span className={packStyles.packMode}>
                  {mode === "legacy" ? t("open.legacyPackLabel") : `${t(`mode.${mode}`)} · ${featuredPackSet?.expansionName ?? "SuomiWoW"}`}
                </span>
                <button
                  type="button"
                  className={`${packStyles.packButton} ${mutation.isPending ? packStyles.packButtonOpening : ""}`}
                  disabled={!canOpen}
                  onClick={openPack}
                  onPointerDown={startPackDrag}
                  onPointerMove={updatePackLight}
                  onPointerUp={finishPackDrag}
                  onPointerCancel={cancelPackDrag}
                  onPointerLeave={(event) => {
                    if (packDragRef.current.pointerId === -1) resetPackMotion(event.currentTarget);
                  }}
                  onBlur={(event) => resetPackMotion(event.currentTarget)}
                  aria-label={t("open.openPack")}
                  aria-busy={mutation.isPending}
                >
                  <span className={packStyles.packShadow} />
                  <span className={packStyles.booster}>
                    <span className={packStyles.wrapperArt} />
                    <span className={packStyles.wrapperShade} />
                    <span className={packStyles.wrapperFoil} />
                    <span className={`${packStyles.crimp} ${packStyles.crimpTop}`} />
                    <span className={`${packStyles.crimp} ${packStyles.crimpBottom}`} />
                    <span className={packStyles.packBrand}>SuomiWoW <strong>CCG</strong></span>
                    <span className={packStyles.packTitle}>{modeSets.length > 0 ? poolTitle : t("landing.preparing")}</span>
                    <span className={packStyles.packSigil} aria-hidden="true"><span /></span>
                    <span className={packStyles.packCount}><strong>5</strong><span>{t("landing.cards")}</span></span>
                    <span className={packStyles.packSeal}>{mode === "legacy" ? t("open.legacySeal") : featuredPackSet?.theme.mark ?? "CCG"}</span>
                  </span>
                </button>
                <span className={packStyles.packHint}>{mutation.isPending ? t("open.openingHint") : t("open.packHint")}</span>
              </div>
            </section>
          </div>
        ) : (
          <section className={`${packStyles.packStage} ${packStyles.revealStage}`} style={stageTheme}>
            <span className={packStyles.stageArt} />
            <span className={packStyles.stageVeil} />
            <span className={packStyles.vaultRing} aria-hidden="true" />
            <span className={packStyles.vaultRingInner} aria-hidden="true" />

            <div className={`${packStyles.tearSequence} ${revealPhase === "ready" ? packStyles.tearSequenceComplete : ""}`} aria-hidden="true">
              <span className={`${packStyles.tornHalf} ${packStyles.tornHalfLeft}`}><span /></span>
              <span className={`${packStyles.tornHalf} ${packStyles.tornHalfRight}`}><span /></span>
              <span className={packStyles.tearFlash} />
              <span className={packStyles.tearBurst} />
              <span className={packStyles.tearParticles}>
                {tearParticles.map((particle, index) => (
                  <i
                    key={index}
                    style={{
                      "--particle-x": `${particle.x}px`,
                      "--particle-y": `${particle.y}px`,
                      "--particle-rotate": `${particle.rotate}deg`,
                      "--particle-delay": `${particle.delay}ms`,
                    } as CSSProperties}
                  />
                ))}
              </span>
              <span className={packStyles.tearShardOne} />
              <span className={packStyles.tearShardTwo} />
              <span className={packStyles.tearShardThree} />
            </div>

            <div className={`${packStyles.revealContent} ${revealPhase === "tearing" ? packStyles.revealContentWaiting : ""}`}>
              <div className={packStyles.revealLead}>
                <span>{opening.mode === "legacy" ? t("open.legacyPackTitle") : openingSet?.raidName}</span>
                <strong>{allRevealed ? t("open.allRevealed") : t("open.revealPrompt")}</strong>
              </div>

              <div className={packStyles.cardFanScroller}>
                <div className={packStyles.cardFan}>
                  {opening.results.map((result, index) => {
                    const revealed = revealedCards.has(index);
                    const dealt = index < dealtCards;
                    const special = result.finish !== "standard" || result.card.tierGrade === "S" || result.card.tierGrade === "Crown";
                    const cardStyle = {
                      "--fan-angle": `${fanAngles[index] ?? 0}deg`,
                      "--fan-y": `${fanOffsets[index] ?? 0}px`,
                      "--deal-delay": `${index * 52}ms`,
                    } as CSSProperties;
                    return (
                      <button
                        key={`${result.card.id}-${index}`}
                        type="button"
                        className={`${packStyles.revealSlot} ${dealt ? packStyles.revealSlotDealt : ""} ${revealed ? packStyles.revealSlotRevealed : ""} ${special ? packStyles.revealSlotSpecial : ""}`}
                        style={cardStyle}
                        ref={(element) => { cardRefs.current[index] = element; }}
                        disabled={!dealt || revealPhase !== "ready"}
                        onClick={() => revealCard(index)}
                        aria-label={revealed ? t("open.viewCard", { name: result.card.name }) : t("open.revealCard", { position: index + 1 })}
                      >
                        <span className={packStyles.cardFlip}>
                          <span className={`${packStyles.cardFace} ${packStyles.cardBack}`} aria-hidden={revealed}>
                            <span className={packStyles.cardBackField} />
                            <span className={packStyles.cardBackSigil} aria-hidden="true"><span /></span>
                            <span className={packStyles.cardBackBrand}>SuomiWoW <strong>CCG</strong></span>
                            <span className={packStyles.cardBackSet}>{opening.mode === "current" ? openingSet?.raidName : t("open.legacyPackTitle")}</span>
                          </span>
                          <span className={`${packStyles.cardFace} ${packStyles.cardFront}`} aria-hidden={!revealed}>
                            <CollectibleCard card={result.card} finish={result.finish} compact />
                          </span>
                        </span>
                        <span className={packStyles.revealFlare} aria-hidden="true" />
                        <span className={packStyles.pullStatus} aria-hidden={!revealed}>
                          <strong>{t(result.isDuplicate ? "open.duplicate" : "open.newCard")}</strong>
                          <span>{t(`finish.${result.finish}`)}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className={packStyles.revealControls}>
                <div className={packStyles.revealProgress}>
                  <span>{t("open.revealProgress", { revealed: revealedCards.size, total: opening.results.length })}</span>
                  <span className={packStyles.progressPips} aria-hidden="true">
                    {opening.results.map((_, index) => <i key={index} data-revealed={revealedCards.has(index)} />)}
                  </span>
                </div>
                {revealPhase === "ready" && !allRevealed ? (
                  <button type="button" className={styles.secondaryButton} onClick={revealAll}>{t("open.revealAll")}</button>
                ) : null}
                {allRevealed ? (
                  <>
                    {showPrototypeLab ? (
                      <Link href={`/fun/ccg/prototypes?set=${encodeURIComponent(opening.results[0]?.card.set.slug ?? "")}`} className={styles.secondaryButton}>
                        {t("open.comparePrototypes")}
                      </Link>
                    ) : null}
                    <button type="button" className={styles.primaryButton} onClick={clearSavedOpening}>{t("open.openAnother")}</button>
                  </>
                ) : null}
              </div>
              {allRevealed && opening.duplicateRewards > 0 ? <p className={packStyles.bonusEarned}>{t("open.bonusEarned", { count: opening.duplicateRewards })}</p> : null}
            </div>
            <p className="sr-only" aria-live="polite">{revealPhase === "ready" && revealedCards.size === 0 ? t("open.cardsReady") : revealedSummary}</p>
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
