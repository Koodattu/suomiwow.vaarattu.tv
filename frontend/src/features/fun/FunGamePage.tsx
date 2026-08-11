"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { FunGameRound, FunGameSlug, HigherOrWipeMode } from "@/types";
import FunGameShell from "./FunGameShell";
import GuildGuessr from "./games/GuildGuessr";
import ImmaculateRoster, { MAX_IMMACULATE_MISTAKES } from "./games/ImmaculateRoster";
import LockItIn from "./games/LockItIn";
import RaidConnections from "./games/RaidConnections";
import RaiderResume from "./games/RaiderResume";
import Wipeprint from "./games/Wipeprint";
import Suomidle from "./games/Suomidle";
import HigherOrWipe from "./games/HigherOrWipe";
import ClosestWithoutGoingOver from "./games/ClosestWithoutGoingOver";
import styles from "./fun-feedback.module.css";

function Game({
  round,
  loading,
  onHigherModeChange,
  onImmaculateMistakesChange,
}: {
  round: FunGameRound;
  loading: boolean;
  onHigherModeChange: (mode: HigherOrWipeMode) => void;
  onImmaculateMistakesChange: (mistakes: number) => void;
}) {
  switch (round.game) {
    case "immaculate-roster":
      return <ImmaculateRoster key={round.roundId} round={round} onMistakesChange={onImmaculateMistakesChange} />;
    case "guild-guessr":
      return <GuildGuessr key={round.roundId} round={round} />;
    case "wipeprint":
      return <Wipeprint key={round.roundId} round={round} />;
    case "raider-resume":
      return <RaiderResume key={round.roundId} round={round} />;
    case "raid-connections":
      return <RaidConnections key={round.roundId} round={round} />;
    case "lock-it-in":
      return <LockItIn key={round.roundId} round={round} />;
    case "suomidle":
      return <Suomidle key={round.roundId} round={round} />;
    case "higher-or-wipe":
      return <HigherOrWipe key={round.roundId} round={round} loading={loading} onModeChange={onHigherModeChange} />;
    case "closest-without-going-over":
      return <ClosestWithoutGoingOver key={round.roundId} round={round} />;
  }
}

export default function FunGamePage({ game }: { game: FunGameSlug }) {
  const [round, setRound] = useState<FunGameRound | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [higherOrWipeMode, setHigherOrWipeMode] = useState<HigherOrWipeMode>("random");
  const [immaculateMistakes, setImmaculateMistakes] = useState(0);
  const requestIdRef = useRef(0);
  const startedRef = useRef(false);

  const generate = useCallback(async (modeOverride?: HigherOrWipeMode) => {
    const requestId = ++requestIdRef.current;
    const requestedMode = game === "higher-or-wipe" ? modeOverride ?? higherOrWipeMode : undefined;
    setLoading(true);
    setError(null);
    try {
      const result = await api.generateFunRound(game, { mode: requestedMode });
      if (requestId !== requestIdRef.current) return;
      if (result.game !== game) throw new Error("The generated game did not match the requested game");
      if (result.game === "higher-or-wipe" && requestedMode && result.mode !== requestedMode) throw new Error("The generated mode did not match the requested mode");
      if (result.game === "immaculate-roster") setImmaculateMistakes(0);
      setRound(result);
      if (result.game === "higher-or-wipe") setHigherOrWipeMode(result.mode);
    } catch (generationError) {
      if (requestId !== requestIdRef.current) return;
      setError(generationError instanceof Error ? generationError.message : "generation_failed");
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [game, higherOrWipeMode]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void generate();
  }, [generate]);

  return (
    <FunGameShell
      game={game}
      loading={loading}
      error={error}
      hasRound={Boolean(round)}
      onGenerate={() => void generate()}
      mistakes={round?.game === "immaculate-roster" ? { count: immaculateMistakes, total: MAX_IMMACULATE_MISTAKES } : undefined}
    >
      {round ? (
        <div key={round.roundId} className={styles.gameEnter}>
          <Game
            round={round}
            loading={loading}
            onHigherModeChange={(mode) => void generate(mode)}
            onImmaculateMistakesChange={setImmaculateMistakes}
          />
        </div>
      ) : null}
    </FunGameShell>
  );
}
