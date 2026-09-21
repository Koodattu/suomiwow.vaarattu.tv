"use client";

import Link from "next/link";
import { Dialog, DialogBackdrop, DialogDescription, DialogPanel, DialogTitle } from "@headlessui/react";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { FaSpinner, FaXmark } from "react-icons/fa6";
import { api, ApiError } from "@/lib/api";
import type { StudioRewardClaim, StudioState } from "@/types/ccg-studio";
import styles from "./studio.module.css";

export default function StudioRewardsDialog({ rewards, close, onClaim }: {
  rewards: StudioState["rewards"]; close: () => void; onClaim: (result: StudioRewardClaim) => void;
}) {
  const t = useTranslations("ccg.studio");
  const claim = useMutation({ mutationFn: () => api.claimCcgStudioPacks(), onSuccess: onClaim });
  const errorCode = claim.error instanceof ApiError ? claim.error.code : null;
  return <Dialog open onClose={() => { if (!claim.isPending) close(); }} className={styles.rewardOverlay}>
    <DialogBackdrop className={styles.rewardBackdrop} />
    <div className={styles.rewardPosition}>
      <DialogPanel className={`${styles.studio} ${styles.rewardDialog}`}>
        <div className={styles.sectionHeading}>
          <DialogTitle as="h2">{t("rewards.title")}</DialogTitle>
          <button onClick={close} disabled={claim.isPending} aria-label={t("rewards.close")}><FaXmark aria-hidden="true" /></button>
        </div>
        <DialogDescription>{t("rewards.description", { count: rewards.packsPerCard })}</DialogDescription>
        <div className={styles.rewardTotal}><strong>{rewards.availablePacks}</strong><span>{t("rewards.available")}</span></div>
        {claim.isSuccess && <p className={styles.success} role="status">{t(claim.data.claimedPacks ? "rewards.claimed" : "rewards.alreadyClaimed", { count: claim.data.claimedPacks })}</p>}
        {claim.isError && <p className={styles.inlineError} role="alert">{t(errorCode && t.has(`errors.${errorCode}`) ? `errors.${errorCode}` : "rewards.failed")}</p>}
        <div className={styles.actions}>
          <button className={styles.primary} disabled={claim.isPending || rewards.availablePacks === 0} onClick={() => claim.mutate()}>
            {claim.isPending && <FaSpinner className={styles.spinner} aria-hidden="true" />}
            {t(claim.isPending ? "rewards.claiming" : "rewards.claim", { count: rewards.availablePacks })}
          </button>
          {claim.isSuccess && <Link href="/ccg/open">{t("rewards.open")}</Link>}
        </div>
      </DialogPanel>
    </div>
  </Dialog>;
}
