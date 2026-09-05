"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { WipeprintBossOption, WipeprintRound } from "@/types";
import { ExpansionIcon, FunIcon, FunRaidIdentity } from "../FunEncounterIdentity";
import FunAutocomplete from "../FunAutocomplete";
import { FunGuildCrest } from "../FunGuildIdentity";
import ProgressiveClues from "../ProgressiveClues";
import FunOutcome from "../FunOutcome";
import styles from "../fun-feedback.module.css";

type Direction = "earlier" | "exact" | "later";
type BossGuess = { boss: WipeprintBossOption; sameRaid: boolean; position: Direction };

export default function Wipeprint({ round }: { round: WipeprintRound }) {
  const t = useTranslations("fun");
  const target = round.solution.boss;
  const [guesses, setGuesses] = useState<BossGuess[]>([]);
  const [status, setStatus] = useState<"playing" | "won">("playing");

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
  };
  const clueItems = [
    { label: t("wipeprint.expansion"), content: <span className="flex items-center gap-2"><ExpansionIcon expansion={target.expansion} />{target.expansion}</span> },
    { label: t("wipeprint.raid"), content: <FunRaidIdentity raid={{ id: target.raidId, name: target.raidName, expansion: target.expansion, iconUrl: target.raidIconUrl }} iconSize={28} compact /> },
    { label: t("wipeprint.position"), content: t("wipeprint.bossOf", { index: target.bossIndex, count: target.bossCount }) },
  ];

  return (
    <section className="mt-5">
      <div className="grid gap-3 border-y border-white/10 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(17rem,24rem)] sm:items-center">
        {status === "playing" ? (
          <div className="flex items-center justify-between gap-3 text-sm">
            <label className="font-bold">{t("wipeprint.chooseBoss")}</label>
            <span className="text-slate-400 tabular-nums">{t("common.mistakes", { count: guesses.length })}</span>
          </div>
        ) : (
          <FunOutcome status={status} className="sm:col-span-2">
            <span className="block text-slate-400">{t("common.mistakes", { count: guesses.length })}</span>
            <span className="mt-1 block text-slate-400">{t("wipeprint.answerWas")}</span>
            <span className="mt-2 block"><WipeprintBossIdentity boss={target} compact /></span>
          </FunOutcome>
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
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-400"><span className="inline-flex items-center gap-1.5"><FunGuildCrest crest={round.solution.sourceGuild.crest} faction={round.solution.sourceGuild.faction} size={24} /><span>{round.solution.sourceGuild.name}</span></span><span aria-hidden="true">·</span><span>{t("wipeprint.pullCount", { count: round.pulls.length })}</span></div>
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
            <div key={guess.boss.key} className={`${styles.bad} grid gap-2 rounded-lg border border-red-400/20 bg-red-950/20 px-4 py-3 text-sm sm:grid-cols-[1fr_auto_auto] sm:items-center`}>
              <WipeprintBossIdentity boss={guess.boss} />
              {guesses.length >= 2 ? <span className={guess.sameRaid ? "text-emerald-300" : "text-red-300"}>{guess.sameRaid ? t("wipeprint.sameRaid") : t("wipeprint.differentRaid")}</span> : null}
              {guesses.length >= 3 ? <DirectionLabel label={t("wipeprint.position")} value={guess.position} /> : null}
            </div>
          ))}
        </div>
        ) : null}
      </div>

      <aside className="h-fit border-t border-white/10 pt-4 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
        <p className="mb-3 text-xs text-slate-400">{t("wipeprint.singleGuild")}</p>
        <div>
          <h2 className="font-black">{t("wipeprint.clues")}</h2>
          {guesses.length === 0 ? <p className="mt-1 text-xs leading-5 text-slate-400">{t("wipeprint.cluesPending")}</p> : null}
          <ProgressiveClues items={clueItems} revealed={guesses.length} />
        </div>
      </aside>
      </div>
    </section>
  );
}

function WipeprintBossIdentity({ boss, compact = false }: { boss: WipeprintBossOption; compact?: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <FunIcon iconUrl={boss.bossIconUrl} label={boss.bossName} size={compact ? 36 : 40} />
      <span className="min-w-0">
        <span className="block font-bold leading-snug">{boss.bossName}</span>
        <span className="mt-1 flex items-center gap-1.5 text-xs text-slate-400">
          <ExpansionIcon expansion={boss.expansion} className="w-6" />
          <span>{boss.expansion} · {boss.raidName}</span>
        </span>
      </span>
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
