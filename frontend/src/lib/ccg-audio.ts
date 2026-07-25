import type { CcgFinish, CcgTierGrade } from "@/types";
import { CCG_RARITY_KEYS } from "@/lib/ccg";
import type { Locale } from "@/lib/locale";

export const CCG_INSPECT_AUDIO_ID = "ccg-inspect-audio";
export const CCG_AUDIO_PREFERENCES_EVENT = "ccg-audio-preferences-change";

export const CCG_AUDIO_PREFERENCES_KEY = "suomiwow-ccg-audio-v1";

export type CcgAudioChannel = "effects" | "announcer" | "quips";

type AnnouncerVariant = "a" | "b";
type AnnouncerKey = `${CcgFinish}-${(typeof CCG_RARITY_KEYS)[CcgTierGrade]}`;

const CCG_ANNOUNCER_BASELINE_VOLUME = 0.5;

const CCG_ANNOUNCER_VARIANTS: Record<Locale, Partial<Record<AnnouncerKey, readonly AnnouncerVariant[]>>> = {
  en: {
    "standard-artifact": ["a", "b"],
    "standard-legendary": ["a", "b"],
    "standard-epic": ["a", "b"],
    "standard-rare": ["a", "b"],
    "foil-artifact": ["a", "b"],
    "foil-legendary": ["a", "b"],
    "foil-epic": ["a", "b"],
    "foil-rare": ["a", "b"],
    "golden-artifact": ["a", "b"],
    "golden-legendary": ["a", "b"],
    "golden-epic": ["a", "b"],
    "golden-rare": ["a", "b"],
    "golden-uncommon": ["a", "b"],
    "golden-common": ["a", "b"],
    "golden-poor": ["a", "b"],
    "prismatic-artifact": ["a", "b"],
    "prismatic-legendary": ["a", "b"],
    "prismatic-epic": ["a", "b"],
    "prismatic-rare": ["a", "b"],
    "prismatic-uncommon": ["a", "b"],
    "prismatic-common": ["a", "b"],
    "prismatic-poor": ["a", "b"],
    "holographic-artifact": ["a", "b"],
    "holographic-legendary": ["a", "b"],
    "holographic-epic": ["a", "b"],
    "holographic-rare": ["a", "b"],
    "holographic-common": ["a", "b"],
    "holographic-poor": ["a", "b"],
    "negative-artifact": ["a", "b"],
    "negative-legendary": ["a", "b"],
    "negative-epic": ["a", "b"],
    "negative-rare": ["a", "b"],
    "negative-uncommon": ["a", "b"],
    "negative-common": ["a", "b"],
    "negative-poor": ["a", "b"],
  },
  fi: {
    "standard-artifact": ["a"],
    "standard-legendary": ["a"],
    "standard-epic": ["a", "b"],
    "standard-rare": ["b"],
    "foil-artifact": ["a", "b"],
    "foil-epic": ["a", "b"],
    "foil-rare": ["a", "b"],
    "golden-artifact": ["b"],
    "golden-legendary": ["b"],
    "golden-epic": ["b"],
    "golden-rare": ["a"],
    "golden-uncommon": ["a", "b"],
    "golden-common": ["a", "b"],
    "golden-poor": ["b"],
    "prismatic-artifact": ["a", "b"],
    "prismatic-legendary": ["a", "b"],
    "prismatic-epic": ["a", "b"],
    "prismatic-rare": ["a", "b"],
    "prismatic-uncommon": ["a", "b"],
    "prismatic-common": ["a", "b"],
    "prismatic-poor": ["a", "b"],
    "holographic-artifact": ["a", "b"],
    "holographic-legendary": ["a", "b"],
    "holographic-epic": ["a"],
    "holographic-rare": ["a"],
    "holographic-uncommon": ["a"],
    "holographic-common": ["a", "b"],
    "holographic-poor": ["a", "b"],
    "negative-legendary": ["a", "b"],
    "negative-epic": ["b"],
    "negative-rare": ["a", "b"],
    "negative-uncommon": ["a", "b"],
    "negative-common": ["b"],
    "negative-poor": ["a", "b"],
  },
};

export type CcgAudioPreferences = {
  enabled: boolean;
  volume: number;
  effectsEnabled: boolean;
  effectsVolume: number;
  announcerEnabled: boolean;
  announcerVolume: number;
  quipsEnabled: boolean;
  quipsVolume: number;
};

export const DEFAULT_CCG_AUDIO_PREFERENCES: CcgAudioPreferences = {
  enabled: true,
  volume: 1,
  effectsEnabled: true,
  effectsVolume: 1,
  announcerEnabled: true,
  announcerVolume: 1,
  quipsEnabled: true,
  quipsVolume: 1,
};

function clampVolume(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;
}

function normalizePreferences(value: unknown): CcgAudioPreferences {
  const stored = value && typeof value === "object" ? value as Partial<CcgAudioPreferences> : {};
  return {
    enabled: typeof stored.enabled === "boolean" ? stored.enabled : DEFAULT_CCG_AUDIO_PREFERENCES.enabled,
    volume: clampVolume(stored.volume, DEFAULT_CCG_AUDIO_PREFERENCES.volume),
    effectsEnabled: typeof stored.effectsEnabled === "boolean" ? stored.effectsEnabled : DEFAULT_CCG_AUDIO_PREFERENCES.effectsEnabled,
    effectsVolume: clampVolume(stored.effectsVolume, DEFAULT_CCG_AUDIO_PREFERENCES.effectsVolume),
    announcerEnabled: typeof stored.announcerEnabled === "boolean" ? stored.announcerEnabled : DEFAULT_CCG_AUDIO_PREFERENCES.announcerEnabled,
    announcerVolume: clampVolume(stored.announcerVolume, DEFAULT_CCG_AUDIO_PREFERENCES.announcerVolume),
    quipsEnabled: typeof stored.quipsEnabled === "boolean" ? stored.quipsEnabled : DEFAULT_CCG_AUDIO_PREFERENCES.quipsEnabled,
    quipsVolume: clampVolume(stored.quipsVolume, DEFAULT_CCG_AUDIO_PREFERENCES.quipsVolume),
  };
}

export function getCcgAudioPreferences(): CcgAudioPreferences {
  if (typeof window === "undefined") return DEFAULT_CCG_AUDIO_PREFERENCES;
  try {
    return normalizePreferences(JSON.parse(window.localStorage.getItem(CCG_AUDIO_PREFERENCES_KEY) ?? "null"));
  } catch {
    return DEFAULT_CCG_AUDIO_PREFERENCES;
  }
}

export function setCcgAudioPreferences(preferences: CcgAudioPreferences): void {
  if (typeof window === "undefined") return;
  const normalized = normalizePreferences(preferences);
  window.localStorage.setItem(CCG_AUDIO_PREFERENCES_KEY, JSON.stringify(normalized));
  window.dispatchEvent(new CustomEvent<CcgAudioPreferences>(CCG_AUDIO_PREFERENCES_EVENT, { detail: normalized }));
}

export function getCcgPlaybackVolume(channel: CcgAudioChannel, baseVolume = 1): number {
  const preferences = getCcgAudioPreferences();
  if (!preferences.enabled) return 0;
  if (channel === "effects" && !preferences.effectsEnabled) return 0;
  if (channel === "announcer" && !preferences.announcerEnabled) return 0;
  if (channel === "quips" && !preferences.quipsEnabled) return 0;
  const channelVolume = channel === "effects"
    ? preferences.effectsVolume
    : channel === "announcer"
      ? preferences.announcerVolume
      : preferences.quipsVolume;
  const channelBaseline = channel === "announcer" ? CCG_ANNOUNCER_BASELINE_VOLUME : 1;
  return clampVolume(baseVolume, 1) * channelBaseline * preferences.volume * channelVolume;
}

export function getCcgAnnouncerSoundSources(locale: Locale, finish: CcgFinish, tierGrade: CcgTierGrade): string[] {
  const rarity = CCG_RARITY_KEYS[tierGrade];
  const key: AnnouncerKey = `${finish}-${rarity}`;
  const variants = CCG_ANNOUNCER_VARIANTS[locale][key] ?? [];
  const directory = finish === "standard" ? "standard-rarity-only" : finish;
  const localePrefix = locale === "fi" ? "fi-" : "";
  return variants.map((variant) => `/ccg/audio/announcer/${locale}/${directory}/${localePrefix}${finish}-${rarity}-${variant}.mp3`);
}

export function playCcgInspectSound(): void {
  if (typeof document === "undefined") return;
  const source = document.getElementById(CCG_INSPECT_AUDIO_ID);
  if (!(source instanceof HTMLAudioElement)) return;
  const volume = getCcgPlaybackVolume("effects", 0.28);
  if (volume <= 0) return;
  const playback = source.cloneNode(true) as HTMLAudioElement;
  playback.volume = volume;
  void playback.play().catch(() => undefined);
}

let activeQuipAudio: HTMLAudioElement | null = null;

export function playCcgQuip(audioPath: string | null | undefined, baseVolume = 0.9): boolean {
  if (typeof window === "undefined" || !audioPath) return false;
  const volume = getCcgPlaybackVolume("quips", baseVolume);
  if (volume <= 0) return false;
  activeQuipAudio?.pause();
  const playback = new Audio(audioPath);
  activeQuipAudio = playback;
  playback.volume = volume;
  playback.addEventListener("ended", () => {
    if (activeQuipAudio === playback) activeQuipAudio = null;
  }, { once: true });
  void playback.play().catch(() => {
    if (activeQuipAudio === playback) activeQuipAudio = null;
  });
  return true;
}
