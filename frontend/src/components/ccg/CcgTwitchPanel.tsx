"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { FaTwitch } from "react-icons/fa";
import { FaArrowUpRightFromSquare } from "react-icons/fa6";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { useLiveStreamers } from "@/lib/queries";
import styles from "./ccg.module.css";

const TWITCH_CHANNEL = "vaarattu";

export default function CcgTwitchPanel() {
  const t = useTranslations("ccg.landing.twitch");
  const { user, isLoading: authLoading, login } = useAuth();
  const [connecting, setConnecting] = useState(false);
  const [connectFailed, setConnectFailed] = useState(false);
  const profileQuery = useQuery({
    queryKey: ["auth", "profile"],
    queryFn: () => api.getProfile(),
    enabled: Boolean(user) && !authLoading,
    staleTime: 5 * 60 * 1000,
  });
  const liveStreamersQuery = useLiveStreamers();
  const twitchAccount = profileQuery.data?.twitch;
  const isLive = liveStreamersQuery.data?.some(
    (streamer) => streamer.channelName.toLowerCase() === TWITCH_CHANNEL,
  ) ?? false;
  const isCheckingConnection = authLoading || (Boolean(user) && profileQuery.isPending);

  const connectTwitch = async () => {
    if (connecting) return;
    setConnecting(true);
    setConnectFailed(false);
    try {
      const { url } = await api.getTwitchConnectUrl();
      window.location.href = url;
    } catch (error) {
      console.error("Failed to get Twitch connect URL:", error);
      setConnectFailed(true);
      setConnecting(false);
    }
  };

  return (
    <section className={styles.vaultTwitchPanel} aria-labelledby="ccg-vault-twitch-title">
      <div className={styles.vaultTwitchCopy}>
        <h2 id="ccg-vault-twitch-title"><FaTwitch aria-hidden="true" /> {t("title")}</h2>
        {isCheckingConnection ? (
          <span className={styles.vaultTwitchConnectionSkeleton} aria-label={t("checkingConnection")} />
        ) : (
          <p>{twitchAccount ? t("connectedAs", { name: twitchAccount.displayName }) : t("notConnected")}</p>
        )}
        <span className={styles.vaultTwitchLiveStatus} data-live={isLive}>
          <span aria-hidden="true" />
          {isLive ? t("live") : t("offline")}
        </span>
      </div>

      <div className={styles.vaultTwitchActions}>
        {!isCheckingConnection && !twitchAccount ? (
          user ? (
            <button
              type="button"
              className={`${styles.secondaryButton} ${styles.vaultTwitchAction}`}
              onClick={() => void connectTwitch()}
              disabled={connecting}
            >
              {connecting ? t("connecting") : t("connect")}
            </button>
          ) : (
            <button
              type="button"
              className={`${styles.secondaryButton} ${styles.vaultTwitchAction}`}
              onClick={() => void login("/fun/ccg")}
            >
              {t("login")}
            </button>
          )
        ) : null}
        {twitchAccount ? (
          <a
            href={`https://www.twitch.tv/${TWITCH_CHANNEL}`}
            target="_blank"
            rel="noopener noreferrer"
            className={`${styles.primaryButton} ${styles.vaultTwitchAction} ${styles.vaultTwitchCta}`}
          >
            {t("redeemPacks")}
            <FaArrowUpRightFromSquare aria-hidden="true" />
          </a>
        ) : null}
      </div>

      {connectFailed ? <p className={styles.vaultTwitchError} role="alert">{t("connectError")}</p> : null}
    </section>
  );
}
