"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import CcgShell from "@/components/ccg/CcgShell";
import CollectibleCard from "@/components/ccg/CollectibleCard";
import { useAuth } from "@/context/AuthContext";
import { api, ApiError } from "@/lib/api";
import { useCcgRewards } from "@/lib/queries";
import styles from "./rewards.module.css";

export default function RewardsPage() {
  const t = useTranslations("ccg.rewards");
  const locale = useLocale();
  const { user, isLoading, login } = useAuth();
  const query = useCcgRewards(user?.discord.username);
  const client = useQueryClient();
  const [code, setCode] = useState("");
  const claim = useMutation({
    mutationFn: async (request: { source: "duplicates" | "pickem" | "studio" | "code" | "manual"; id?: string }) => {
      if (request.source === "manual") await api.redeemCcgCode(request.id!);
      else await api.claimCcgReward(request.source, request.id);
    },
    onSuccess: async (_data, request) => {
      if (request.source === "manual") setCode("");
      await Promise.all([
        client.invalidateQueries({ queryKey: ["ccg"] }),
        client.invalidateQueries({ queryKey: ["pickems"] }),
      ]);
    },
    onError: () => { void client.invalidateQueries({ queryKey: ["ccg", "rewards"] }); },
  });
  const data = query.data;
  const claimedIds = new Set(data?.claimedCodes.map(item => item.id));
  const unclaimedCodes = data?.publicCodes.filter(item => !claimedIds.has(item.id)) ?? [];
  const available = (data?.items.length ?? 0) + unclaimedCodes.length + Number((data?.historical.availablePacks ?? 0) > 0);
  const codeRows = [
    ...unclaimedCodes.map(item => ({ ...item, claimedAt: null as string | null })),
    ...(data?.claimedCodes ?? []),
  ];
  const errorCode = claim.error instanceof ApiError ? claim.error.code : undefined;
  const claimButton = (source: "duplicates" | "pickem" | "studio" | "code", id?: string) => (
    <button type="button" className={styles.claimButton} disabled={claim.isPending} onClick={() => claim.mutate({ source, id })}>
      {t(claim.isPending && claim.variables?.source === source && claim.variables?.id === id ? "claiming" : "claim")}
    </button>
  );

  return <CcgShell>
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>{t("title")}</h1>
        {user ? <Link href="/ccg/activity">{t("activity")}</Link> : null}
      </header>
      {!isLoading && !user ? <div className={styles.signIn}>
        <p>{t("login")}</p>
        <button type="button" className={styles.claimButton} onClick={() => login("/ccg/rewards")}>{t("signIn")}</button>
      </div> : null}
      {user && data ? <>
        {claim.isSuccess ? <p className={styles.success} role="status">{t("claimed")}</p> : null}
        {claim.isError ? <p className={styles.error} role="alert">{t(errorCode === "redeem_code_already_used" ? "alreadyClaimed" : errorCode === "redeem_code_not_found" || errorCode === "invalid_redeem_code" ? "invalidCode" : "claimError")}</p> : null}
        {available === 0 ? <p className={styles.empty}>{t("empty")}</p> : null}
        {available > 0 || codeRows.length > 0 ? <ul className={styles.list}>
          {data.historical.availablePacks > 0 ? <li className={styles.reward}>
            <div className={styles.identity}>
              <h2>{t("duplicates")}</h2>
              <details className={styles.details}>
                <summary>{t("breakdown")}</summary>
                <dl className={styles.breakdown}>
                  {(["raid", "community", "supporter"] as const).map(kind => <div key={kind}><dt>{t(kind)}</dt><dd>{t("packCount", { count: data.historical.breakdown[kind] })}</dd></div>)}
                </dl>
              </details>
            </div>
            <span className={styles.amount}>{t("packCount", { count: data.historical.availablePacks })}</span>
            {claimButton("duplicates")}
          </li> : null}
          {data.items.map(item => <li className={styles.reward} key={`${item.source}:${item.id}`}>
            <div className={styles.identity}><h2>{item.title}</h2><p>{t(item.source)}</p></div>
            <span className={styles.amount}>{t("packCount", { count: item.packs })}</span>
            {claimButton(item.source, item.id)}
          </li>)}
          {codeRows.map(item => <li className={styles.reward} key={`code:${item.id}`}>
            <div className={styles.identity}>
              <h2>{item.code}</h2>
              {item.reward.type === "card" && item.reward.card ? <details className={styles.details}>
                <summary>{item.reward.card.name}</summary>
                <div className={styles.cardPreview}><CollectibleCard card={item.reward.card} finish={item.reward.finish ?? "standard"} artVariant={item.reward.artVariant ?? "standard"} /></div>
              </details> : <p>{t("promotion")}</p>}
            </div>
            <span className={styles.amount}>{item.reward.type === "packs" ? t("packCount", { count: item.reward.packs }) : t("cardReward")}</span>
            {item.claimedAt ? <div className={styles.claimedStatus}><span>{t("codeClaimed")}</span><time dateTime={item.claimedAt}>{new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(item.claimedAt))}</time></div> : claimButton("code", item.id)}
          </li>)}
        </ul> : null}
        {available > 0 ? <p className={styles.note}>{t("storageNote")}</p> : null}
        <form className={styles.codeForm} onSubmit={event => {
          event.preventDefault();
          if (code.trim() && !claim.isPending) claim.mutate({ source: "manual", id: code.trim() });
        }}>
          <label htmlFor="reward-code">{t("enterCode")}</label>
          <div className={styles.codeControls}>
            <input id="reward-code" value={code} onChange={event => setCode(event.target.value)} autoComplete="off" maxLength={64} placeholder={t("codePlaceholder")} />
            <button className={styles.claimButton} disabled={!code.trim() || claim.isPending}>
              {t(claim.isPending && claim.variables?.source === "manual" ? "claiming" : "redeem")}
            </button>
          </div>
        </form>
        <details className={styles.help}>
          <summary>{t("duplicateHelp")}</summary>
          <p>{t("automaticRule")}</p>
        </details>
      </> : null}
    </div>
  </CcgShell>;
}
