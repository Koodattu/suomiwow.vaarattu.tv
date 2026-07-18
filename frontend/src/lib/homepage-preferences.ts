"use client";

import { useCallback, useEffect, useState } from "react";

export interface HomePagePreferences {
  showEvents: boolean;
  showLivestreams: boolean;
  showHighlights: boolean;
  showRaidingToday: boolean;
}

const SHOW_EVENTS_STORAGE_KEY = "home-show-events";
const SHOW_LIVESTREAMS_STORAGE_KEY = "home-show-livestreams";
const SHOW_HIGHLIGHTS_STORAGE_KEY = "home-show-highlights";
const SHOW_RAIDING_TODAY_STORAGE_KEY = "home-show-raiding-today";
const HOME_PAGE_PREFERENCES_CHANGE_EVENT = "home-page-preferences-change";

const DEFAULT_HOME_PAGE_PREFERENCES: HomePagePreferences = {
  showEvents: true,
  showLivestreams: true,
  showHighlights: true,
  showRaidingToday: true,
};

function readStoredBoolean(key: string, defaultValue: boolean) {
  const storedValue = window.localStorage.getItem(key);
  if (storedValue === null) return defaultValue;
  return storedValue === "true";
}

export function readHomePagePreferences(): HomePagePreferences {
  if (typeof window === "undefined") return DEFAULT_HOME_PAGE_PREFERENCES;

  return {
    showEvents: readStoredBoolean(SHOW_EVENTS_STORAGE_KEY, DEFAULT_HOME_PAGE_PREFERENCES.showEvents),
    showLivestreams: readStoredBoolean(SHOW_LIVESTREAMS_STORAGE_KEY, DEFAULT_HOME_PAGE_PREFERENCES.showLivestreams),
    showHighlights: readStoredBoolean(SHOW_HIGHLIGHTS_STORAGE_KEY, DEFAULT_HOME_PAGE_PREFERENCES.showHighlights),
    showRaidingToday: readStoredBoolean(SHOW_RAIDING_TODAY_STORAGE_KEY, DEFAULT_HOME_PAGE_PREFERENCES.showRaidingToday),
  };
}

function writeHomePagePreferences(preferences: HomePagePreferences) {
  window.localStorage.setItem(SHOW_EVENTS_STORAGE_KEY, String(preferences.showEvents));
  window.localStorage.setItem(SHOW_LIVESTREAMS_STORAGE_KEY, String(preferences.showLivestreams));
  window.localStorage.setItem(SHOW_HIGHLIGHTS_STORAGE_KEY, String(preferences.showHighlights));
  window.localStorage.setItem(SHOW_RAIDING_TODAY_STORAGE_KEY, String(preferences.showRaidingToday));
  window.dispatchEvent(new CustomEvent<HomePagePreferences>(HOME_PAGE_PREFERENCES_CHANGE_EVENT, { detail: preferences }));
}

export function useHomePagePreferences() {
  const [preferences, setPreferencesState] = useState<HomePagePreferences>(DEFAULT_HOME_PAGE_PREFERENCES);

  useEffect(() => {
    setPreferencesState(readHomePagePreferences());

    const handlePreferencesChange = (event: Event) => {
      setPreferencesState((event as CustomEvent<HomePagePreferences>).detail);
    };

    const handleStorageChange = (event: StorageEvent) => {
      if (
        event.key === SHOW_EVENTS_STORAGE_KEY ||
        event.key === SHOW_LIVESTREAMS_STORAGE_KEY ||
        event.key === SHOW_HIGHLIGHTS_STORAGE_KEY ||
        event.key === SHOW_RAIDING_TODAY_STORAGE_KEY
      ) {
        setPreferencesState(readHomePagePreferences());
      }
    };

    window.addEventListener(HOME_PAGE_PREFERENCES_CHANGE_EVENT, handlePreferencesChange);
    window.addEventListener("storage", handleStorageChange);
    return () => {
      window.removeEventListener(HOME_PAGE_PREFERENCES_CHANGE_EVENT, handlePreferencesChange);
      window.removeEventListener("storage", handleStorageChange);
    };
  }, []);

  const updatePreferences = useCallback((nextValues: Partial<HomePagePreferences>) => {
    const nextPreferences = { ...readHomePagePreferences(), ...nextValues };
    setPreferencesState(nextPreferences);
    writeHomePagePreferences(nextPreferences);
  }, []);

  const setShowEvents = useCallback((showEvents: boolean) => updatePreferences({ showEvents }), [updatePreferences]);
  const setShowLivestreams = useCallback((showLivestreams: boolean) => updatePreferences({ showLivestreams }), [updatePreferences]);
  const setShowHighlights = useCallback((showHighlights: boolean) => updatePreferences({ showHighlights }), [updatePreferences]);
  const setShowRaidingToday = useCallback((showRaidingToday: boolean) => updatePreferences({ showRaidingToday }), [updatePreferences]);

  return { ...preferences, setShowEvents, setShowLivestreams, setShowHighlights, setShowRaidingToday };
}
