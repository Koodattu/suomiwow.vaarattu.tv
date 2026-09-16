"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import type { SupporterModerationRow } from "@/types/ccg-studio";

export default function CcgSupporterManager() {
  const t = useTranslations("ccg.studio");
  const client = useQueryClient();
  const key = ["ccg", "supporter-moderation"];
  const query = useQuery({ queryKey: key, queryFn: () => api.getCcgSupporterModeration() });
  const mutation = useMutation({ mutationFn: (row: SupporterModerationRow) => api.updateCcgStudio(`moderation/${row._id}`,
    { editsFrozen: row.editsFrozen, distributable: row.distributable }, "PATCH"), onSuccess: () => client.invalidateQueries({ queryKey: key }) });
  return <section className="space-y-4 rounded-lg bg-gray-900 p-5 text-gray-200">
    <h3 className="text-lg font-semibold">{t("moderation.title")}</h3><p className="text-sm text-gray-400">{t("moderation.description")}</p>
    {(query.isError || mutation.isError) && <p role="alert" className="text-red-300">{t("errors.studio_unavailable")}</p>}
    {query.isLoading && <p>{t("loading")}</p>}
    {query.data?.creations.length === 0 && <p>{t("moderation.empty")}</p>}
    {query.data?.creations.map((row) => <div key={row._id} className="flex flex-wrap items-center justify-between gap-4 border-t border-gray-700 py-4">
      <strong>{row.name} <small className="text-gray-400">{row.realm}</small></strong>
      <div className="flex flex-wrap gap-5">
        <label className="flex items-center gap-2"><input type="checkbox" checked={row.editsFrozen} disabled={mutation.isPending}
          onChange={(event) => mutation.mutate({ ...row, editsFrozen: event.target.checked })} />{t("moderation.freeze")}</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={row.distributable} disabled={mutation.isPending}
          onChange={(event) => mutation.mutate({ ...row, distributable: event.target.checked })} />{t("moderation.distribute")}</label>
      </div>
    </div>)}
  </section>;
}
