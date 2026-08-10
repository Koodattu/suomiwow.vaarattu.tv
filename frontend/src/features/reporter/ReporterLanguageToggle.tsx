"use client";

import { useCallback, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";

export type ReporterLanguage = "en" | "fi";

const REPORTER_LANGUAGE_STORAGE_KEY = "reporter-article-language";
const REPORTER_LANGUAGE_CHANGE_EVENT = "reporter-language-change";

function readReporterLanguage(defaultLanguage: ReporterLanguage): ReporterLanguage {
  const storedLanguage = window.localStorage.getItem(REPORTER_LANGUAGE_STORAGE_KEY);
  return storedLanguage === "en" || storedLanguage === "fi" ? storedLanguage : defaultLanguage;
}

function subscribeToReporterLanguage(onStoreChange: () => void) {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === REPORTER_LANGUAGE_STORAGE_KEY) onStoreChange();
  };
  window.addEventListener("storage", handleStorage);
  window.addEventListener(REPORTER_LANGUAGE_CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(REPORTER_LANGUAGE_CHANGE_EVENT, onStoreChange);
  };
}

export function useReporterLanguage(defaultLanguage: ReporterLanguage) {
  const language = useSyncExternalStore(
    subscribeToReporterLanguage,
    () => readReporterLanguage(defaultLanguage),
    () => defaultLanguage,
  );

  const selectLanguage = useCallback((nextLanguage: ReporterLanguage) => {
    window.localStorage.setItem(REPORTER_LANGUAGE_STORAGE_KEY, nextLanguage);
    window.dispatchEvent(new Event(REPORTER_LANGUAGE_CHANGE_EVENT));
  }, []);

  return { language, selectLanguage };
}

export default function ReporterLanguageToggle({
  language,
  onChange,
}: {
  language: ReporterLanguage;
  onChange: (language: ReporterLanguage) => void;
}) {
  const t = useTranslations("reporter");

  return (
    <div role="group" aria-label={t("languageLabel")} className="inline-flex shrink-0 items-center gap-2">
      <span className="hidden text-xs font-semibold text-slate-400 sm:inline">{t("languageLabel")}</span>
      <div className="inline-flex rounded-xl bg-slate-950/60 p-1 shadow-[0_0_0_1px_rgba(255,255,255,0.1)]">
        {(["en", "fi"] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-label={value === "en" ? t("languageEnglish") : t("languageFinnish")}
            aria-pressed={language === value}
            onClick={() => onChange(value)}
            className={`min-h-11 min-w-12 rounded-lg px-3 text-xs font-extrabold uppercase tracking-[0.12em] transition-[scale,background-color,color,box-shadow] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 active:scale-[0.97] ${
              language === value
                ? "bg-amber-400 text-slate-950 shadow-sm shadow-amber-950/30"
                : "text-slate-400 hover:bg-white/[0.06] hover:text-white"
            }`}
          >
            {value}
          </button>
        ))}
      </div>
    </div>
  );
}
