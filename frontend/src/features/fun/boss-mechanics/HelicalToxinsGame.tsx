"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useTranslations } from "next-intl";
import { FaArrowUpRightFromSquare } from "react-icons/fa6";
import AlphaFittedCharacterRender from "@/components/ccg/AlphaFittedCharacterRender";
import { api } from "@/lib/api";
import { CCG_CLASS_COLORS } from "@/lib/ccg";
import type { BossMechanicCharacter } from "@/types";
import styles from "./helical-toxins.module.css";

const ROUND_DURATION_MS = 10_000;
const PLAYER_COUNT = 20;
const PAIR_COUNT = PLAYER_COUNT / 2;
const ARENA_MIN_Y = 0.18;
const ARENA_MAX_Y = 0.93;
const ARENA_CENTER_Y = 0.56;

type Position = { x: number; y: number };
type Player = BossMechanicCharacter & Position & { greenCount: number; matched: boolean };
type Phase = "loading" | "ready" | "playing" | "won" | "wiped" | "error";
type DragState = {
  id: string;
  pointerId: number;
  offsetX: number;
  offsetY: number;
  lastPosition: Position;
};

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
  const arenaRef = useRef<HTMLDivElement>(null);
  const playersRef = useRef<Player[]>([]);
  const dragRef = useRef<DragState | null>(null);
  const startedAtRef = useRef(0);
  const loadIdRef = useRef(0);
  const autoStartRef = useRef(false);
  const [players, setPlayers] = useState<Player[]>([]);
  const [phase, setPhase] = useState<Phase>("loading");
  const [remainingMs, setRemainingMs] = useState(ROUND_DURATION_MS);
  const [wipeTotal, setWipeTotal] = useState<number | null>(null);
  const [readyRenders, setReadyRenders] = useState<Set<string>>(() => new Set());
  playersRef.current = players;

  const assembleRaid = useCallback(async (autoStart = false) => {
    const loadId = ++loadIdRef.current;
    autoStartRef.current = autoStart;
    setPhase("loading");
    setPlayers([]);
    setWipeTotal(null);
    setRemainingMs(ROUND_DURATION_MS);
    setReadyRenders(new Set());
    try {
      const response = await api.getBossMechanicCharacters();
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
    if (phase !== "playing") return;
    const tick = () => {
      const nextRemaining = Math.max(0, ROUND_DURATION_MS - (Date.now() - startedAtRef.current));
      setRemainingMs(nextRemaining);
      if (nextRemaining === 0) {
        setPhase("wiped");
        dragRef.current = null;
      }
    };
    tick();
    const interval = window.setInterval(tick, 50);
    return () => window.clearInterval(interval);
  }, [phase]);

  const startRound = () => {
    if (phase !== "ready" || readyRenders.size < PLAYER_COUNT) return;
    autoStartRef.current = false;
    startedAtRef.current = Date.now();
    setRemainingMs(ROUND_DURATION_MS);
    setWipeTotal(null);
    setPhase("playing");
  };

  useEffect(() => {
    if (!autoStartRef.current || phase !== "ready" || readyRenders.size < PLAYER_COUNT) return;
    autoStartRef.current = false;
    startedAtRef.current = Date.now();
    setRemainingMs(ROUND_DURATION_MS);
    setWipeTotal(null);
    setPhase("playing");
  }, [phase, readyRenders]);

  const markRenderReady = (id: string) => {
    setReadyRenders((current) => {
      if (current.has(id)) return current;
      const next = new Set(current);
      next.add(id);
      return next;
    });
  };

  const wipe = (total: number) => {
    setWipeTotal(total);
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
      wipe(total);
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
    if (nextPlayers.every((player) => player.matched)) setPhase("won");
  };

  const getPointerPosition = (clientX: number, clientY: number, drag: DragState): Position | null => {
    const rect = arenaRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return clampPosition({
      x: (clientX - rect.left - drag.offsetX) / rect.width,
      y: (clientY - rect.top - drag.offsetY) / rect.height,
    });
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>, player: Player) => {
    if (phase !== "playing" || player.matched) return;
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

  const movePlayer = (event: ReactPointerEvent<HTMLDivElement>): Position | null => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || drag.id !== event.currentTarget.dataset.playerId) return null;
    const position = getPointerPosition(event.clientX, event.clientY, drag);
    const rect = arenaRef.current?.getBoundingClientRect();
    if (!position || !rect) return null;

    const radiusX = Math.min(25, Math.max(15, rect.width * 0.025));
    const radiusY = Math.min(14, Math.max(9, rect.height * 0.02));
    const collision = playersRef.current
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

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    movePlayer(event);
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || drag.id !== event.currentTarget.dataset.playerId) return;
    movePlayer(event);
    dragRef.current = null;
  };

  const matchedPairs = players.filter((player) => player.matched).length / 2;
  const resultCopy = phase === "won"
    ? { title: t("clearTitle"), body: t("clearBody") }
    : wipeTotal === null
      ? { title: t("wipeTitle"), body: t("timeoutBody") }
      : { title: t("wipeTitle"), body: t("wrongPairBody", { total: wipeTotal }) };

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <Link href="/fun" className={styles.back}>← {t("back")}</Link>
          <h1>{t("title")}</h1>
        </header>

        <div className={styles.hud}>
          <div><span>{t("time")}</span><strong>{(remainingMs / 1000).toFixed(1)}</strong></div>
          <div className={styles.timerTrack} aria-hidden="true"><span style={{ width: `${(remainingMs / ROUND_DURATION_MS) * 100}%` }} /></div>
          <div><span>{t("pairs")}</span><strong>{matchedPairs}/{PAIR_COUNT}</strong></div>
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
              style={{ left: `${player.x * 100}%`, top: `${player.y * 100}%`, zIndex: player.matched ? 20 + index : 30 + index }}
              role="group"
              aria-label={phase === "playing" ? t("playerLabel", { name: player.name, green: player.greenCount }) : player.name}
              onPointerDown={(event) => onPointerDown(event, player)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={() => { dragRef.current = null; }}
            >
              {phase === "playing" || phase === "won" || phase === "wiped" ? <ToxinMarker greenCount={player.greenCount} /> : null}
              <span className={styles.nameplate} style={{ color: CCG_CLASS_COLORS[player.classID] ?? "#e2e8f0" }}>{player.name}</span>
              <span className={styles.renderWindow} aria-hidden="true">
                <AlphaFittedCharacterRender
                  src={player.renderUrl}
                  className={styles.renderImage}
                  fit={player.renderFit}
                  priority={index < 8}
                  onReady={() => markRenderReady(player.id)}
                />
              </span>
              <span className={styles.footZone} aria-hidden="true" />
            </div>
          ))}

          {phase === "loading" ? (
            <div className={styles.overlay} role="status"><span className={styles.spinner} /><h2 className={styles.singleLineTitle}>{t("loading")}</h2></div>
          ) : null}
          {phase === "ready" ? (
            <div className={styles.overlay}>
              <h2 className={styles.singleLineTitle}>{readyRenders.size < PLAYER_COUNT || autoStartRef.current ? t("rendering", { count: readyRenders.size }) : t("readyTitle")}</h2>
              {!autoStartRef.current ? <button type="button" onClick={startRound} disabled={readyRenders.size < PLAYER_COUNT}>{t("start")}</button> : null}
            </div>
          ) : null}
          {phase === "error" ? (
            <div className={styles.overlay} role="alert"><h2>{t("errorTitle")}</h2><p>{t("errorBody")}</p><button type="button" onClick={() => void assembleRaid()}>{t("retry")}</button></div>
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
                <button type="button" onClick={() => void assembleRaid(true)}>{t("newPull")}</button>
              </div>
            </div>
          ) : null}
        </div>

      </div>
    </main>
  );
}
