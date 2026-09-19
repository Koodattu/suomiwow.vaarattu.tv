"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { FaTwitch, FaXmark } from "react-icons/fa6";
import type { StudioState } from "@/types/ccg-studio";
import styles from "./studio.module.css";

export type StudioAccountPanel = "battlenet" | "twitch" | "rules";
export type StudioFeedback = { path: string; message: string; error?: boolean; characterKey?: string };

export default function StudioAccounts({ panel, data, busy, connecting, action, feedback, connect, run, close }: {
  panel: StudioAccountPanel; data: StudioState; busy: boolean; connecting: boolean; action: string | null;
  feedback: StudioFeedback | null; connect: (provider: "battlenet" | "twitch") => void;
  run: (path: string) => Promise<unknown>; close: () => void;
}) {
  const t = useTranslations("ccg.studio");
  const locale = useLocale();
  const ref = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
    ref.current?.scrollIntoView({ block: "nearest" });
  }, [panel]);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  const statusText = (value: boolean | null) => t(value === null ? "unknown" : value ? "yes" : "no");
  const errorText = (code: string) => t(t.has(`errors.${code}`) ? `errors.${code}` : "errors.studio_unavailable");
  const relevant = feedback && (panel === "battlenet" ? ["battlenet", "roster"] : ["twitch", "status"]).includes(feedback.path);
  return <div id="studio-accounts" ref={ref} tabIndex={-1} className={styles.accountPanel}>
    <button className={styles.closePanel} aria-label={t("closePanel")} onClick={close}><FaXmark /></button>
    {panel === "battlenet" ? <>
      <h2>Battle.net <small>EU · {t(data.battlenetConnected ? "connected" : "notConnected")}</small></h2>
      <p>{t("bnetRequired")}</p>
      {data.rosterError && <p className={styles.inlineError} role="alert">{errorText(data.rosterError)}</p>}
      <div className={styles.actions}><button disabled={connecting || busy} onClick={() => connect("battlenet")}>{t(data.battlenetConnected ? "reconnect" : "connectBnet")}</button>
        {data.battlenetConnected && <button disabled={busy} onClick={() => void run("roster")}>{t(action === "roster" ? "refreshing" : "refreshCharacters")}</button>}</div>
    </> : panel === "twitch" ? <>
      <h2><FaTwitch aria-hidden="true" /> Twitch <small>vaarattu</small></h2><p>{t("twitchOptional")}</p>
      {data.twitchConnected && <p>{t("following", { status: statusText(data.status.following) })} · {t("subscribed", { status: statusText(data.status.subscribed) })}</p>}
      {data.status.checkedAt && <small>{t("checked", { date: new Date(data.status.checkedAt).toLocaleString(locale) })}</small>}
      {data.status.error && <p className={styles.inlineError} role="alert">{errorText(data.status.error)}</p>}
      <div className={styles.actions}><button disabled={connecting || busy} onClick={() => connect("twitch")}>{t(data.twitchConnected ? "reconnect" : "connectTwitch")}</button>
        <a href="https://www.twitch.tv/vaarattu" target="_blank" rel="noopener noreferrer">{t("visitChannel")}</a>
        {data.twitchConnected && <button disabled={busy || Date.parse(data.status.nextManualCheckAt) > now} onClick={() => void run("status")}>{t(action === "status" ? "checking" : "refreshStatus")}</button>}</div>
      {data.twitchConnected && Date.parse(data.status.nextManualCheckAt) > now && <p className={styles.hint}>{t("statusCooldown", { date: new Date(data.status.nextManualCheckAt).toLocaleTimeString(locale) })}</p>}
      <p>{t("subscriptionUnlock")}</p><p>{t("permanent")}</p>
    </> : <><h2>{t("slotRules")}</h2><p>{t("allowanceRules")}</p><p>{t("permanent")}</p><p>{t("draftExplanation")}</p><p>{t("confirmPublish")}</p></>}
    {relevant && <p role={feedback.error ? "alert" : "status"} className={feedback.error ? styles.inlineError : styles.success}>{feedback.message}</p>}
  </div>;
}
