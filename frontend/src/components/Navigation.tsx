"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { FaGlobe, FaMagnifyingGlass } from "react-icons/fa6";
import { api } from "@/lib/api";
import { setLocale, getLocale, LOCALE_CHANGE_EVENT, type Locale } from "@/lib/locale";
import { formatRealmName, getClassInfoById } from "@/lib/utils";
import IconImage from "@/components/IconImage";
import { useAuth } from "@/context/AuthContext";
import { HorseRaceMode, HorseRaceVisibility, useHorseRaceMode } from "@/lib/horse-race-preferences";
import { useHomePagePreferences } from "@/lib/homepage-preferences";
import { DIFFICULTIES, EVENT_TYPES, useEventFilterPreferences } from "@/lib/useEventFilters";
import type { GlobalSearchResult } from "@/types";

const HORSE_RACE_VISIBILITY_OPTIONS: Array<{ visibility: HorseRaceVisibility; labelKey: "horseRaceAuto" | "horseRaceShow" | "horseRaceHide" }> = [
  { visibility: "auto", labelKey: "horseRaceAuto" },
  { visibility: "show", labelKey: "horseRaceShow" },
  { visibility: "hide", labelKey: "horseRaceHide" },
];

const HORSE_RACE_MODE_OPTIONS: Array<{ mode: HorseRaceMode; labelKey: "horseRaceRandom" | "horseRaceCrest" | "horseRaceJapanese" | "horseRaceUma" }> = [
  { mode: "random", labelKey: "horseRaceRandom" },
  { mode: "crest", labelKey: "horseRaceCrest" },
  { mode: "japanese", labelKey: "horseRaceJapanese" },
  { mode: "uma", labelKey: "horseRaceUma" },
];

const NAVIGATION_LINKS = [
  { href: "/", labelKey: "progressLeaderboard" },
  { href: "/guilds", labelKey: "allGuilds" },
  { href: "/characters", labelKey: "characterRankings" },
  { href: "/tierlists", labelKey: "tierLists" },
  { href: "/analytics", labelKey: "raidAnalytics" },
  { href: "/timetable", labelKey: "raidTimetable" },
  { href: "/livestreams", labelKey: "livestreams" },
  { href: "/events", labelKey: "latestEvents" },
  { href: "/pickems", labelKey: "pickems" },
  { href: "/fun/ccg", labelKey: "ccg" },
] as const;

const getDesktopNavLinkClass = (isCurrent: boolean, previousIsCurrent: boolean, nextIsCurrent: boolean) =>
  `flex h-full min-w-24 flex-1 cursor-pointer items-center justify-center whitespace-nowrap border-x border-b-2 px-2 text-center text-sm font-medium transition-[background-color,color] ${
    isCurrent
      ? "border-x-transparent border-b-blue-400 bg-blue-600/35 text-white"
      : `border-b-transparent text-gray-400 hover:bg-gray-800/80 hover:text-white ${previousIsCurrent ? "border-l-transparent" : "border-l-gray-700/80"} ${
          nextIsCurrent ? "border-r-transparent" : "border-r-gray-700/80"
        }`
  }`;

const getMobileNavLinkClass = (isCurrent: boolean) =>
  `block cursor-pointer rounded-md border px-3 py-2.5 text-sm font-medium transition-colors ${
    isCurrent ? "border-blue-400/30 bg-blue-500/15 text-blue-100" : "border-transparent text-gray-300 hover:border-white/10 hover:bg-white/5 hover:text-white"
  }`;

function SettingsToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`flex w-full cursor-pointer items-center justify-between gap-3 rounded px-3 py-2 text-left shadow-sm shadow-black/25 ring-1 transition-colors ${
        checked ? "bg-blue-600/25 text-blue-50 ring-blue-400/35 hover:bg-blue-600/35" : "bg-gray-950/55 text-gray-500 ring-white/5 hover:bg-gray-900/80 hover:text-gray-300"
      }`}
      aria-pressed={checked}
    >
      <span className="text-sm font-medium">{label}</span>
      <span className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? "bg-blue-500" : "bg-gray-700"}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm shadow-black/40 transition-transform ${checked ? "translate-x-4" : "translate-x-0.5"}`} />
      </span>
    </button>
  );
}

const getEventFilterChipClass = (type: string, selected: boolean) => {
  if (!selected) {
    return "cursor-pointer rounded px-2.5 py-1.5 text-xs font-medium bg-gray-950/60 text-gray-500 ring-1 ring-white/5 transition-colors hover:bg-gray-900/90 hover:text-gray-200";
  }

  switch (type) {
    case "boss_kill":
      return "cursor-pointer rounded px-2.5 py-1.5 text-xs font-semibold bg-green-600 text-white shadow-sm shadow-black/30 transition-colors hover:bg-green-500";
    case "best_pull":
      return "cursor-pointer rounded px-2.5 py-1.5 text-xs font-semibold bg-blue-600 text-white shadow-sm shadow-black/30 transition-colors hover:bg-blue-500";
    case "hiatus":
      return "cursor-pointer rounded px-2.5 py-1.5 text-xs font-semibold bg-gray-600 text-white shadow-sm shadow-black/30 transition-colors hover:bg-gray-500";
    case "regress":
      return "cursor-pointer rounded px-2.5 py-1.5 text-xs font-semibold bg-red-600 text-white shadow-sm shadow-black/30 transition-colors hover:bg-red-500";
    case "reproge":
      return "cursor-pointer rounded px-2.5 py-1.5 text-xs font-semibold bg-yellow-600 text-white shadow-sm shadow-black/30 transition-colors hover:bg-yellow-500";
    default:
      return "cursor-pointer rounded px-2.5 py-1.5 text-xs font-semibold bg-gray-600 text-white shadow-sm shadow-black/30 transition-colors hover:bg-gray-500";
  }
};

const getDifficultySegmentClass = (difficulty: string, selected: boolean) => {
  if (!selected) {
    return "cursor-pointer rounded px-2.5 py-1.5 text-xs font-medium bg-gray-950/60 text-gray-500 ring-1 ring-white/5 transition-colors hover:bg-gray-900/90 hover:text-gray-200";
  }

  return `cursor-pointer rounded px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm shadow-black/30 transition-colors ${
    difficulty === "mythic" ? "bg-orange-600 hover:bg-orange-500" : "bg-purple-600 hover:bg-purple-500"
  }`;
};

const getHorseRaceSegmentClass = (selected: boolean) =>
  `flex min-h-8 flex-1 cursor-pointer items-center justify-center rounded px-3 py-1.5 text-xs font-semibold transition-colors ${
    selected ? "bg-blue-600 text-white shadow-sm shadow-black/30 hover:bg-blue-500" : "text-gray-400 hover:bg-white/5 hover:text-gray-100"
  }`;

export default function Navigation() {
  const pathname = usePathname();
  const shouldRemoveBottomMargin = pathname === "/analytics/network" || pathname.startsWith("/fun/ccg");
  const t = useTranslations("navigation");
  const tEvents = useTranslations("eventsPage");
  const tInfo = useTranslations("infoDialog");
  const { user, isLoading, login, logout } = useAuth();
  const {
    mode: horseRaceMode,
    visibility: horseRaceVisibility,
    showCharacters: showHorseRaceCharacters,
    showBackground: showHorseRaceBackground,
    setMode: setHorseRaceMode,
    setVisibility: setHorseRaceVisibility,
    setShowCharacters: setShowHorseRaceCharacters,
    setShowBackground: setShowHorseRaceBackground,
  } = useHorseRaceMode();
  const { showEvents, showLivestreams, showHighlights, showRaidingToday, setShowEvents, setShowLivestreams, setShowHighlights, setShowRaidingToday } =
    useHomePagePreferences();
  const { selectedEventTypes, selectedDifficulties, selectedGuild, setEventTypes, setDifficulties, setSelectedGuild } = useEventFilterPreferences();
  const [isInfoDialogOpen, setIsInfoDialogOpen] = useState(false);
  const [isContactDropdownOpen, setIsContactDropdownOpen] = useState(false);
  const [isUserDropdownOpen, setIsUserDropdownOpen] = useState(false);
  const [isSearchDropdownOpen, setIsSearchDropdownOpen] = useState(false);
  const [isSettingsDropdownOpen, setIsSettingsDropdownOpen] = useState(false);
  const [isLanguageDropdownOpen, setIsLanguageDropdownOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [currentLocale, setCurrentLocale] = useState<Locale>("en");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<GlobalSearchResult[]>([]);
  const [isSearchLoading, setIsSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const userDropdownRef = useRef<HTMLDivElement>(null);
  const searchDropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const settingsDropdownRef = useRef<HTMLDivElement>(null);
  const languageDropdownRef = useRef<HTMLDivElement>(null);
  const mobileMenuRef = useRef<HTMLDivElement>(null);
  const selectedEventTypeSet = new Set(selectedEventTypes);
  const selectedDifficultySet = new Set(selectedDifficulties);
  const trimmedSearchQuery = searchQuery.trim();

  useEffect(() => {
    setCurrentLocale(getLocale());

    const handleLocaleChange = (event: Event) => {
      setCurrentLocale((event as CustomEvent<Locale>).detail);
    };

    window.addEventListener(LOCALE_CHANGE_EVENT, handleLocaleChange);
    return () => {
      window.removeEventListener(LOCALE_CHANGE_EVENT, handleLocaleChange);
    };
  }, []);

  // Close mobile menu on route change
  useEffect(() => {
    setIsMobileMenuOpen(false);
    setIsSearchDropdownOpen(false);
    setIsSettingsDropdownOpen(false);
    setIsLanguageDropdownOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (isSearchDropdownOpen) {
      searchInputRef.current?.focus();
      return;
    }

    setSearchQuery("");
    setSearchResults([]);
    setIsSearchLoading(false);
    setSearchError(false);
  }, [isSearchDropdownOpen]);

  useEffect(() => {
    if (!isSearchDropdownOpen || trimmedSearchQuery.length < 2) {
      setSearchResults([]);
      setIsSearchLoading(false);
      setSearchError(false);
      return;
    }

    let isActiveRequest = true;
    setIsSearchLoading(true);
    setSearchError(false);

    const timeoutId = window.setTimeout(() => {
      api
        .searchSite(trimmedSearchQuery, 5)
        .then((data) => {
          if (!isActiveRequest) return;
          setSearchResults(data.results);
        })
        .catch(() => {
          if (!isActiveRequest) return;
          setSearchResults([]);
          setSearchError(true);
        })
        .finally(() => {
          if (!isActiveRequest) return;
          setIsSearchLoading(false);
        });
    }, 180);

    return () => {
      isActiveRequest = false;
      window.clearTimeout(timeoutId);
    };
  }, [isSearchDropdownOpen, trimmedSearchQuery]);

  // Prevent body scroll when mobile menu is open
  useEffect(() => {
    if (isMobileMenuOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isMobileMenuOpen]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsContactDropdownOpen(false);
      }
      if (userDropdownRef.current && !userDropdownRef.current.contains(event.target as Node)) {
        setIsUserDropdownOpen(false);
      }
      if (searchDropdownRef.current && !searchDropdownRef.current.contains(event.target as Node)) {
        setIsSearchDropdownOpen(false);
      }
      if (settingsDropdownRef.current && !settingsDropdownRef.current.contains(event.target as Node)) {
        setIsSettingsDropdownOpen(false);
      }
      if (languageDropdownRef.current && !languageDropdownRef.current.contains(event.target as Node)) {
        setIsLanguageDropdownOpen(false);
      }
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(event.target as Node)) {
        setIsMobileMenuOpen(false);
      }
    };

    if (isContactDropdownOpen || isUserDropdownOpen || isSearchDropdownOpen || isSettingsDropdownOpen || isLanguageDropdownOpen || isMobileMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isContactDropdownOpen, isSearchDropdownOpen, isSettingsDropdownOpen, isLanguageDropdownOpen, isUserDropdownOpen, isMobileMenuOpen]);

  const isActive = (path: string) => {
    if (path === "/") {
      return pathname === "/" || pathname === "/progress";
    }
    return pathname.startsWith(path);
  };

  const handleLanguageChange = (newLocale: Locale) => {
    setLocale(newLocale);
    setIsLanguageDropdownOpen(false);
  };

  const toggleEventType = (type: string) => {
    const nextTypes = new Set(selectedEventTypeSet);
    if (nextTypes.has(type)) {
      nextTypes.delete(type);
    } else {
      nextTypes.add(type);
    }
    setEventTypes(nextTypes.size === 0 ? [...EVENT_TYPES] : Array.from(nextTypes));
  };

  const toggleDifficulty = (difficulty: string) => {
    const nextDifficulties = new Set(selectedDifficultySet);
    if (nextDifficulties.has(difficulty)) {
      nextDifficulties.delete(difficulty);
    } else {
      nextDifficulties.add(difficulty);
    }
    setDifficulties(nextDifficulties.size === 0 ? [...DIFFICULTIES] : Array.from(nextDifficulties));
  };

  const getEventTypeLabel = (type: string): string => {
    switch (type) {
      case "boss_kill":
        return tEvents("bossKill");
      case "best_pull":
        return tEvents("bestPull");
      case "hiatus":
        return tEvents("hiatus");
      case "regress":
        return tEvents("regress");
      case "reproge":
        return tEvents("reproge");
      default:
        return type;
    }
  };

  return (
    <>
      <nav className={`${shouldRemoveBottomMargin ? "" : "mb-4 "}border-b border-gray-700 bg-gray-900`}>
        <div className="w-full px-4 md:px-6">
          <div className="flex h-14 items-center justify-between gap-3 md:h-16">
            {/* Left side: Logo and Desktop Navigation */}
            <div className="flex h-full min-w-0 flex-1 items-center gap-4 md:gap-8">
              <Link href="/" className="flex shrink-0 items-center transition-opacity hover:opacity-80">
                <Image src="/logo.png" alt="WoW Guild Progress" width={100} height={18} className="md:w-[120px]" priority />
              </Link>

              {/* Desktop Navigation Links - Hidden on mobile */}
              <div className="hidden h-full min-w-0 flex-1 lg:block">
                <div className="flex h-full max-w-full items-stretch overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {NAVIGATION_LINKS.map((link, index) => {
                    const isCurrent = isActive(link.href);
                    const previousIsCurrent = index > 0 ? isActive(NAVIGATION_LINKS[index - 1].href) : false;
                    const nextIsCurrent = index < NAVIGATION_LINKS.length - 1 ? isActive(NAVIGATION_LINKS[index + 1].href) : false;

                    return (
                      <Link key={link.href} href={link.href} className={getDesktopNavLinkClass(isCurrent, previousIsCurrent, nextIsCurrent)}>
                        {t(link.labelKey)}
                      </Link>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Right side buttons */}
            <div className="flex items-center gap-2">
              <div className="relative h-9 shrink-0" ref={searchDropdownRef}>
                <button
                  type="button"
                  onClick={() => setIsSearchDropdownOpen((isOpen) => !isOpen)}
                  className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-md bg-emerald-600 text-white shadow-sm shadow-black/30 transition-[background-color,transform] hover:bg-emerald-500 active:scale-[0.96] sm:w-auto sm:gap-2 sm:pl-3 sm:pr-3.5"
                  title={t("search")}
                  aria-label={t("search")}
                  aria-expanded={isSearchDropdownOpen}
                >
                  <FaMagnifyingGlass className="h-[17px] w-[17px]" aria-hidden="true" />
                  <span className="hidden text-sm font-medium sm:inline">{t("search")}</span>
                </button>

                {isSearchDropdownOpen && (
                  <div className="fixed inset-x-0 top-0 z-50 bg-gray-950/95 p-3 pt-[max(0.75rem,env(safe-area-inset-top))] shadow-2xl shadow-black/50 ring-1 ring-white/10 lg:absolute lg:inset-x-auto lg:right-0 lg:top-auto lg:mt-2 lg:w-[min(23rem,calc(100vw-1.5rem))] lg:rounded-md lg:p-2">
                    <input
                      ref={searchInputRef}
                      type="search"
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder={t("searchPlaceholder")}
                      className="h-9 w-full rounded bg-gray-900 px-3 text-sm text-white outline-none ring-1 ring-white/10 transition-shadow placeholder:text-gray-500 focus:ring-2 focus:ring-emerald-500/70"
                    />
                    <div className="mt-2 max-h-[calc(100dvh_-_4.75rem_-_env(safe-area-inset-top))] overflow-y-auto rounded bg-gray-900/70 ring-1 ring-white/5 lg:max-h-none lg:overflow-hidden">
                      {trimmedSearchQuery.length < 2 ? (
                        <div className="px-3 py-2.5 text-sm text-gray-500">{t("searchMinCharacters")}</div>
                      ) : isSearchLoading ? (
                        <div className="flex items-center gap-2 px-3 py-2.5 text-sm text-gray-400">
                          <span className="h-3.5 w-3.5 rounded-full border-2 border-gray-500 border-t-transparent animate-spin" />
                          {t("searching")}
                        </div>
                      ) : searchError ? (
                        <div className="px-3 py-2.5 text-sm text-red-300">{t("searchError")}</div>
                      ) : searchResults.length === 0 ? (
                        <div className="px-3 py-2.5 text-sm text-gray-500">{t("noSearchResults")}</div>
                      ) : (
                        searchResults.map((result) => (
                          <Link
                            key={`${result.type}:${result.realm}:${result.name}`}
                            href={result.href}
                            onClick={() => setIsSearchDropdownOpen(false)}
                            className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2.5 text-sm transition-colors hover:bg-white/10"
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              {result.type === "character" && result.classID ? (
                                <span className="relative h-6 w-6 shrink-0 overflow-hidden rounded shadow-sm shadow-black/30 ring-1 ring-white/10">
                                  <IconImage iconFilename={getClassInfoById(result.classID).iconUrl} alt="" fill style={{ objectFit: "cover" }} />
                                </span>
                              ) : null}
                              <span className="min-w-0 truncate text-gray-100">
                                {result.name} - {formatRealmName(result.realm)}
                              </span>
                            </span>
                            <span className={`shrink-0 rounded px-2 py-0.5 text-[11px] font-semibold uppercase ${result.type === "guild" ? "bg-orange-500/20 text-orange-200" : "bg-blue-500/20 text-blue-200"}`}>
                              {result.type === "guild" ? t("guildType") : t("characterType")}
                            </span>
                          </Link>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="relative h-9 w-9 shrink-0" ref={settingsDropdownRef}>
                <button
                  type="button"
                  onClick={() => setIsSettingsDropdownOpen((isOpen) => !isOpen)}
                  className="group flex h-9 w-9 cursor-pointer items-center justify-center rounded-md bg-purple-600 text-white shadow-sm shadow-black/30 transition-[background-color,transform] hover:bg-purple-500 active:scale-[0.96]"
                  title={t("homepageSettings")}
                  aria-label={t("homepageSettings")}
                  aria-expanded={isSettingsDropdownOpen}
                >
                  <svg className="h-5 w-5 transition-transform group-hover:rotate-45" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path
                      fillRule="evenodd"
                      d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.53 1.53 0 0 1-2.29.95c-1.37-.84-2.94.73-2.1 2.1a1.53 1.53 0 0 1-.95 2.29c-1.56.38-1.56 2.6 0 2.98a1.53 1.53 0 0 1 .95 2.29c-.84 1.37.73 2.94 2.1 2.1a1.53 1.53 0 0 1 2.29.95c.38 1.56 2.6 1.56 2.98 0a1.53 1.53 0 0 1 2.29-.95c1.37.84 2.94-.73 2.1-2.1a1.53 1.53 0 0 1 .95-2.29c1.56-.38 1.56-2.6 0-2.98a1.53 1.53 0 0 1-.95-2.29c.84-1.37-.73-2.94-2.1-2.1a1.53 1.53 0 0 1-2.29-.95ZM10 13a3 3 0 1 0 0-6a3 3 0 0 0 0 6Z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>

                {isSettingsDropdownOpen && (
                  <div className="absolute right-0 z-50 mt-2 w-[min(23rem,calc(100vw-1.5rem))] rounded-md bg-[#182235] p-3 shadow-2xl shadow-black/70 ring-1 ring-blue-300/15">
                    <div className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-gray-500">{t("generalSettings")}</div>
                    <div className="space-y-1.5">
                      <SettingsToggle label={t("showEventsOnHome")} checked={showEvents} onChange={setShowEvents} />
                      <SettingsToggle label={t("showLivestreamsOnHome")} checked={showLivestreams} onChange={setShowLivestreams} />
                      <SettingsToggle label={t("showHighlightsOnHome")} checked={showHighlights} onChange={setShowHighlights} />
                      <SettingsToggle label={t("showRaidingTodayOnHome")} checked={showRaidingToday} onChange={setShowRaidingToday} />
                    </div>

                    <div className="mt-3 border-t border-white/10 pt-3">
                      <div className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-gray-500">{t("eventFilters")}</div>
                      <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-600">{tEvents("eventTypes")}</div>
                      <div className="flex flex-wrap gap-1.5">
                        {EVENT_TYPES.map((type) => (
                          <button key={type} type="button" onClick={() => toggleEventType(type)} className={getEventFilterChipClass(type, selectedEventTypeSet.has(type))}>
                            {getEventTypeLabel(type)}
                          </button>
                        ))}
                      </div>
                      <div className="mt-3 mb-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-600">{tEvents("difficulties")}</div>
                      <div className="flex flex-wrap gap-1.5">
                        {DIFFICULTIES.map((difficulty) => (
                          <button key={difficulty} type="button" onClick={() => toggleDifficulty(difficulty)} className={getDifficultySegmentClass(difficulty, selectedDifficultySet.has(difficulty))}>
                            {difficulty === "mythic" ? tEvents("mythic") : tEvents("heroic")}
                          </button>
                        ))}
                      </div>
                      {selectedGuild && (
                        <div className="mt-2 flex items-center justify-between gap-2 rounded bg-white/[0.04] px-2.5 py-1.5 text-xs text-gray-300">
                          <span className="min-w-0 truncate">
                            {tEvents("guild")}: {selectedGuild}
                          </span>
                          <button type="button" onClick={() => setSelectedGuild("")} className="shrink-0 cursor-pointer font-medium text-blue-300 transition-colors hover:text-blue-100">
                            {tEvents("allGuilds")}
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="mt-3 border-t border-white/10 pt-3">
                      <div className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-gray-500">{t("horseRaceSettings")}</div>
                      <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-600">{t("horseRaceVisibility")}</div>
                      <div className="flex overflow-hidden rounded bg-gray-950/55 p-1 shadow-inner shadow-black/25 ring-1 ring-white/5">
                        {HORSE_RACE_VISIBILITY_OPTIONS.map((option) => (
                          <button
                            key={option.visibility}
                            type="button"
                            onClick={() => setHorseRaceVisibility(option.visibility)}
                            className={getHorseRaceSegmentClass(horseRaceVisibility === option.visibility)}
                            aria-pressed={horseRaceVisibility === option.visibility}
                          >
                            {t(option.labelKey)}
                          </button>
                        ))}
                      </div>
                      <div className="mt-3 mb-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-600">{t("horseRaceStyle")}</div>
                      <div className="flex overflow-hidden rounded bg-gray-950/55 p-1 shadow-inner shadow-black/25 ring-1 ring-white/5">
                        {HORSE_RACE_MODE_OPTIONS.map((option) => (
                          <button
                            key={option.mode}
                            type="button"
                            onClick={() => setHorseRaceMode(option.mode)}
                            className={getHorseRaceSegmentClass(horseRaceMode === option.mode)}
                            aria-pressed={horseRaceMode === option.mode}
                          >
                            {t(option.labelKey)}
                          </button>
                        ))}
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-1.5">
                        <SettingsToggle label={t("horseRaceCharacters")} checked={showHorseRaceCharacters} onChange={setShowHorseRaceCharacters} />
                        <SettingsToggle label={t("horseRaceBackground")} checked={showHorseRaceBackground} onChange={setShowHorseRaceBackground} />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Language Switcher - Always visible */}
              <div className="relative h-9 w-9 shrink-0" ref={languageDropdownRef}>
                <button
                  type="button"
                  onClick={() => setIsLanguageDropdownOpen((isOpen) => !isOpen)}
                  className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-md bg-cyan-600 text-white shadow-sm shadow-black/30 transition-[background-color,transform] hover:bg-cyan-500 active:scale-[0.96]"
                  title={t("language")}
                  aria-label={t("language")}
                  aria-expanded={isLanguageDropdownOpen}
                >
                  <FaGlobe className="h-[18px] w-[18px]" aria-hidden="true" />
                </button>

                {isLanguageDropdownOpen && (
                  <div className="absolute right-0 z-50 mt-2 w-28 overflow-hidden rounded-md border border-white/10 bg-gray-950/95 p-1 shadow-2xl shadow-black/40">
                    <button
                      type="button"
                      onClick={() => handleLanguageChange("en")}
                      className={`flex w-full cursor-pointer items-center justify-between rounded px-2.5 py-2 text-sm font-medium transition-colors ${
                        currentLocale === "en" ? "bg-blue-600 text-white" : "text-gray-300 hover:bg-white/10 hover:text-white"
                      }`}
                    >
                      EN
                      {currentLocale === "en" && (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                          <path
                            fillRule="evenodd"
                            d="M16.704 5.29a1 1 0 0 1 .006 1.414l-7.25 7.31a1 1 0 0 1-1.42.002L3.29 9.266a1 1 0 1 1 1.414-1.414l4.04 4.04l6.546-6.596a1 1 0 0 1 1.414-.006Z"
                            clipRule="evenodd"
                          />
                        </svg>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleLanguageChange("fi")}
                      className={`mt-1 flex w-full cursor-pointer items-center justify-between rounded px-2.5 py-2 text-sm font-medium transition-colors ${
                        currentLocale === "fi" ? "bg-blue-600 text-white" : "text-gray-300 hover:bg-white/10 hover:text-white"
                      }`}
                    >
                      FI
                      {currentLocale === "fi" && (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                          <path
                            fillRule="evenodd"
                            d="M16.704 5.29a1 1 0 0 1 .006 1.414l-7.25 7.31a1 1 0 0 1-1.42.002L3.29 9.266a1 1 0 1 1 1.414-1.414l4.04 4.04l6.546-6.596a1 1 0 0 1 1.414-.006Z"
                            clipRule="evenodd"
                          />
                        </svg>
                      )}
                    </button>
                  </div>
                )}
              </div>

              {/* Desktop-only buttons */}
              <div className="hidden items-center gap-1.5 md:flex">
                {/* Community Dropdown Button */}
                <div className="relative" ref={dropdownRef}>
                  <button
                    onClick={() => setIsContactDropdownOpen(!isContactDropdownOpen)}
                    className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-md bg-orange-600 text-white shadow-sm shadow-black/30 transition-[background-color,transform] hover:bg-orange-500 active:scale-[0.96]"
                    aria-label={t("community")}
                    aria-expanded={isContactDropdownOpen}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-white" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                      <path d="M13 6a3 3 0 1 1-6 0a3 3 0 0 1 6 0Z" />
                      <path d="M18 8a2 2 0 1 1-4 0a2 2 0 0 1 4 0ZM14 15a4 4 0 0 0-8 0v.25c0 .414.336.75.75.75h6.5a.75.75 0 0 0 .75-.75V15ZM6 8a2 2 0 1 1-4 0a2 2 0 0 1 4 0ZM4.75 16A.75.75 0 0 1 4 15.25V15c0-1.01.292-1.953.797-2.746A3.99 3.99 0 0 0 1 16h3.75ZM19 16a3.99 3.99 0 0 0-3.797-3.746A5.971 5.971 0 0 1 16 15v.25a.75.75 0 0 1-.75.75H19Z" />
                    </svg>
                  </button>

                  {/* Dropdown Menu */}
                  {isContactDropdownOpen && (
                    <div className="absolute right-0 top-full z-50 mt-1 w-40 overflow-hidden rounded-md border border-white/10 bg-gray-950/95 shadow-2xl shadow-black/40">
                      <div>
                        <button
                          type="button"
                          onClick={() => {
                            setIsContactDropdownOpen(false);
                            setIsInfoDialogOpen(true);
                          }}
                          className="flex w-full cursor-pointer items-center gap-2 bg-emerald-600 px-3 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                            <path
                              fillRule="evenodd"
                              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                              clipRule="evenodd"
                            />
                          </svg>
                          {t("about")}
                        </button>

                        {/* GitHub Link */}
                        <a
                          href="https://github.com/Koodattu/wow-guild-progress-tracker"
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => setIsContactDropdownOpen(false)}
                          className="flex cursor-pointer items-center gap-2 bg-slate-700 px-3 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-600"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                          </svg>
                          {t("github")}
                        </a>

                        {/* Discord Link */}
                        <a
                          href="https://discord.gg/BgQDncamHZ"
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => setIsContactDropdownOpen(false)}
                          className="flex cursor-pointer items-center gap-2 bg-indigo-600 px-3 py-2.5 text-sm font-medium text-white transition-colors hover:bg-indigo-500"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515a.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0a12.64 12.64 0 0 0-.617-1.25a.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057a19.9 19.9 0 0 0 5.993 3.03a.078.078 0 0 0 .084-.028a14.09 14.09 0 0 0 1.226-1.994a.076.076 0 0 0-.041-.106a13.107 13.107 0 0 1-1.872-.892a.077.077 0 0 1-.008-.128a10.2 10.2 0 0 0 .372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127a12.299 12.299 0 0 1-1.873.892a.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028a19.839 19.839 0 0 0 6.002-3.03a.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.956-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.955-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.946 2.418-2.157 2.418z" />
                          </svg>
                          {t("discord")}
                        </a>

                        {/* Twitch Link */}
                        <a
                          href="https://www.twitch.tv/vaarattu"
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => setIsContactDropdownOpen(false)}
                          className="flex cursor-pointer items-center gap-2 bg-purple-600 px-3 py-2.5 text-sm font-medium text-white transition-colors hover:bg-purple-500"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z" />
                          </svg>
                          {t("twitch")}
                        </a>
                      </div>
                    </div>
                  )}
                </div>

                {/* Login with Discord Button or User Profile */}
                {isLoading ? (
                  <div className="hidden h-9 items-center gap-2 rounded-md bg-slate-800 px-3 text-sm text-gray-400 shadow-sm shadow-black/30 md:flex">
                    <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin"></div>
                  </div>
                ) : user ? (
                  <div className="relative" ref={userDropdownRef}>
                    <button
                      onClick={() => setIsUserDropdownOpen(!isUserDropdownOpen)}
                      className="hidden h-9 cursor-pointer items-center gap-2 rounded-md border border-gray-700 bg-gray-800 px-2 text-sm shadow-sm shadow-black/30 transition-[background-color,border-color,transform] hover:border-indigo-500/60 hover:bg-gray-700 active:scale-[0.96] md:flex"
                      aria-label="User menu"
                    >
                      <img src={user.discord.avatarUrl} alt={user.discord.username} className="h-7 w-7 rounded-full ring-1 ring-indigo-500/70" />
                      <span className="text-sm text-white font-medium pr-1">{user.discord.username}</span>
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className={`h-4 w-4 text-gray-400 transition-transform ${isUserDropdownOpen ? "rotate-180" : ""}`}
                        viewBox="0 0 20 20"
                        fill="currentColor"
                      >
                        <path
                          fillRule="evenodd"
                          d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </button>

                    {/* User Dropdown Menu */}
                    {isUserDropdownOpen && (
                      <div className="absolute right-0 z-50 mt-2 w-40 overflow-hidden rounded-md border border-white/10 bg-gray-950/95 shadow-2xl shadow-black/40">
                        <div className="py-0">
                          <Link
                            href="/profile"
                            onClick={() => setIsUserDropdownOpen(false)}
                            className="flex items-center gap-2 px-3 py-2.5 text-sm text-gray-200 transition-colors hover:bg-white/10 hover:text-white"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                            </svg>
                            {t("profile")}
                          </Link>
                          {user.isAdmin && (
                            <Link
                              href="/admin"
                              onClick={() => setIsUserDropdownOpen(false)}
                              className="flex cursor-pointer items-center gap-2 px-3 py-2.5 text-sm text-amber-300 transition-colors hover:bg-amber-400/10 hover:text-amber-100"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                <path
                                  fillRule="evenodd"
                                  d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z"
                                  clipRule="evenodd"
                                />
                              </svg>
                              {t("adminPanel")}
                            </Link>
                          )}
                          <button
                            onClick={() => {
                              setIsUserDropdownOpen(false);
                              logout();
                            }}
                            className="flex w-full cursor-pointer items-center gap-2 px-3 py-2.5 text-sm text-red-300 transition-colors hover:bg-red-400/10 hover:text-red-100"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                              <path
                                fillRule="evenodd"
                                d="M3 3a1 1 0 00-1 1v12a1 1 0 001 1h12a1 1 0 001-1V4a1 1 0 00-1-1H3zm10.293 9.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L14.586 9H7a1 1 0 100 2h7.586l-1.293 1.293z"
                                clipRule="evenodd"
                              />
                            </svg>
                            {t("logout")}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <button
                    onClick={() => login()}
                    className="hidden h-9 cursor-pointer items-center gap-2 rounded-md bg-indigo-600 px-3 text-sm font-medium text-white shadow-sm shadow-black/30 transition-[background-color,transform] hover:bg-indigo-500 active:scale-[0.96] md:flex"
                    aria-label="Login with Discord"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515a.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0a12.64 12.64 0 0 0-.617-1.25a.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057a19.9 19.9 0 0 0 5.993 3.03a.078.078 0 0 0 .084-.028a14.09 14.09 0 0 0 1.226-1.994a.076.076 0 0 0-.041-.106a13.107 13.107 0 0 1-1.872-.892a.077.077 0 0 1-.008-.128a10.2 10.2 0 0 0 .372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127a12.299 12.299 0 0 1-1.873.892a.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028a19.839 19.839 0 0 0 6.002-3.03a.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.956-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.955-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.946 2.418-2.157 2.418z" />
                    </svg>
                    {t("loginWithDiscord")}
                  </button>
                )}
              </div>

              {/* Mobile Hamburger Menu Button */}
              <button
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-md border border-white/10 bg-white/[0.04] text-gray-300 shadow-sm shadow-black/20 transition-colors hover:border-blue-400/35 hover:bg-white/[0.08] hover:text-white lg:hidden"
                aria-label="Toggle menu"
              >
                {isMobileMenuOpen ? (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Mobile Menu Overlay */}
      {isMobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          {/* Backdrop */}
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setIsMobileMenuOpen(false)} />

          {/* Menu Panel */}
          <div
            ref={mobileMenuRef}
            className="fixed right-0 top-0 h-full w-[min(20rem,calc(100vw-2rem))] overflow-y-auto border-l border-white/10 bg-[#070b16] shadow-2xl shadow-black/60"
          >
            {/* Menu Header */}
            <div className="flex items-center justify-between border-b border-white/10 p-4">
              <Image src="/logo.png" alt="WoW Guild Progress" width={112} height={20} />
              <button
                onClick={() => setIsMobileMenuOpen(false)}
                className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-md border border-white/10 bg-white/[0.04] text-gray-300 transition-colors hover:border-blue-400/35 hover:bg-white/10 hover:text-white"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Navigation Links */}
            <div className="space-y-1 px-3 py-3">
              {NAVIGATION_LINKS.map((link) => (
                <Link key={link.href} href={link.href} className={getMobileNavLinkClass(isActive(link.href))}>
                  {t(link.labelKey)}
                </Link>
              ))}
            </div>

            {/* Divider */}
            <div className="my-2 border-t border-white/10"></div>

            {/* Action Buttons */}
            <div className="space-y-3 px-4 py-3">
              {/* About Button */}
              <button
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  setIsInfoDialogOpen(true);
                }}
                className="flex w-full cursor-pointer items-center gap-2 rounded-md bg-orange-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm shadow-orange-950/40 transition-[background-color,transform] hover:bg-orange-500 active:scale-[0.96]"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fillRule="evenodd"
                    d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                    clipRule="evenodd"
                  />
                </svg>
                {t("about")}
              </button>

              {/* Social Links */}
              <div className="grid grid-cols-3 gap-2">
                <a
                  href="https://github.com/Koodattu/wow-guild-progress-tracker"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-gray-200 transition-colors hover:border-white/20 hover:bg-white/10 hover:text-white"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                  </svg>
                </a>
                <a
                  href="https://discord.gg/BgQDncamHZ"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex cursor-pointer items-center justify-center gap-2 rounded-md bg-indigo-600 px-3 py-2.5 text-sm text-white shadow-sm shadow-indigo-950/40 transition-colors hover:bg-indigo-500"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515a.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0a12.64 12.64 0 0 0-.617-1.25a.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057a19.9 19.9 0 0 0 5.993 3.03a.078.078 0 0 0 .084-.028a14.09 14.09 0 0 0 1.226-1.994a.076.076 0 0 0-.041-.106a13.107 13.107 0 0 1-1.872-.892a.077.077 0 0 1-.008-.128a10.2 10.2 0 0 0 .372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127a12.299 12.299 0 0 1-1.873.892a.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028a19.839 19.839 0 0 0 6.002-3.03a.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.956-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.955-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.946 2.418-2.157 2.418z" />
                  </svg>
                </a>
                <a
                  href="https://www.twitch.tv/vaarattu"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-purple-300/20 bg-purple-400/10 px-3 py-2.5 text-sm text-purple-100 transition-colors hover:border-purple-300/35 hover:bg-purple-400/20 hover:text-white"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z" />
                  </svg>
                </a>
              </div>

              {/* Login Button or User Profile (Mobile) */}
              {isLoading ? (
                <div className="flex w-full items-center justify-center gap-2 rounded-md border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm text-gray-400">
                  <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin"></div>
                </div>
              ) : user ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-3 rounded-md border border-white/10 bg-white/[0.04] px-3 py-2">
                    <img src={user.discord.avatarUrl} alt={user.discord.username} className="w-10 h-10 rounded-full" />
                    <span className="text-white font-medium">{user.discord.username}</span>
                  </div>
                  <Link
                    href="/profile"
                    onClick={() => setIsMobileMenuOpen(false)}
                    className="flex w-full cursor-pointer items-center gap-2 rounded-md border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-gray-200 transition-colors hover:border-white/20 hover:bg-white/10 hover:text-white"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                    </svg>
                    {t("profile")}
                  </Link>
                  {user.isAdmin && (
                    <Link
                      href="/admin"
                      onClick={() => setIsMobileMenuOpen(false)}
                      className="flex w-full cursor-pointer items-center gap-2 rounded-md border border-amber-300/20 bg-amber-400/10 px-4 py-2.5 text-sm font-medium text-amber-100 transition-colors hover:border-amber-300/35 hover:bg-amber-400/20 hover:text-white"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                        <path
                          fillRule="evenodd"
                          d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z"
                          clipRule="evenodd"
                        />
                      </svg>
                      {t("adminPanel")}
                    </Link>
                  )}
                  <button
                    onClick={() => {
                      setIsMobileMenuOpen(false);
                      logout();
                    }}
                    className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-md border border-red-300/20 bg-red-400/10 px-4 py-2.5 text-sm font-medium text-red-100 transition-colors hover:border-red-300/35 hover:bg-red-400/20 hover:text-white"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                      <path
                        fillRule="evenodd"
                        d="M3 3a1 1 0 00-1 1v12a1 1 0 001 1h12a1 1 0 001-1V4a1 1 0 00-1-1H3zm10.293 9.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L14.586 9H7a1 1 0 100 2h7.586l-1.293 1.293z"
                        clipRule="evenodd"
                      />
                    </svg>
                    {t("logout")}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => {
                    setIsMobileMenuOpen(false);
                    login();
                  }}
                  className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-md bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm shadow-indigo-950/50 transition-[background-color,transform] hover:bg-indigo-500 active:scale-[0.96]"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515a.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0a12.64 12.64 0 0 0-.617-1.25a.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057a19.9 19.9 0 0 0 5.993 3.03a.078.078 0 0 0 .084-.028a14.09 14.09 0 0 0 1.226-1.994a.076.076 0 0 0-.041-.106a13.107 13.107 0 0 1-1.872-.892a.077.077 0 0 1-.008-.128a10.2 10.2 0 0 0 .372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127a12.299 12.299 0 0 1-1.873.892a.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028a19.839 19.839 0 0 0 6.002-3.03a.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.956-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.955-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.946 2.418-2.157 2.418z" />
                  </svg>
                  {t("loginWithDiscord")}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Info Dialog */}
      {isInfoDialogOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={() => setIsInfoDialogOpen(false)}>
          <div className="bg-gray-800 rounded-lg p-6 max-w-lg mx-4 border border-blue-500 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-4">
              <div className="shrink-0 text-3xl" aria-hidden="true">
                💙
              </div>
              <div className="flex-1">
                <h3 className="text-xl font-bold text-white mb-3">{tInfo("title")}</h3>
                <p className="text-gray-300 mb-3">{tInfo("description")}</p>
                <p className="text-gray-300 mb-3">{tInfo("community")}</p>
                <p className="text-gray-300 mb-3">{tInfo("noMonetization")}</p>
                <p className="text-gray-300 mb-3">{tInfo("asIs")}</p>
                <p className="text-gray-300 mb-4">{tInfo("contact")}</p>
                <p className="text-gray-400 text-sm">{tInfo("dataSource")}</p>
              </div>
            </div>
            <div className="mt-6 flex justify-end">
              <button onClick={() => setIsInfoDialogOpen(false)} className="cursor-pointer rounded-md bg-blue-600 px-4 py-2 font-medium text-white transition-colors hover:bg-blue-500">
                {tInfo("close")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
