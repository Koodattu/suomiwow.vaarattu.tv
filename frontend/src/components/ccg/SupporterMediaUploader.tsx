"use client";

import Image from "next/image";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { api, ApiError } from "@/lib/api";
import type { StudioCreation, SupporterMedia } from "@/types/ccg-studio";
import styles from "./studio.module.css";

export function SupporterMediaPreview({ media }: { media: SupporterMedia }) {
  const t = useTranslations("ccg.studio.media");
  if (!media.url) return null;
  return media.kind === "image"
    ? <Image src={media.url} alt={t("preview")} width={240} height={280} unoptimized style={{ objectFit: "contain", maxWidth: "100%", background: "#292934" }} />
    : <audio controls preload="none" src={media.url} aria-label={t("audio")} style={{ maxWidth: "100%" }} />;
}

export default function SupporterMediaUploader({ source, media, disabled }: { source: StudioCreation; media: SupporterMedia[]; disabled: boolean }) {
  const t = useTranslations("ccg.studio");
  const client = useQueryClient();
  const [files, setFiles] = useState<Partial<Record<"image" | "audio", File>>>({});
  const [fileKey, setFileKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: ({ kind, file, withdrawId }: { kind?: "image" | "audio"; file?: File; withdrawId?: string }) => withdrawId
      ? api.updateCcgStudio(`media/${withdrawId}`, {}, "DELETE")
      : api.uploadSupporterMedia(source.id, kind!, file!),
    onSuccess: async () => { setError(null); setFiles({}); setFileKey((key) => key + 1); await client.invalidateQueries({ queryKey: ["ccg", "studio"] }); },
    onError: (failure) => setError(failure instanceof ApiError && failure.code ? failure.code : "media_upload_failed"),
  });
  const submit = (kind: "image" | "audio") => {
    const file = files[kind];
    if (!file) return;
    if (file.size > (kind === "image" ? 5 : 8) * 1024 * 1024) { setError(kind === "image" ? "media_image_size" : "media_audio_size"); return; }
    mutation.mutate({ kind, file });
  };
  return <section className={styles.panel}>
    <h2>{t("media.title")}</h2><p>{t("media.description")}</p>
    {error && <p role="alert">{t(t.has(`errors.${error}`) ? `errors.${error}` : "errors.media_upload_failed")}</p>}
    {(["image", "audio"] as const).map((kind) => {
      const rows = media.filter((row) => row.sourceId === source.id && row.kind === kind);
      const pending = rows.find((row) => row.status === "pending" || row.status === "processing");
      const approved = rows.find((row) => row.status === "approved");
      const latest = rows[0];
      return <div key={kind} className={styles.media}>
        <h3>{t(`media.${kind}`)}</h3><p>{t(`media.${kind}Limits`)}</p>
        {approved && <><p>{t("media.status.approved")}</p><SupporterMediaPreview media={approved} /></>}
        {pending ? <><p role="status">{t(`media.status.${pending.status}`)}</p><SupporterMediaPreview media={pending} />
          {pending.status === "pending" && <button disabled={mutation.isPending} onClick={() => mutation.mutate({ withdrawId: pending.id })}>{t("media.withdraw")}</button>}</>
          : <>
            {latest && latest.status !== "approved" && <p>{t(`media.status.${latest.status}`)}{latest.reason && `: ${latest.status === "failed" ? t(t.has(`errors.${latest.reason}`) ? `errors.${latest.reason}` : "errors.media_upload_failed") : latest.reason}`}</p>}
            <label>{t(`media.${kind}`)}<input key={`${kind}:${fileKey}`} type="file" accept={kind === "image" ? "image/png,image/webp" : "audio/*,.m4a,.mp4,.webm,.flac,.aiff,.wma"}
              disabled={disabled || mutation.isPending} onChange={(event) => setFiles((previous) => ({ ...previous, [kind]: event.target.files?.[0] }))} /></label>
            <button disabled={disabled || mutation.isPending || !files[kind]} onClick={() => submit(kind)}>{t(mutation.isPending ? "media.uploading" : "media.submit")}</button>
          </>}
      </div>;
    })}
  </section>;
}
