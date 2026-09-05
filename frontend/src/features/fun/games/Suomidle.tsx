"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { formatRealmName, getClassInfoById } from "@/lib/utils";
import type { SuomidleCandidate, SuomidleRound } from "@/types";
import FunAutocomplete from "../FunAutocomplete";
import FunCharacterIdentity, { FunClassIcon } from "../FunCharacterIdentity";
import { FunIcon } from "../FunEncounterIdentity";
import FunGuildIdentity, { FunGuildCrest } from "../FunGuildIdentity";
import { useDebouncedFunGameSearch } from "../useFunGameSearch";
import FunOutcome from "../FunOutcome";
import styles from "../fun-feedback.module.css";

type Comparison = "lower" | "exact" | "higher" | "mismatch";

export default function Suomidle({ round }: { round: SuomidleRound }) {
  const t = useTranslations("fun");
  const target = round.solution.target;
  const [query, setQuery] = useState("");
  const [guesses, setGuesses] = useState<SuomidleCandidate[]>([]);
  const [status, setStatus] = useState<"playing" | "won">("playing");
  const mistakes = guesses.filter((guess) => guess.key !== target.key).length;
  const search = useDebouncedFunGameSearch("suomidle", query);
  const used = new Set(guesses.map((guess) => guess.key));
  const available = search.candidates.filter((candidate) => !used.has(candidate.key));
  const emptyLabel = search.trimmedQuery.length < 2
    ? t("common.typeTwoCharacters")
    : search.isSearching
      ? t("common.searching")
      : search.isError
        ? t("common.searchFailed")
        : t("suomidle.none");

  const submit = (candidate: SuomidleCandidate) => {
    if (status !== "playing") return;
    const next = [...guesses, candidate];
    setGuesses(next);
    if (candidate.key === target.key) {
      setStatus("won");
    }
  };

  return (
    <section className="mx-auto mt-5 max-w-5xl space-y-5">
      <div className="grid gap-4 rounded-xl border border-white/10 bg-slate-900/60 p-4 sm:grid-cols-[minmax(0,1fr)_minmax(16rem,24rem)] sm:items-center sm:p-5">
        <div className={`min-w-0 ${status === "playing" ? "" : "sm:col-span-2"}`}>
          {status === "playing" ? (
            <>
              <div className="flex items-center gap-3">
                <h2 className="font-black">{t("suomidle.guess")}</h2>
                <span className="text-sm text-slate-400 tabular-nums">{t("common.mistakes", { count: mistakes })}</span>
              </div>
              <p className="mt-0.5 text-pretty text-xs leading-5 text-slate-400">{t("suomidle.arrows")}</p>
            </>
          ) : (
            <FunOutcome status={status}>
              <span className="block text-slate-400">{t("common.mistakes", { count: mistakes })}</span>
              <span className="mt-2 flex flex-wrap items-center gap-3"><FunCharacterIdentity character={target} iconSize={30} /><FunGuildIdentity guild={target.guild} crestSize={30} /></span>
            </FunOutcome>
          )}
        </div>
        {status === "playing" ? (
          <FunAutocomplete
            items={available}
            getKey={(candidate) => candidate.key}
            getLabel={(candidate) => candidate.name}
            getSearchText={(candidate) => `${candidate.name} ${candidate.realm} ${candidate.guildName}`}
            renderOption={(candidate) => <FunCharacterIdentity character={candidate} iconSize={30} />}
            placeholder={t("suomidle.search")}
            emptyLabel={emptyLabel}
            loading={search.isSearching}
            filterItems={false}
            onSelect={submit}
            onQueryChange={setQuery}
          />
        ) : null}
      </div>

      <div className="min-w-0">
        {guesses.length === 0 ? <div className="grid min-h-40 place-items-center rounded-xl border border-dashed border-white/15 px-6 text-center text-sm text-slate-400">{t("suomidle.start")}</div> : null}
        <div className="space-y-4">
          {guesses.toReversed().map((guess, index) => {
            const classInfo = getClassInfoById(guess.classID);
            const exactCharacter = guess.key === target.key;
            return (
              <article key={guess.key} className={`${exactCharacter ? styles.good : styles.reveal} overflow-hidden rounded-xl border border-white/10 bg-slate-900/60`}>
                <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
                  <FunCharacterIdentity character={guess} iconSize={36} />
                  <span className="text-xs font-semibold text-slate-400 tabular-nums">{t("closest.attempt", { number: guesses.length - index })}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 p-3 text-sm sm:grid-cols-3">
                  <SuomidleCell label={t("suomidle.class")}><Compare comparison={guess.classID === target.classID ? "exact" : "mismatch"}><span className="inline-flex min-w-0 items-center gap-1.5"><FunClassIcon classID={guess.classID} size={24} /><span className="truncate">{classInfo.name}</span></span></Compare></SuomidleCell>
                  <SuomidleCell label={t("suomidle.spec")}><Compare comparison={guess.specName === target.specName ? "exact" : "mismatch"}>{guess.specName}</Compare></SuomidleCell>
                  <SuomidleCell label={t("suomidle.role")}><Compare comparison={guess.role === target.role ? "exact" : "mismatch"}>{t(`roles.${guess.role}`)}</Compare></SuomidleCell>
                  <SuomidleCell label={t("suomidle.realm")}><Compare comparison={guess.realm === target.realm ? "exact" : "mismatch"}>{formatRealmName(guess.realm)}</Compare></SuomidleCell>
                  <SuomidleCell label={t("suomidle.guild")}><Compare comparison={guess.guild.id === target.guild.id ? "exact" : "mismatch"}><span className="inline-flex min-w-0 items-center gap-1.5"><FunGuildCrest crest={guess.guild.crest} faction={guess.guild.faction} size={24} /><span className="break-words">{guess.guild.name}</span></span></Compare></SuomidleCell>
                  <SuomidleCell label={t("suomidle.raid")}>
                    <Compare comparison={guess.raidId === target.raidId ? "exact" : "mismatch"}>
                      <span className="flex items-center gap-2"><FunIcon iconUrl={guess.raidIconUrl} label={guess.raidName} size={24} /><span>{guess.raidName}</span></span>
                    </Compare>
                  </SuomidleCell>
                  <SuomidleCell label={t("suomidle.mythicPlus")}><Compare comparison={compareNumber(guess.mythicPlusScore, target.mythicPlusScore)}>{guess.mythicPlusScore}</Compare></SuomidleCell>
                  <SuomidleCell label={t("suomidle.achievements")}><Compare comparison={compareNumber(guess.achievementCount, target.achievementCount)}>{guess.achievementCount}</Compare></SuomidleCell>
                  <SuomidleCell label={t("suomidle.firstSeen")}><Compare comparison={compareNumber(new Date(guess.firstSeenAt).getFullYear(), new Date(target.firstSeenAt).getFullYear())}>{new Date(guess.firstSeenAt).getFullYear()}</Compare></SuomidleCell>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function SuomidleCell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className="mb-1 block px-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</span>
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
  const color = comparison === "exact" ? "border-emerald-400/25 bg-emerald-950/40 text-emerald-200" : comparison === "mismatch" ? "border-red-400/15 bg-red-950/20 text-red-200" : "border-blue-400/20 bg-blue-950/30 text-blue-100";
  return <span className={`${comparison === "exact" ? styles.good : ""} flex min-h-12 min-w-0 flex-1 items-center gap-2 rounded-lg border px-2.5 py-2 ${color}`}><span className="min-w-0 break-words">{children}</span><span className="sr-only">{t(`comparisons.${comparison}`)}</span><span aria-hidden="true" className="ml-auto shrink-0">{marker}</span></span>;
}
