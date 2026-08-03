"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { CSSProperties } from "react";
import CollectibleCard from "@/components/ccg/CollectibleCard";
import { getPackTheme } from "@/components/ccg/PackBoosterVisual";
import { api } from "@/lib/api";
import { getCcgAnnouncerSoundSources, getCcgPlaybackVolume } from "@/lib/ccg-audio";
import { CCG_CARD_SLIDE_SOUNDS, getCcgQualityRevealSoundFile, hasCcgQualityRevealSound } from "@/lib/ccg-reveal-audio";
import type { CcgOverlayEvent } from "@/types";
import packStyles from "@/components/ccg/pack-opening.module.css";
import styles from "./overlay.module.css";

type RevealPhase = "entering" | "sealed" | "revealed" | "exiting";

const CARD_REVEAL_DELAY_MS = 1050;
const CARD_VISIBLE_DURATION_MS = 3000;
const CARD_EXIT_DURATION_MS = 550;

function randomIndex(length: number): number {
  if (length <= 1) return 0;
  const value = new Uint32Array(1);
  window.crypto.getRandomValues(value);
  return value[0] % length;
}

function playAudio(audio: HTMLAudioElement | null, channel: "effects" | "quips" | "announcer", volume: number): void {
  if (!audio) return;
  const playbackVolume = getCcgPlaybackVolume(channel, volume);
  if (playbackVolume <= 0) return;
  audio.pause();
  audio.currentTime = 0;
  audio.volume = playbackVolume;
  void audio.play().catch(() => undefined);
}

export default function CcgOverlayPage() {
  const t = useTranslations("ccg.overlay");
  const locale = useLocale() === "fi" ? "fi" : "en";
  const [token, setToken] = useState("");
  const [event, setEvent] = useState<CcgOverlayEvent | null>(null);
  const [phase, setPhase] = useState<RevealPhase>("entering");
  const [cardReady, setCardReady] = useState(false);
  const activeRef = useRef(true);
  const documentVisibleRef = useRef(true);
  const obsActiveRef = useRef(true);
  const obsVisibleRef = useRef(true);
  const stoppedRef = useRef(false);
  const busyRef = useRef(false);
  const pollTimerRef = useRef<number | null>(null);
  const pollRequestRef = useRef<AbortController | null>(null);
  const sequenceTimersRef = useRef<number[]>([]);
  const slideAudioRefs = useRef<Array<HTMLAudioElement | null>>([]);
  const qualityAudioRef = useRef<HTMLAudioElement | null>(null);
  const quipAudioRef = useRef<HTMLAudioElement | null>(null);
  const announcerAudioRefs = useRef<Array<HTMLAudioElement | null>>([]);

  const announcerSources = useMemo(
    () => event ? getCcgAnnouncerSoundSources(locale, event.finish, event.tierGrade, event.artVariant) : [],
    [event, locale],
  );

  const clearPollTimer = useCallback(() => {
    if (pollTimerRef.current !== null) window.clearTimeout(pollTimerRef.current);
    pollTimerRef.current = null;
  }, []);

  const pollRef = useRef<() => Promise<void>>(async () => undefined);
  const schedulePoll = useCallback((delay = 1000) => {
    clearPollTimer();
    if (!token || stoppedRef.current || busyRef.current || !activeRef.current) return;
    pollTimerRef.current = window.setTimeout(() => void pollRef.current(), delay);
  }, [clearPollTimer, token]);

  pollRef.current = async () => {
    if (!token || stoppedRef.current || busyRef.current || !activeRef.current) return;
    const controller = new AbortController();
    pollRequestRef.current = controller;
    try {
      const next = await api.getTwitchCcgOverlayNext(token, controller.signal);
      if (!activeRef.current) return;
      if (!next) {
        schedulePoll(1000);
        return;
      }
      busyRef.current = true;
      setCardReady(false);
      setPhase("entering");
      setEvent(next);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      const overlayError = error as Error & { status?: number; code?: string };
      if (overlayError.status === 401 || overlayError.code === "overlay_disabled") {
        stoppedRef.current = true;
        clearPollTimer();
        return;
      }
      schedulePoll(5000);
    } finally {
      if (pollRequestRef.current === controller) pollRequestRef.current = null;
    }
  };

  useEffect(() => {
    const hashToken = new URLSearchParams(window.location.hash.slice(1)).get("token")?.trim() || "";
    if (!hashToken) stoppedRef.current = true;
    setToken(hashToken);
  }, []);

  useEffect(() => {
    if (!token || stoppedRef.current) return;
    schedulePoll(0);
    return clearPollTimer;
  }, [clearPollTimer, schedulePoll, token]);

  useEffect(() => {
    const updateActive = () => {
      const active = documentVisibleRef.current && obsActiveRef.current && obsVisibleRef.current;
      activeRef.current = active;
      if (active) schedulePoll(0);
      else {
        clearPollTimer();
        pollRequestRef.current?.abort();
      }
    };
    const handleVisibility = () => {
      documentVisibleRef.current = document.visibilityState === "visible";
      updateActive();
    };
    const handleObsActive = (customEvent: Event) => {
      const detail = (customEvent as CustomEvent<{ active?: boolean } | boolean>).detail;
      obsActiveRef.current = typeof detail === "boolean" ? detail : detail?.active !== false;
      updateActive();
    };
    const handleObsVisible = (customEvent: Event) => {
      const detail = (customEvent as CustomEvent<{ visible?: boolean } | boolean>).detail;
      obsVisibleRef.current = typeof detail === "boolean" ? detail : detail?.visible !== false;
      updateActive();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("obsSourceActiveChanged", handleObsActive);
    window.addEventListener("obsSourceVisibleChanged", handleObsVisible);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("obsSourceActiveChanged", handleObsActive);
      window.removeEventListener("obsSourceVisibleChanged", handleObsVisible);
    };
  }, [clearPollTimer, schedulePoll]);

  useEffect(() => {
    if (!event || cardReady) return;
    const fallback = window.setTimeout(() => setCardReady(true), 2500);
    return () => window.clearTimeout(fallback);
  }, [cardReady, event]);

  useEffect(() => {
    if (!event || !cardReady) return;
    sequenceTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    sequenceTimersRef.current = [];
    const later = (delay: number, callback: () => void) => {
      const timer = window.setTimeout(callback, delay);
      sequenceTimersRef.current.push(timer);
    };

    setPhase("entering");
    later(80, () => {
      setPhase("sealed");
      playAudio(slideAudioRefs.current[randomIndex(slideAudioRefs.current.length)] ?? null, "effects", 0.36);
    });
    later(CARD_REVEAL_DELAY_MS, () => {
      setPhase("revealed");
    });
    if (hasCcgQualityRevealSound(event.finish, event.tierGrade, event.artVariant)) {
      later(1250, () => playAudio(qualityAudioRef.current, "effects", 0.4));
    }
    if (event.card.quip?.audioPath) later(1270, () => playAudio(quipAudioRef.current, "quips", 0.9));
    else later(1410, () => playAudio(announcerAudioRefs.current[randomIndex(announcerSources.length)] ?? null, "announcer", 0.78));
    later(CARD_REVEAL_DELAY_MS + CARD_VISIBLE_DURATION_MS, () => setPhase("exiting"));
    later(CARD_REVEAL_DELAY_MS + CARD_VISIBLE_DURATION_MS + CARD_EXIT_DURATION_MS, () => {
      void api.acknowledgeTwitchCcgOverlayEvent(token, event.eventId, event.leaseId)
        .catch((error) => {
          const overlayError = error as Error & { code?: string };
          if (overlayError.code === "overlay_disabled") stoppedRef.current = true;
        })
        .finally(() => {
          setEvent(null);
          setCardReady(false);
          busyRef.current = false;
          schedulePoll(750);
        });
    });

    return () => {
      sequenceTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      sequenceTimersRef.current = [];
    };
  }, [announcerSources.length, cardReady, event, schedulePoll, token]);

  useEffect(() => () => {
    stoppedRef.current = true;
    pollRequestRef.current?.abort();
    clearPollTimer();
    sequenceTimersRef.current.forEach((timer) => window.clearTimeout(timer));
  }, [clearPollTimer]);

  const qualitySound = event ? getCcgQualityRevealSoundFile(event.finish, event.artVariant) : undefined;
  const special = event ? event.finish !== "standard" || event.tierGrade === "S" : false;
  const stageStyle = event ? {
    ...getPackTheme(event.card.set),
    "--fan-angle": "0deg",
    "--fan-y": "0px",
    "--deal-x": "0%",
    "--deal-angle": "0deg",
    "--deal-delay": "0ms",
  } as CSSProperties : undefined;

  return (
    <main className={styles.overlay} aria-live="polite">
      {event && (
        <section
          className={`${styles.stage} ${phase !== "entering" ? styles.stageEntered : ""} ${phase === "exiting" ? styles.stageExiting : ""}`}
          style={stageStyle}
        >
          <div className={styles.viewerLabel}>
            <span>{t("redeemedBy")}</span>
            <strong>{event.viewer.displayName}</strong>
          </div>
          <div
            className={`${styles.cardSlot} ${packStyles.revealSlot} ${phase !== "entering" ? packStyles.revealSlotDealt : ""} ${packStyles.revealSlotReady} ${phase === "revealed" || phase === "exiting" ? packStyles.revealSlotRevealed : ""} ${special ? packStyles.revealSlotSpecial : ""}`}
            data-finish={event.finish}
            data-grade={event.tierGrade}
          >
            <span className={packStyles.sealedAura} aria-hidden="true" />
            <span className={packStyles.cardFlip} data-card-surface>
              <span className={`${packStyles.cardFace} ${packStyles.cardBack}`} aria-hidden={phase === "revealed" || phase === "exiting"}>
                <span className={packStyles.cardBackField} />
                <span className={packStyles.cardBackFinish} />
                <span className={packStyles.cardBackSigil} aria-hidden="true"><span /></span>
                <span className={packStyles.cardBackBrand}><span>SUOMIWOW</span><strong>CCG</strong></span>
                <span className={packStyles.cardBackSet}>{event.card.set.raidName}</span>
              </span>
              <span className={`${packStyles.cardFace} ${packStyles.cardFront}`} aria-hidden={phase !== "revealed" && phase !== "exiting"}>
                <CollectibleCard
                  card={event.card}
                  finish={event.finish}
                  artVariant={event.artVariant}
                  compact
                  renderPriority
                  className={packStyles.openedCard}
                  forcedPointer={event.finish === "holographic" ? undefined : { x: 0.62, y: 0.38 }}
                  ambientMaterial={event.finish === "holographic"}
                  onReady={() => setCardReady(true)}
                />
              </span>
            </span>
            <span className={packStyles.revealFlare} aria-hidden="true" />
            <span className={packStyles.revealCeremony} aria-hidden="true">
              <span className={packStyles.revealRays} />
              <span className={packStyles.revealRings}><i /><i /><i /><i /><i /><i /></span>
              <span className={packStyles.revealMotes} />
            </span>
            <span className={packStyles.pullStatus} aria-hidden={phase !== "revealed"}>
              <strong>{t(event.source === "test" ? "test" : "revealed")}</strong>
            </span>
          </div>
        </section>
      )}
      {CCG_CARD_SLIDE_SOUNDS.map((src, index) => (
        <audio key={src} ref={(element) => { slideAudioRefs.current[index] = element; }} src={src} preload="auto" aria-hidden="true" />
      ))}
      <audio ref={qualityAudioRef} src={qualitySound ? `/ccg/audio/quality/${qualitySound}` : undefined} preload="auto" aria-hidden="true" />
      <audio ref={quipAudioRef} src={event?.card.quip?.audioPath ?? undefined} preload="auto" aria-hidden="true" />
      {announcerSources.map((src, index) => (
        <audio key={src} ref={(element) => { announcerAudioRefs.current[index] = element; }} src={src} preload="auto" aria-hidden="true" />
      ))}
    </main>
  );
}
