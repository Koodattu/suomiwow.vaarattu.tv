"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { FunCharacter, RaidConnectionsRound } from "@/types";
import FunCharacterIdentity from "../FunCharacterIdentity";
import { FunRaidIdentity } from "../FunEncounterIdentity";
import FunGuildIdentity from "../FunGuildIdentity";
import FunOutcome from "../FunOutcome";
import styles from "../fun-feedback.module.css";

const GROUP_STYLES = [
  "border-amber-300/30 bg-amber-950/35 text-amber-100",
  "border-emerald-300/30 bg-emerald-950/35 text-emerald-100",
  "border-blue-300/30 bg-blue-950/35 text-blue-100",
  "border-violet-300/30 bg-violet-950/35 text-violet-100",
];

export default function RaidConnections({ round }: { round: RaidConnectionsRound }) {
  const t = useTranslations("fun");
  const [selected, setSelected] = useState<string[]>([]);
  const [solvedIds, setSolvedIds] = useState<string[]>([]);
  const [mistakes, setMistakes] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<"good" | "bad" | null>(null);
  const [status, setStatus] = useState<"playing" | "won" | "lost">("playing");
  const boardRef = useRef<HTMLDivElement>(null);

  const tilesByKey = useMemo(() => new Map(round.tiles.map((tile) => [tile.key, tile])), [round.tiles]);
  const solvedKeys = useMemo(() => new Set(round.solution.groups.filter((group) => solvedIds.includes(group.id)).flatMap((group) => group.memberKeys)), [round.solution.groups, solvedIds]);
  const remainingTiles = round.tiles.filter((tile) => !solvedKeys.has(tile.key));

  useEffect(() => {
    if (status !== "playing") return;
    boardRef.current?.querySelector<HTMLButtonElement>("[data-connection-tile]")?.focus();
  }, [mistakes, solvedIds.length, status]);

  const toggle = (key: string) => {
    if (status !== "playing") return;
    setNotice(null);
    setFeedback(null);
    setSelected((current) => current.includes(key) ? current.filter((item) => item !== key) : current.length < 4 ? [...current, key] : current);
  };

  const submit = () => {
    if (selected.length !== 4 || status !== "playing") return;
    const selectedSet = new Set(selected);
    const unsolved = round.solution.groups.filter((group) => !solvedIds.includes(group.id));
    const match = unsolved.find((group) => group.memberKeys.every((key) => selectedSet.has(key)));
    if (match) {
      const nextSolved = [...solvedIds, match.id];
      setSolvedIds(nextSolved);
      setSelected([]);
      setNotice(t("connections.correctGroup"));
      setFeedback("good");
      if (nextSolved.length === round.solution.groups.length) setStatus("won");
      return;
    }

    const closest = Math.max(...unsolved.map((group) => group.memberKeys.filter((key) => selectedSet.has(key)).length));
    const nextMistakes = mistakes + 1;
    setMistakes(nextMistakes);
    setSelected([]);
    setNotice(closest === 3 ? t("connections.oneAway") : t("connections.incorrectGroup"));
    setFeedback("bad");
    if (nextMistakes >= 4) setStatus("lost");
  };

  return (
    <section className="mt-5 min-w-0">
      <div>
        <div className="flex flex-col gap-2 border-b border-white/10 pb-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <FunRaidIdentity raid={round.raid} iconSize={42} />
            <p className="mt-2 max-w-2xl text-pretty text-sm text-slate-400">{t("connections.instructions")}</p>
          </div>
          <span className="shrink-0 text-sm font-bold text-red-200 tabular-nums">{t("common.mistakes", { count: mistakes, total: 4 })}</span>
        </div>

        <div className="sticky bottom-3 z-20 -mx-1 mt-3 flex items-center justify-between gap-3 border-y border-white/10 bg-[#0b1020]/95 px-1 py-3 backdrop-blur-sm lg:static lg:mx-0 lg:bg-transparent lg:backdrop-blur-none">
          {status === "playing" ? (
            <>
              <p key={`${mistakes}:${solvedIds.length}:${notice ?? "selection"}`} className={`min-w-0 text-sm ${feedback === "good" ? `${styles.good} text-emerald-200` : feedback === "bad" ? `${styles.bad} text-red-200` : "text-slate-400"}`} role="status">{notice ?? t("connections.selected", { count: selected.length })}</p>
              <button type="button" onClick={submit} disabled={selected.length !== 4} className="min-h-11 shrink-0 rounded-md bg-blue-600 px-5 py-2 text-sm font-bold transition-[background-color,transform] hover:bg-blue-500 active:not-disabled:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300 motion-reduce:transform-none motion-reduce:transition-none">{t("connections.submitGroup")}</button>
            </>
          ) : (
            <FunOutcome status={status} className="w-full">{status === "won" ? t("connections.wonSummary", { mistakes }) : t("connections.lostSummary")}</FunOutcome>
          )}
        </div>

      <div className="mt-3 space-y-2">
        {round.solution.groups.map((group, index) => {
          const visible = solvedIds.includes(group.id) || status === "lost";
          if (!visible) return null;
          const members = group.memberKeys.map((key) => tilesByKey.get(key)).filter((tile): tile is FunCharacter => Boolean(tile));
          return (
            <div key={group.id} className={`${solvedIds.includes(group.id) ? styles.good : styles.reveal} grid gap-3 rounded-lg border p-3 sm:grid-cols-[13rem_minmax(0,1fr)] sm:items-center ${GROUP_STYLES[index % GROUP_STYLES.length]}`}>
              <FunGuildIdentity guild={group.guild} crestSize={40} />
              <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                {members.map((member) => <FunCharacterIdentity key={member.key} character={member} iconSize={24} showRealm={false} />)}
              </div>
            </div>
          );
        })}
      </div>

      {status !== "lost" ? (
        <div ref={boardRef} className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label={t("connections.instructions")}>
          {remainingTiles.map((tile) => {
            const active = selected.includes(tile.key);
            return (
              <button
                key={tile.key}
                type="button"
                data-connection-tile
                onClick={() => toggle(tile.key)}
                disabled={status !== "playing"}
                aria-pressed={active}
                className={`relative flex min-h-[4.5rem] items-center gap-3 rounded-lg border p-3 pr-8 text-left transition-[border-color,background-color,box-shadow,transform] duration-150 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300 motion-reduce:transform-none motion-reduce:transition-none ${active ? "scale-[0.98] border-blue-300 bg-blue-950/60 shadow-[0_0_0_1px_rgba(147,197,253,0.22)]" : "border-white/10 bg-slate-900/65 hover:-translate-y-0.5 hover:border-blue-300/30"}`}
              >
                <FunCharacterIdentity character={tile} iconSize={40} />
                {active ? <span className={`${styles.good} absolute right-2 top-2 grid size-5 place-items-center rounded-full bg-blue-300 text-xs font-black text-blue-950`} aria-hidden="true">✓</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}
      </div>
    </section>
  );
}
