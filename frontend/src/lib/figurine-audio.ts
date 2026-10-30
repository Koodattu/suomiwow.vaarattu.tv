import type { FigurineCue } from "@/lib/figurine-reveal";

// Generated with ElevenLabs sound effects and mastered offline (trimmed to the
// transient, loudness-matched); volumes here only balance the mix. Every play picks a random
// variant and nudges its speed by up to `jitter`, so repeats never sound identical. The music
// bed, riser and hum stay at pitch so they keep resolving into the hit.
export const FIGURINE_SOUNDS: Record<FigurineCue, { files: readonly string[]; volume: number; jitter?: number }> = {
  tap: { files: ["tap-a", "tap-b"], volume: 0.45, jitter: 0.06 },
  // A bagged vinyl figure bumping thin cardboard: dull, low thumps, low-passed so nothing clicks.
  rattle: { files: ["rattle-a", "rattle-b", "rattle-c", "rattle-d", "rattle-e"], volume: 0.8, jitter: 0.06 },
  rip: { files: ["rip-a", "rip-b"], volume: 0.85, jitter: 0.04 },
  music: { files: ["music-a", "music-b"], volume: 0.55 },
  knock: { files: ["knock-a", "knock-b", "knock-c"], volume: 0.7, jitter: 0.08 },
  riser: { files: ["riser-a", "riser-b"], volume: 0.32 },
  hum: { files: ["hum", "hum-b"], volume: 0.45 },
  peel: { files: ["peel-a", "peel-b"], volume: 0.7 },
  stick: { files: ["stick-a", "stick-b"], volume: 0.6, jitter: 0.06 },
  ready: { files: ["ready-a", "ready-b"], volume: 0.5, jitter: 0.03 },
  burst: { files: ["burst-a", "burst-b"], volume: 0.75, jitter: 0.03 },
  hit: { files: ["hit-a", "hit-b"], volume: 0.85, jitter: 0.03 },
  boom: { files: ["boom-a", "boom-b", "boom-c"], volume: 0.8, jitter: 0.04 },
  whoosh: { files: ["whoosh-a", "whoosh-b"], volume: 0.45, jitter: 0.05 },
  choir: { files: ["choir-a", "choir-b"], volume: 0.5, jitter: 0.02 },
  rise: { files: ["rise-a", "rise-b"], volume: 0.25, jitter: 0.03 },
  sparkle: { files: ["sparkle-a", "sparkle-b"], volume: 0.45, jitter: 0.04 },
  // One heavy, neutral impact for every figure: a punchy knock layered over a synthesized sub
  // thump (95 Hz falling to ~42), under a short hit-stop. The class signature follows it.
  land: { files: ["land-a", "land-b", "land-c", "land-d"], volume: 1, jitter: 0.03 },
  // Per-class files are chosen at play time from the drawn figure's class.
  signature: { files: [], volume: 0.6, jitter: 0.03 },
  fanfare: { files: ["fanfare-a", "fanfare-b", "fanfare-c"], volume: 0.6, jitter: 0.02 },
  drop: { files: ["drop-a", "drop-b"], volume: 0.6, jitter: 0.04 },
};
const sourceFor = (file: string) => `/figurines/audio/${file}.mp3`;
const signatureFiles = (classKey?: string) => classKey && /^[a-zA-Z]+$/.test(classKey) ? [`class-${classKey}-a`, `class-${classKey}-b`] : [];
// A cue that cannot start on time is dropped instead of playing out of sync.
const MAX_LATENCY_MS = 220;
const LOOP_TRIM = 0.05;

export const FIGURINE_AUDIO_MUTED_KEY = "suomiwow-figurine-audio-muted";
let context: AudioContext | null = null;
let master: GainNode | null = null;
const buffers = new Map<string, Promise<AudioBuffer | null>>();
// Downloaded file bytes, kept so decoding never waits on the network (and survives a new context).
const downloads = new Map<string, Promise<ArrayBuffer | null>>();
function download(file: string): Promise<ArrayBuffer | null> {
  let pending = downloads.get(file);
  if (!pending) {
    pending = fetch(sourceFor(file)).then((response) => { if (!response.ok) throw new Error("Sound unavailable"); return response.arrayBuffer(); })
      .catch(() => { downloads.delete(file); return null; });
    downloads.set(file, pending);
  }
  return pending;
}

// Downloads every cue's variants and the given classes' signatures, reporting progress (0..1).
// Needs no user gesture: decoding waits for the audio context that the first tap creates.
export function prefetchFigurineAudio(classKeys: readonly string[], onProgress?: (fraction: number) => void): Promise<void> {
  const files = [...new Set([...Object.values(FIGURINE_SOUNDS).flatMap(({ files }) => files), ...classKeys.flatMap(signatureFiles)])];
  let done = 0;
  return Promise.all(files.map((file) => download(file).then(() => onProgress?.(++done / files.length)))).then(() => undefined);
}

export function getFigurineAudioMuted(): boolean {
  try { return window.localStorage.getItem(FIGURINE_AUDIO_MUTED_KEY) === "1"; } catch { return false; }
}

export function setFigurineAudioMuted(muted: boolean): void {
  try { window.localStorage.setItem(FIGURINE_AUDIO_MUTED_KEY, muted ? "1" : "0"); } catch { /* preference is optional */ }
  if (context && master) master.gain.setTargetAtTime(muted ? 0 : 1, context.currentTime, 0.03);
}

function load(file: string): Promise<AudioBuffer | null> {
  const cached = buffers.get(file);
  if (cached || !context) return cached ?? Promise.resolve(null);
  const audio = context;
  // decodeAudioData detaches its input, so it gets a copy and the download stays reusable.
  const pending = download(file)
    .then((data) => { if (!data) throw new Error("Sound unavailable"); return audio.decodeAudioData(data.slice(0)); })
    .catch(() => { buffers.delete(file); return null; });
  buffers.set(file, pending);
  return pending;
}

// Must run inside a user gesture; before that, cues are silently skipped.
export function unlockFigurineAudio(): void {
  if (typeof window === "undefined" || !window.AudioContext) return;
  if (!context || context.state === "closed") {
    context = new window.AudioContext();
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -6; limiter.knee.value = 6; limiter.ratio.value = 12;
    limiter.attack.value = 0.002; limiter.release.value = 0.15;
    master = context.createGain();
    master.gain.value = getFigurineAudioMuted() ? 0 : 1;
    master.connect(limiter).connect(context.destination);
    buffers.clear();
    Object.values(FIGURINE_SOUNDS).forEach(({ files }) => files.forEach((file) => void load(file)));
  }
  if (context.state === "suspended") void context.resume().catch(() => undefined);
}

// Loads the drawn figure's landing signature during the build-up.
export function preloadFigurineSignature(classKey: string): void {
  if (context) signatureFiles(classKey).forEach((file) => void load(file));
}

export function playFigurineCue(cue: FigurineCue, { loop = false, intensity = 1, signature }: { loop?: boolean; intensity?: number; signature?: string } = {}): () => void {
  let stopped = false;
  let stop = () => { stopped = true; };
  if (!context || !master) return () => stop();
  const audio = context, output = master;
  const sound = FIGURINE_SOUNDS[cue];
  const files = cue === "signature" ? signatureFiles(signature) : sound.files;
  if (!files.length) return () => stop();
  const file = files[Math.floor(Math.random() * files.length)];
  const requested = performance.now();
  const resumed = audio.state === "suspended" ? audio.resume().catch(() => undefined) : undefined;
  void Promise.all([load(file), resumed]).then(([buffer]) => {
    if (stopped || !buffer || audio.state !== "running" || (!loop && performance.now() - requested > MAX_LATENCY_MS)) return;
    const playback = audio.createBufferSource();
    const gain = audio.createGain();
    playback.buffer = buffer;
    playback.loop = loop;
    // MP3 pads both ends with silence; looping between inner points keeps loops seamless.
    if (loop) { playback.loopStart = LOOP_TRIM; playback.loopEnd = buffer.duration - LOOP_TRIM; }
    playback.playbackRate.value = 1 + (Math.random() * 2 - 1) * (sound.jitter ?? 0);
    const level = sound.volume * intensity;
    if (loop) { gain.gain.setValueAtTime(0, audio.currentTime); gain.gain.setTargetAtTime(level, audio.currentTime, 0.12); }
    else gain.gain.value = level;
    playback.connect(gain).connect(output);
    playback.addEventListener("ended", () => { playback.disconnect(); gain.disconnect(); }, { once: true });
    playback.start();
    stop = () => {
      stopped = true;
      gain.gain.setTargetAtTime(0, audio.currentTime, 0.06);
      playback.stop(audio.currentTime + 0.3);
    };
  });
  return () => stop();
}

// A loop whose level and speed are steered live, e.g. tape crackle that follows the drag.
export function startFigurineLoop(cue: FigurineCue): { set: (level: number, rate?: number) => void; stop: () => void } {
  let level = 0, rate = 1, stopped = false;
  let playback: AudioBufferSourceNode | null = null, gain: GainNode | null = null;
  const audio = context, output = master;
  const sound = FIGURINE_SOUNDS[cue];
  if (audio && output) void load(sound.files[Math.floor(Math.random() * sound.files.length)]).then((buffer) => {
    if (stopped || !buffer || audio.state !== "running") return;
    playback = audio.createBufferSource(); gain = audio.createGain();
    playback.buffer = buffer; playback.loop = true;
    playback.loopStart = LOOP_TRIM; playback.loopEnd = buffer.duration - LOOP_TRIM;
    playback.playbackRate.value = rate; gain.gain.value = level * sound.volume;
    playback.connect(gain).connect(output);
    playback.addEventListener("ended", () => { playback?.disconnect(); gain?.disconnect(); }, { once: true });
    playback.start(0, LOOP_TRIM + Math.random() * (buffer.duration - 2 * LOOP_TRIM));
  });
  return {
    set(nextLevel, nextRate = 1) {
      level = nextLevel; rate = nextRate;
      if (audio && gain && playback) { gain.gain.setTargetAtTime(level * sound.volume, audio.currentTime, 0.03); playback.playbackRate.setTargetAtTime(rate, audio.currentTime, 0.05); }
    },
    stop() {
      stopped = true;
      if (audio && gain && playback) { gain.gain.setTargetAtTime(0, audio.currentTime, 0.04); playback.stop(audio.currentTime + 0.25); }
    },
  };
}
