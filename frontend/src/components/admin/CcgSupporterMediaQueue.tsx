"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import type { SupporterMedia } from "@/types/ccg-studio";
import { SupporterMediaPreview } from "@/components/ccg/SupporterMediaUploader";

function Review({ media }: { media: SupporterMedia }) {
  const t = useTranslations("ccg.studio.media");
  const [reason, setReason] = useState("");
  const client = useQueryClient();
  const mutation = useMutation({ mutationFn: (action: "approve" | "reject" | "revoke") => api.reviewSupporterMedia(media.id, action, reason),
    onSuccess: () => client.invalidateQueries({ queryKey: ["ccg"] }) });
  return <div className="space-y-3">
    <p>{t(media.kind)} · {t(`status.${media.status}`)}</p><SupporterMediaPreview media={media} />
    {media.aiReview && <div className="rounded border border-gray-700 p-3 text-sm">
      <p>{t(media.aiReview.autoApproved ? "aiApproved" : "aiReviewed")} · {media.aiReview.model}</p>
      {media.aiReview.safetyConfidence !== null && <p>{t("aiConfidence", { score: media.aiReview.safetyConfidence })}</p>}
      <p>{media.aiReview.decision === "error" ? t("aiUnavailable") : media.aiReview.reason}</p>
    </div>}
    <label className="block">{t("reason")}<textarea maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} className="mt-1 block w-full rounded bg-gray-950 p-2" /></label>
    <div className="flex gap-3">
      {media.status === "pending" && <button disabled={mutation.isPending} onClick={() => mutation.mutate("approve")} className="rounded bg-green-800 px-4 py-2 disabled:opacity-50">{t("approve")}</button>}
      <button disabled={mutation.isPending || !reason.trim()} onClick={() => mutation.mutate(media.status === "approved" ? "revoke" : "reject")} className="rounded bg-red-900 px-4 py-2 disabled:opacity-50">{t(media.status === "approved" ? "revoke" : "reject")}</button>
    </div>{mutation.isError && <p role="alert">{t("reviewError")}</p>}
  </div>;
}

export default function CcgSupporterMediaQueue() {
  const t = useTranslations("ccg.studio.media");
  const query = useQuery({ queryKey: ["ccg", "supporter-media-review"], queryFn: () => api.getSupporterMediaQueue(), refetchInterval: 60_000 });
  const [showApproved, setShowApproved] = useState(false);
  const rows = query.data?.submissions.filter((row) => row.status === (showApproved ? "approved" : "pending")) ?? [];
  return <section className="space-y-4 rounded-lg bg-gray-900 p-5 text-gray-200">
    <h3 className="text-lg font-semibold">{t("queue")}</h3><p>{t("reviewDescription")}</p>
    <label className="flex gap-2"><input type="checkbox" checked={showApproved} onChange={(event) => setShowApproved(event.target.checked)} />{t("showApproved")}</label>
    {query.isLoading && <p>{t("loading")}</p>}{query.isError && <p role="alert">{t("reviewError")}</p>}
    {!query.isLoading && rows.length === 0 && <p>{t("empty")}</p>}
    {rows.map((row) => { const source = query.data?.sources.find((entry) => entry._id === row.sourceId); return <article key={row.id} className="space-y-3 border-t border-gray-700 py-4">
      <h4>{source?.name} · {source?.realm}</h4><Review media={row} />
    </article>; })}
  </section>;
}
