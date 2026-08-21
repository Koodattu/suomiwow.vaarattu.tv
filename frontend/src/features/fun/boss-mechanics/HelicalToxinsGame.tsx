"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import AlphaFittedCharacterRender from "@/components/ccg/AlphaFittedCharacterRender";
import { api } from "@/lib/api";
import type { BossMechanicCharacter } from "@/types";
import styles from "./helical-toxins.module.css";

const ROUND_DURATION_MS = 10_000;
const PLAYER_COUNT = 20;
const PAIR_COUNT = PLAYER_COUNT / 2;

type Position = { x: number; y: number };
type Player = BossMechanicCharacter & Position & { greenCount: number; matched: boolean };
type Phase = "loading" | "ready" | "playing" | "won" | "wiped" | "error";
type DragState = {
  id: string;
  pointerId: number;
  offsetX: number;
  offsetY: number;
  moved: boolean;
};

function shuffle<T>(items: readonly T[]): T[] {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
  }
  return shuffled;
}

function buildPlayers(characters: BossMechanicCharacter[]): Player[] {
  const greenCounts = shuffle(Array.from({ length: PAIR_COUNT / 2 }, () => [1, 3, 2, 2]).flat());
  const slots = shuffle(
    Array.from({ length: PLAYER_COUNT }, (_, index) => ({
      x: 0.1 + (index % 5) * 0.2 + (Math.random() - 0.5) * 0.035,
      y: 0.22 + Math.floor(index / 5) * 0.24 + (Math.random() - 0.5) * 0.025,
    })),
  );

  return shuffle(characters).map((character, index) => ({
    ...character,
    ...slots[index],
    greenCount: greenCounts[index],
    matched: false,
  }));
}

function ToxinMarker({ greenCount }: { greenCount: number }) {
  const colors = greenCount === 1
    ? ["green", "red", "red", "red"]
    : greenCount === 2
      ? ["red", "green", "green", "red"]
      : ["green", "green", "green", "red"];

  return (
    <span className={styles.toxinMarker} aria-label={`${greenCount} green, ${4 - greenCount} red`}>
      {colors.map((color, index) => <span key={index} className={styles.toxinOrb} data-color={color} />)}
    </span>
  );
}

function clampPosition(position: Position): Position {
  return {
    x: Math.min(0.965, Math.max(0.035, position.x)),
    y: Math.min(0.965, Math.max(0.19, position.y)),
  };
}

export default function HelicalToxinsGame() {
  const t = useTranslations("fun.helicalToxins");
  const arenaRef = useRef<HTMLDivElement>(null);
  const playersRef = useRef<Player[]>([]);
  const dragRef = useRef<DragState | null>(null);
  const startedAtRef = useRef(0);
  const loadIdRef = useRef(0);
  const suppressClickRef = useRef<string | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [phase, setPhase] = useState<Phase>("loading");
  const [remainingMs, setRemainingMs] = useState(ROUND_DURATION_MS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [wipeTotal, setWipeTotal] = useState<number | null>(null);
  const [readyRenders, setReadyRenders] = useState<Set<string>>(() => new Set());
  playersRef.current = players;

  const assembleRaid = useCallback(async () => {
    const loadId = ++loadIdRef.current;
    setPhase("loading");
    setPlayers([]);
    setSelectedId(null);
    setWipeTotal(null);
    setRemainingMs(ROUND_DURATION_MS);
    setReadyRenders(new Set());
    try {
      const response = await api.getBossMechanicCharacters();
      if (loadId !== loadIdRef.current) return;
      if (response.characters.length !== PLAYER_COUNT) throw new Error("A full raid group was not returned");
      setPlayers(buildPlayers(response.characters));
      setPhase("ready");
    } catch {
      if (loadId === loadIdRef.current) setPhase("error");
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
        setSelectedId(null);
      }
    };
    tick();
    const interval = window.setInterval(tick, 50);
    return () => window.clearInterval(interval);
  }, [phase]);

  const startRound = () => {
    if (phase !== "ready" || readyRenders.size < PLAYER_COUNT) return;
    startedAtRef.current = Date.now();
    setRemainingMs(ROUND_DURATION_MS);
    setSelectedId(null);
    setWipeTotal(null);
    setPhase("playing");
  };

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
    setSelectedId(null);
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
    setSelectedId(null);
    if (nextPlayers.every((player) => player.matched)) setPhase("won");
  };

  const selectPlayer = (id: string) => {
    if (suppressClickRef.current === id) {
      suppressClickRef.current = null;
      return;
    }
    if (phase !== "playing") return;
    const player = playersRef.current.find((entry) => entry.id === id);
    if (!player || player.matched) return;
    if (!selectedId) {
      setSelectedId(id);
      return;
    }
    if (selectedId === id) {
      setSelectedId(null);
      return;
    }
    pairPlayers(selectedId, id);
  };

  const getPointerPosition = (clientX: number, clientY: number, drag: DragState): Position | null => {
    const rect = arenaRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return clampPosition({
      x: (clientX - rect.left - drag.offsetX) / rect.width,
      y: (clientY - rect.top - drag.offsetY) / rect.height,
    });
  };

  const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>, player: Player) => {
    if (phase !== "playing" || player.matched) return;
    const rect = arenaRef.current?.getBoundingClientRect();
    if (!rect) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      id: player.id,
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left - player.x * rect.width,
      offsetY: event.clientY - rect.top - player.y * rect.height,
      moved: false,
    };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || drag.id !== event.currentTarget.dataset.playerId) return;
    const position = getPointerPosition(event.clientX, event.clientY, drag);
    if (!position) return;
    drag.moved = true;
    setSelectedId(null);
    setPlayers((current) => current.map((player) => player.id === drag.id ? { ...player, ...position } : player));
  };

  const onPointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || drag.id !== event.currentTarget.dataset.playerId) return;
    dragRef.current = null;
    if (!drag.moved) return;
    suppressClickRef.current = drag.id;
    const position = getPointerPosition(event.clientX, event.clientY, drag);
    const rect = arenaRef.current?.getBoundingClientRect();
    if (!position || !rect) return;

    const radiusX = Math.min(25, Math.max(15, rect.width * 0.025));
    const radiusY = Math.min(14, Math.max(9, rect.height * 0.02));
    const overlapping = playersRef.current
      .filter((player) => player.id !== drag.id)
      .map((player) => ({
        player,
        distance: ((position.x - player.x) * rect.width / (radiusX * 2)) ** 2
          + ((position.y - player.y) * rect.height / (radiusY * 2)) ** 2,
      }))
      .filter(({ distance }) => distance <= 1)
      .sort((left, right) => left.distance - right.distance);

    if (overlapping.length > 0) {
      pairPlayers(drag.id, overlapping[0].player.id);
      return;
    }
    setPlayers((current) => current.map((player) => player.id === drag.id ? { ...player, ...position } : player));
  };

  const matchedPairs = players.filter((player) => player.matched).length / 2;
  const selectedPlayer = players.find((player) => player.id === selectedId);
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
          <p className={styles.eyebrow}>{t("eyebrow")}</p>
          <h1>{t("title")}</h1>
          <p className={styles.description}>{t("description")}</p>
        </header>

        <section className={styles.instructions} aria-labelledby="helical-rules-title">
          <div>
            <p className={styles.rulesEyebrow}>{t("rulesEyebrow")}</p>
            <h2 id="helical-rules-title">{t("rulesTitle")}</h2>
          </div>
          <ol>
            <li><strong>1</strong><span>{t("ruleCount")}</span></li>
            <li><strong>2</strong><span>{t("rulePair")}</span></li>
            <li><strong>3</strong><span>{t("ruleAvoid")}</span></li>
          </ol>
        </section>

        <div className={styles.hud}>
          <div><span>{t("time")}</span><strong>{(remainingMs / 1000).toFixed(1)}</strong></div>
          <div className={styles.timerTrack} aria-hidden="true"><span style={{ width: `${(remainingMs / ROUND_DURATION_MS) * 100}%` }} /></div>
          <div><span>{t("pairs")}</span><strong>{matchedPairs}/{PAIR_COUNT}</strong></div>
        </div>

        <div ref={arenaRef} className={styles.arena} data-phase={phase}>
          <div className={styles.arenaShade} aria-hidden="true" />
          <div className={styles.boss} aria-hidden="true">
            <Image src="/fun/boss-mechanics/entombed-sentinels.png" alt="" fill sizes="(max-width: 700px) 70vw, 440px" priority />
          </div>

          {players.map((player, index) => (
            <button
              key={player.id}
              type="button"
              data-player-id={player.id}
              className={`${styles.player} ${player.matched ? styles.matched : ""} ${selectedId === player.id ? styles.selected : ""}`}
              style={{ left: `${player.x * 100}%`, top: `${player.y * 100}%`, zIndex: player.matched ? 20 + index : selectedId === player.id ? 80 : 30 + index }}
              disabled={phase !== "playing" || player.matched}
              aria-label={t("playerLabel", { name: player.name, green: player.greenCount })}
              onClick={() => selectPlayer(player.id)}
              onPointerDown={(event) => onPointerDown(event, player)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={() => { dragRef.current = null; }}
            >
              <ToxinMarker greenCount={player.greenCount} />
              <span className={styles.renderWindow} aria-hidden="true">
                <AlphaFittedCharacterRender
                  src={player.renderUrl}
                  className={styles.renderImage}
                  fit={player.renderFit}
                  priority={index < 8}
                  onReady={() => markRenderReady(player.id)}
                />
              </span>
              <span className={styles.nameplate}>{player.name}</span>
              <span className={styles.footZone} aria-hidden="true" />
            </button>
          ))}

          {phase === "loading" ? (
            <div className={styles.overlay} role="status"><span className={styles.spinner} /><h2>{t("loading")}</h2></div>
          ) : null}
          {phase === "ready" ? (
            <div className={styles.overlay}>
              <p className={styles.overlayEyebrow}>{t("readyEyebrow")}</p>
              <h2>{readyRenders.size < PLAYER_COUNT ? t("rendering", { count: readyRenders.size }) : t("readyTitle")}</h2>
              <p>{t("readyBody")}</p>
              <button type="button" onClick={startRound} disabled={readyRenders.size < PLAYER_COUNT}>{t("start")}</button>
            </div>
          ) : null}
          {phase === "error" ? (
            <div className={styles.overlay} role="alert"><h2>{t("errorTitle")}</h2><p>{t("errorBody")}</p><button type="button" onClick={() => void assembleRaid()}>{t("retry")}</button></div>
          ) : null}
          {phase === "won" || phase === "wiped" ? (
            <div className={`${styles.overlay} ${phase === "won" ? styles.winOverlay : styles.wipeOverlay}`} role="status">
              <p className={styles.overlayEyebrow}>{phase === "won" ? t("success") : t("failed")}</p>
              <h2>{resultCopy.title}</h2>
              <p>{resultCopy.body}</p>
              <button type="button" onClick={() => void assembleRaid()}>{t("newPull")}</button>
            </div>
          ) : null}
        </div>

        <div className={styles.hint} aria-live="polite">
          <span>{selectedPlayer ? t("selectedHint", { name: selectedPlayer.name, green: selectedPlayer.greenCount }) : t("dragHint")}</span>
          <span>{t("footHint")}</span>
        </div>
      </div>
    </main>
  );
}
