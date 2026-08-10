"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { WipeprintBossOption, WipeprintRound } from "@/types";
import { ExpansionIcon, FunBossIdentity, FunRaidIdentity } from "../FunEncounterIdentity";
import FunAutocomplete from "../FunAutocomplete";
import { FunGuildCrest } from "../FunGuildIdentity";
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
    <section className="mt-5">
      <div className="grid gap-3 border-y border-white/10 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(17rem,24rem)] sm:items-center">
        {status === "playing" ? (
          <div className="flex items-center justify-between gap-3 text-sm">
            <label className="font-bold">{t("wipeprint.chooseBoss")}</label>
            <span className="text-slate-400 tabular-nums">{t("common.mistakes", { count: guesses.length, total: 5 })}</span>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3" role="status">
            <p className={`text-lg font-black ${status === "won" ? "text-emerald-300" : "text-red-300"}`}>{status === "won" ? t("common.youWon") : t("common.gameOver")}</p>
            <WipeprintBossIdentity boss={target} compact />
          </div>
        )}
        {status === "playing" ? (
          <FunAutocomplete
            items={availableBosses}
            getKey={(boss) => boss.key}
            getLabel={(boss) => boss.bossName}
            getSearchText={(boss) => `${boss.bossName} ${boss.raidName} ${boss.expansion}`}
            renderOption={(boss) => <WipeprintBossIdentity boss={boss} compact />}
            placeholder={t("wipeprint.searchBoss")}
            emptyLabel={t("wipeprint.noBosses")}
            onSelect={submitGuess}
          />
        ) : null}
      </div>

      <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_19rem]">
      <div className="min-w-0">
        <div className="border-y border-white/10 py-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-xl font-black">{t("wipeprint.identifyBoss")}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-400"><ExpansionIcon expansion={target.expansion} className="w-7" /><span>{target.expansion}</span><span aria-hidden="true">·</span><span className="inline-flex items-center gap-1.5"><FunGuildCrest crest={round.solution.sourceGuild.crest} faction={round.solution.sourceGuild.faction} size={24} /><span>{round.solution.sourceGuild.name}</span></span><span aria-hidden="true">·</span><span>{t("wipeprint.pullCount", { count: round.pulls.length })}</span></div>
          </div>
          <p className="text-xs text-slate-400">{t("wipeprint.progressHint")}</p>
        </div>
        <div className="mt-3 h-64 w-full sm:h-72" aria-label={t("wipeprint.chartAria") }>
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
              <WipeprintBossIdentity boss={guess.boss} />
              <span className={guess.sameRaid ? "text-emerald-300" : "text-red-300"}>{guess.sameRaid ? t("wipeprint.sameRaid") : t("wipeprint.differentRaid")}</span>
              <DirectionLabel label={t("wipeprint.position")} value={guess.position} />
            </div>
          ))}
        </div>
        ) : null}
      </div>

      <aside className="h-fit border-t border-white/10 pt-4 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
        <p className="mb-3 text-xs text-slate-400">{t("wipeprint.singleGuild")}</p>
        <div>
          <h2 className="font-black">{t("wipeprint.clues")}</h2>
          <ProgressiveClues items={clueItems} revealed={guesses.length} />
        </div>
      </aside>
      </div>
    </section>
  );
}

function WipeprintBossIdentity({ boss, compact = false }: { boss: WipeprintBossOption; compact?: boolean }) {
  return (
    <span className="grid min-w-0 gap-2">
      <FunBossIdentity name={boss.bossName} iconUrl={boss.bossIconUrl} iconSize={compact ? 30 : 34} />
      <FunRaidIdentity
        raid={{ id: boss.raidId, name: boss.raidName, expansion: boss.expansion, iconUrl: boss.raidIconUrl }}
        iconSize={compact ? 24 : 28}
        compact
      />
    </span>
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
