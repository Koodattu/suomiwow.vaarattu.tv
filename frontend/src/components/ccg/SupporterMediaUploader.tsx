"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { FaLock } from "react-icons/fa6";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { api, ApiError } from "@/lib/api";
import { isWebmArtwork } from "@/lib/ccg";
import type { StudioCreation, SupporterMedia } from "@/types/ccg-studio";
import styles from "./studio.module.css";

export function SupporterMediaPreview({ media }: { media: SupporterMedia }) {
  const t = useTranslations("ccg.studio.media");
  if (!media.url) return null;
  if (media.kind === "image" && isWebmArtwork(media.url)) return <video controls autoPlay loop muted playsInline src={media.url} aria-label={t("preview")} style={{ width: 240, height: 280, objectFit: "contain", maxWidth: "100%", background: "#292934" }} />;
  return media.kind === "image"
    ? <Image src={media.url} alt={t("preview")} width={240} height={280} unoptimized style={{ objectFit: "contain", maxWidth: "100%", background: "#292934" }} />
    : <audio controls preload="none" src={media.url} aria-label={t("audio")} style={{ maxWidth: "100%" }} />;
}

export default function SupporterMediaUploader({ source, media, disabled, onPreview, onSelectionChange }: { source: StudioCreation; media: SupporterMedia[]; disabled: boolean; onPreview: (url: string | null) => void; onSelectionChange: (selected: boolean) => void }) {
  const t = useTranslations("ccg.studio");
  const client = useQueryClient();
  const [files, setFiles] = useState<Partial<Record<"image" | "audio", File>>>({});
  const [fileKeys, setFileKeys] = useState({ image: 0, audio: 0 });
  const [error, setError] = useState<string | null>(null);
  const [confirmRemoval, setConfirmRemoval] = useState<string | null>(null);
  const [showAlternative, setShowAlternative] = useState(true);
  const [localImage, setLocalImage] = useState<string | null>(null);
  const imageFile = files.image;
  const hasFiles = Boolean(files.image || files.audio);
  useEffect(() => { onSelectionChange(hasFiles); }, [hasFiles, onSelectionChange]);
  useEffect(() => () => { if (localImage) URL.revokeObjectURL(localImage.split("#")[0]); }, [localImage]);
  const imageRows = media.filter((row) => row.sourceId === source.id && row.kind === "image");
  const imageUrl = imageFile ? localImage : imageRows.find((row) => row.status === "pending")?.url ?? imageRows.find((row) => row.status === "approved")?.url ?? null;
  useEffect(() => { onPreview(showAlternative ? imageUrl : null); }, [imageUrl, showAlternative, onPreview]);
  const locked = !source.cardId || disabled;
  const clearFile = (kind: "image" | "audio") => {
    setFiles((previous) => ({ ...previous, [kind]: undefined }));
    if (kind === "image") setLocalImage(null);
    setFileKeys((previous) => ({ ...previous, [kind]: previous[kind] + 1 }));
    setError(null);
  };
  const mutation = useMutation({
    mutationFn: ({ kind, file, withdrawId }: { kind?: "image" | "audio"; file?: File; withdrawId?: string }) => withdrawId
      ? api.updateCcgStudio(`media/${withdrawId}`, {}, "DELETE")
      : api.uploadSupporterMedia(source.id, kind!, file!),
    onSuccess: async (_data, input) => {
      setError(null);
      setConfirmRemoval(null);
      if (input.kind) clearFile(input.kind);
      await client.invalidateQueries({ queryKey: ["ccg"] });
    },
    onError: (failure) => setError(failure instanceof ApiError && failure.code ? failure.code : "media_upload_failed"),
  });
  const submit = (kind: "image" | "audio") => {
    const file = files[kind];
    if (!file) return;
    if (file.size > (kind === "image" ? 5 : 8) * 1024 * 1024) { setError(kind === "image" ? "media_image_size" : "media_audio_size"); return; }
    mutation.mutate({ kind, file });
  };
  return <aside className={`${styles.panel} ${styles.mediaPanel}`} data-locked={locked} aria-label={t("media.title")}>
    <div className={styles.mediaHeading}><h2>{locked && <FaLock aria-hidden="true" />} {t("media.title")}</h2><small>{t("media.optional")}</small></div>
    <p>{t(!source.cardId ? "media.publishFirst" : disabled ? "media.unavailable" : "media.description")}</p>
    {error && <p role="alert">{t(t.has(`errors.${error}`) ? `errors.${error}` : "errors.media_upload_failed")}</p>}
    <div className={styles.mediaGrid}>
    {(["image", "audio"] as const).map((kind) => {
      const rows = media.filter((row) => row.sourceId === source.id && row.kind === kind);
      const pending = rows.find((row) => row.status === "pending" || row.status === "processing");
      const approved = rows.find((row) => row.status === "approved");
      const latest = rows[0];
      return <div key={kind} className={styles.media}>
        <div className={styles.mediaHeading}><h3>{t(`media.${kind}`)}</h3>{approved && <span className={styles.badge} data-tone="success">{t("media.status.approved")}</span>}</div><p>{t(`media.${kind}Limits`)}</p>
        {kind === "image" && imageUrl && <label className={styles.previewToggle}><input type="checkbox" checked={showAlternative} onChange={(event) => setShowAlternative(event.target.checked)} />{t("media.showAlternative")}</label>}
        {approved && <>
          {kind === "audio" && <SupporterMediaPreview media={approved} />}
          {confirmRemoval === approved.id ? <div className={styles.confirm}>
            <p>{t(`media.confirmRemove.${kind}`)}</p>
            {pending && <p>{t("media.pendingUnaffected")}</p>}
            <div className={styles.actions}>
              <button disabled={mutation.isPending} onClick={() => mutation.mutate({ withdrawId: approved.id })}>{t(`media.remove.${kind}`)}</button>
              <button disabled={mutation.isPending} onClick={() => setConfirmRemoval(null)}>{t("cancel")}</button>
            </div>
          </div> : <button disabled={mutation.isPending} onClick={() => setConfirmRemoval(approved.id)}>{t(`media.remove.${kind}`)}</button>}
        </>}
        {pending ? <><p role="status">{t(`media.status.${pending.status}`)}</p>{kind === "audio" && <SupporterMediaPreview media={pending} />}
          {pending.status === "pending" && <button disabled={mutation.isPending} onClick={() => mutation.mutate({ withdrawId: pending.id })}>{t("media.withdraw")}</button>}</>
          : <>
            {latest && latest.status !== "approved" && <p>{t(`media.status.${latest.status}`)}{latest.reason && `: ${latest.status === "failed" ? t(t.has(`errors.${latest.reason}`) ? `errors.${latest.reason}` : "errors.media_upload_failed") : latest.reason}`}</p>}
            <label>{t(`media.${kind}`)}<input key={`${kind}:${fileKeys[kind]}`} type="file" accept={kind === "image" ? "image/png,image/webp,image/gif,.gif,image/avif,image/avif-sequence,.avif,.avifs,video/webm,.webm" : "audio/*,.m4a,.mp4,.webm,.flac,.aiff,.wma"}
              disabled={locked || mutation.isPending} onChange={(event) => {
                const file = event.target.files?.[0];
                const webm = file && (file.type === "video/webm" || isWebmArtwork(file.name));
                const gif = file && (file.type === "image/gif" || /\.gif$/i.test(file.name));
                const avif = file && (["image/avif", "image/avif-sequence"].includes(file.type) || /\.avifs?$/i.test(file.name));
                if (file && (file.size > (kind === "image" ? 5 : 8) * 1024 * 1024 || (kind === "image" && !["image/png", "image/webp"].includes(file.type) && !webm && !gif && !avif))) {
                  setError(kind === "image" ? file.size > 5 * 1024 * 1024 ? "media_image_size" : "media_image_format" : "media_audio_size");
                  setFiles((previous) => ({ ...previous, [kind]: undefined }));
                  if (kind === "image") setLocalImage(null);
                  event.target.value = ""; return;
                }
                setError(null); setFiles((previous) => ({ ...previous, [kind]: file }));
                if (kind === "image") { setLocalImage(file ? `${URL.createObjectURL(file)}${webm ? "#art.webm" : ""}` : null); setShowAlternative(true); }
              }} /></label>
            <div className={styles.actions}>
              <button disabled={locked || mutation.isPending || !files[kind]} onClick={() => submit(kind)}>{t(mutation.isPending && mutation.variables.kind === kind ? "media.uploading" : "media.submit")}</button>
              {files[kind] && <button disabled={mutation.isPending} onClick={() => clearFile(kind)}>{t("media.clearSelection")}</button>}
            </div>
          </>}
      </div>;
    })}
    </div>
  </aside>;
}
