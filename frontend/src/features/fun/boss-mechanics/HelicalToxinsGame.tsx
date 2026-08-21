"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useTranslations } from "next-intl";
import { Listbox, ListboxButton, ListboxOption, ListboxOptions } from "@headlessui/react";
import { FaArrowUpRightFromSquare, FaChevronDown } from "react-icons/fa6";
import AlphaFittedCharacterRender from "@/components/ccg/AlphaFittedCharacterRender";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { CCG_CLASS_COLORS } from "@/lib/ccg";
import type { BossMechanicCharacter, BossMechanicDifficulty, BossMechanicGuild, BossMechanicLeaderboardEntry } from "@/types";
import styles from "./helical-toxins.module.css";

const PLAYER_COUNT = 20;
const ARENA_MIN_Y = 0.18;
const ARENA_MAX_Y = 0.93;
const ARENA_CENTER_Y = 0.56;
const WIPE_STORAGE_PREFIX = "helical-toxins:wipes:";
const DIFFICULTIES: Array<{ id: BossMechanicDifficulty; emoji: string; durationMs: number; pairCount: number; labelKey: "difficultyNormal" | "difficultyHeroic" | "difficultyMythic" }> = [
  { id: "normal", emoji: "🛡️", durationMs: 20_000, pairCount: 6, labelKey: "difficultyNormal" },
  { id: "heroic", emoji: "⚔️", durationMs: 10_000, pairCount: 7, labelKey: "difficultyHeroic" },
  { id: "mythic", emoji: "💀", durationMs: 10_000, pairCount: 8, labelKey: "difficultyMythic" },
];
const DIFFICULTY_BY_ID = Object.fromEntries(DIFFICULTIES.map((difficulty) => [difficulty.id, difficulty])) as Record<BossMechanicDifficulty, (typeof DIFFICULTIES)[number]>;

type Position = { x: number; y: number };
type Player = BossMechanicCharacter & Position & { greenCount: number; hasMechanic: boolean; matched: boolean };
type Phase = "loading" | "ready" | "playing" | "won" | "wiped" | "error";
type WipeReason = "timeout" | "manual" | { total: number };
type DragState = {
  id: string;
  pointerId: number;
  offsetX: number;
  offsetY: number;
  lastPosition: Position;
};
type AlphaHitMask = {
  width: number;
  height: number;
  alpha: Uint8Array;
};
type RenderHitArea = {
  image: HTMLImageElement;
  mask: AlphaHitMask;
};
type GameSelectOption = { value: string; label: string; icon?: string };

const HIT_MASK_MAX_SIZE = 128;
const HIT_ALPHA_THRESHOLD = 8;
const HIT_GAP_EDGE_ALPHA_THRESHOLD = 32;
const HIT_MAX_BRIDGED_GAP_RATIO = 0.26;

function createAlphaHitMask(image: HTMLImageElement): AlphaHitMask | null {
  const scale = Math.min(1, HIT_MASK_MAX_SIZE / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;

  canvas.width = width;
  canvas.height = height;
  context.drawImage(image, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;
  const alpha = new Uint8Array(width * height);
  for (let index = 0; index < alpha.length; index += 1) alpha[index] = pixels[index * 4 + 3];

  const maxBridgedGap = Math.max(1, Math.round(width * HIT_MAX_BRIDGED_GAP_RATIO));
  for (let y = 0; y < height; y += 1) {
    let previousOpaqueX = -1;
    for (let x = 0; x < width; x += 1) {
      if (alpha[y * width + x] < HIT_GAP_EDGE_ALPHA_THRESHOLD) continue;
      const gap = x - previousOpaqueX - 1;
      if (previousOpaqueX >= 0 && gap > 0 && gap <= maxBridgedGap) {
        alpha.fill(255, y * width + previousOpaqueX + 1, y * width + x);
      }
      previousOpaqueX = x;
    }
  }
  return { width, height, alpha };
}

function hitsOpaquePixel(clientX: number, clientY: number, hitArea: RenderHitArea): boolean {
  const rect = hitArea.image.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0 || clientX < rect.left || clientX >= rect.right || clientY < rect.top || clientY >= rect.bottom) return false;
  const x = Math.min(hitArea.mask.width - 1, Math.floor((clientX - rect.left) / rect.width * hitArea.mask.width));
  const y = Math.min(hitArea.mask.height - 1, Math.floor((clientY - rect.top) / rect.height * hitArea.mask.height));
  return hitArea.mask.alpha[y * hitArea.mask.width + x] >= HIT_ALPHA_THRESHOLD;
}

function GameSelect({ label, value, options, disabled, accent, wide, onChange }: {
  label: string;
  value: string;
  options: GameSelectOption[];
  disabled: boolean;
  accent?: BossMechanicDifficulty;
  wide?: boolean;
  onChange: (value: string) => void;
}) {
  const selected = options.find((option) => option.value === value) ?? options[0];

  return (
    <Listbox value={value} onChange={onChange} disabled={disabled}>
      <div className={`${styles.selectField} ${wide ? styles.raidTeamSelectField : ""}`}>
        <span className={styles.selectFieldLabel} aria-hidden="true">{label}</span>
        <ListboxButton className={styles.selectButton} data-accent={accent} aria-label={label}>
          <span className={styles.selectValue}>
            {selected.icon ? <span className={styles.selectIcon} aria-hidden="true">{selected.icon}</span> : null}
            <span>{selected.label}</span>
          </span>
          <FaChevronDown className={styles.selectButtonChevron} aria-hidden="true" />
        </ListboxButton>
        <ListboxOptions className={styles.selectMenu} modal={false} transition>
          {options.map((option) => (
            <ListboxOption key={option.value || "default"} value={option.value} className={styles.selectOption}>
              <span className={styles.selectOptionValue}>
                {option.icon ? <span className={styles.selectIcon} aria-hidden="true">{option.icon}</span> : null}
                <span>{option.label}</span>
              </span>
            </ListboxOption>
          ))}
        </ListboxOptions>
      </div>
    </Listbox>
  );
}

function shuffle<T>(items: readonly T[]): T[] {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
  }
  return shuffled;
}

function getArenaXBounds(y: number): [number, number] {
  const progress = (y - ARENA_MIN_Y) / (ARENA_MAX_Y - ARENA_MIN_Y);
  const halfWidth = 0.21 + Math.sin(Math.max(0, Math.min(1, progress)) * Math.PI) * 0.065;
  return [0.5 - halfWidth, 0.5 + halfWidth];
}

function clampPosition(position: Position): Position {
  const y = Math.min(ARENA_MAX_Y, Math.max(ARENA_MIN_Y, position.y));
  const [minX, maxX] = getArenaXBounds(y);
  return { x: Math.min(maxX, Math.max(minX, position.x)), y };
}

function getPlayerDepth(y: number): number {
  return 10 + Math.round(y * 80);
}

function readStoredWipes(difficulty: BossMechanicDifficulty): number {
  try {
    const value = Number(window.localStorage.getItem(`${WIPE_STORAGE_PREFIX}${difficulty}`));
    return Number.isInteger(value) && value >= 0 ? Math.min(value, 9_999) : 0;
  } catch {
    return 0;
  }
}

function writeStoredWipes(difficulty: BossMechanicDifficulty, wipes: number): void {
  try {
    window.localStorage.setItem(`${WIPE_STORAGE_PREFIX}${difficulty}`, String(wipes));
  } catch {
    // The game still works when browser storage is unavailable.
  }
}

function getKnockedPosition(source: Position, target: Position): Position {
  let dx = target.x - source.x;
  let dy = target.y - source.y;
  if (Math.abs(dx) + Math.abs(dy) < 0.001) {
    const angle = Math.random() * Math.PI * 2;
    dx = Math.cos(angle);
    dy = Math.sin(angle);
  }
  const length = Math.hypot(dx, dy);
  return clampPosition({
    x: target.x + (dx / length) * 0.045,
    y: target.y + (dy / length) * 0.035,
  });
}

function getMatchedPairPositions(target: Position, arenaWidth: number): [Position, Position] {
  const [minX, maxX] = getArenaXBounds(target.y);
  const separation = Math.min(maxX - minX, Math.max(0.07, Math.min(0.15, 90 / arenaWidth)));
  const halfSeparation = separation / 2;
  const midpoint = Math.min(maxX - halfSeparation, Math.max(minX + halfSeparation, target.x));
  return [
    { x: midpoint - halfSeparation, y: target.y },
    { x: midpoint + halfSeparation, y: target.y },
  ];
}

function formatTimeLeft(timeLeftMs: number): string {
  return `${(timeLeftMs / 1_000).toFixed(1)}s`;
}

function randomSpawnPosition(): Position {
  const angle = Math.random() * Math.PI * 2;
  const radius = 0.2 + Math.pow(Math.random(), 0.9) * 0.74;
  const y = ARENA_CENTER_Y + Math.sin(angle) * 0.33 * radius + (Math.random() - 0.5) * 0.025;
  const [, maxX] = getArenaXBounds(y);
  const x = 0.5 + Math.cos(angle) * (maxX - 0.5) * 0.9 * radius + (Math.random() - 0.5) * 0.015;
  return clampPosition({ x, y });
}

function buildSpawnPositions(arenaWidth: number, arenaHeight: number): Position[] {
  const radiusX = Math.min(25, Math.max(15, arenaWidth * 0.025));
  const radiusY = Math.min(14, Math.max(9, arenaHeight * 0.02));
  const minDistanceX = radiusX * 2.08 / arenaWidth;
  const minDistanceY = radiusY * 2.08 / arenaHeight;
  const positions: Position[] = [];

  while (positions.length < PLAYER_COUNT) {
    let accepted = false;
    for (let attempt = 0; attempt < 2_000; attempt += 1) {
      const candidate = randomSpawnPosition();
      const touchesAnotherRing = positions.some((position) => (
        ((candidate.x - position.x) / minDistanceX) ** 2
          + ((candidate.y - position.y) / minDistanceY) ** 2
      ) <= 1);
      if (touchesAnotherRing) continue;
      positions.push(candidate);
      accepted = true;
      break;
    }
    if (!accepted) throw new Error("The raid could not be spread around the arena");
  }
  return positions;
}

function buildPlayers(characters: BossMechanicCharacter[], arenaWidth: number, arenaHeight: number, pairCount: number): Player[] {
  const mechanicGreenCounts = Array.from({ length: pairCount }, (_, index) => (
    index % 2 === 0 ? [1, 3] : [2, 2]
  )).flat();
  const assignments = shuffle([
    ...mechanicGreenCounts.map((greenCount) => ({ greenCount, hasMechanic: true })),
    ...Array.from({ length: PLAYER_COUNT - mechanicGreenCounts.length }, () => ({ greenCount: 0, hasMechanic: false })),
  ]);
  const positions = buildSpawnPositions(arenaWidth, arenaHeight);

  return shuffle(characters).map((character, index) => ({
    ...character,
    ...positions[index],
    ...assignments[index],
    matched: false,
  }));
}

function ToxinMarker({ greenCount }: { greenCount: number }) {
  const positions = ["top", "left", "right", "bottom"];
  const colors = greenCount === 1
    ? ["green", "red", "red", "red"]
    : greenCount === 2
      ? ["red", "green", "green", "red"]
      : ["green", "green", "green", "red"];

  return (
    <span className={styles.toxinMarker} aria-label={`${greenCount} green, ${4 - greenCount} red`}>
      {greenCount === 2 ? <span className={styles.toxinTube} data-segment="horizontal" /> : null}
      {greenCount === 3 ? (
        <>
          <span className={styles.toxinTube} data-segment="upper-left" />
          <span className={styles.toxinTube} data-segment="upper-right" />
        </>
      ) : null}
      {colors.map((color, index) => (
        <span key={positions[index]} className={styles.toxinOrb} data-color={color} data-position={positions[index]} />
      ))}
    </span>
  );
}

export default function HelicalToxinsGame() {
  const t = useTranslations("fun.helicalToxins");
  const { user } = useAuth();
  const arenaRef = useRef<HTMLDivElement>(null);
  const playersRef = useRef<Player[]>([]);
  const dragRef = useRef<DragState | null>(null);
  const renderHitAreasRef = useRef<Map<string, RenderHitArea>>(new Map());
  const startedAtRef = useRef(0);
  const loadIdRef = useRef(0);
  const autoStartRef = useRef(false);
  const selectedGuildIdRef = useRef("");
  const difficultyRef = useRef<BossMechanicDifficulty>("normal");
  const wipeCountRef = useRef(0);
  const [players, setPlayers] = useState<Player[]>([]);
  const [phase, setPhase] = useState<Phase>("loading");
  const [remainingMs, setRemainingMs] = useState(DIFFICULTY_BY_ID.normal.durationMs);
  const [wipeReason, setWipeReason] = useState<WipeReason>("timeout");
  const [wipeCount, setWipeCount] = useState(0);
  const [clearPulls, setClearPulls] = useState(1);
  const [difficulty, setDifficulty] = useState<BossMechanicDifficulty>("normal");
  const [guilds, setGuilds] = useState<BossMechanicGuild[]>([]);
  const [selectedGuildId, setSelectedGuildId] = useState("");
  const [leaderboard, setLeaderboard] = useState<BossMechanicLeaderboardEntry[]>([]);
  const [leaderboardLoaded, setLeaderboardLoaded] = useState(false);
  const [readyRenders, setReadyRenders] = useState<Set<string>>(() => new Set());
  const [hoveredPlayerId, setHoveredPlayerId] = useState<string | null>(null);
  const [draggingPlayerId, setDraggingPlayerId] = useState<string | null>(null);
  playersRef.current = players;
  wipeCountRef.current = wipeCount;
  difficultyRef.current = difficulty;
  const roundDurationMs = DIFFICULTY_BY_ID[difficulty].durationMs;

  const assembleRaid = useCallback(async (autoStart = false, guildId = selectedGuildIdRef.current) => {
    const loadId = ++loadIdRef.current;
    autoStartRef.current = autoStart;
    setPhase("loading");
    setPlayers([]);
    setWipeReason("timeout");
    setRemainingMs(DIFFICULTY_BY_ID[difficultyRef.current].durationMs);
    setReadyRenders(new Set());
    setHoveredPlayerId(null);
    setDraggingPlayerId(null);
    renderHitAreasRef.current.clear();
    try {
      const response = await api.getBossMechanicCharacters(guildId || undefined);
      if (loadId !== loadIdRef.current) return;
      if (response.characters.length !== PLAYER_COUNT) throw new Error("A full raid group was not returned");
      const arenaRect = arenaRef.current?.getBoundingClientRect();
      setPlayers(buildPlayers(
        response.characters,
        arenaRect?.width || 1_200,
        arenaRect?.height || 675,
        DIFFICULTY_BY_ID[difficultyRef.current].pairCount,
      ));
      setPhase("ready");
    } catch {
      if (loadId === loadIdRef.current) {
        autoStartRef.current = false;
        setPhase("error");
      }
    }
  }, []);

  useEffect(() => {
    void assembleRaid();
    return () => { loadIdRef.current += 1; };
  }, [assembleRaid]);

  useEffect(() => {
    const storedWipes = readStoredWipes(difficultyRef.current);
    wipeCountRef.current = storedWipes;
    setWipeCount(storedWipes);
  }, []);

  useEffect(() => {
    let active = true;
    void api.getBossMechanicGuilds()
      .then((response) => {
        if (active) setGuilds(response.guilds);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    void api.getBossMechanicLeaderboard()
      .then((response) => {
        if (active) setLeaderboard(response.entries);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLeaderboardLoaded(true);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (phase !== "playing") return;
    const tick = () => {
      if (startedAtRef.current === 0) return;
      const nextRemaining = Math.max(0, roundDurationMs - (Date.now() - startedAtRef.current));
      setRemainingMs(nextRemaining);
      if (nextRemaining === 0) {
        startedAtRef.current = 0;
        const nextWipeCount = Math.min(wipeCountRef.current + 1, 9_999);
        wipeCountRef.current = nextWipeCount;
        setWipeCount(nextWipeCount);
        writeStoredWipes(difficultyRef.current, nextWipeCount);
        setWipeReason("timeout");
        setPhase("wiped");
        dragRef.current = null;
        setHoveredPlayerId(null);
        setDraggingPlayerId(null);
      }
    };
    tick();
    const interval = window.setInterval(tick, 50);
    return () => window.clearInterval(interval);
  }, [phase, roundDurationMs]);

  const startRound = () => {
    if (phase !== "ready" || readyRenders.size < PLAYER_COUNT) return;
    autoStartRef.current = false;
    startedAtRef.current = Date.now();
    setRemainingMs(roundDurationMs);
    setWipeReason("timeout");
    setPhase("playing");
  };

  useEffect(() => {
    if (!autoStartRef.current || phase !== "ready" || readyRenders.size < PLAYER_COUNT) return;
    autoStartRef.current = false;
    startedAtRef.current = Date.now();
    setRemainingMs(roundDurationMs);
    setWipeReason("timeout");
    setPhase("playing");
  }, [phase, readyRenders, roundDurationMs]);

  const markRenderReady = (id: string) => {
    setReadyRenders((current) => {
      if (current.has(id)) return current;
      const next = new Set(current);
      next.add(id);
      return next;
    });
  };

  const registerRenderHitArea = (id: string, image: HTMLImageElement) => {
    try {
      const mask = createAlphaHitMask(image);
      if (mask) renderHitAreasRef.current.set(id, { image, mask });
    } catch {
      renderHitAreasRef.current.delete(id);
    }
  };

  const findPlayerAtPoint = (clientX: number, clientY: number): Player | null => (
    playersRef.current
      .map((player, index) => ({ player, index }))
      .sort((left, right) => getPlayerDepth(right.player.y) - getPlayerDepth(left.player.y) || right.index - left.index)
      .find(({ player }) => {
        const hitArea = renderHitAreasRef.current.get(player.id);
        return hitArea ? hitsOpaquePixel(clientX, clientY, hitArea) : false;
      })?.player ?? null
  );

  const selectGuild = (guildId: string) => {
    selectedGuildIdRef.current = guildId;
    setSelectedGuildId(guildId);
    void assembleRaid(false, guildId);
  };

  const selectDifficulty = (nextDifficulty: BossMechanicDifficulty, autoStart = false) => {
    difficultyRef.current = nextDifficulty;
    setDifficulty(nextDifficulty);
    const storedWipes = readStoredWipes(nextDifficulty);
    wipeCountRef.current = storedWipes;
    setWipeCount(storedWipes);
    setClearPulls(1);
    setRemainingMs(DIFFICULTY_BY_ID[nextDifficulty].durationMs);
    void assembleRaid(autoStart);
  };

  const wipe = (reason: WipeReason) => {
    if (startedAtRef.current === 0) return;
    startedAtRef.current = 0;
    const nextWipeCount = Math.min(wipeCountRef.current + 1, 9_999);
    wipeCountRef.current = nextWipeCount;
    setWipeCount(nextWipeCount);
    writeStoredWipes(difficultyRef.current, nextWipeCount);
    setWipeReason(reason);
    dragRef.current = null;
    setHoveredPlayerId(null);
    setDraggingPlayerId(null);
    setPhase("wiped");
  };

  const pairPlayers = (sourceId: string, targetId: string) => {
    const current = playersRef.current;
    const source = current.find((player) => player.id === sourceId);
    const target = current.find((player) => player.id === targetId);
    if (!source || !target || !source.hasMechanic || !target.hasMechanic || source.matched || target.matched || phase !== "playing") return;

    const total = source.greenCount + target.greenCount;
    if (total !== 4) {
      if (difficulty === "normal") {
        const knockedPosition = getKnockedPosition(source, target);
        const nextPlayers = current.map((player) => player.id === targetId ? { ...player, ...knockedPosition } : player);
        playersRef.current = nextPlayers;
        setPlayers(nextPlayers);
        dragRef.current = null;
        setHoveredPlayerId(null);
        setDraggingPlayerId(null);
        return;
      }
      wipe({ total });
      return;
    }

    const [sourcePosition, targetPosition] = getMatchedPairPositions(
      target,
      arenaRef.current?.getBoundingClientRect().width || 1_200,
    );
    const nextPlayers = current.map((player) => {
      if (player.id === sourceId) return { ...player, ...sourcePosition, matched: true };
      if (player.id === targetId) return { ...player, ...targetPosition, matched: true };
      return player;
    });
    playersRef.current = nextPlayers;
    setPlayers(nextPlayers);
    dragRef.current = null;
    setHoveredPlayerId(null);
    setDraggingPlayerId(null);
    if (nextPlayers.filter((player) => player.hasMechanic).every((player) => player.matched)) {
      const timeLeftMs = Math.max(0, roundDurationMs - (Date.now() - startedAtRef.current));
      const pulls = wipeCountRef.current + 1;
      startedAtRef.current = 0;
      setRemainingMs(timeLeftMs);
      setClearPulls(pulls);
      wipeCountRef.current = 0;
      setWipeCount(0);
      writeStoredWipes(difficulty, 0);
      setPhase("won");
      if (user) {
        const team = guilds.find((guild) => guild.id === selectedGuildId)?.name ?? t("dreamTeam");
        void api.submitBossMechanicScore({ difficulty, pulls, timeLeftMs, team })
          .then((response) => {
            setLeaderboard(response.entries);
            setLeaderboardLoaded(true);
          })
          .catch(() => undefined);
      }
    }
  };

  const getPointerPosition = (clientX: number, clientY: number, drag: DragState): Position | null => {
    const rect = arenaRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return clampPosition({
      x: (clientX - rect.left - drag.offsetX) / rect.width,
      y: (clientY - rect.top - drag.offsetY) / rect.height,
    });
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (phase !== "playing" || event.button !== 0) return;
    const rect = arenaRef.current?.getBoundingClientRect();
    const player = findPlayerAtPoint(event.clientX, event.clientY);
    if (!rect || !player) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      id: player.id,
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left - player.x * rect.width,
      offsetY: event.clientY - rect.top - player.y * rect.height,
      lastPosition: { x: player.x, y: player.y },
    };
    setHoveredPlayerId(player.id);
    setDraggingPlayerId(player.id);
  };

  const movePlayer = (event: ReactPointerEvent<HTMLDivElement>): Position | null => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return null;
    const position = getPointerPosition(event.clientX, event.clientY, drag);
    const rect = arenaRef.current?.getBoundingClientRect();
    if (!position || !rect) return null;

    const radiusX = Math.min(25, Math.max(15, rect.width * 0.025));
    const radiusY = Math.min(14, Math.max(9, rect.height * 0.02));
    const draggedPlayer = playersRef.current.find((player) => player.id === drag.id);
    const collision = !draggedPlayer?.hasMechanic || draggedPlayer.matched
      ? undefined
      : playersRef.current
        .filter((player) => player.id !== drag.id && player.hasMechanic && !player.matched)
        .map((player) => {
          const startX = (drag.lastPosition.x - player.x) * rect.width / (radiusX * 2);
          const startY = (drag.lastPosition.y - player.y) * rect.height / (radiusY * 2);
          const endX = (position.x - player.x) * rect.width / (radiusX * 2);
          const endY = (position.y - player.y) * rect.height / (radiusY * 2);
          const pathX = endX - startX;
          const pathY = endY - startY;
          const pathLengthSquared = pathX ** 2 + pathY ** 2;
          const progress = pathLengthSquared === 0
            ? 0
            : Math.max(0, Math.min(1, -(startX * pathX + startY * pathY) / pathLengthSquared));
          return {
            player,
            progress,
            distance: (startX + pathX * progress) ** 2 + (startY + pathY * progress) ** 2,
          };
        })
        .filter(({ distance }) => distance <= 1)
        .sort((left, right) => left.progress - right.progress || left.distance - right.distance)[0];

    if (collision) {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      pairPlayers(drag.id, collision.player.id);
      return null;
    }

    drag.lastPosition = position;
    const nextPlayers = playersRef.current.map((player) => player.id === drag.id ? { ...player, ...position } : player);
    playersRef.current = nextPlayers;
    setPlayers(nextPlayers);
    return position;
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current) {
      movePlayer(event);
      return;
    }
    const hovered = phase === "playing" ? findPlayerAtPoint(event.clientX, event.clientY)?.id ?? null : null;
    setHoveredPlayerId((current) => current === hovered ? current : hovered);
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    movePlayer(event);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
    setDraggingPlayerId(null);
    const hovered = phase === "playing" ? findPlayerAtPoint(event.clientX, event.clientY)?.id ?? null : null;
    setHoveredPlayerId(hovered);
  };

  const onPointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
    setHoveredPlayerId(null);
    setDraggingPlayerId(null);
  };

  const matchedPairs = players.filter((player) => player.matched).length / 2;
  const pairCount = DIFFICULTY_BY_ID[difficulty].pairCount;
  const showToxinMarkers = (phase === "playing" || phase === "won" || phase === "wiped")
    && (difficulty !== "mythic" || remainingMs > 5_000);
  const resultCopy = phase === "won"
    ? { title: t("clearTitle"), body: t("clearBody", { pulls: clearPulls, pairs: pairCount }) }
    : wipeReason === "manual"
      ? { title: t("wipeTitle", { count: wipeCount }), body: t("manualWipeBody") }
      : wipeReason === "timeout"
      ? { title: t("wipeTitle", { count: wipeCount }), body: t("timeoutBody") }
      : { title: t("wipeTitle", { count: wipeCount }), body: t("wrongPairBody", { total: wipeReason.total }) };
  const guildOptions: GameSelectOption[] = [
    { value: "", label: t("dreamTeam") },
    ...guilds.map((guild) => ({ value: guild.id, label: guild.name })),
  ];
  const difficultyOptions: GameSelectOption[] = DIFFICULTIES.map((option) => ({
    value: option.id,
    label: t(option.labelKey),
    icon: option.emoji,
  }));
  const nextDifficulty = difficulty === "normal" ? "heroic" : difficulty === "heroic" ? "mythic" : null;

  return (
    <main className={styles.page}>
      <div className={`${styles.shell} ${styles.shellWithLeaderboard}`}>
        <header className={styles.header}>
          <Link href="/fun" className={styles.back}>← {t("back")}</Link>
          <div className={styles.titleRow}>
            <div className={styles.encounterTitle}>
              <span className={styles.encounterIcon} aria-hidden="true">
                <Image src="/fun/boss-mechanics/entombed-sentinels.png" alt="" fill sizes="72px" priority />
              </span>
              <h1>{t("title")}</h1>
            </div>
            <div className={styles.headerControls}>
              <GameSelect
                label={t("raidTeam")}
                value={selectedGuildId}
                options={guildOptions}
                disabled={phase === "playing" || phase === "loading"}
                wide
                onChange={selectGuild}
              />
              <GameSelect
                label={t("difficulty")}
                value={difficulty}
                options={difficultyOptions}
                disabled={phase === "playing" || phase === "loading"}
                accent={difficulty}
                onChange={(value) => selectDifficulty(value as BossMechanicDifficulty)}
              />
            </div>
          </div>
        </header>

        <div className={`${styles.gameLayout} ${styles.withLeaderboard}`}>
          <section className={styles.gameColumn}>
            <div className={styles.hud}>
          <div><span>{t("time")}</span><strong>{(remainingMs / 1000).toFixed(1)}</strong></div>
          <div className={styles.timerTrack} aria-hidden="true"><span style={{ width: `${(remainingMs / roundDurationMs) * 100}%` }} /></div>
          <div className={styles.hudPairs}><span>{t("pairs")}</span><strong>{matchedPairs}/{pairCount}</strong></div>
          <button
            type="button"
            className={styles.wipeButton}
            data-visible={phase === "playing"}
            disabled={phase !== "playing"}
            aria-hidden={phase !== "playing"}
            onClick={() => wipe("manual")}
          >
            {t("wipe")}
          </button>
            </div>

            <div
              ref={arenaRef}
              className={styles.arena}
              data-phase={phase}
              data-model-hovered={hoveredPlayerId ? "true" : "false"}
              data-dragging={draggingPlayerId ? "true" : "false"}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerCancel}
              onPointerLeave={() => {
                if (!dragRef.current) setHoveredPlayerId(null);
              }}
            >
          <div className={styles.arenaShade} aria-hidden="true" />
          <div className={styles.boss} aria-hidden="true">
            <Image src="/fun/boss-mechanics/entombed-sentinels.png" alt="" fill sizes="(max-width: 700px) 46vw, 320px" priority />
          </div>

          {players.map((player, index) => (
            <div
              key={player.id}
              data-player-id={player.id}
              className={`${styles.player} ${player.matched ? styles.matched : ""}`}
              data-hovered={hoveredPlayerId === player.id ? "true" : "false"}
              data-dragging={draggingPlayerId === player.id ? "true" : "false"}
              style={{ left: `${player.x * 100}%`, top: `${player.y * 100}%`, zIndex: getPlayerDepth(player.y) }}
              role="group"
              aria-label={phase === "playing" && player.hasMechanic ? t("playerLabel", { name: player.name, green: player.greenCount }) : player.name}
            >
              <span className={styles.nameplate} style={{ color: CCG_CLASS_COLORS[player.classID] ?? "#e2e8f0" }}>{player.name}</span>
              <span
                className={styles.renderWindow}
              >
                <AlphaFittedCharacterRender
                  src={player.renderUrl}
                  className={styles.renderImage}
                  fit={player.renderFit}
                  priority={index < 8}
                  draggable={false}
                  onImageReady={(image) => registerRenderHitArea(player.id, image)}
                  onReady={() => markRenderReady(player.id)}
                />
              </span>
              {player.hasMechanic ? <span className={styles.footZone} aria-hidden="true" /> : null}
            </div>
          ))}

          {showToxinMarkers ? (
            <div className={styles.markerLayer} aria-hidden="true">
              {players.filter((player) => player.hasMechanic && !player.matched).map((player) => (
                <span
                  key={player.id}
                  className={styles.markerAnchor}
                  style={{ left: `${player.x * 100}%`, top: `${player.y * 100}%` }}
                >
                  <ToxinMarker greenCount={player.greenCount} />
                </span>
              ))}
            </div>
          ) : null}

          {phase === "loading" ? (
            <div className={styles.overlay} role="status"><h2 className={styles.singleLineTitle}>{t("loading")}</h2><span className={styles.spinner} /></div>
          ) : null}
          {phase === "ready" ? (
            <div className={styles.overlay}>
              <h2 className={styles.singleLineTitle}>{readyRenders.size < PLAYER_COUNT || autoStartRef.current ? t("rendering", { count: readyRenders.size }) : t("readyTitle")}</h2>
              {!autoStartRef.current ? <button type="button" onClick={startRound} disabled={readyRenders.size < PLAYER_COUNT}>{t("start")}</button> : null}
            </div>
          ) : null}
          {phase === "error" ? (
            <div className={styles.overlay} role="alert"><h2 className={styles.fitTitle}>{t("errorTitle")}</h2><button type="button" onClick={() => void assembleRaid()}>{t("retry")}</button></div>
          ) : null}
          {phase === "won" || phase === "wiped" ? (
            <div className={`${styles.overlay} ${phase === "won" ? styles.winOverlay : styles.wipeOverlay}`} role="status">
              {phase === "won" ? <p className={styles.overlayEyebrow}>{t("success")}</p> : null}
              <h2>{resultCopy.title}</h2>
              <p>{resultCopy.body}</p>
              <div className={styles.resultActions}>
                {phase === "won" && nextDifficulty ? (
                  <button type="button" onClick={() => selectDifficulty(nextDifficulty, true)}>
                    {t("nextDifficulty", { difficulty: t(DIFFICULTY_BY_ID[nextDifficulty].labelKey) })}
                  </button>
                ) : null}
                {phase === "wiped" ? (
                  <a
                    className={styles.guideLink}
                    href="https://opintopolku.fi/konfo/fi/koulutus/1.2.246.562.13.00000000000000004246"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t("guideLink")} <FaArrowUpRightFromSquare aria-hidden="true" />
                  </a>
                ) : null}
                <button type="button" onClick={() => void assembleRaid(true)}>{t("newPull", { count: wipeCount + 1 })}</button>
              </div>
            </div>
          ) : null}
            </div>
          </section>

          <aside className={styles.leaderboard} aria-label={t("leaderboard")}>
              <h2>{t("leaderboard")}</h2>
              {leaderboard.length > 0 ? (
                <table>
                  <thead>
                    <tr>
                      <th>{t("raider")}</th>
                      <th>{t("pulls")}</th>
                      <th>{t("timeLeft")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaderboard.map((entry) => (
                      <tr key={entry.id}>
                        <td>
                          <span className={styles.leaderboardPlayer}>
                            <span className={styles.leaderboardRank}>{entry.rank}</span>
                            <Image src={entry.avatarUrl} alt="" width={24} height={24} unoptimized />
                            <span className={styles.leaderboardDifficulty} title={t(DIFFICULTY_BY_ID[entry.difficulty].labelKey)}>{DIFFICULTY_BY_ID[entry.difficulty].emoji}</span>
                            <span className={styles.leaderboardIdentity}>
                              <span className={styles.leaderboardName}>{entry.username}</span>
                              <span className={styles.leaderboardTeam}>{entry.team}</span>
                            </span>
                          </span>
                        </td>
                        <td>{entry.pulls}</td>
                        <td>{formatTimeLeft(entry.timeLeftMs)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className={styles.leaderboardEmpty}>{leaderboardLoaded ? t("leaderboardEmpty") : t("leaderboardLoading")}</p>
              )}
          </aside>
        </div>
      </div>
    </main>
  );
}
