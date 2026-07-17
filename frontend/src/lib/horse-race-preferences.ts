"use client";

import { useCallback, useEffect, useState } from "react";

export const HORSE_RACE_MODES = ["random", "crest", "japanese", "uma"] as const;
export const HORSE_RACE_VISIBILITIES = ["auto", "show", "hide"] as const;

export type HorseRaceMode = (typeof HORSE_RACE_MODES)[number];
export type HorseRaceVisibility = (typeof HORSE_RACE_VISIBILITIES)[number];
export interface HorseRacePreferences {
  mode: HorseRaceMode;
  visibility: HorseRaceVisibility;
  showCharacters: boolean;
  showBackground: boolean;
}

const MODE_STORAGE_KEY = "horse-race-mode";
const VISIBILITY_STORAGE_KEY = "horse-race-visibility";
const CHARACTERS_STORAGE_KEY = "horse-race-show-characters";
const BACKGROUND_STORAGE_KEY = "horse-race-show-background";
const PREFERENCES_CHANGE_EVENT = "horse-race-preferences-change";
const DEFAULT_MODE: HorseRaceMode = "random";
const DEFAULT_VISIBILITY: HorseRaceVisibility = "auto";
const DEFAULT_SHOW_CHARACTERS = false;
const DEFAULT_SHOW_BACKGROUND = false;
const DEFAULT_PREFERENCES: HorseRacePreferences = {
  mode: DEFAULT_MODE,
  visibility: DEFAULT_VISIBILITY,
  showCharacters: DEFAULT_SHOW_CHARACTERS,
  showBackground: DEFAULT_SHOW_BACKGROUND,
};

function isHorseRaceMode(value: string | null): value is HorseRaceMode {
  return HORSE_RACE_MODES.includes(value as HorseRaceMode);
}

function getInitialMode(storedMode: string | null): HorseRaceMode {
  if (isHorseRaceMode(storedMode)) return storedMode;
  return DEFAULT_MODE;
}

function isHorseRaceVisibility(value: string | null): value is HorseRaceVisibility {
  return HORSE_RACE_VISIBILITIES.includes(value as HorseRaceVisibility);
}

function readStoredPreferences(): HorseRacePreferences {
  if (typeof window === "undefined") return DEFAULT_PREFERENCES;

  const storedMode = window.localStorage.getItem(MODE_STORAGE_KEY);
  const storedVisibility = window.localStorage.getItem(VISIBILITY_STORAGE_KEY);
  const storedCharacters = window.localStorage.getItem(CHARACTERS_STORAGE_KEY);
  const storedBackground = window.localStorage.getItem(BACKGROUND_STORAGE_KEY);
  const mode = getInitialMode(storedMode);
  const visibility = isHorseRaceVisibility(storedVisibility) ? storedVisibility : DEFAULT_VISIBILITY;
  const showCharacters = storedCharacters === null ? DEFAULT_SHOW_CHARACTERS : storedCharacters === "true";
  const showBackground = storedBackground === null ? DEFAULT_SHOW_BACKGROUND : storedBackground === "true";

  if (storedMode !== mode) {
    window.localStorage.setItem(MODE_STORAGE_KEY, mode);
  }

  if (storedVisibility !== visibility) {
    window.localStorage.setItem(VISIBILITY_STORAGE_KEY, visibility);
  }

  if (storedCharacters === null) {
    window.localStorage.setItem(CHARACTERS_STORAGE_KEY, String(showCharacters));
  }

  if (storedBackground === null) {
    window.localStorage.setItem(BACKGROUND_STORAGE_KEY, String(showBackground));
  }

  return {
    mode,
    visibility,
    showCharacters,
    showBackground,
  };
}

function writeStoredPreferences(preferences: HorseRacePreferences) {
  window.localStorage.setItem(MODE_STORAGE_KEY, preferences.mode);
  window.localStorage.setItem(VISIBILITY_STORAGE_KEY, preferences.visibility);
  window.localStorage.setItem(CHARACTERS_STORAGE_KEY, String(preferences.showCharacters));
  window.localStorage.setItem(BACKGROUND_STORAGE_KEY, String(preferences.showBackground));
  window.dispatchEvent(new CustomEvent<HorseRacePreferences>(PREFERENCES_CHANGE_EVENT, { detail: preferences }));
}

export function getNextHorseRaceMode(mode: HorseRaceMode): HorseRaceMode {
  const currentIndex = HORSE_RACE_MODES.indexOf(mode);
  return HORSE_RACE_MODES[(currentIndex + 1) % HORSE_RACE_MODES.length];
}

export function useHorseRaceMode() {
  const [preferences, setPreferencesState] = useState<HorseRacePreferences>(DEFAULT_PREFERENCES);

  useEffect(() => {
    setPreferencesState(readStoredPreferences());

    const handlePreferencesChange = (event: Event) => {
      setPreferencesState((event as CustomEvent<HorseRacePreferences>).detail);
    };

    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === MODE_STORAGE_KEY || event.key === VISIBILITY_STORAGE_KEY || event.key === CHARACTERS_STORAGE_KEY || event.key === BACKGROUND_STORAGE_KEY) {
        setPreferencesState(readStoredPreferences());
      }
    };

    window.addEventListener(PREFERENCES_CHANGE_EVENT, handlePreferencesChange);
    window.addEventListener("storage", handleStorageChange);
    return () => {
      window.removeEventListener(PREFERENCES_CHANGE_EVENT, handlePreferencesChange);
      window.removeEventListener("storage", handleStorageChange);
    };
  }, []);

  const setMode = useCallback((nextMode: HorseRaceMode) => {
    const nextPreferences = { ...readStoredPreferences(), mode: nextMode };
    setPreferencesState(nextPreferences);
    writeStoredPreferences(nextPreferences);
  }, []);

  const setVisibility = useCallback((visibility: HorseRaceVisibility) => {
    const nextPreferences = { ...readStoredPreferences(), visibility };
    setPreferencesState(nextPreferences);
    writeStoredPreferences(nextPreferences);
  }, []);

  const setShowCharacters = useCallback((showCharacters: boolean) => {
    const nextPreferences = { ...readStoredPreferences(), showCharacters };
    setPreferencesState(nextPreferences);
    writeStoredPreferences(nextPreferences);
  }, []);

  const setShowBackground = useCallback((showBackground: boolean) => {
    const nextPreferences = { ...readStoredPreferences(), showBackground };
    setPreferencesState(nextPreferences);
    writeStoredPreferences(nextPreferences);
  }, []);

  const cycleMode = useCallback(() => {
    const currentPreferences = readStoredPreferences();
    const nextPreferences = { ...currentPreferences, mode: getNextHorseRaceMode(currentPreferences.mode) };
    setPreferencesState(nextPreferences);
    writeStoredPreferences(nextPreferences);
  }, []);

  return { ...preferences, setMode, setVisibility, setShowCharacters, setShowBackground, cycleMode };
}
