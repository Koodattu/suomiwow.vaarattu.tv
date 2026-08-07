"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { FaMagnifyingGlass } from "react-icons/fa6";
import IconImage from "@/components/IconImage";
import { api } from "@/lib/api";
import { formatRealmName, getClassInfoById } from "@/lib/utils";
import type { GlobalSearchResult } from "@/types";

function SearchResultsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const locale = useLocale();
  const t = useTranslations("searchPage");
  const tNavigation = useTranslations("navigation");
  const query = (searchParams.get("q") ?? "").trim().slice(0, 60);
  const [draftQuery, setDraftQuery] = useState(query);
  const [results, setResults] = useState<GlobalSearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setDraftQuery(query);
  }, [query]);

  useEffect(() => {
    if (query.length < 2) {
      setResults([]);
      setIsLoading(false);
      setHasError(false);
      return;
    }

    const controller = new AbortController();
    setIsLoading(true);
    setHasError(false);

    api
      .searchSite(query, 20, controller.signal, true)
      .then((data) => setResults(data.results))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setResults([]);
        setHasError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });

    return () => controller.abort();
  }, [query]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextQuery = draftQuery.trim().slice(0, 60);
    router.push(nextQuery.length >= 2 ? `/search?q=${encodeURIComponent(nextQuery)}` : "/search");
  };

  const formatLastSeen = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return new Intl.DateTimeFormat(locale === "fi" ? "fi-FI" : "en-GB", { dateStyle: "medium" }).format(date);
  };

  return (
    <main className="mx-auto min-h-[calc(100vh-8rem)] w-full max-w-4xl px-3 py-8 md:px-4 md:py-10">
      <header className="mb-6">
        <h1 className="text-3xl font-bold text-white [text-wrap:balance]">{t("title")}</h1>
        <p className="mt-2 max-w-2xl text-sm text-gray-400 [text-wrap:pretty]">{t("description")}</p>
      </header>

      <form onSubmit={handleSubmit} role="search" className="rounded-lg bg-gray-900/80 p-3 shadow-lg shadow-black/20 ring-1 ring-white/10 sm:flex sm:gap-2">
        <label htmlFor="site-search-query" className="sr-only">
          {t("inputLabel")}
        </label>
        <div className="relative flex-1">
          <FaMagnifyingGlass className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" aria-hidden="true" />
          <input
            id="site-search-query"
            type="search"
            value={draftQuery}
            onChange={(event) => setDraftQuery(event.target.value)}
            placeholder={t("placeholder")}
            autoFocus
            className="min-h-10 w-full rounded-md bg-gray-950 py-2 pl-10 pr-3 text-sm text-white outline-none ring-1 ring-white/10 transition-shadow placeholder:text-gray-500 focus:ring-2 focus:ring-emerald-500/70"
          />
        </div>
        <button
          type="submit"
          className="mt-2 flex min-h-10 w-full items-center justify-center rounded-md bg-emerald-600 px-5 py-2 text-sm font-semibold text-white shadow-sm shadow-black/30 transition-[background-color,transform] hover:bg-emerald-500 active:scale-[0.96] sm:mt-0 sm:w-auto"
        >
          {t("submit")}
        </button>
      </form>

      {query.length < 2 ? (
        <p className="mt-4 text-sm text-gray-500">{t("minimumQuery")}</p>
      ) : query.length === 2 ? (
        <p className="mt-4 rounded-md bg-blue-500/10 px-3 py-2.5 text-sm text-blue-200 ring-1 ring-blue-400/20">{t("shortQueryNotice")}</p>
      ) : null}

      {query.length >= 2 && (
        <section className="mt-7" aria-labelledby="search-results-heading" aria-live="polite">
          <h2 id="search-results-heading" className="mb-3 text-lg font-semibold text-white [text-wrap:balance]">
            {t("resultsFor", { query })}
          </h2>

          {isLoading ? (
            <div className="flex min-h-24 items-center justify-center gap-2 rounded-lg bg-gray-900/70 text-sm text-gray-400 ring-1 ring-white/10">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-500 border-t-transparent" aria-hidden="true" />
              {t("searching")}
            </div>
          ) : hasError ? (
            <div role="alert" className="rounded-lg bg-red-950/30 px-4 py-5 text-sm text-red-200 ring-1 ring-red-500/20">
              {t("searchError")}
            </div>
          ) : results.length === 0 ? (
            <div className="rounded-lg bg-gray-900/70 px-4 py-8 text-center text-sm text-gray-400 ring-1 ring-white/10">{t("noResults")}</div>
          ) : (
            <div className="overflow-hidden rounded-lg bg-gray-900/70 shadow-lg shadow-black/20 ring-1 ring-white/10">
              {results.map((result) => {
                const lastSeen = result.lastSeenAt ? formatLastSeen(result.lastSeenAt) : null;
                return (
                  <Link
                    key={`${result.type}:${result.href}:${result.name}`}
                    href={result.href}
                    className="flex min-h-16 items-center justify-between gap-3 border-b border-white/5 px-3 py-3 transition-[background-color,transform] last:border-b-0 hover:bg-white/10 active:scale-[0.96] sm:px-4"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      {result.type === "character" && result.classID ? (
                        <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-md shadow-sm shadow-black/30 ring-1 ring-white/10">
                          <IconImage iconFilename={getClassInfoById(result.classID).iconUrl} alt="" fill style={{ objectFit: "cover" }} />
                        </span>
                      ) : (
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-orange-500/15 text-sm font-bold text-orange-200 ring-1 ring-orange-400/20">
                          {result.name.slice(0, 1).toUpperCase()}
                        </span>
                      )}
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-gray-100">{result.name}</span>
                        <span className="mt-0.5 block truncate text-xs text-gray-400">
                          {formatRealmName(result.realm)}
                          {result.guild?.name ? ` · ${t("guildContext", { guild: result.guild.name })}` : ""}
                          {lastSeen ? ` · ${t("lastSeen", { date: lastSeen })}` : ""}
                        </span>
                      </span>
                    </span>
                    <span
                      className={`shrink-0 rounded px-2 py-1 text-[11px] font-semibold uppercase ${
                        result.type === "guild" ? "bg-orange-500/20 text-orange-200" : "bg-blue-500/20 text-blue-200"
                      }`}
                    >
                      {result.type === "guild" ? tNavigation("guildType") : tNavigation("characterType")}
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      )}
    </main>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={null}>
      <SearchResultsContent />
    </Suspense>
  );
}
