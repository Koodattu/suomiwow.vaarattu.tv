const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const smooth = (value: number) => { const t = clamp01(value); return t * t * (3 - 2 * t); };
const easeOut = (value: number) => 1 - (1 - clamp01(value)) ** 3;
const easeIn = (value: number) => clamp01(value) ** 2;
const easeOutBack = (value: number) => { const t = clamp01(value) - 1; return 1 + 2.70158 * t ** 3 + 1.70158 * t ** 2; };
// A pulse that starts at `at` and reaches exactly zero after `length`, so settled frames are stable.
// A half-sine hop that is exactly zero once finished.
const arc = (value: number) => { const t = clamp01(value); return t >= 1 ? 0 : Math.sin(Math.PI * t); };
const pulse = (time: number, at: number, length: number) => time < at || time >= at + length ? 0 : (1 - (time - at) / length) ** 2;

export type FigurineCue = "tap" | "peel" | "stick" | "ready" | "rip" | "music" | "knock" | "riser" | "hum"
  | "burst" | "hit" | "boom" | "whoosh" | "choir" | "rise" | "sparkle" | "land" | "signature" | "fanfare" | "drop";
export type TimedCue = { at: number; cue: FigurineCue };
// Cues whose time falls in (previous, current]; start each clock at -1 so cues at zero fire.
export const cuesBetween = (cues: readonly TimedCue[], previous: number, current: number) => cues.filter(({ at }) => at > previous && at <= current);

// Build-up while the model loads: the seal rips, music swells, something knocks inside.
// The burst waits for both the model and this minimum; music and riser peak exactly on it.
export const CHARGE_SECONDS = 2.4;
export const KNOCK_TIMES = [0.75, 1.2, 1.6, 1.95] as const;
export const CHARGE_CUES: readonly TimedCue[] = [
  { at: 0, cue: "rip" }, { at: 0.1, cue: "music" }, { at: 0.4, cue: "riser" },
  ...KNOCK_TIMES.map((at) => ({ at, cue: "knock" as const })),
];
export function figurineCharge(seconds: number) {
  const time = Math.max(0, seconds);
  const build = smooth((time - 0.3) / (CHARGE_SECONDS - 0.3));
  let knock = 0, knockSide = 0;
  KNOCK_TIMES.forEach((at, index) => {
    const value = pulse(time, at, 0.24) * (0.55 + 0.45 * index / (KNOCK_TIMES.length - 1));
    if (value > knock) { knock = value; knockSide = index % 2 ? 1 : -1; }
  });
  return {
    build, knock, knockSide,
    // The seal peels up, tears free and tumbles away; the box jolts and light spills from the seam.
    rip: easeOut(time / 0.22), ripFly: easeOut((time - 0.1) / 0.8), jolt: pulse(time, 0.02, 0.25), ripGlow: pulse(time, 0.04, 0.7),
    tremble: smooth((time - 1.45) / 0.95), seam: 0.12 + 0.88 * build, zoom: 1 - 0.1 * build, ready: time >= CHARGE_SECONDS,
  };
}

// Seconds after the burst, paused with the tab. Every transform is absolute
// so repeated openings cannot accumulate offsets on the figure or packaging.
export const LAND_AT = 2.2;
export const REVEAL_SECONDS = 3;
export const REVEAL_CUES: readonly TimedCue[] = [
  // The hit resolves the music swell on the burst; the choir carries the silhouette up the beam.
  { at: 0, cue: "burst" }, { at: 0, cue: "hit" }, { at: 0, cue: "boom" }, { at: 0.08, cue: "whoosh" },
  { at: 0.12, cue: "rise" }, { at: 0.18, cue: "choir" }, { at: 0.95, cue: "sparkle" },
  // The figure's class signature owns the touchdown; the fanfare follows a beat later.
  { at: LAND_AT, cue: "land" }, { at: LAND_AT, cue: "signature" }, { at: LAND_AT + 0.35, cue: "fanfare" },
];
const PEAK = 0.75;
export function figurineReveal(seconds: number, reducedMotion = false) {
  const time = reducedMotion ? REVEAL_SECONDS : Math.min(REVEAL_SECONDS, Math.max(0, seconds));
  const lift = time < 1.05 ? PEAK * easeOut(time / 1.05)
    : time < 1.85 ? PEAK + 0.06 * arc((time - 1.05) / 0.8)
    : time < LAND_AT ? PEAK * (1 - easeIn((time - 1.85) / (LAND_AT - 1.85)))
    : 0.06 * arc((time - LAND_AT) / 0.2);
  return {
    lift,
    spin: Math.PI * 2 * (easeOut(time / 1.7) - 1),
    figureScale: 0.78 + 0.22 * easeOut(time),
    silhouette: 1 - smooth((time - 0.95) / 0.7),
    lidHinge: easeOutBack(time / 0.22),
    lidFly: easeOut((time - 0.08) / 0.8),
    unfold: easeOutBack((time - 0.04) / 0.5),
    boxOpacity: 1 - smooth((time - 0.3) / 0.55),
    seam: 1 - smooth(time / 0.15),
    flash: pulse(time, 0, 0.5),
    beam: smooth(time / 0.12) * (1 - smooth((time - 1.5) / 0.9)),
    burstRing: time < 0.8 ? time / 0.8 : 0,
    landRing: time >= LAND_AT && time < LAND_AT + 0.75 ? (time - LAND_AT) / 0.75 : 0,
    shake: reducedMotion ? 0 : Math.max(0.6 * pulse(time, 0, 0.35), pulse(time, LAND_AT, 0.4)),
    plinthGlow: pulse(time, LAND_AT, 0.75),
    zoom: 0.9 + 0.16 * easeOut(time) - 0.06 * smooth((time - 1.6) / 1.2),
    orbit: 0.24 * smooth(time / REVEAL_SECONDS),
    complete: time >= REVEAL_SECONDS,
  };
}

// A fresh box drops onto the disc with a small bounce.
export const ENTRANCE_LAND = 0.42;
export const ENTRANCE_SECONDS = 0.8;
export const ENTRANCE_CUES: readonly TimedCue[] = [{ at: ENTRANCE_LAND, cue: "drop" }];
export function figurineEntrance(seconds: number, reducedMotion = false) {
  const time = reducedMotion ? ENTRANCE_SECONDS : Math.min(ENTRANCE_SECONDS, Math.max(0, seconds));
  const drop = time < ENTRANCE_LAND ? 3.4 * (1 - easeIn(time / ENTRANCE_LAND)) : 0.1 * arc((time - ENTRANCE_LAND) / 0.22);
  const squash = pulse(time, ENTRANCE_LAND, 0.2);
  return { drop, squash, complete: time >= ENTRANCE_SECONDS };
}
