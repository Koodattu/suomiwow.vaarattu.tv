// Card idle loops (infinite CSS animations) follow one shared clock capped near 60 fps on high-refresh displays.
// The browser would otherwise restyle, repaint and re-blend every animated card layer at 120-240 Hz. On displays
// at ~60 Hz the clock measures the refresh rate, finds nothing to save and stops, leaving the browser in charge.
// Hover, tilt and transitions are never driven, so pointer response stays at the display rate.

const TARGET_FPS = 60;
const HIGH_REFRESH_HZ = 75;
const SAMPLE_FRAMES = 40;
const ADOPT_EVERY_TICKS = 4;
const MAX_STEP_MS = 100;

type DrivenLoop = { host: HTMLElement; time: number };

const hosts = new Set<HTMLElement>();
const driven = new Map<Animation, DrivenLoop>();
let enabled = true;
let frame = 0;
// 0 while the refresh rate is being measured, then the measured frame interval; -1 means a ~60 Hz display.
let frameInterval = 0;
let tickIndex = 0;
let lastFrame = 0;
let lastTick = 0;
const intervals: number[] = [];

// Lets CSS keep large blended layers composited while the clock drives them (see card-prototypes.module.css).
function markActive(active: boolean) {
  if (active) document.documentElement.dataset.ccgIdleClock = "true";
  else delete document.documentElement.dataset.ccgIdleClock;
}

const isPaused = (host: HTMLElement) => host.dataset.effectsPaused === "true" || host.dataset.effectsAutoPaused === "true";

function hostOf(element: Element): HTMLElement | null {
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (hosts.has(node as HTMLElement)) return node as HTMLElement;
  }
  return null;
}

const forget = (event: Event) => driven.delete(event.target as Animation);

// Takes over newly started idle loops. This is the only place that reads animation state: reading currentTime or
// playState makes the browser bring all styles up to date, so reads stay out of the per-tick write loop.
// Script-paused animations ignore animation-play-state from CSS, so the clock itself holds them still while their
// card is paused (offscreen, hidden tab or effectsPaused).
function adopt() {
  for (const animation of document.getAnimations()) {
    if (!(animation instanceof CSSAnimation) || driven.has(animation) || animation.playState !== "running") continue;
    if (!(animation.effect instanceof KeyframeEffect) || animation.effect.getTiming().iterations !== Infinity) continue;
    const target = animation.effect.target;
    const host = target ? hostOf(target) : null;
    if (!host || isPaused(host)) continue;
    driven.set(animation, { host, time: Number(animation.currentTime ?? 0) });
    animation.pause();
    // CSS cancels a loop when its card's finish or hover state changes; the event arrives before the next frame's
    // callbacks, so a cancelled loop is never written to (that would revive it as a script-owned animation).
    animation.addEventListener("cancel", forget, { once: true });
  }
}

function release() {
  for (const [animation, loop] of driven) {
    animation.removeEventListener("cancel", forget);
    if (animation.playState === "paused" && loop.host.isConnected) animation.play();
  }
  driven.clear();
}

function tick(now: number) {
  frame = 0;
  if (!enabled || !hosts.size) return;
  if (!frameInterval) {
    if (lastFrame) intervals.push(now - lastFrame);
    lastFrame = now;
    if (intervals.length >= SAMPLE_FRAMES) {
      const sorted = [...intervals].sort((a, b) => a - b);
      const interval = sorted[sorted.length >> 1];
      if (1000 / interval < HIGH_REFRESH_HZ) {
        frameInterval = -1;
        return;
      }
      frameInterval = interval;
      lastTick = now;
      markActive(true);
      adopt();
    }
  } else if (now - lastTick >= 1000 / TARGET_FPS - frameInterval / 2) {
    // Time-based so busy pages that skip frames still advance ~60 times a second.
    const step = Math.min(now - lastTick, MAX_STEP_MS);
    lastTick = now;
    if (++tickIndex % ADOPT_EVERY_TICKS === 0) adopt();
    for (const [animation, loop] of driven) {
      if (!loop.host.isConnected) driven.delete(animation);
      else if (!isPaused(loop.host)) {
        loop.time += step;
        animation.currentTime = loop.time;
      }
    }
  }
  frame = requestAnimationFrame(tick);
}

function schedule() {
  if (!frame && enabled && hosts.size && frameInterval !== -1) frame = requestAnimationFrame(tick);
}

export function registerIdleAnimationHost(host: HTMLElement): () => void {
  hosts.add(host);
  schedule();
  return () => {
    hosts.delete(host);
    for (const [animation, loop] of driven) {
      if (loop.host === host) driven.delete(animation);
    }
    if (!hosts.size && frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
  };
}

// The effects lab turns the clock off to compare capped rates against the browser's own timing.
export function setIdleAnimationClockEnabled(next: boolean) {
  if (enabled === next) return;
  enabled = next;
  if (!next) {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    release();
    markActive(false);
  } else {
    if (frameInterval > 0) markActive(true);
    schedule();
  }
}
