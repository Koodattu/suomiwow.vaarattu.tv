"use client";

import { useState, useSyncExternalStore, type CSSProperties } from "react";
import Image from "next/image";
import { useLocale, useNow, useTranslations } from "next-intl";
import { useAuth } from "@/context/AuthContext";
import { foreverApi, ForeverApiError, ForeverWorker, type ForeverCharacter } from "@/lib/forever-api";
import styles from "./forever.module.css";

export const controlClass = styles.select;
export const buttonClass = styles.button;

// Match on names: retail/WCL class IDs are not Blizzard character class IDs.
const classColors: Record<string, string> = {
  Druid: "#FF7C0A", Hunter: "#AAD372", Mage: "#3FC7EB", Paladin: "#F48CBA", Priest: "#FFFFFF",
  Rogue: "#FFF468", Shaman: "#0070DD", Warlock: "#8788EE", Warrior: "#C69B6D",
};
// Lift Shaman blue just enough for small text on the dark board; keep the standard blue border.
export function classColor(name?: string) { return name === "Shaman" ? "#2989E6" : classColors[name || ""] || "#d5cbb5"; }
export function Portrait({ character }: { character: Pick<ForeverCharacter, "avatarUrl" | "className"> }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const knownClass = !!classColors[character.className || ""];
  const classIcon = knownClass ? `/icons/classicon_${character.className!.toLowerCase()}.jpg` : null;
  const avatar = character.avatarUrl && character.avatarUrl !== failedUrl ? character.avatarUrl : null;
  const src = avatar || classIcon;
  return <span className={styles.portrait} style={{ "--class-color": classColors[character.className || ""] || "#9e8d65" } as CSSProperties}>
    {src && <Image src={src} alt="" width={80} height={80} unoptimized onError={() => { if (avatar) setFailedUrl(avatar); }} />}
    {avatar && classIcon && <span className={styles.classBadge}><Image src={classIcon} alt="" width={18} height={18} /></span>}
  </span>;
}
export function Faction({ name }: { name?: string }) {
  const t = useTranslations("forever");
  if (name !== "Horde" && name !== "Alliance") return null;
  return <span className={styles.faction}><Image src={`/custom_components/${name.toLowerCase()}_circle.png`} width={16} height={16} alt="" />{t(`factions.${name.toLowerCase()}`)}</span>;
}

export function ForeverDate({ value, compact = false }: { value?: string | null; compact?: boolean }) {
  const locale = useLocale();
  if (!value) return <span>—</span>;
  const date = new Date(value), language = locale === "fi" ? "fi-FI" : "en-GB";
  return <time dateTime={value} title={date.toLocaleString(language)}>{date.toLocaleString(language, compact ? { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" } : { dateStyle: "short", timeStyle: "short" })}</time>;
}
export function ForeverErrorMessage({ error }: { error: unknown }) {
  const t = useTranslations("forever");
  const code = error instanceof ForeverApiError ? error.code : "unavailable";
  const key = ["invalid_url", "rate_limited", "login_required", "not_found"].includes(code) ? code : "unavailable";
  return <p role="alert" className="rounded-lg border border-red-800 bg-red-950/40 p-3 text-sm text-red-200">{t(`errors.${key}`)}</p>;
}
export function WorkerStatus({ worker, enabled }: { worker: ForeverWorker | null; enabled: boolean }) {
  const t = useTranslations("forever");
  return <div className="flex flex-wrap gap-x-6 gap-y-2 py-2 text-xs text-stone-400">
    <span>{!enabled ? t("workerPaused") : !worker?.lastTickAt ? t("workerWaiting") : t("workerLastSeen")} {enabled && <ForeverDate value={worker?.lastTickAt} />}</span>
    {worker?.errorCode && <span className="text-amber-200">{t("retryNotice")} <ForeverDate value={worker.nextRequestAt} /></span>}
  </div>;
}
export function UpdateStatus({ worker, enabled }: { worker: ForeverWorker | null; enabled: boolean }) {
  const t = useTranslations("forever");
  const now = useNow({ updateInterval: 60_000 });
  const stale = !worker?.lastTickAt || now.getTime() - Date.parse(worker.lastTickAt) > 120_000;
  const paused = !enabled || !!worker?.errorCode || stale;
  return <span className={`${styles.live} ${paused ? styles.paused : ""}`}>
    {t(!enabled ? "updatesPaused" : worker?.errorCode ? "updatesDelayed" : stale ? "updatesWaiting" : "updatesAutomatic")}
  </span>;
}

const wideSnapshot = () => window.matchMedia("(min-width: 801px)").matches;
function subscribeWidth(callback: () => void) {
  const media = window.matchMedia("(min-width: 801px)");
  media.addEventListener("change", callback); return () => media.removeEventListener("change", callback);
}
export function CharacterForm({ admin = false, onAdded }: { admin?: boolean; onAdded?: () => void }) {
  const t = useTranslations("forever"), { user, login, isLoading } = useAuth();
  const [url, setUrl] = useState(""), [busy, setBusy] = useState(false), [success, setSuccess] = useState(false), [error, setError] = useState<unknown>(null);
  const wide = useSyncExternalStore(subscribeWidth, wideSnapshot, () => false);
  const [expanded, setExpanded] = useState<boolean | null>(null);
  const open = expanded ?? (admin || wide);
  return <details className={styles.form} open={open}>
    <summary onClick={(event) => { event.preventDefault(); setExpanded(!open); }}>{t(admin ? "addTitle" : "proposeTitle")}</summary>
    <div className={styles.formContents}>
    {!admin && <p className={styles.formHelp}>{t("proposeDescription")}</p>}
    {!user ? <button className={buttonClass} disabled={isLoading} onClick={() => void login("/forever/leveling").catch(setError)}>{t("login")}</button> :
      <form onSubmit={async (event) => {
        event.preventDefault(); setBusy(true); setError(null); setSuccess(false);
        try { await foreverApi(admin ? "admin/forever/characters" : "forever/proposals", "POST", { url }); setSuccess(true); setUrl(""); onAdded?.(); }
        catch (caught) { setError(caught); } finally { setBusy(false); }
      }}>
        <label htmlFor={admin ? "forever-add-url" : "forever-propose-url"}>{t("armoryUrl")}</label>
        <div className={styles.formFields}>
          <input id={admin ? "forever-add-url" : "forever-propose-url"} type="url" required maxLength={500} value={url} onChange={(event) => { setUrl(event.target.value); setSuccess(false); }} className={styles.input} placeholder="https://worldofwarcraft.blizzard.com/…" />
          <button disabled={busy} className={buttonClass}>{t(busy ? "sending" : admin ? "add" : "propose")}</button>
        </div>
      </form>}
    {success && <p role="status" className={styles.formSuccess}>{t(admin ? "added" : "proposed")}</p>}
    {error != null && <div className="mt-3"><ForeverErrorMessage error={error} /></div>}
    </div>
  </details>;
}
