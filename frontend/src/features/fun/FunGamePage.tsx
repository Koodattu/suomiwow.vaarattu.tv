"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { FunGameRound, FunGameSlug } from "@/types";
import FunGameShell from "./FunGameShell";
import GuildGuessr from "./games/GuildGuessr";
import ImmaculateRoster from "./games/ImmaculateRoster";
import LockItIn from "./games/LockItIn";
import RaidConnections from "./games/RaidConnections";
import RaiderResume from "./games/RaiderResume";
import Wipeprint from "./games/Wipeprint";
import Suomidle from "./games/Suomidle";
import HigherOrWipe from "./games/HigherOrWipe";
import ClosestWithoutGoingOver from "./games/ClosestWithoutGoingOver";

function Game({ round }: { round: FunGameRound }) {
  switch (round.game) {
    case "immaculate-roster":
      return <ImmaculateRoster key={round.roundId} round={round} />;
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
      return <HigherOrWipe key={round.roundId} round={round} />;
    case "closest-without-going-over":
      return <ClosestWithoutGoingOver key={round.roundId} round={round} />;
  }
}

export default function FunGamePage({ game }: { game: FunGameSlug }) {
  const [round, setRound] = useState<FunGameRound | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const startedRef = useRef(false);

  const generate = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const result = await api.generateFunRound(game);
      if (requestId !== requestIdRef.current) return;
      if (result.game !== game) throw new Error("The generated game did not match the requested game");
      setRound(result);
    } catch (generationError) {
      if (requestId !== requestIdRef.current) return;
      setError(generationError instanceof Error ? generationError.message : "generation_failed");
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [game]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void generate();
  }, [generate]);

  return (
    <FunGameShell game={game} loading={loading} error={error} hasRound={Boolean(round)} onGenerate={() => void generate()}>
      {round ? <Game round={round} /> : null}
    </FunGameShell>
  );
}
