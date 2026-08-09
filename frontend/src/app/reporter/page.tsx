"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/lib/api";
import type { ReporterPost } from "@/types";

export default function ReporterIndexPage() {
  const t = useTranslations("reporter");
  const locale = useLocale();
  const language = locale === "fi" ? "fi" : "en";
  const [posts, setPosts] = useState<ReporterPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: "long" }), [locale]);

  useEffect(() => {
    let active = true;
    api.getReporterPosts()
      .then((result) => {
        if (active) setPosts(result.posts);
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
  }, []);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(245,158,11,0.12),transparent_38%),linear-gradient(to_bottom,#090e1a,#111827)] px-4 py-14 text-white sm:py-20">
      <div className="mx-auto max-w-4xl">
        <header className="border-b border-amber-400/20 pb-10">
          <p className="text-xs font-bold uppercase tracking-[0.28em] text-amber-400">{t("eyebrow")}</p>
          <h1 className="mt-4 text-balance text-4xl font-black tracking-tight sm:text-6xl">{t("title")}</h1>
          <p className="mt-5 max-w-2xl text-pretty text-lg leading-8 text-slate-300">{t("description")}</p>
        </header>

        {loading && <p className="py-16 text-center text-slate-400">{t("loading")}</p>}
        {error && <p className="my-10 rounded-xl border border-red-500/30 bg-red-950/30 p-5 text-red-200">{t("loadError")}</p>}
        {!loading && !error && posts.length === 0 && <p className="py-16 text-center text-slate-400">{t("empty")}</p>}

        <div className="divide-y divide-white/10">
          {posts.map((post) => {
            const article = post.content[language];
            return (
              <article key={post.id} className="group py-9">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-400">{dateFormatter.format(new Date(post.publishedAt || post.periodEnd))}</p>
                <h2 className="mt-3 text-balance text-2xl font-extrabold tracking-tight sm:text-3xl">
                  <Link href={`/reporter/${post.slug}`} className="transition-colors group-hover:text-amber-200">{article.title}</Link>
                </h2>
                <p className="mt-3 max-w-3xl text-pretty leading-7 text-slate-400">{article.summary}</p>
                <Link href={`/reporter/${post.slug}`} className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-amber-300 hover:text-amber-200">
                  {t("readArticle")} <span aria-hidden="true">→</span>
                </Link>
              </article>
            );
          })}
        </div>
      </div>
    </main>
  );
}
