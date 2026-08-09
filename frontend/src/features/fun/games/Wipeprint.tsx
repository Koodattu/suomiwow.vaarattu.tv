"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { WipeprintBossOption, WipeprintRound } from "@/types";
import { ExpansionIcon, FunBossIdentity, FunRaidIdentity } from "../FunEncounterIdentity";
import FunAutocomplete from "../FunAutocomplete";
import FunGuildIdentity from "../FunGuildIdentity";
import ProgressiveClues from "../ProgressiveClues";

type Direction = "earlier" | "exact" | "later";
type BossGuess = { boss: WipeprintBossOption; sameRaid: boolean; position: Direction };

export default function Wipeprint({ round }: { round: WipeprintRound }) {
  const t = useTranslations("fun");
  const target = round.solution.boss;
  const [guesses, setGuesses] = useState<BossGuess[]>([]);
  const [status, setStatus] = useState<"playing" | "won" | "lost">("playing");

  const availableBosses = useMemo(() => {
    const guessedKeys = new Set(guesses.map((guess) => guess.boss.key));
    return round.bossOptions.filter((boss) => !guessedKeys.has(boss.key));
  }, [guesses, round.bossOptions]);

  const submitGuess = (boss: WipeprintBossOption) => {
    if (status !== "playing") return;
    if (boss.key === target.key) {
      setStatus("won");
      return;
    }
    const nextGuesses = [
      ...guesses,
      {
        boss,
        sameRaid: boss.raidId === target.raidId,
        position: compareNumber(boss.bossIndex, target.bossIndex),
      },
    ];
    setGuesses(nextGuesses);
    if (nextGuesses.length >= 5) setStatus("lost");
  };
  const clueItems = [
    { label: t("wipeprint.position"), content: t("wipeprint.bossOf", { index: target.bossIndex, count: target.bossCount }) },
    { label: t("wipeprint.raid"), content: <FunRaidIdentity raid={{ id: target.raidId, name: target.raidName, expansion: target.expansion, iconUrl: target.raidIconUrl }} iconSize={28} compact /> },
  ];

  return (
    <section className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_19rem]">
      <div className="min-w-0">
        <div className="rounded-xl border border-white/10 bg-slate-900/70 p-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-xl font-black">{t("wipeprint.identifyBoss")}</h2>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-400"><ExpansionIcon expansion={target.expansion} className="w-7" /><span>{target.expansion}</span><span aria-hidden="true">·</span><span>{round.solution.sourceGuild.name}</span><span aria-hidden="true">·</span><span>{t("wipeprint.pullCount", { count: round.pulls.length })}</span></p>
          </div>
          <p className="text-xs text-slate-400">{t("wipeprint.progressHint")}</p>
        </div>
        <div className="mt-5 h-72 w-full" aria-label={t("wipeprint.chartAria") }>
          <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 640, height: 288 }}>
            <LineChart data={round.pulls} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
              <CartesianGrid stroke="rgba(148,163,184,0.13)" vertical={false} />
              <XAxis dataKey="pullNumber" stroke="#94a3b8" tickLine={false} axisLine={false} />
              <YAxis domain={[0, 100]} stroke="#94a3b8" tickLine={false} axisLine={false} unit="%" width={48} />
              <Tooltip
                contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8 }}
                labelFormatter={(value) => t("wipeprint.pull", { number: value })}
                formatter={(value) => [`${value ?? "–"}%`, t("wipeprint.bossRemaining")]}
              />
              <Line type="monotone" dataKey="progressPercentage" stroke="#60a5fa" strokeWidth={3} dot={{ r: 3, fill: "#93c5fd" }} activeDot={{ r: 5 }} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>
        </div>

      {guesses.length > 0 ? (
        <div className="mt-3 space-y-2">
          {guesses.map((guess) => (
            <div key={guess.boss.key} className="grid gap-2 rounded-lg border border-red-400/20 bg-red-950/20 px-4 py-3 text-sm sm:grid-cols-[1fr_auto_auto] sm:items-center">
              <FunBossIdentity name={guess.boss.bossName} iconUrl={guess.boss.bossIconUrl} iconSize={32} detail={guess.boss.raidName} />
              <span className={guess.sameRaid ? "text-emerald-300" : "text-red-300"}>{guess.sameRaid ? t("wipeprint.sameRaid") : t("wipeprint.differentRaid")}</span>
              <DirectionLabel label={t("wipeprint.position")} value={guess.position} />
            </div>
          ))}
        </div>
        ) : null}
      </div>

      <aside className="h-fit rounded-xl border border-white/10 bg-slate-900/70 p-4">
        <div className="border-b border-white/10 pb-3">
          <p className="mb-2 text-xs text-slate-400">{t("wipeprint.singleGuild")}</p>
          <FunGuildIdentity guild={round.solution.sourceGuild} crestSize={42} />
        </div>
          {status === "playing" ? (
            <>
              <div className="mb-3 mt-4 flex items-center justify-between gap-3 text-sm">
                <label className="font-bold">{t("wipeprint.chooseBoss")}</label>
                <span className="text-slate-400 tabular-nums">{t("common.mistakes", { count: guesses.length, total: 5 })}</span>
              </div>
              <FunAutocomplete
                items={availableBosses}
                getKey={(boss) => boss.key}
                getLabel={(boss) => boss.bossName}
                getSearchText={(boss) => `${boss.bossName} ${boss.raidName} ${boss.expansion}`}
                renderOption={(boss) => <FunBossIdentity name={boss.bossName} iconUrl={boss.bossIconUrl} iconSize={30} detail={boss.raidName} />}
                placeholder={t("wipeprint.searchBoss")}
                emptyLabel={t("wipeprint.noBosses")}
                onSelect={submitGuess}
              />
            </>
          ) : (
            <div className="text-center" role="status">
              <p className={`text-xl font-black ${status === "won" ? "text-emerald-300" : "text-red-300"}`}>{status === "won" ? t("common.youWon") : t("common.gameOver")}</p>
              <p className="mt-2 text-sm text-slate-400">{t("wipeprint.answerWas")}</p>
              <FunBossIdentity name={target.bossName} iconUrl={target.bossIconUrl} iconSize={40} detail={target.raidName} />
            </div>
          )}
        <div className="mt-4 border-t border-white/10 pt-3">
          <h2 className="font-black">{t("wipeprint.clues")}</h2>
          <ProgressiveClues items={clueItems} revealed={guesses.length} />
        </div>
      </aside>
    </section>
  );
}

function compareNumber(guess: number, target: number): Direction {
  if (guess === target) return "exact";
  return guess < target ? "later" : "earlier";
}

function DirectionLabel({ label, value }: { label: string; value: Direction }) {
  const t = useTranslations("fun");
  const arrow = value === "earlier" ? "←" : value === "later" ? "→" : "✓";
  return <span className={value === "exact" ? "text-emerald-300" : "text-slate-300"}>{label}: {t(`directions.${value}`)} {arrow}</span>;
}
