"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import IconImage from "@/components/IconImage";
import { getClassInfoById } from "@/lib/utils";
import type { SuomidleCandidate, SuomidleRound } from "@/types";
import FunAutocomplete from "../FunAutocomplete";
import { ExpansionIcon, FunIcon } from "../FunEncounterIdentity";

type Comparison = "lower" | "exact" | "higher" | "mismatch";

const columns = ["character", "class", "spec", "role", "realm", "guild", "raid", "mythicPlus", "achievements", "firstSeen"] as const;

export default function Suomidle({ round }: { round: SuomidleRound }) {
  const t = useTranslations("fun");
  const target = round.solution.target;
  const [guesses, setGuesses] = useState<SuomidleCandidate[]>([]);
  const [status, setStatus] = useState<"playing" | "won" | "lost">("playing");
  const mistakes = guesses.filter((guess) => guess.key !== target.key).length;
  const available = useMemo(() => {
    const used = new Set(guesses.map((guess) => guess.key));
    return round.candidates.filter((candidate) => !used.has(candidate.key));
  }, [guesses, round.candidates]);

  const submit = (candidate: SuomidleCandidate) => {
    if (status !== "playing") return;
    const next = [...guesses, candidate];
    setGuesses(next);
    if (candidate.key === target.key) {
      setStatus("won");
    } else if (next.length >= 6) {
      setStatus("lost");
    }
  };

  return (
    <section className="mt-5 space-y-4">
      <div className="grid gap-4 rounded-xl bg-slate-900/70 p-4 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.1)] sm:grid-cols-[minmax(0,1fr)_minmax(16rem,24rem)] sm:items-center">
        <div className="min-w-0">
          {status === "playing" ? (
            <>
              <div className="flex items-center gap-3">
                <h2 className="font-black">{t("suomidle.guess")}</h2>
                <span className="text-sm text-slate-400 tabular-nums">{t("common.mistakes", { count: mistakes, total: 6 })}</span>
              </div>
              <p className="mt-1 text-pretty text-xs leading-5 text-slate-400">{t("suomidle.arrows")}</p>
            </>
          ) : (
            <div role="status">
              <p className={`text-xl font-black ${status === "won" ? "text-emerald-300" : "text-red-300"}`}>{status === "won" ? t("common.youWon") : t("common.gameOver")}</p>
              <p className="mt-1 text-sm text-slate-400">{t("suomidle.answerWas")} <span className="font-bold text-white">{target.name}</span> · {target.realm} · {target.guildName}</p>
            </div>
          )}
        </div>
        {status === "playing" ? (
          <FunAutocomplete
            items={available}
            getKey={(candidate) => candidate.key}
            getLabel={(candidate) => candidate.name}
            getSearchText={(candidate) => `${candidate.name} ${candidate.realm} ${candidate.guildName}`}
            renderOption={(candidate) => <><span className="font-semibold">{candidate.name}</span><span className="ml-2 text-slate-400">{candidate.realm}</span></>}
            placeholder={t("suomidle.search")}
            emptyLabel={t("suomidle.none")}
            onSelect={submit}
          />
        ) : null}
      </div>

      <div className="min-w-0 rounded-xl bg-slate-950/35 p-2 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.1)]">
        <div className="hidden grid-cols-[minmax(0,1.2fr)_minmax(0,1.05fr)_minmax(0,.9fr)_minmax(0,.75fr)_minmax(0,.95fr)_minmax(0,1.05fr)_minmax(0,1.25fr)_minmax(0,.8fr)_minmax(0,.8fr)_minmax(0,.8fr)] gap-1 px-2 py-1 text-[11px] font-bold text-slate-400 lg:grid xl:text-xs">
          {columns.map((key) => <span key={key} className="truncate">{t(`suomidle.${key}`)}</span>)}
        </div>
        {guesses.length === 0 ? <div className="grid min-h-40 place-items-center text-sm text-slate-400">{t("suomidle.start")}</div> : null}
        <div className="space-y-2">
          {guesses.map((guess) => {
            const classInfo = getClassInfoById(guess.classID);
            const exactCharacter = guess.key === target.key;
            return (
              <div key={guess.key} className="grid grid-cols-2 gap-1 rounded-lg bg-slate-900/80 p-2 text-sm sm:grid-cols-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1.05fr)_minmax(0,.9fr)_minmax(0,.75fr)_minmax(0,.95fr)_minmax(0,1.05fr)_minmax(0,1.25fr)_minmax(0,.8fr)_minmax(0,.8fr)_minmax(0,.8fr)] lg:text-[11px] xl:text-xs">
                <SuomidleCell label={t("suomidle.character")}><Compare comparison={exactCharacter ? "exact" : "mismatch"}>{guess.name}</Compare></SuomidleCell>
                <SuomidleCell label={t("suomidle.class")}><Compare comparison={guess.classID === target.classID ? "exact" : "mismatch"}><span className="inline-flex min-w-0 items-center gap-1.5"><span className="relative size-6 shrink-0 overflow-hidden rounded outline outline-1 -outline-offset-1 outline-white/10"><IconImage iconFilename={classInfo.iconUrl} alt="" fill style={{ objectFit: "cover" }} /></span><span className="truncate">{classInfo.name}</span></span></Compare></SuomidleCell>
                <SuomidleCell label={t("suomidle.spec")}><Compare comparison={guess.specName === target.specName ? "exact" : "mismatch"}>{guess.specName}</Compare></SuomidleCell>
                <SuomidleCell label={t("suomidle.role")}><Compare comparison={guess.role === target.role ? "exact" : "mismatch"}>{t(`roles.${guess.role}`)}</Compare></SuomidleCell>
                <SuomidleCell label={t("suomidle.realm")}><Compare comparison={guess.realm === target.realm ? "exact" : "mismatch"}>{guess.realm}</Compare></SuomidleCell>
                <SuomidleCell label={t("suomidle.guild")}><Compare comparison={guess.guildName === target.guildName ? "exact" : "mismatch"}>{guess.guildName}</Compare></SuomidleCell>
                <SuomidleCell label={t("suomidle.raid")}>
                  <Compare comparison={guess.raidId === target.raidId ? "exact" : "mismatch"}>
                    <span className="inline-flex min-w-0 items-center gap-1.5" title={`${guess.raidName} · ${guess.raidExpansion}`}>
                      <FunIcon iconUrl={guess.raidIconUrl} label={guess.raidName} size={24} />
                      <ExpansionIcon expansion={guess.raidExpansion} className="w-5" />
                      <span className="truncate">{guess.raidName}</span>
                    </span>
                  </Compare>
                </SuomidleCell>
                <SuomidleCell label={t("suomidle.mythicPlus")}><Compare comparison={compareNumber(guess.mythicPlusScore, target.mythicPlusScore)}>{guess.mythicPlusScore}</Compare></SuomidleCell>
                <SuomidleCell label={t("suomidle.achievements")}><Compare comparison={compareNumber(guess.achievementCount, target.achievementCount)}>{guess.achievementCount}</Compare></SuomidleCell>
                <SuomidleCell label={t("suomidle.firstSeen")}><Compare comparison={compareNumber(new Date(guess.firstSeenAt).getTime(), new Date(target.firstSeenAt).getTime())}>{new Date(guess.firstSeenAt).getFullYear()}</Compare></SuomidleCell>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function SuomidleCell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="min-w-0 rounded-md bg-slate-950/25 px-2 py-2 lg:bg-transparent lg:px-0.5 lg:py-1">
      <span className="mb-1 block truncate text-[10px] font-bold uppercase tracking-wide text-slate-500 lg:hidden">{label}</span>
      {children}
    </span>
  );
}

function compareNumber(guess: number, target: number): Comparison {
  if (guess === target) return "exact";
  return guess < target ? "higher" : "lower";
}

function Compare({ comparison, children }: { comparison: Comparison; children: ReactNode }) {
  const t = useTranslations("fun");
  const marker = comparison === "higher" ? "↑" : comparison === "lower" ? "↓" : comparison === "mismatch" ? "×" : "✓";
  const color = comparison === "exact" ? "text-emerald-300" : comparison === "mismatch" ? "text-red-300" : "text-slate-300";
  return <span className={`flex min-w-0 items-center gap-1 ${color}`}><span className="min-w-0 truncate">{children}</span><span className="sr-only">{t(`comparisons.${comparison}`)}</span><span aria-hidden="true" className="ml-auto shrink-0">{marker}</span></span>;
}
