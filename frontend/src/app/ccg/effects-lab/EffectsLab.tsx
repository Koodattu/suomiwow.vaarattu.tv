"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import type { CcgCard, CcgSet } from "@/types";
import CollectibleCard, { applyCardMaterial, resetCardMaterial } from "@/components/ccg/CollectibleCard";
import { setIdleAnimationClockEnabled } from "@/lib/ccg-idle-clock";
import {
  CCG_STUDIO_AFFIXES,
  CCG_STUDIO_DEVELOPMENT_FINISHES,
  CCG_STUDIO_PRODUCTION_FINISHES,
  type CcgPreviewAffix,
  type CcgPreviewFinish,
} from "@/lib/ccg-preview-finishes";

const BASELINE_STORAGE_KEY = "ccg-effects-lab-baseline";
const CHARACTER_ART = ["hittavainen.png", "ache.png", "bosso.png", "kp.png", "mjog.png", "smurffi.png"].map((file) => `/ccg/alternative/character/${file}`);
const BACKGROUNDS = ["/ccg/manaforge-omega-desktop.jpg", "/ccg/nerubar-palace-desktop.avif", "/ccg/aberrus-desktop.jpg", "/ccg/amirdrassil-desktop.jpg", "/ccg/liberation-of-undermine-desktop.webp"];
const THEMES: CcgSet["theme"][] = [
  { mark: "MO", accent: "#58D9E8", glow: "rgba(88, 217, 232, 0.34)" },
  { mark: "NP", accent: "#B699FF", glow: "rgba(182, 153, 255, 0.36)" },
  { mark: "AB", accent: "#D98A50", glow: "rgba(217, 138, 80, 0.34)" },
];
const CLASS_SPECS: [number, string][] = [[1, "Arms"], [2, "Retribution"], [3, "Marksmanship"], [5, "Shadow"], [8, "Fire"], [12, "Havoc"], [11, "Balance"], [13, "Devastation"]];
const NAMES = ["Hittavainen", "Ache", "Bosso", "Kp", "Mjog", "Smurffi"];

const LAYOUTS = {
  grid: { label: "Collection grid", count: 24, width: 200 },
  big: { label: "Big cards", count: 6, width: 400 },
  hero: { label: "Single hero", count: 1, width: 640 },
} as const;
type LayoutKey = keyof typeof LAYOUTS;
type HoverMode = "off" | "first" | "all";
type SweepTarget = "production" | "all-finishes" | "affixes";

const COMPOSITOR_PROPERTIES = new Set(["transform", "opacity", "translate", "rotate", "scale"]);
const KEYFRAME_META = new Set(["offset", "computedOffset", "easing", "composite"]);

type CostProfile = {
  layers: number;
  blended: number;
  filtered: number;
  backdrop: number;
  masked: number;
  animations: number;
  paintAnimations: number;
  paintAnimationNames: string[];
};

type FrameStats = {
  frames: number;
  fps: number;
  p50: number;
  p95: number;
  p99: number;
  worst: number;
  dropped: number;
  loafCount: number;
  loafMs: number;
  styleLayoutMs: number;
};

type LabResult = {
  key: string;
  finish: CcgPreviewFinish;
  affix: CcgPreviewAffix;
  scenario: string;
  profile: CostProfile;
  animated: FrameStats;
  paused: FrameStats | null;
};

type LoafEntry = PerformanceEntry & { styleAndLayoutStart: number };

function makeFixtureCard(index: number): CcgCard {
  const [classID, specName] = CLASS_SPECS[index % CLASS_SPECS.length];
  const set: CcgSet = {
    id: `lab-set-${index % BACKGROUNDS.length}`,
    slug: "effects-lab",
    zoneId: 0,
    raidName: "Effects Lab",
    expansionName: "Lab",
    state: "current",
    kind: "raid",
    enabledAt: null,
    themeKey: "lab",
    theme: THEMES[index % THEMES.length],
    customFinish: null,
    backgroundPath: BACKGROUNDS[index % BACKGROUNDS.length],
    packArtOffsetX: 0,
    cardCount: 0,
    ownedCards: 0,
    publicationWave: 1,
    lastPublishedAt: null,
  };
  return {
    id: `lab-card-${index}`,
    characterId: `lab-character-${index}`,
    setNumber: index + 1,
    snapshotVersion: 1,
    snapshotKey: null,
    name: NAMES[index % NAMES.length],
    realm: "kazzak",
    region: "eu",
    guildId: null,
    guildName: "Effects Lab",
    guildRealm: null,
    classID,
    specName,
    role: "dps",
    metric: "dps",
    itemLevel: 700,
    scores: { performance: 96.4, mechanics: 88.1, combined: 92.3, mythicPlus: 3412 },
    tierGrade: "A",
    avatarUrl: null,
    renderUrl: CHARACTER_ART[index % CHARACTER_ART.length],
    renderFit: null,
    availabilityStatus: "active",
    alternativeArt: null,
    quip: null,
    backgroundCrop: { x: 50, y: 50, scale: 1 },
    backgroundPath: null,
    performanceSnapshotAt: "2026-01-01T00:00:00.000Z",
    mediaCapturedAt: null,
    publicationWave: 1,
    publishedAt: "2026-01-01T00:00:00.000Z",
    set,
  };
}

function profileCard(card: HTMLElement): CostProfile {
  const profile: CostProfile = { layers: 0, blended: 0, filtered: 0, backdrop: 0, masked: 0, animations: 0, paintAnimations: 0, paintAnimationNames: [] };
  const inspect = (style: CSSStyleDeclaration) => {
    if (style.display === "none") return;
    profile.layers += 1;
    if (style.mixBlendMode !== "normal") profile.blended += 1;
    if (style.filter !== "none") profile.filtered += 1;
    if (style.backdropFilter && style.backdropFilter !== "none") profile.backdrop += 1;
    const mask = style.getPropertyValue("mask-image") || style.getPropertyValue("-webkit-mask-image");
    if (mask && mask !== "none") profile.masked += 1;
  };

  for (const element of [card, ...card.querySelectorAll("*")]) {
    if (element instanceof SVGElement && !(element instanceof SVGSVGElement)) continue;
    inspect(getComputedStyle(element));
    for (const pseudo of ["::before", "::after"]) {
      const style = getComputedStyle(element, pseudo);
      if (style.content !== "none" && style.content !== "normal") inspect(style);
    }
  }

  const paintNames = new Set<string>();
  for (const animation of card.getAnimations({ subtree: true })) {
    if (!(animation.effect instanceof KeyframeEffect)) continue;
    profile.animations += 1;
    const properties = new Set(animation.effect.getKeyframes().flatMap((frame) => Object.keys(frame)).filter((key) => !KEYFRAME_META.has(key)));
    if ([...properties].some((property) => !COMPOSITOR_PROPERTIES.has(property))) {
      profile.paintAnimations += 1;
      const name = animation instanceof CSSAnimation ? animation.animationName.replace(/^.*?_(prototype\w+)__.*$/, "$1") : "script";
      paintNames.add(`${name} (${[...properties].join(", ")})`);
    }
  }
  profile.paintAnimationNames = [...paintNames];
  return profile;
}

function percentile(sorted: number[], quantile: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(quantile * sorted.length))];
}

function summarize(deltas: number[], refreshMs: number, loafs: LoafEntry[] = []): FrameStats {
  const sorted = [...deltas].sort((a, b) => a - b);
  const total = deltas.reduce((sum, delta) => sum + delta, 0);
  const missed = deltas.reduce((sum, delta) => sum + Math.max(0, Math.round(delta / refreshMs) - 1), 0);
  return {
    frames: deltas.length,
    fps: total ? (deltas.length * 1000) / total : 0,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    worst: sorted.at(-1) ?? 0,
    dropped: deltas.length ? (missed / (missed + deltas.length)) * 100 : 0,
    loafCount: loafs.length,
    loafMs: loafs.reduce((sum, entry) => sum + entry.duration, 0),
    styleLayoutMs: loafs.reduce((sum, entry) => sum + Math.max(0, entry.startTime + entry.duration - entry.styleAndLayoutStart), 0),
  };
}

const delay = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
const nextPaint = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const ms = (value: number) => value.toFixed(1);

function loadBaseline(): LabResult[] {
  try {
    return JSON.parse(window.localStorage.getItem(BASELINE_STORAGE_KEY) ?? "[]") as LabResult[];
  } catch {
    return [];
  }
}

// Drives a container's idle CSS animations from one clock capped at `fps` instead of the display rate.
// Transitions (hover, tilt) are left alone so pointer response stays at full rate.
function useCappedIdleAnimations(container: RefObject<HTMLDivElement | null>, fps: number | null) {
  useEffect(() => {
    const root = container.current;
    if (!root || !fps) return;
    const interval = 1000 / fps;
    const driven = new Set<Animation>();
    let last = performance.now();
    let frame = 0;
    const adopt = () => {
      for (const animation of root.getAnimations({ subtree: true })) {
        if (!(animation instanceof CSSAnimation) || driven.has(animation) || animation.playState !== "running") continue;
        animation.pause();
        driven.add(animation);
      }
    };
    const tick = (now: number) => {
      if (now - last >= interval - 1.5) {
        const elapsed = now - last;
        last = now;
        adopt();
        for (const animation of driven) {
          if (animation.playState === "idle") driven.delete(animation);
          else animation.currentTime = Number(animation.currentTime ?? 0) + elapsed;
        }
      }
      frame = requestAnimationFrame(tick);
    };
    adopt();
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      driven.forEach((animation) => {
        if (animation.playState === "paused") animation.play();
      });
    };
  }, [container, fps]);
}

type RateGroupProps = {
  label: string;
  fps: number | null;
  cards: CcgCard[];
  finish: CcgPreviewFinish;
  affix: CcgPreviewAffix;
  width: number;
  effectsPaused: boolean;
};

function RateGroup({ label, fps, cards, finish, affix, width, effectsPaused }: RateGroupProps) {
  const groupRef = useRef<HTMLDivElement>(null);
  useCappedIdleAnimations(groupRef, fps);
  return (
    <section className="flex min-w-0 flex-1 flex-col gap-2">
      <h2 className="text-center text-sm font-semibold text-white">{label}</h2>
      <div ref={groupRef} className="grid content-start justify-center gap-3" style={{ gridTemplateColumns: `repeat(auto-fill, ${width}px)` }}>
        {cards.map((card) => (
          <CollectibleCard key={card.id} card={card} finish={finish} affix={affix} width={width} effectsPaused={effectsPaused} />
        ))}
      </div>
    </section>
  );
}

const RATE_GROUPS = [
  { label: "Display rate (browser timing)", fps: null },
  { label: "Idle capped at 60 fps", fps: 60 },
  { label: "Idle capped at 30 fps", fps: 30 },
] as const;

export default function EffectsLab() {
  const [finish, setFinish] = useState<CcgPreviewFinish>("standard");
  const [affix, setAffix] = useState<CcgPreviewAffix>("none");
  const [layout, setLayout] = useState<LayoutKey>("grid");
  const [count, setCount] = useState<number>(LAYOUTS.grid.count);
  const [width, setWidth] = useState<number>(LAYOUTS.grid.width);
  const [hover, setHover] = useState<HoverMode>("off");
  const [effectsPaused, setEffectsPaused] = useState(false);
  const [compareRates, setCompareRates] = useState(false);
  const [idleClock, setIdleClock] = useState(true);
  const [frozenAt, setFrozenAt] = useState<number | null>(null);
  const [freezeSeconds, setFreezeSeconds] = useState(2);
  const [stageKey, setStageKey] = useState(0);
  const [refreshMs, setRefreshMs] = useState(1000 / 60);
  const [sweepTarget, setSweepTarget] = useState<SweepTarget>("production");
  const [sweepAffixFinish, setSweepAffixFinish] = useState<CcgPreviewFinish>("standard");
  const [measurePaused, setMeasurePaused] = useState(true);
  const [durationMs, setDurationMs] = useState(3000);
  const [warmupMs, setWarmupMs] = useState(1200);
  const [running, setRunning] = useState<string | null>(null);
  const [profile, setProfile] = useState<CostProfile | null>(null);
  const [results, setResults] = useState<LabResult[]>([]);
  const [baseline, setBaseline] = useState<LabResult[]>([]);
  const stageRef = useRef<HTMLDivElement>(null);
  const liveRef = useRef<HTMLDivElement>(null);
  const hoverRef = useRef<HoverMode>("off");
  const refreshMsRef = useRef(1000 / 60);
  const abortRef = useRef(false);
  const recorderRef = useRef<{ deltas: number[]; start: number; duration: number; resolve: (deltas: number[]) => void } | null>(null);

  const cards = useMemo(() => Array.from({ length: count }, (_, index) => makeFixtureCard(index)), [count]);
  const scenario = `${count}×${width}px, hover ${hover}`;

  useEffect(() => {
    const frame = requestAnimationFrame(() => setBaseline(loadBaseline()));
    return () => cancelAnimationFrame(frame);
  }, []);

  // The side-by-side comparison drives its own groups, so the shared clock steps aside while it is shown.
  useEffect(() => {
    setIdleAnimationClockEnabled(idleClock && !compareRates);
    return () => setIdleAnimationClockEnabled(true);
  }, [idleClock, compareRates]);

  useEffect(() => {
    hoverRef.current = hover;
    if (hover !== "all") {
      stageRef.current?.querySelectorAll<HTMLElement>("[data-ccg-card]").forEach((card, index) => {
        if (hover === "first" && index === 0) return;
        delete card.dataset.pointerActive;
        resetCardMaterial(card);
      });
    }
  }, [hover]);

  // One rAF loop drives simulated hover, live stats and recordings so measurements share a single frame clock.
  useEffect(() => {
    let frame = 0;
    let last = 0;
    let lastLiveUpdate = 0;
    const recent: number[] = [];
    const tick = (time: number) => {
      if (last) {
        const delta = time - last;
        recent.push(delta);
        if (recent.length > 180) recent.shift();
        const recorder = recorderRef.current;
        if (recorder) {
          if (!recorder.start) recorder.start = time;
          else recorder.deltas.push(delta);
          if (recorder.start && time - recorder.start >= recorder.duration) {
            recorderRef.current = null;
            recorder.resolve(recorder.deltas);
          }
        }
      }
      last = time;

      const stage = stageRef.current;
      if (stage && hoverRef.current !== "off") {
        const targets = stage.querySelectorAll<HTMLElement>("[data-ccg-card]");
        targets.forEach((card, index) => {
          if (hoverRef.current === "first" && index > 0) return;
          const phase = time / 1000 + index * 0.37;
          card.dataset.pointerActive = "true";
          applyCardMaterial(card, 0.5 + 0.42 * Math.sin(phase * 1.7), 0.5 + 0.42 * Math.sin(phase * 2.3 + 1));
        });
      }

      if (time - lastLiveUpdate > 500 && liveRef.current && stage) {
        lastLiveUpdate = time;
        const stats = summarize(recent, refreshMsRef.current);
        const all = stage.querySelectorAll("[data-ccg-card]").length;
        const autoPaused = stage.querySelectorAll("[data-ccg-card][data-effects-auto-paused='true']").length;
        liveRef.current.textContent = `${stats.fps.toFixed(0)} fps · p95 ${ms(stats.p95)}ms · dropped ${stats.dropped.toFixed(1)}% · ${all - autoPaused}/${all} cards animating${document.hidden ? " · TAB HIDDEN" : ""}`;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    refreshMsRef.current = refreshMs;
  }, [refreshMs]);

  const record = useCallback(async (duration: number): Promise<FrameStats> => {
    const loafs: LoafEntry[] = [];
    const observer = PerformanceObserver.supportedEntryTypes.includes("long-animation-frame")
      ? new PerformanceObserver((list) => loafs.push(...(list.getEntries() as LoafEntry[])))
      : null;
    observer?.observe({ type: "long-animation-frame" });
    const deltas = await new Promise<number[]>((resolve) => {
      recorderRef.current = { deltas: [], start: 0, duration, resolve };
    });
    observer?.disconnect();
    return summarize(deltas, refreshMsRef.current, loafs);
  }, []);

  const profileStage = useCallback(() => {
    const card = stageRef.current?.querySelector<HTMLElement>("[data-ccg-card]");
    return card ? profileCard(card) : null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void nextPaint().then(() => delay(150)).then(() => {
      if (!cancelled) setProfile(profileStage());
    });
    return () => {
      cancelled = true;
    };
  }, [finish, affix, stageKey, count, profileStage]);

  const calibrate = useCallback(async () => {
    setRunning("Calibrating refresh rate");
    const previousCount = count;
    setCount(0);
    await nextPaint();
    await delay(400);
    const stats = await record(1500);
    setRefreshMs(stats.p50 || 1000 / 60);
    setCount(previousCount);
    setRunning(null);
  }, [count, record]);

  const measure = useCallback(async (subject: { finish: CcgPreviewFinish; affix: CcgPreviewAffix }): Promise<LabResult | null> => {
    setFinish(subject.finish);
    setAffix(subject.affix);
    setEffectsPaused(false);
    await nextPaint();
    await delay(warmupMs);
    const subjectProfile = profileStage();
    if (!subjectProfile) return null;
    const animated = await record(durationMs);
    let paused: FrameStats | null = null;
    if (measurePaused && !abortRef.current) {
      setEffectsPaused(true);
      await nextPaint();
      await delay(300);
      paused = await record(durationMs);
      setEffectsPaused(false);
    }
    return { key: `${subject.finish}+${subject.affix}`, ...subject, scenario, profile: subjectProfile, animated, paused };
  }, [durationMs, measurePaused, profileStage, record, scenario, warmupMs]);

  const upsert = (current: LabResult[], result: LabResult) => [...current.filter((entry) => entry.key !== result.key || entry.scenario !== result.scenario), result];

  const measureCurrent = async () => {
    abortRef.current = false;
    setRunning(`Measuring ${finish} + ${affix}`);
    const result = await measure({ finish, affix });
    if (result) setResults((current) => upsert(current, result));
    setRunning(null);
  };

  const runSweep = async () => {
    abortRef.current = false;
    const finishes = sweepTarget === "production" ? CCG_STUDIO_PRODUCTION_FINISHES : [...CCG_STUDIO_PRODUCTION_FINISHES, ...CCG_STUDIO_DEVELOPMENT_FINISHES];
    const subjects = sweepTarget === "affixes"
      ? CCG_STUDIO_AFFIXES.map((entry) => ({ finish: sweepAffixFinish, affix: entry }))
      : finishes.map((entry) => ({ finish: entry, affix: "none" as CcgPreviewAffix }));
    for (const [index, subject] of subjects.entries()) {
      if (abortRef.current) break;
      setRunning(`Sweep ${index + 1}/${subjects.length}: ${subject.finish} + ${subject.affix}`);
      const result = await measure(subject);
      if (result) setResults((current) => upsert(current, result));
    }
    setRunning(null);
  };

  const freeze = () => {
    const stage = stageRef.current;
    if (!stage) return;
    for (const animation of stage.getAnimations({ subtree: true })) {
      animation.pause();
      animation.currentTime = freezeSeconds * 1000;
    }
    setFrozenAt(freezeSeconds);
  };

  const unfreeze = () => {
    setFrozenAt(null);
    setStageKey((key) => key + 1);
  };

  const saveBaseline = () => {
    try {
      window.localStorage.setItem(BASELINE_STORAGE_KEY, JSON.stringify(results));
    } catch {
      // Storage can be unavailable in private windows; the in-memory baseline still works for this session.
    }
    setBaseline(results);
  };

  const sortedResults = [...results].sort((a, b) => b.animated.p95 - a.animated.p95 || b.animated.dropped - a.animated.dropped);
  const baselineFor = (result: LabResult) => baseline.find((entry) => entry.key === result.key && entry.scenario === result.scenario);
  const allFinishes = [...CCG_STUDIO_PRODUCTION_FINISHES, ...CCG_STUDIO_DEVELOPMENT_FINISHES];
  const busy = running !== null;

  return (
    <div className="flex min-h-screen bg-[#07090d] text-sm text-slate-200">
      <aside className="flex h-screen w-[440px] shrink-0 flex-col gap-4 overflow-y-auto border-r border-white/10 bg-[#0c1017] p-4">
        <header>
          <h1 className="text-lg font-semibold text-white">Card effects lab</h1>
          <p className="text-xs text-slate-400">Local only. Keep this tab focused and visible while measuring.</p>
        </header>

        <div ref={liveRef} className="rounded-md bg-black/40 px-3 py-2 font-mono text-xs text-emerald-300" />
        {running ? <div className="rounded-md bg-amber-500/15 px-3 py-2 text-xs text-amber-200">{running}… <button type="button" className="underline" onClick={() => { abortRef.current = true; }}>stop</button></div> : null}

        <section className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-xs">Finish
            <select className="rounded bg-slate-800 px-2 py-1" value={finish} disabled={busy} onChange={(event) => setFinish(event.target.value as CcgPreviewFinish)}>
              <optgroup label="Production">{CCG_STUDIO_PRODUCTION_FINISHES.map((entry) => <option key={entry} value={entry}>{entry}</option>)}</optgroup>
              <optgroup label="Development">{CCG_STUDIO_DEVELOPMENT_FINISHES.map((entry) => <option key={entry} value={entry}>{entry}</option>)}</optgroup>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs">Affix
            <select className="rounded bg-slate-800 px-2 py-1" value={affix} disabled={busy} onChange={(event) => setAffix(event.target.value as CcgPreviewAffix)}>
              {CCG_STUDIO_AFFIXES.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs">Layout
            <select
              className="rounded bg-slate-800 px-2 py-1"
              value={layout}
              disabled={busy}
              onChange={(event) => {
                const next = event.target.value as LayoutKey;
                setLayout(next);
                setCount(LAYOUTS[next].count);
                setWidth(LAYOUTS[next].width);
              }}
            >
              {Object.entries(LAYOUTS).map(([key, entry]) => <option key={key} value={key}>{entry.label}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs">Simulated hover
            <select className="rounded bg-slate-800 px-2 py-1" value={hover} onChange={(event) => setHover(event.target.value as HoverMode)}>
              <option value="off">Off (idle)</option>
              <option value="first">First card</option>
              <option value="all">All cards (stress)</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs">Cards
            <input className="rounded bg-slate-800 px-2 py-1" type="number" min={1} max={96} value={count} disabled={busy} onChange={(event) => setCount(Math.max(1, Math.min(96, Number(event.target.value) || 1)))} />
          </label>
          <label className="flex flex-col gap-1 text-xs">Card width (px)
            <input className="rounded bg-slate-800 px-2 py-1" type="number" min={120} max={900} step={20} value={width} disabled={busy} onChange={(event) => setWidth(Math.max(120, Math.min(900, Number(event.target.value) || 200)))} />
          </label>
          <label className="col-span-2 flex items-center gap-2 text-xs">
            <input type="checkbox" checked={effectsPaused} disabled={busy} onChange={(event) => setEffectsPaused(event.target.checked)} />
            Pause CSS animations (same as offscreen cards)
          </label>
          <label className="col-span-2 flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={compareRates}
              disabled={busy}
              onChange={(event) => {
                setCompareRates(event.target.checked);
                if (event.target.checked) {
                  setCount(4);
                  setWidth(240);
                }
              }}
            />
            Compare idle frame rates side by side (display / 60 / 30)
          </label>
          <label className="col-span-2 flex items-center gap-2 text-xs">
            <input type="checkbox" checked={idleClock && !compareRates} disabled={busy || compareRates} onChange={(event) => setIdleClock(event.target.checked)} />
            Shared idle clock (production: caps idle loops near 60 fps on high-refresh displays)
          </label>
        </section>

        <section className="flex flex-col gap-2 rounded-md border border-white/10 p-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Measure</h2>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-xs">Sample (ms)
              <input className="rounded bg-slate-800 px-2 py-1" type="number" min={1000} step={500} value={durationMs} disabled={busy} onChange={(event) => setDurationMs(Number(event.target.value) || 3000)} />
            </label>
            <label className="flex flex-col gap-1 text-xs">Warm-up (ms)
              <input className="rounded bg-slate-800 px-2 py-1" type="number" min={0} step={200} value={warmupMs} disabled={busy} onChange={(event) => setWarmupMs(Number(event.target.value) || 0)} />
            </label>
          </div>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={measurePaused} disabled={busy} onChange={(event) => setMeasurePaused(event.target.checked)} />
            Also measure with animations paused (isolates animation cost)
          </label>
          <p className="text-xs text-slate-400">Refresh interval {ms(refreshMs)}ms ({(1000 / refreshMs).toFixed(0)} Hz). Calibrate once per monitor.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="rounded bg-slate-700 px-3 py-1.5 disabled:opacity-40" disabled={busy} onClick={() => void calibrate()}>Calibrate</button>
            <button type="button" className="rounded bg-sky-700 px-3 py-1.5 disabled:opacity-40" disabled={busy} onClick={() => void measureCurrent()}>Measure current</button>
          </div>
          <div className="mt-1 grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-xs">Sweep
              <select className="rounded bg-slate-800 px-2 py-1" value={sweepTarget} disabled={busy} onChange={(event) => setSweepTarget(event.target.value as SweepTarget)}>
                <option value="production">Production finishes</option>
                <option value="all-finishes">All finishes (incl. dev)</option>
                <option value="affixes">All affixes</option>
              </select>
            </label>
            {sweepTarget === "affixes" ? (
              <label className="flex flex-col gap-1 text-xs">Affix sweep finish
                <select className="rounded bg-slate-800 px-2 py-1" value={sweepAffixFinish} disabled={busy} onChange={(event) => setSweepAffixFinish(event.target.value as CcgPreviewFinish)}>
                  {allFinishes.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
                </select>
              </label>
            ) : null}
          </div>
          <button type="button" className="rounded bg-emerald-700 px-3 py-1.5 disabled:opacity-40" disabled={busy} onClick={() => void runSweep()}>Run sweep</button>
        </section>

        <section className="flex flex-col gap-2 rounded-md border border-white/10 p-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Visual check</h2>
          <p className="text-xs text-slate-400">Freeze every animation at the same timestamp to screenshot before/after an optimization.</p>
          <div className="flex items-center gap-2">
            <input className="w-20 rounded bg-slate-800 px-2 py-1" type="number" min={0} step={0.5} value={freezeSeconds} onChange={(event) => setFreezeSeconds(Number(event.target.value) || 0)} />
            <span className="text-xs">s</span>
            <button type="button" className="rounded bg-slate-700 px-3 py-1.5" onClick={freeze}>Freeze</button>
            <button type="button" className="rounded bg-slate-700 px-3 py-1.5 disabled:opacity-40" disabled={frozenAt === null} onClick={unfreeze}>Unfreeze</button>
          </div>
        </section>

        {profile ? (
          <section className="flex flex-col gap-1 rounded-md border border-white/10 p-3 text-xs">
            <h2 className="font-semibold uppercase tracking-wide text-slate-400">Cost profile · {finish} + {affix} (per card)</h2>
            <p>{profile.layers} painted boxes · {profile.blended} blend-mode · {profile.filtered} filter · {profile.backdrop} backdrop-filter · {profile.masked} masked</p>
            <p>{profile.animations} animations, <span className={profile.paintAnimations ? "text-amber-300" : "text-emerald-300"}>{profile.paintAnimations} repaint every frame</span></p>
            {profile.paintAnimationNames.length ? (
              <ul className="list-disc pl-4 font-mono text-[11px] text-amber-200/80">{profile.paintAnimationNames.map((name) => <li key={name}>{name}</li>)}</ul>
            ) : null}
          </section>
        ) : null}

        <section className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="mr-auto text-xs font-semibold uppercase tracking-wide text-slate-400">Results ({results.length})</h2>
            <button type="button" className="rounded bg-slate-700 px-2 py-1 text-xs disabled:opacity-40" disabled={!results.length} onClick={saveBaseline}>Save as baseline</button>
            <button type="button" className="rounded bg-slate-700 px-2 py-1 text-xs disabled:opacity-40" disabled={!results.length} onClick={() => void navigator.clipboard.writeText(JSON.stringify({ refreshMs, results }, null, 2))}>Copy JSON</button>
            <button type="button" className="rounded bg-slate-700 px-2 py-1 text-xs disabled:opacity-40" disabled={!results.length} onClick={() => setResults([])}>Clear</button>
          </div>
          {baseline.length ? <p className="text-xs text-slate-400">Baseline: {baseline.length} results. Δ columns compare against it.</p> : null}
          <div className="overflow-x-auto">
            <table className="w-full text-right font-mono text-[11px]">
              <thead className="text-slate-400">
                <tr>
                  <th className="text-left">subject</th>
                  <th title="95th percentile frame time while animating">p95</th>
                  <th title="Share of vsync frames that were missed">drop%</th>
                  <th title="p95 with animations paused">p95 ‖</th>
                  <th title="Animations that repaint every frame / total">paint</th>
                  <th title="Blend-mode layers / filter layers per card">blend/flt</th>
                  <th title="Change in p95 against the saved baseline">Δp95</th>
                </tr>
              </thead>
              <tbody>
                {sortedResults.map((result) => {
                  const previous = baselineFor(result);
                  const delta = previous ? result.animated.p95 - previous.animated.p95 : null;
                  const slow = result.animated.dropped > 5;
                  return (
                    <tr key={`${result.key}:${result.scenario}`} className="border-t border-white/5" title={result.scenario}>
                      <td className="text-left">
                        <button type="button" className="hover:underline" disabled={busy} onClick={() => { setFinish(result.finish); setAffix(result.affix); }}>
                          {result.finish}{result.affix !== "none" ? `+${result.affix}` : ""}
                        </button>
                      </td>
                      <td className={slow ? "text-rose-300" : ""}>{ms(result.animated.p95)}</td>
                      <td className={slow ? "text-rose-300" : ""}>{result.animated.dropped.toFixed(1)}</td>
                      <td>{result.paused ? ms(result.paused.p95) : "—"}</td>
                      <td>{result.profile.paintAnimations}/{result.profile.animations}</td>
                      <td>{result.profile.blended}/{result.profile.filtered}</td>
                      <td className={delta === null ? "" : delta < -0.5 ? "text-emerald-300" : delta > 0.5 ? "text-rose-300" : ""}>{delta === null ? "—" : `${delta > 0 ? "+" : ""}${ms(delta)}`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </aside>

      <main className="h-screen flex-1 overflow-hidden p-4">
        {compareRates ? (
          <div key={stageKey} ref={stageRef} className="flex gap-6">
            {RATE_GROUPS.map((group) => (
              <RateGroup key={group.label} {...group} cards={cards} finish={finish} affix={affix} width={width} effectsPaused={effectsPaused} />
            ))}
          </div>
        ) : (
          <div
            key={stageKey}
            ref={stageRef}
            className="grid content-start justify-center gap-3"
            style={{ gridTemplateColumns: `repeat(auto-fill, ${width}px)` }}
          >
            {cards.map((card) => (
              <CollectibleCard key={card.id} card={card} finish={finish} affix={affix} width={width} effectsPaused={effectsPaused} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
