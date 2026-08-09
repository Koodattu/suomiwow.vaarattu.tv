"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import ReporterArticleBody from "@/features/reporter/ReporterArticleBody";
import { api } from "@/lib/api";
import type { ReporterPost, ReporterSettingsUpdate, ReporterStatusResponse } from "@/types";

type ReporterSettingKey = keyof ReporterSettingsUpdate;

export default function ReporterAdminPanel() {
  const t = useTranslations("admin.reporter");
  const locale = useLocale();
  const [status, setStatus] = useState<ReporterStatusResponse | null>(null);
  const [posts, setPosts] = useState<ReporterPost[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [language, setLanguage] = useState<"en" | "fi">("en");
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [savingSetting, setSavingSetting] = useState<ReporterSettingKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }), [locale]);
  const numberFormatter = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const selectedPost = posts.find((post) => post.id === selectedId) || posts[0] || null;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [statusResult, postsResult] = await Promise.all([api.getAdminReporterStatus(), api.getAdminReporterPosts()]);
      setStatus(statusResult);
      setPosts(postsResult.posts);
      setSelectedId((current) => (current && postsResult.posts.some((post) => post.id === current) ? current : postsResult.posts[0]?.id || null));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("loadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const generate = async () => {
    setGenerating(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.generateAdminReporterPost();
      setSelectedId(result.post.id);
      setNotice(t("generated"));
      await load();
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : t("generationError"));
    } finally {
      setGenerating(false);
    }
  };

  const togglePublished = async () => {
    if (!selectedPost) return;
    setUpdatingStatus(true);
    setError(null);
    setNotice(null);
    try {
      const nextStatus = selectedPost.status === "published" ? "draft" : "published";
      await api.updateAdminReporterPostStatus(selectedPost.id, nextStatus);
      setNotice(nextStatus === "published" ? t("publishedNotice") : t("draftNotice"));
      await load();
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : t("statusError"));
    } finally {
      setUpdatingStatus(false);
    }
  };

  const saveSetting = async (key: ReporterSettingKey, value: boolean) => {
    setSavingSetting(key);
    setError(null);
    setNotice(null);
    try {
      const result = await api.updateAdminReporterSettings({ [key]: value });
      setStatus((current) => current ? {
        ...current,
        config: {
          ...current.config,
          featureEnabled: result.settings.featureEnabled,
          automationEnabled: result.settings.automationEnabled,
          autoPublish: result.settings.autoPublish,
          settingsUpdatedAt: result.settings.updatedAt,
        },
      } : current);
      setNotice(t("settingsSaved"));
    } catch (settingsError) {
      setError(settingsError instanceof Error ? settingsError.message : t("settingsError"));
    } finally {
      setSavingSetting(null);
    }
  };

  if (loading && !status) return <div className="rounded-xl bg-gray-800 p-8 text-center text-gray-300">{t("loading")}</div>;

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-amber-500/20 bg-gray-900/80 p-5 shadow-lg shadow-black/20">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-400">{t("eyebrow")}</p>
            <h2 className="mt-2 text-2xl font-bold text-white">{t("title")}</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-400">{t("description")}</p>
          </div>
          <button
            type="button"
            onClick={() => void generate()}
            disabled={generating || status?.generationRunning || !status?.config.featureEnabled || !status?.config.apiKeyConfigured}
            className="min-h-11 rounded-lg bg-amber-600 px-4 py-2 font-bold text-white transition-[scale,background-color] duration-150 ease-out hover:bg-amber-500 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {generating || status?.generationRunning ? t("generating") : t("generate")}
          </button>
        </div>

        {status && (
          <div className="mt-5 grid gap-3 lg:grid-cols-3">
            <SettingToggle
              label={t("featureToggle")}
              description={t("featureToggleDescription")}
              checked={status.config.featureEnabled}
              saving={savingSetting === "featureEnabled"}
              disabled={savingSetting !== null}
              tone="emerald"
              onToggle={(value) => void saveSetting("featureEnabled", value)}
            />
            <SettingToggle
              label={t("automationToggle")}
              description={t("automationToggleDescription")}
              checked={status.config.automationEnabled}
              saving={savingSetting === "automationEnabled"}
              disabled={savingSetting !== null}
              tone="blue"
              onToggle={(value) => void saveSetting("automationEnabled", value)}
            />
            <SettingToggle
              label={t("autoPublishToggle")}
              description={t("autoPublishToggleDescription")}
              checked={status.config.autoPublish}
              saving={savingSetting === "autoPublish"}
              disabled={savingSetting !== null}
              tone="amber"
              onToggle={(value) => void saveSetting("autoPublish", value)}
            />
          </div>
        )}

        {status && (
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Metric label={t("model")} value={`${status.config.model} · ${status.config.reasoningEffort}`} />
            <Metric label={t("drafts")} value={numberFormatter.format(status.posts.drafts)} />
            <Metric label={t("inputTokens")} value={numberFormatter.format(status.usage.inputTokens)} />
            <Metric label={t("outputTokens")} value={numberFormatter.format(status.usage.outputTokens)} />
            <Metric label={t("estimatedCost")} value={`$${status.usage.estimatedCostUsd.toFixed(6)}`} />
          </div>
        )}

        {status && (!status.config.featureEnabled || !status.config.apiKeyConfigured) && (
          <p className="mt-4 rounded-lg border border-amber-600/40 bg-amber-950/40 px-4 py-3 text-sm text-amber-200">
            {!status.config.featureEnabled ? t("featureDisabled") : t("missingKey")}
          </p>
        )}
        {error && <p className="mt-4 rounded-lg border border-red-500/40 bg-red-950/40 px-4 py-3 text-sm text-red-200">{error}</p>}
        {notice && <p className="mt-4 rounded-lg border border-emerald-500/40 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-200">{notice}</p>}
      </section>

      <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="space-y-2 rounded-2xl border border-white/10 bg-gray-900/70 p-3">
          <h3 className="px-2 py-2 text-sm font-semibold text-gray-300">{t("articles")}</h3>
          {posts.length === 0 && <p className="px-2 pb-3 text-sm text-gray-500">{t("noArticles")}</p>}
          {posts.map((post) => (
            <button
              type="button"
              key={post.id}
              onClick={() => setSelectedId(post.id)}
              className={`w-full rounded-xl px-3 py-3 text-left transition-[scale,background-color,box-shadow] duration-150 ease-out active:scale-[0.96] ${selectedPost?.id === post.id ? "bg-amber-500/15 shadow-[0_0_0_1px_rgba(251,191,36,0.4)]" : "bg-gray-800/70 shadow-[0_0_0_1px_rgba(255,255,255,0.06)] hover:bg-gray-800 hover:shadow-[0_0_0_1px_rgba(255,255,255,0.1)]"}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-gray-400">{post.weekKey}</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${post.status === "published" ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300"}`}>
                  {t(post.status)}
                </span>
              </div>
              <p className="mt-2 line-clamp-2 text-sm font-medium text-white">{post.content[language].title}</p>
              <p className="mt-2 text-xs text-gray-500">${post.usage.estimatedCostUsd.toFixed(6)} · {numberFormatter.format(post.usage.totalTokens)} {t("tokens")}</p>
            </button>
          ))}
        </aside>

        <section className="min-w-0 rounded-2xl border border-white/10 bg-gray-900/70 p-5 sm:p-7">
          {!selectedPost ? (
            <div className="py-16 text-center text-gray-500">{t("selectArticle")}</div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-5">
                <div className="flex rounded-lg bg-gray-800 p-1">
                  {(["en", "fi"] as const).map((value) => (
                    <button key={value} type="button" onClick={() => setLanguage(value)} className={`rounded-md px-3 py-1.5 text-sm font-semibold ${language === value ? "bg-gray-600 text-white" : "text-gray-400 hover:text-white"}`}>
                      {value.toUpperCase()}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  {selectedPost.status === "published" && (
                    <Link href={`/reporter/${selectedPost.slug}`} className="min-h-10 rounded-lg bg-gray-800 px-3 py-2 text-sm font-semibold text-gray-200 hover:bg-gray-700">
                      {t("openPublic")}
                    </Link>
                  )}
                  <button type="button" onClick={() => void togglePublished()} disabled={updatingStatus} className="min-h-10 rounded-lg bg-emerald-700 px-3 py-2 text-sm font-bold text-white hover:bg-emerald-600 disabled:opacity-50">
                    {updatingStatus ? t("saving") : selectedPost.status === "published" ? t("moveToDraft") : t("publish")}
                  </button>
                </div>
              </div>

              <article className="mx-auto mt-8 max-w-3xl">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-400">{dateFormatter.format(new Date(selectedPost.periodEnd))}</p>
                <h1 className="mt-3 text-balance text-3xl font-black tracking-tight text-white sm:text-4xl">{selectedPost.content[language].title}</h1>
                <p className="mt-4 text-pretty text-lg leading-8 text-gray-400">{selectedPost.content[language].summary}</p>
                <div className="mt-8"><ReporterArticleBody body={selectedPost.content[language].body} links={selectedPost.links} /></div>
              </article>

              <div className="mt-10 grid gap-3 border-t border-white/10 pt-5 sm:grid-cols-3">
                <Metric label={t("thisInput")} value={numberFormatter.format(selectedPost.usage.inputTokens)} />
                <Metric label={t("thisOutput")} value={numberFormatter.format(selectedPost.usage.outputTokens)} />
                <Metric label={t("thisCost")} value={`$${selectedPost.usage.estimatedCostUsd.toFixed(6)}`} />
              </div>
              {selectedPost.facts && (
                <details className="mt-5 rounded-xl bg-gray-950/60 p-4 text-sm text-gray-300">
                  <summary className="cursor-pointer font-semibold text-gray-200">{t("sourceFacts", { count: selectedPost.facts.length })}</summary>
                  <ol className="mt-4 space-y-2 pl-5 text-gray-400">
                    {selectedPost.facts.map((fact) => <li key={fact.id} className="list-decimal">{fact.summary}</li>)}
                  </ol>
                </details>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-gray-800/80 px-4 py-3">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className="mt-1 break-words text-sm font-bold tabular-nums text-white">{value}</p>
    </div>
  );
}

function SettingToggle({
  label,
  description,
  checked,
  saving,
  disabled,
  tone,
  onToggle,
}: {
  label: string;
  description: string;
  checked: boolean;
  saving: boolean;
  disabled: boolean;
  tone: "emerald" | "blue" | "amber";
  onToggle: (value: boolean) => void;
}) {
  const activeSurface = {
    emerald: "bg-emerald-950/45 shadow-[0_0_0_1px_rgba(52,211,153,0.24)]",
    blue: "bg-blue-950/45 shadow-[0_0_0_1px_rgba(96,165,250,0.24)]",
    amber: "bg-amber-950/45 shadow-[0_0_0_1px_rgba(251,191,36,0.28)]",
  }[tone];
  const activeTrack = { emerald: "bg-emerald-500", blue: "bg-blue-500", amber: "bg-amber-500" }[tone];

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-busy={saving}
      onClick={() => onToggle(!checked)}
      disabled={disabled}
      className={`flex min-h-24 w-full items-center justify-between gap-4 rounded-xl p-4 text-left transition-[scale,background-color,box-shadow] duration-150 ease-out active:scale-[0.96] disabled:cursor-wait disabled:opacity-65 ${checked ? activeSurface : "bg-gray-800/75 shadow-[0_0_0_1px_rgba(255,255,255,0.07)] hover:bg-gray-800 hover:shadow-[0_0_0_1px_rgba(255,255,255,0.12)]"}`}
    >
      <span className="min-w-0">
        <span className="block text-balance text-sm font-bold text-white">{label}</span>
        <span className="mt-1 block text-pretty text-xs leading-5 text-gray-400">{description}</span>
      </span>
      <span className={`relative h-7 w-12 shrink-0 rounded-full shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)] transition-[background-color] duration-200 ease-out ${checked ? activeTrack : "bg-gray-700"}`}>
        <span className={`absolute top-1 size-5 rounded-full bg-white shadow-sm transition-transform duration-200 ease-out ${checked ? "translate-x-6" : "translate-x-1"}`} />
      </span>
    </button>
  );
}
