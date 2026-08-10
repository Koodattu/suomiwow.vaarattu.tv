"use client";

import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import ReporterArticleBody from "@/features/reporter/ReporterArticleBody";
import ReporterLanguageToggle, { useReporterLanguage } from "@/features/reporter/ReporterLanguageToggle";
import { api } from "@/lib/api";
import type { ReporterPost } from "@/types";

export default function ReporterArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const t = useTranslations("reporter");
  const locale = useLocale();
  const { language, selectLanguage } = useReporterLanguage();
  const [post, setPost] = useState<ReporterPost | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: "long" }), [locale]);

  useEffect(() => {
    let active = true;
    api.getReporterPost(slug)
      .then((result) => {
        if (active) setPost(result.post);
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [slug]);

  if (loading) return <main className="min-h-screen bg-slate-950 px-4 py-20 text-center text-slate-400">{t("loading")}</main>;
  if (error || !post) return <main className="min-h-screen bg-slate-950 px-4 py-20 text-center text-slate-300">{t("notFound")}</main>;

  const article = post.content[language];
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(245,158,11,0.1),transparent_34%),linear-gradient(to_bottom,#090e1a,#111827)] px-4 py-14 text-white sm:py-20">
      <article className="mx-auto max-w-3xl">
        <div className="flex items-center justify-between gap-4">
          <Link href="/reporter" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-slate-400 transition-colors hover:text-amber-300">
            <span aria-hidden="true">←</span> {t("back")}
          </Link>
          <ReporterLanguageToggle language={language} onChange={selectLanguage} />
        </div>
        <header className="mt-10 border-b border-amber-400/20 pb-9">
          <p className="text-xs font-bold uppercase tracking-[0.24em] text-amber-400">{t("eyebrow")} · {dateFormatter.format(new Date(post.publishedAt || post.periodEnd))}</p>
          <h1 className="mt-4 text-balance text-4xl font-black tracking-tight sm:text-6xl">{article.title}</h1>
          <p className="mt-6 text-pretty text-xl leading-8 text-slate-300">{article.summary}</p>
        </header>
        <div className="mt-10"><ReporterArticleBody body={article.body} links={post.links} /></div>
        <footer className="mt-12 border-t border-white/10 pt-6 text-sm text-slate-500">{t("footer")}</footer>
      </article>
    </main>
  );
}
