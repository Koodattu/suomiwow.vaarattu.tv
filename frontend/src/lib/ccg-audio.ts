export const CCG_INSPECT_AUDIO_ID = "ccg-inspect-audio";

export function playCcgInspectSound(): void {
  if (typeof document === "undefined") return;
  const source = document.getElementById(CCG_INSPECT_AUDIO_ID);
  if (!(source instanceof HTMLAudioElement)) return;
  const playback = source.cloneNode(true) as HTMLAudioElement;
  playback.volume = 0.28;
  void playback.play().catch(() => undefined);
}
