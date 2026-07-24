export const CCG_INSPECT_AUDIO_ID = "ccg-inspect-audio";
export const CCG_AUDIO_PREFERENCES_EVENT = "ccg-audio-preferences-change";

export const CCG_AUDIO_PREFERENCES_KEY = "suomiwow-ccg-audio-v1";

export type CcgAudioChannel = "effects" | "announcer";

export type CcgAudioPreferences = {
  enabled: boolean;
  volume: number;
  effectsEnabled: boolean;
  effectsVolume: number;
  announcerEnabled: boolean;
  announcerVolume: number;
};

export const DEFAULT_CCG_AUDIO_PREFERENCES: CcgAudioPreferences = {
  enabled: true,
  volume: 1,
  effectsEnabled: true,
  effectsVolume: 1,
  announcerEnabled: true,
  announcerVolume: 1,
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
  const channelVolume = channel === "effects" ? preferences.effectsVolume : preferences.announcerVolume;
  return clampVolume(baseVolume, 1) * preferences.volume * channelVolume;
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
