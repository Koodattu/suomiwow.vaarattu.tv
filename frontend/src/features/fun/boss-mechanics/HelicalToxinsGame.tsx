"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useTranslations } from "next-intl";
import { Listbox, ListboxButton, ListboxOption, ListboxOptions } from "@headlessui/react";
import { FaArrowUpRightFromSquare, FaCheck, FaChevronDown } from "react-icons/fa6";
import AlphaFittedCharacterRender from "@/components/ccg/AlphaFittedCharacterRender";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { CCG_CLASS_COLORS } from "@/lib/ccg";
import type { BossMechanicCharacter, BossMechanicDifficulty, BossMechanicGuild, BossMechanicLeaderboardEntry } from "@/types";
import styles from "./helical-toxins.module.css";

const PLAYER_COUNT = 20;
const PAIR_COUNT = PLAYER_COUNT / 2;
const ARENA_MIN_Y = 0.18;
const ARENA_MAX_Y = 0.93;
const ARENA_CENTER_Y = 0.56;
const WIPE_STORAGE_PREFIX = "helical-toxins:wipes:";
const DIFFICULTIES: Array<{ id: BossMechanicDifficulty; emoji: string; durationMs: number; labelKey: "difficultyNormal" | "difficultyHeroic" | "difficultyMythic" }> = [
  { id: "normal", emoji: "🛡️", durationMs: 20_000, labelKey: "difficultyNormal" },
  { id: "heroic", emoji: "⚔️", durationMs: 10_000, labelKey: "difficultyHeroic" },
  { id: "mythic", emoji: "💀", durationMs: 10_000, labelKey: "difficultyMythic" },
];
const DIFFICULTY_BY_ID = Object.fromEntries(DIFFICULTIES.map((difficulty) => [difficulty.id, difficulty])) as Record<BossMechanicDifficulty, (typeof DIFFICULTIES)[number]>;

type Position = { x: number; y: number };
type Player = BossMechanicCharacter & Position & { greenCount: number; matched: boolean };
type Phase = "loading" | "ready" | "playing" | "won" | "wiped" | "error";
type WipeReason = "timeout" | "manual" | { total: number };
type DragState = {
  id: string;
  pointerId: number;
  offsetX: number;
  offsetY: number;
  lastPosition: Position;
};
type GameSelectOption = { value: string; label: string; icon?: string };

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
              <FaCheck className={styles.selectCheck} aria-hidden="true" />
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

function buildPlayers(characters: BossMechanicCharacter[], arenaWidth: number, arenaHeight: number): Player[] {
  const greenCounts = shuffle(Array.from({ length: PAIR_COUNT / 2 }, () => [1, 3, 2, 2]).flat());
  const positions = buildSpawnPositions(arenaWidth, arenaHeight);

  return shuffle(characters).map((character, index) => ({
    ...character,
    ...positions[index],
    greenCount: greenCounts[index],
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
    try {
      const response = await api.getBossMechanicCharacters(guildId || undefined);
      if (loadId !== loadIdRef.current) return;
      if (response.characters.length !== PLAYER_COUNT) throw new Error("A full raid group was not returned");
      const arenaRect = arenaRef.current?.getBoundingClientRect();
      setPlayers(buildPlayers(response.characters, arenaRect?.width || 1_200, arenaRect?.height || 675));
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
    if (!user) {
      setLeaderboard([]);
      setLeaderboardLoaded(false);
      return;
    }
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
  }, [user]);

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

  const selectGuild = (guildId: string) => {
    selectedGuildIdRef.current = guildId;
    setSelectedGuildId(guildId);
    void assembleRaid(false, guildId);
  };

  const selectDifficulty = (nextDifficulty: BossMechanicDifficulty) => {
    difficultyRef.current = nextDifficulty;
    setDifficulty(nextDifficulty);
    const storedWipes = readStoredWipes(nextDifficulty);
    wipeCountRef.current = storedWipes;
    setWipeCount(storedWipes);
    setClearPulls(1);
    setRemainingMs(DIFFICULTY_BY_ID[nextDifficulty].durationMs);
    void assembleRaid();
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
    setPhase("wiped");
  };

  const pairPlayers = (sourceId: string, targetId: string) => {
    const current = playersRef.current;
    const source = current.find((player) => player.id === sourceId);
    const target = current.find((player) => player.id === targetId);
    if (!source || !target || source.matched || target.matched || phase !== "playing") return;

    const total = source.greenCount + target.greenCount;
    if (total !== 4) {
      if (difficulty === "normal") {
        const knockedPosition = getKnockedPosition(source, target);
        const nextPlayers = current.map((player) => player.id === targetId ? { ...player, ...knockedPosition } : player);
        playersRef.current = nextPlayers;
        setPlayers(nextPlayers);
        dragRef.current = null;
        return;
      }
      wipe({ total });
      return;
    }

    const nextPlayers = current.map((player) => {
      if (player.id === sourceId) return { ...player, x: target.x, y: target.y, matched: true };
      if (player.id === targetId) return { ...player, matched: true };
      return player;
    });
    playersRef.current = nextPlayers;
    setPlayers(nextPlayers);
    dragRef.current = null;
    if (nextPlayers.every((player) => player.matched)) {
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

  const onPointerDown = (event: ReactPointerEvent<HTMLSpanElement>, player: Player) => {
    if (phase !== "playing") return;
    const rect = arenaRef.current?.getBoundingClientRect();
    if (!rect) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      id: player.id,
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left - player.x * rect.width,
      offsetY: event.clientY - rect.top - player.y * rect.height,
      lastPosition: { x: player.x, y: player.y },
    };
  };

  const movePlayer = (event: ReactPointerEvent<HTMLSpanElement>): Position | null => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || drag.id !== event.currentTarget.dataset.playerId) return null;
    const position = getPointerPosition(event.clientX, event.clientY, drag);
    const rect = arenaRef.current?.getBoundingClientRect();
    if (!position || !rect) return null;

    const radiusX = Math.min(25, Math.max(15, rect.width * 0.025));
    const radiusY = Math.min(14, Math.max(9, rect.height * 0.02));
    const draggedPlayer = playersRef.current.find((player) => player.id === drag.id);
    const collision = draggedPlayer?.matched
      ? undefined
      : playersRef.current
        .filter((player) => player.id !== drag.id && !player.matched)
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
    setPlayers((current) => current.map((player) => player.id === drag.id ? { ...player, ...position } : player));
    return position;
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLSpanElement>) => {
    movePlayer(event);
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLSpanElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || drag.id !== event.currentTarget.dataset.playerId) return;
    movePlayer(event);
    dragRef.current = null;
  };

  const matchedPairs = players.filter((player) => player.matched).length / 2;
  const showToxinMarkers = (phase === "playing" || phase === "won" || phase === "wiped")
    && (difficulty !== "mythic" || remainingMs > 5_000);
  const resultCopy = phase === "won"
    ? { title: t("clearTitle"), body: t("clearBody", { pulls: clearPulls }) }
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

  return (
    <main className={styles.page}>
      <div className={`${styles.shell} ${user ? styles.shellWithLeaderboard : ""}`}>
        <header className={styles.header}>
          <Link href="/fun" className={styles.back}>← {t("back")}</Link>
          <div className={styles.titleRow}>
            <h1>{t("title")}</h1>
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

        <div className={`${styles.gameLayout} ${user ? styles.withLeaderboard : ""}`}>
          <section className={styles.gameColumn}>
            <div className={styles.hud}>
          <div><span>{t("time")}</span><strong>{(remainingMs / 1000).toFixed(1)}</strong></div>
          <div className={styles.timerTrack} aria-hidden="true"><span style={{ width: `${(remainingMs / roundDurationMs) * 100}%` }} /></div>
          <div className={styles.hudPairs}><span>{t("pairs")}</span><strong>{matchedPairs}/{PAIR_COUNT}</strong></div>
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

            <div ref={arenaRef} className={styles.arena} data-phase={phase}>
          <div className={styles.arenaShade} aria-hidden="true" />
          <div className={styles.boss} aria-hidden="true">
            <Image src="/fun/boss-mechanics/entombed-sentinels.png" alt="" fill sizes="(max-width: 700px) 46vw, 320px" priority />
          </div>

          {players.map((player, index) => (
            <div
              key={player.id}
              data-player-id={player.id}
              className={`${styles.player} ${player.matched ? styles.matched : ""}`}
              style={{ left: `${player.x * 100}%`, top: `${player.y * 100}%`, zIndex: getPlayerDepth(player.y) }}
              role="group"
              aria-label={phase === "playing" ? t("playerLabel", { name: player.name, green: player.greenCount }) : player.name}
            >
              <span className={styles.nameplate} style={{ color: CCG_CLASS_COLORS[player.classID] ?? "#e2e8f0" }}>{player.name}</span>
              <span
                className={styles.renderWindow}
                data-player-id={player.id}
                onDragStart={(event) => event.preventDefault()}
                onPointerDown={(event) => onPointerDown(event, player)}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={() => { dragRef.current = null; }}
              >
                <AlphaFittedCharacterRender
                  src={player.renderUrl}
                  className={styles.renderImage}
                  fit={player.renderFit}
                  priority={index < 8}
                  draggable={false}
                  onReady={() => markRenderReady(player.id)}
                />
              </span>
              <span className={styles.footZone} aria-hidden="true" />
            </div>
          ))}

          {showToxinMarkers ? (
            <div className={styles.markerLayer} aria-hidden="true">
              {players.filter((player) => !player.matched).map((player) => (
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

          {user ? (
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
          ) : null}
        </div>
      </div>
    </main>
  );
}
