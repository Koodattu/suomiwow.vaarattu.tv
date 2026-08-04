import type { CcgArtVariant, CcgFinish, CcgTierGrade } from "@/types";
import { CCG_RARITY_KEYS, isCcgRaidFinish } from "@/lib/ccg";
import { getLocale, type Locale } from "@/lib/locale";

export const CCG_AUDIO_PREFERENCES_EVENT = "ccg-audio-preferences-change";

export const CCG_AUDIO_PREFERENCES_KEY = "suomiwow-ccg-audio-v1";

export type CcgAudioChannel = "effects" | "announcer" | "quips";

type AnnouncerVariant = "a" | "b" | "c" | "d";
type AnnouncerQuality = CcgFinish | "unique";
type AnnouncerKey = `${AnnouncerQuality}-${(typeof CCG_RARITY_KEYS)[CcgTierGrade]}`;

const CCG_ANNOUNCER_EXCLAMATIONS = [
  "amazing",
  "holy",
  "impossible",
  "incredible",
  "nice",
  "no-way",
  "oh",
  "unbelievable",
  "whoa",
  "wow",
] as const;

const CCG_ANNOUNCER_COMPONENT_VARIANTS: Record<Locale, readonly AnnouncerVariant[]> = {
  en: ["a", "b", "c", "d"],
  fi: ["a", "b"],
};

const CCG_ANNOUNCER_BASELINE_VOLUME: Record<Locale, number> = {
  en: 0.5,
  fi: 1,
};

const CCG_ANNOUNCER_VARIANTS: Record<Locale, Partial<Record<AnnouncerKey, readonly AnnouncerVariant[]>>> = {
  en: {
    "standard-heirloom": ["a", "b"],
    "standard-artifact": ["a", "b"],
    "standard-legendary": ["a", "b"],
    "standard-epic": ["a", "b"],
    "standard-rare": ["a", "b"],
    "foil-heirloom": ["a", "b"],
    "foil-artifact": ["a", "b"],
    "foil-legendary": ["a", "b"],
    "foil-epic": ["a", "b"],
    "foil-rare": ["a", "b"],
    "golden-heirloom": ["a", "b"],
    "golden-artifact": ["a", "b"],
    "golden-legendary": ["a", "b", "c"],
    "golden-epic": ["a", "b"],
    "golden-rare": ["a", "b"],
    "golden-uncommon": ["a", "b"],
    "golden-common": ["a", "b"],
    "golden-poor": ["a", "b"],
    "prismatic-heirloom": ["a", "b"],
    "prismatic-artifact": ["a", "b"],
    "prismatic-legendary": ["a", "b"],
    "prismatic-epic": ["a", "b"],
    "prismatic-rare": ["a", "b"],
    "prismatic-uncommon": ["a", "b"],
    "prismatic-common": ["a", "b"],
    "prismatic-poor": ["a", "b"],
    "holographic-heirloom": ["a", "b"],
    "holographic-artifact": ["a", "b"],
    "holographic-legendary": ["a", "b"],
    "holographic-epic": ["a", "b"],
    "holographic-rare": ["a", "b"],
    "holographic-uncommon": ["a", "b"],
    "holographic-common": ["a", "b"],
    "holographic-poor": ["a", "b"],
    "void-artifact": ["a", "b"],
    "void-legendary": ["a", "b"],
    "void-epic": ["a", "b"],
    "void-rare": ["a", "b"],
    "void-uncommon": ["a", "b"],
    "void-common": ["a", "b"],
    "void-poor": ["a", "b"],
    "toxic-artifact": ["a", "b"],
    "toxic-legendary": ["a", "b"],
    "toxic-epic": ["a", "b"],
    "toxic-rare": ["a", "b"],
    "toxic-uncommon": ["a", "b"],
    "toxic-common": ["a", "b"],
    "toxic-poor": ["a", "b"],
    "unique-heirloom": ["a", "b"],
    "unique-artifact": ["a", "b"],
    "unique-legendary": ["a", "b"],
    "unique-epic": ["a", "b"],
    "unique-rare": ["a", "b"],
    "unique-uncommon": ["a", "b"],
    "unique-common": ["a", "b"],
    "unique-poor": ["a", "b"],
    "negative-heirloom": ["a", "b"],
    "negative-artifact": ["a", "b"],
    "negative-legendary": ["a", "b"],
    "negative-epic": ["a", "b"],
    "negative-rare": ["a", "b"],
    "negative-uncommon": ["a", "b"],
    "negative-common": ["a", "b"],
    "negative-poor": ["a", "b"],
    "astral-heirloom": ["a", "b"],
    "astral-artifact": ["a", "b"],
    "astral-legendary": ["a", "b"],
    "astral-epic": ["a", "b"],
    "astral-rare": ["a", "b"],
    "astral-uncommon": ["a", "b"],
    "astral-common": ["a", "b"],
    "astral-poor": ["a", "b"],
  },
  fi: {
    "standard-heirloom": ["a", "b"],
    "standard-artifact": ["a", "b"],
    "standard-legendary": ["a", "b"],
    "standard-epic": ["a", "b"],
    "standard-rare": ["a", "b"],
    "foil-heirloom": ["a", "b"],
    "foil-artifact": ["a", "b"],
    "foil-legendary": ["a", "b"],
    "foil-epic": ["a", "b"],
    "foil-rare": ["a", "b"],
    "golden-heirloom": ["a", "b"],
    "golden-artifact": ["a", "b"],
    "golden-legendary": ["a", "b"],
    "golden-epic": ["a", "b"],
    "golden-rare": ["a", "b"],
    "golden-uncommon": ["a", "b"],
    "golden-common": ["a", "b"],
    "golden-poor": ["a", "b"],
    "prismatic-heirloom": ["a", "b"],
    "prismatic-artifact": ["a", "b"],
    "prismatic-legendary": ["a", "b"],
    "prismatic-epic": ["a", "b"],
    "prismatic-rare": ["a", "b"],
    "prismatic-uncommon": ["a", "b"],
    "prismatic-common": ["a", "b"],
    "prismatic-poor": ["a", "b"],
    "holographic-heirloom": ["a", "b"],
    "holographic-artifact": ["a", "b"],
    "holographic-legendary": ["a", "b"],
    "holographic-epic": ["a", "b"],
    "holographic-rare": ["a", "b"],
    "holographic-uncommon": ["a", "b"],
    "holographic-common": ["a", "b"],
    "holographic-poor": ["a", "b"],
    "void-artifact": ["a", "b"],
    "void-legendary": ["a", "b"],
    "void-epic": ["a", "b"],
    "void-rare": ["a", "b"],
    "void-uncommon": ["a", "b"],
    "void-common": ["a", "b"],
    "void-poor": ["a", "b"],
    "toxic-artifact": ["a", "b"],
    "toxic-legendary": ["a", "b"],
    "toxic-epic": ["a", "b"],
    "toxic-rare": ["a", "b"],
    "toxic-uncommon": ["a", "b"],
    "toxic-common": ["a", "b"],
    "toxic-poor": ["a", "b"],
    "unique-heirloom": ["a", "b"],
    "unique-artifact": ["a", "b"],
    "unique-legendary": ["a", "b"],
    "unique-epic": ["a", "b"],
    "unique-rare": ["a", "b"],
    "unique-uncommon": ["a", "b"],
    "unique-common": ["a", "b"],
    "unique-poor": ["a", "b"],
    "negative-heirloom": ["a", "b"],
    "negative-artifact": ["a", "b"],
    "negative-legendary": ["a", "b"],
    "negative-epic": ["a", "b"],
    "negative-rare": ["a", "b"],
    "negative-uncommon": ["a", "b"],
    "negative-common": ["a", "b"],
    "negative-poor": ["a", "b"],
    "astral-heirloom": ["a", "b"],
    "astral-artifact": ["a", "b"],
    "astral-legendary": ["a", "b"],
    "astral-epic": ["a", "b"],
    "astral-rare": ["a", "b"],
    "astral-uncommon": ["a", "b"],
    "astral-common": ["a", "b"],
    "astral-poor": ["a", "b"],
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
  const channelBaseline = channel === "announcer" ? CCG_ANNOUNCER_BASELINE_VOLUME[getLocale()] : 1;
  return clampVolume(baseVolume, 1) * channelBaseline * preferences.volume * channelVolume;
}

export function getCcgAnnouncerSoundSources(
  locale: Locale,
  finish: CcgFinish,
  tierGrade: CcgTierGrade,
  artVariant: CcgArtVariant = "standard",
): string[] {
  const rarity = CCG_RARITY_KEYS[tierGrade];
  const quality: AnnouncerQuality = artVariant === "alternative" || isCcgRaidFinish(finish) ? "unique" : finish;
  const key: AnnouncerKey = `${quality}-${rarity}`;
  const variants = CCG_ANNOUNCER_VARIANTS[locale][key] ?? [];
  const directory = quality === "standard" ? "standard-rarity-only" : quality;
  const localePrefix = locale === "fi" ? "fi-" : "";
  return variants.map((variant) => `/ccg/audio/announcer/${locale}/${directory}/${localePrefix}${quality}-${rarity}-${variant}.mp3`);
}

export type CcgAnnouncerSoundSequence = readonly string[];

export function getCcgAnnouncerSoundSequences(
  locale: Locale,
  finish: CcgFinish,
  tierGrade: CcgTierGrade,
  artVariant: CcgArtVariant = "standard",
): CcgAnnouncerSoundSequence[] {
  if (artVariant === "alternative") {
    return getCcgAnnouncerSoundSources(locale, finish, tierGrade, artVariant).map((source) => [source]);
  }

  const rarity = CCG_RARITY_KEYS[tierGrade];
  const localePrefix = locale === "fi" ? "fi-" : "";
  const basePath = `/ccg/audio/announcer/components/${locale}`;
  return CCG_ANNOUNCER_COMPONENT_VARIANTS[locale].flatMap((variant) => (
    CCG_ANNOUNCER_EXCLAMATIONS.map((exclamation) => [
      `${basePath}/exclamations/${localePrefix}${exclamation}-${variant}.mp3`,
      `${basePath}/qualities/${localePrefix}${finish}-${variant}.mp3`,
      `${basePath}/rarities/${localePrefix}${rarity}-${variant}.mp3`,
    ])
  ));
}

type CcgSoundOptions = {
  playbackRate?: number;
  interruptKey?: string;
};

type ActiveCcgSound = {
  requestId: number;
  source?: AudioBufferSourceNode;
};

const CCG_INSPECT_AUDIO_SOURCE = "/ccg/audio/inspect.mp3";
const ccgAudioBuffers = new Map<string, Promise<AudioBuffer | null>>();
const activeCcgSounds = new Map<string, ActiveCcgSound>();
let ccgAudioContext: AudioContext | null = null;
let nextCcgSoundRequestId = 0;

function getCcgAudioContext(): AudioContext | null {
  if (typeof window === "undefined" || !window.AudioContext) return null;
  if (!ccgAudioContext || ccgAudioContext.state === "closed") {
    ccgAudioContext = new window.AudioContext();
    ccgAudioBuffers.clear();
  }
  return ccgAudioContext;
}

function loadCcgAudioBuffer(context: AudioContext, source: string): Promise<AudioBuffer | null> {
  const cached = ccgAudioBuffers.get(source);
  if (cached) return cached;

  const pending = fetch(source)
    .then((response) => {
      if (!response.ok) throw new Error(`Failed to load CCG audio: ${response.status}`);
      return response.arrayBuffer();
    })
    .then((data) => context.decodeAudioData(data))
    .catch(() => {
      ccgAudioBuffers.delete(source);
      return null;
    });
  ccgAudioBuffers.set(source, pending);
  return pending;
}

export function preloadCcgSounds(sources: readonly (string | null | undefined)[]): void {
  const context = getCcgAudioContext();
  if (!context) return;
  new Set(sources.filter((source): source is string => Boolean(source))).forEach((source) => {
    void loadCcgAudioBuffer(context, source);
  });
}

export function resumeCcgAudio(): void {
  const context = getCcgAudioContext();
  if (context?.state === "suspended") void context.resume().catch(() => undefined);
}

export function playCcgSound(
  source: string | null | undefined,
  channel: CcgAudioChannel,
  baseVolume = 1,
  options: CcgSoundOptions = {},
): boolean {
  if (!source) return false;
  const volume = getCcgPlaybackVolume(channel, baseVolume);
  if (volume <= 0) return false;
  const context = getCcgAudioContext();
  if (!context) return false;

  const requestId = ++nextCcgSoundRequestId;
  if (options.interruptKey) {
    activeCcgSounds.get(options.interruptKey)?.source?.stop();
    activeCcgSounds.set(options.interruptKey, { requestId });
  }

  const resumed = context.state === "suspended"
    ? context.resume().catch(() => undefined)
    : Promise.resolve();
  void Promise.all([loadCcgAudioBuffer(context, source), resumed]).then(([buffer]) => {
    if (!buffer || context.state !== "running") return;
    if (options.interruptKey && activeCcgSounds.get(options.interruptKey)?.requestId !== requestId) return;

    const playback = context.createBufferSource();
    const gain = context.createGain();
    playback.buffer = buffer;
    playback.playbackRate.value = options.playbackRate ?? 1;
    gain.gain.value = volume;
    playback.connect(gain);
    gain.connect(context.destination);

    if (options.interruptKey) activeCcgSounds.set(options.interruptKey, { requestId, source: playback });
    playback.addEventListener("ended", () => {
      if (options.interruptKey && activeCcgSounds.get(options.interruptKey)?.requestId === requestId) {
        activeCcgSounds.delete(options.interruptKey);
      }
      playback.disconnect();
      gain.disconnect();
    }, { once: true });
    playback.start();
  });
  return true;
}

export function playCcgSoundSequence(
  sources: CcgAnnouncerSoundSequence,
  channel: CcgAudioChannel,
  baseVolume = 1,
): boolean {
  if (sources.length === 0) return false;
  const volume = getCcgPlaybackVolume(channel, baseVolume);
  if (volume <= 0) return false;
  const context = getCcgAudioContext();
  if (!context) return false;

  const resumed = context.state === "suspended"
    ? context.resume().catch(() => undefined)
    : Promise.resolve();
  void Promise.all([Promise.all(sources.map((source) => loadCcgAudioBuffer(context, source))), resumed])
    .then(([buffers]) => {
      const available = buffers.filter((buffer): buffer is AudioBuffer => Boolean(buffer));
      if (available.length === 0 || context.state !== "running") return;

      const gain = context.createGain();
      gain.gain.value = volume;
      gain.connect(context.destination);

      let startsAt = context.currentTime;
      const playbacks = available.map((buffer) => {
        const playback = context.createBufferSource();
        playback.buffer = buffer;
        playback.connect(gain);
        playback.start(startsAt);
        startsAt += buffer.duration;
        return playback;
      });

      playbacks.at(-1)?.addEventListener("ended", () => {
        playbacks.forEach((playback) => playback.disconnect());
        gain.disconnect();
      }, { once: true });
    });
  return true;
}

export function playCcgInspectSound(): void {
  playCcgSound(CCG_INSPECT_AUDIO_SOURCE, "effects", 0.28, { interruptKey: "inspect" });
}

export function playCcgQuip(audioPath: string | null | undefined, baseVolume = 0.9): boolean {
  return playCcgSound(audioPath, "quips", baseVolume, { interruptKey: "voice" });
}
