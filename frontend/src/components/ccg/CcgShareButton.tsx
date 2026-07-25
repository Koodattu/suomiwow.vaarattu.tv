"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { FaCheck, FaShareNodes, FaTriangleExclamation } from "react-icons/fa6";
import type { CcgArtVariant, CcgFinish, CcgShareLink } from "@/types";
import { api } from "@/lib/api";
import styles from "./ccg.module.css";

type ShareTarget =
  | { kind: "card"; cardId: string; finish: CcgFinish; artVariant: CcgArtVariant }
  | { kind: "pack"; openingId: string };

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // The selection fallback still works in browsers that deny Clipboard API access.
    }
  }

  const textArea = document.createElement("textarea");
  textArea.value = value;
  textArea.setAttribute("readonly", "");
  textArea.style.position = "fixed";
  textArea.style.opacity = "0";
  document.body.appendChild(textArea);
  textArea.select();
  const copied = document.execCommand("copy");
  textArea.remove();
  if (!copied) throw new Error("Clipboard access was denied");
}

export default function CcgShareButton({
  target,
  className = "",
}: {
  target: ShareTarget;
  className?: string;
}) {
  const t = useTranslations("ccg.share");
  const [status, setStatus] = useState<"idle" | "creating" | "copied" | "error">("idle");
  const [shareLink, setShareLink] = useState<CcgShareLink | null>(null);
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
  }, []);

  const share = async () => {
    if (status === "creating") return;
    setStatus("creating");
    let resetDelay = 2400;
    try {
      const link = shareLink ?? (target.kind === "card"
        ? await api.createCcgCardShare(target)
        : await api.createCcgPackShare(target.openingId));
      setShareLink(link);
      await copyText(new URL(link.path, window.location.origin).toString());
      setStatus("copied");
      resetDelay = 1400;
    } catch {
      setStatus("error");
    }
    if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
    resetTimerRef.current = window.setTimeout(() => setStatus("idle"), resetDelay);
  };

  const label = status === "creating"
    ? t("creating")
    : status === "copied"
      ? t("copied")
      : status === "error"
        ? t("error")
        : t(target.kind === "card" ? "card" : "pack");
  const resultVisible = status === "copied" || status === "error";

  return (
    <button
      type="button"
      className={`${styles.shareButton} ${className}`}
      onClick={() => void share()}
      disabled={status === "creating"}
      data-status={status}
      aria-label={label}
      title={label}
    >
      <span className={styles.shareButtonIcon} aria-hidden="true">
        <FaShareNodes className={resultVisible ? styles.shareIconHidden : styles.shareIconVisible} />
        <FaCheck className={status === "copied" ? styles.shareIconVisible : styles.shareIconHidden} />
        <FaTriangleExclamation className={status === "error" ? styles.shareIconVisible : styles.shareIconHidden} />
      </span>
      <span aria-live="polite">{label}</span>
    </button>
  );
}
