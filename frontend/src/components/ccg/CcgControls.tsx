"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { FaBullhorn, FaChevronDown, FaGlobe, FaMicrophoneLines, FaVolumeHigh, FaVolumeXmark } from "react-icons/fa6";
import {
  CCG_AUDIO_PREFERENCES_EVENT,
  CCG_AUDIO_PREFERENCES_KEY,
  DEFAULT_CCG_AUDIO_PREFERENCES,
  getCcgAudioPreferences,
  setCcgAudioPreferences,
  type CcgAudioPreferences,
} from "@/lib/ccg-audio";
import { getLocale, LOCALE_CHANGE_EVENT, setLocale, type Locale } from "@/lib/locale";
import styles from "./ccg.module.css";

type AudioToggleKey = "enabled" | "effectsEnabled" | "announcerEnabled" | "quipsEnabled";
type AudioVolumeKey = "volume" | "effectsVolume" | "announcerVolume" | "quipsVolume";

export default function CcgControls() {
  const t = useTranslations("ccg.settings");
  const [preferences, setPreferences] = useState<CcgAudioPreferences>(DEFAULT_CCG_AUDIO_PREFERENCES);
  const [locale, setCurrentLocale] = useState<Locale>("en");
  const [isMixerOpen, setIsMixerOpen] = useState(false);
  const mixerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPreferences(getCcgAudioPreferences());
    setCurrentLocale(getLocale());

    const handleAudioChange = (event: Event) => {
      setPreferences((event as CustomEvent<CcgAudioPreferences>).detail);
    };
    const handleLocaleChange = (event: Event) => {
      setCurrentLocale((event as CustomEvent<Locale>).detail);
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === CCG_AUDIO_PREFERENCES_KEY) setPreferences(getCcgAudioPreferences());
    };

    window.addEventListener(CCG_AUDIO_PREFERENCES_EVENT, handleAudioChange);
    window.addEventListener(LOCALE_CHANGE_EVENT, handleLocaleChange);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener(CCG_AUDIO_PREFERENCES_EVENT, handleAudioChange);
      window.removeEventListener(LOCALE_CHANGE_EVENT, handleLocaleChange);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  useEffect(() => {
    if (!isMixerOpen) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!mixerRef.current?.contains(event.target as Node)) setIsMixerOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsMixerOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [isMixerOpen]);

  const updatePreferences = (update: Partial<CcgAudioPreferences>) => {
    const next = { ...preferences, ...update };
    setPreferences(next);
    setCcgAudioPreferences(next);
  };

  const toggleAudio = (key: AudioToggleKey) => updatePreferences({ [key]: !preferences[key] });
  const changeVolume = (key: AudioVolumeKey, value: string) => updatePreferences({ [key]: Number(value) });

  const audioRows: Array<{
    label: string;
    toggleKey: AudioToggleKey;
    volumeKey: AudioVolumeKey;
    icon: typeof FaVolumeHigh;
  }> = [
    { label: t("sound"), toggleKey: "enabled", volumeKey: "volume", icon: FaVolumeHigh },
    { label: t("effects"), toggleKey: "effectsEnabled", volumeKey: "effectsVolume", icon: FaVolumeHigh },
    { label: t("announcer"), toggleKey: "announcerEnabled", volumeKey: "announcerVolume", icon: FaBullhorn },
    { label: t("quips"), toggleKey: "quipsEnabled", volumeKey: "quipsVolume", icon: FaMicrophoneLines },
  ];

  return (
    <div className={styles.shellControls}>
      <div ref={mixerRef} className={styles.audioControl}>
        <button
          type="button"
          className={`${styles.shellUtilityButton} ${styles.audioToggleButton}`}
          onClick={() => toggleAudio("enabled")}
          aria-label={preferences.enabled ? t("muteAll") : t("unmuteAll")}
          aria-pressed={preferences.enabled}
          title={preferences.enabled ? t("muteAll") : t("unmuteAll")}
        >
          {preferences.enabled ? <FaVolumeHigh aria-hidden="true" /> : <FaVolumeXmark aria-hidden="true" />}
        </button>
        <button
          type="button"
          className={`${styles.shellUtilityButton} ${styles.audioMixerButton}`}
          onClick={() => setIsMixerOpen((open) => !open)}
          aria-label={t("audioSettings")}
          aria-expanded={isMixerOpen}
          aria-haspopup="dialog"
          title={t("audioSettings")}
        >
          <FaChevronDown className={isMixerOpen ? styles.utilityChevronOpen : ""} aria-hidden="true" />
        </button>

        {isMixerOpen ? (
          <div className={styles.audioPopover} role="dialog" aria-label={t("audioSettings")}>
            <div className={styles.audioPopoverTitle}>{t("audioSettings")}</div>
            {audioRows.map((row) => {
              const Icon = row.icon;
              const enabled = preferences[row.toggleKey];
              const channelUnavailable = row.toggleKey !== "enabled" && !preferences.enabled;
              const percent = Math.round(preferences[row.volumeKey] * 100);
              return (
                <div key={row.toggleKey} className={styles.audioRow}>
                  <button
                    type="button"
                    className={`${styles.audioRowToggle} ${enabled ? styles.audioRowToggleActive : ""}`}
                    onClick={() => toggleAudio(row.toggleKey)}
                    aria-label={enabled ? t("disable", { channel: row.label }) : t("enable", { channel: row.label })}
                    aria-pressed={enabled}
                  >
                    {enabled ? <Icon aria-hidden="true" /> : <FaVolumeXmark aria-hidden="true" />}
                  </button>
                  <label className={styles.audioRowControl}>
                    <span>
                      <strong>{row.label}</strong>
                      <output>{percent}%</output>
                    </span>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={preferences[row.volumeKey]}
                      onChange={(event) => changeVolume(row.volumeKey, event.target.value)}
                      disabled={!enabled || channelUnavailable}
                      aria-label={t("volume", { channel: row.label })}
                    />
                  </label>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>

      <button
        type="button"
        className={`${styles.shellUtilityButton} ${styles.languageButton}`}
        onClick={() => setLocale(locale === "en" ? "fi" : "en")}
        aria-label={t("switchLanguage", { language: locale === "en" ? "Suomi" : "English" })}
        title={t("switchLanguage", { language: locale === "en" ? "Suomi" : "English" })}
      >
        <FaGlobe aria-hidden="true" />
        <span>{locale.toUpperCase()}</span>
      </button>
    </div>
  );
}
