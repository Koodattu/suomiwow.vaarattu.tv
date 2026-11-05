"use client";

import { useState, type CSSProperties } from "react";
import Image from "next/image";
import { useNow, useTranslations } from "next-intl";
import { useAuth } from "@/context/AuthContext";
import { foreverApi, foreverUpdateAge, formatForeverDate, ForeverApiError, ForeverWorker, isForeverStreamLive, type ForeverCharacter } from "@/lib/forever-api";
import styles from "./forever.module.css";

export const controlClass = styles.select;
export const buttonClass = styles.button;

export function StreamerLink({ character }: { character: ForeverCharacter }) {
  const t = useTranslations("forever"), now = useNow({ updateInterval: 30_000 });
  if (!character.twitchChannel) return null;
  const live = isForeverStreamLive(character, now.getTime());
  return <a className={`${styles.streamer} ${live ? styles.streamerLive : ""}`} href={`https://www.twitch.tv/${encodeURIComponent(character.twitchChannel)}`} target="_blank" rel="noreferrer"
    aria-label={t(live ? "watchLive" : "openTwitch", { channel: character.twitchChannel })}>
    <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M4 2 1 6v15h5v3l4-3h4l8-8V2H4zm16 10-4 4h-4l-3 3v-3H5V4h15v8zm-5-5h2v5h-2V7zm-5 0h2v5h-2V7z" /></svg>
    {live && <strong>{t("live")}</strong>}<span>{character.twitchChannel}</span><span aria-hidden="true">↗</span>
  </a>;
}

export function TwitchEditor({ character, onSaved }: { character: ForeverCharacter; onSaved: () => void }) {
  const t = useTranslations("forever");
  const [value, setValue] = useState(character.twitchChannel || ""), [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null);
  return <details className={styles.twitchEditor}><summary>{t("editTwitch")}</summary><form onSubmit={async (event) => {
    event.preventDefault(); setBusy(true); setError(null);
    try { await foreverApi(`admin/forever/characters/${character._id}/twitch`, "PATCH", { twitchChannel: value }); onSaved(); }
    catch (caught) { setError(caught); } finally { setBusy(false); }
  }}>
    <label htmlFor={`twitch-${character._id}`}>{t("twitchChannel")}</label>
    <div className={styles.formFields}><input id={`twitch-${character._id}`} className={styles.input} value={value} maxLength={100} onChange={(event) => setValue(event.target.value)} placeholder="twitch.tv/…" /><button className={styles.button} disabled={busy}>{t(busy ? "sending" : "save")}</button></div>
    <p>{t("clearTwitch")}</p>{error != null && <ForeverErrorMessage error={error} />}
  </form></details>;
}

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
  if (!value) return <span>—</span>;
  return <time dateTime={value} title={formatForeverDate(value)}>{formatForeverDate(value, compact)}</time>;
}
export function ForeverUpdated({ value }: { value?: string | null }) {
  const t = useTranslations("forever"), now = useNow({ updateInterval: 30_000 });
  const age = foreverUpdateAge(value, now.getTime());
  if (!age || !value) return <span>—</span>;
  return <time dateTime={value} title={formatForeverDate(value)}>{t(`timeAgo.${age.unit}`, { count: age.count })}</time>;
}
export function ForeverErrorMessage({ error }: { error: unknown }) {
  const t = useTranslations("forever");
  const code = error instanceof ForeverApiError ? error.code : "unavailable";
  const key = ["invalid_url", "invalid_twitch", "rate_limited", "login_required", "not_found"].includes(code) ? code : "unavailable";
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

export function CharacterForm({ admin = false, compact = false, onAdded }: { admin?: boolean; compact?: boolean; onAdded?: () => void }) {
  const t = useTranslations("forever"), { user, login, isLoading } = useAuth();
  const [url, setUrl] = useState(""), [busy, setBusy] = useState(false), [success, setSuccess] = useState(false), [error, setError] = useState<unknown>(null);
  const [twitchChannel, setTwitchChannel] = useState("");
  const content = <div className={styles.formContents}>
    {!user ? <button className={buttonClass} disabled={isLoading} onClick={() => void login("/forever/leveling").catch(setError)}>{t("login")}</button> :
      <form onSubmit={async (event) => {
        event.preventDefault(); setBusy(true); setError(null); setSuccess(false);
        try { await foreverApi(admin ? "admin/forever/characters" : "forever/proposals", "POST", { url, ...(admin && twitchChannel.trim() ? { twitchChannel } : {}) }); setSuccess(true); setUrl(""); setTwitchChannel(""); onAdded?.(); }
        catch (caught) { setError(caught); } finally { setBusy(false); }
      }}>
        <label className={compact ? "sr-only" : undefined} htmlFor={admin ? "forever-add-url" : "forever-propose-url"}>{t("armoryUrl")}</label>
        <div className={styles.formFields}>
          <input id={admin ? "forever-add-url" : "forever-propose-url"} type="url" required maxLength={500} value={url} onChange={(event) => { setUrl(event.target.value); setSuccess(false); }} className={styles.input} placeholder={compact ? t("armoryUrl") : "https://worldofwarcraft.blizzard.com/…"} />
          <button disabled={busy} className={buttonClass}>{t(busy ? "sending" : admin ? "add" : compact ? "send" : "propose")}</button>
        </div>
        {admin && <div className={styles.optionalTwitch}><label htmlFor="forever-add-twitch">{t("twitchChannel")}</label><input id="forever-add-twitch" className={styles.input} value={twitchChannel} maxLength={100} onChange={(event) => setTwitchChannel(event.target.value)} placeholder="twitch.tv/…" /></div>}
      </form>}
    {success && <p role="status" className={styles.formSuccess}>{t(admin ? "added" : "proposed")}</p>}
    {error != null && <div className="mt-3"><ForeverErrorMessage error={error} /></div>}
    </div>;
  if (compact) return <section className={styles.compactForm} aria-label={t("proposeTitle")}><h2>{t("proposeTitle")}</h2>{content}</section>;
  return <details className={styles.form} open><summary>{t(admin ? "addTitle" : "proposeTitle")}</summary>{content}</details>;
}
