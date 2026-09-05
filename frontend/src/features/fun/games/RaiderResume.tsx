"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import CharacterAvatar from "@/components/CharacterAvatar";
import { formatRealmName, getClassInfoById } from "@/lib/utils";
import type { RaiderResumeCandidate, RaiderResumeRound } from "@/types";
import FunAutocomplete from "../FunAutocomplete";
import FunCharacterIdentity, { FunClassIcon } from "../FunCharacterIdentity";
import { FunRaidIdentity } from "../FunEncounterIdentity";
import FunGuildIdentity from "../FunGuildIdentity";
import ProgressiveClues from "../ProgressiveClues";
import { useDebouncedFunGameSearch } from "../useFunGameSearch";
import FunOutcome from "../FunOutcome";
import styles from "../fun-feedback.module.css";

type Comparison = "lower" | "exact" | "higher" | "mismatch";
type ResumeGuess = { character: RaiderResumeCandidate };

export default function RaiderResume({ round }: { round: RaiderResumeRound }) {
  const t = useTranslations("fun");
  const target = round.solution.target;
  const [query, setQuery] = useState("");
  const [guesses, setGuesses] = useState<ResumeGuess[]>([]);
  const [status, setStatus] = useState<"playing" | "won">("playing");
  const targetClass = getClassInfoById(target.classID);

  const search = useDebouncedFunGameSearch("raider-resume", query);
  const guessedKeys = new Set(guesses.map((guess) => guess.character.key));
  const availableCandidates = search.candidates.filter((candidate) => !guessedKeys.has(candidate.key));
  const emptyLabel = search.trimmedQuery.length < 2
    ? t("common.typeTwoCharacters")
    : search.isSearching
      ? t("common.searching")
      : search.isError
        ? t("common.searchFailed")
        : t("resume.noRaiders");

  const submitGuess = (character: RaiderResumeCandidate) => {
    if (status !== "playing") return;
    if (character.key === target.key) {
      setStatus("won");
      return;
    }
    const nextGuesses = [...guesses, { character }];
    setGuesses(nextGuesses);
  };
  const clueItems = [
    { label: t("resume.class"), content: <span className="inline-flex items-center gap-2"><FunClassIcon classID={target.classID} size={24} />{targetClass.name}</span> },
    { label: t("resume.activeYears"), content: `${new Date(target.firstSeenAt).getFullYear()}–${new Date(target.lastSeenAt).getFullYear()}` },
    { label: t("resume.portrait"), content: <span className="inline-flex items-center gap-2"><CharacterAvatar avatarUrl={target.avatarUrl} classIcon={targetClass.iconUrl} characterName={target.name} className="size-10" />{t("resume.portraitClue")}</span> },
  ];

  return (
    <section className="mt-5">
      <div className="grid gap-3 border-y border-white/10 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(17rem,24rem)] sm:items-center">
        {status === "playing" ? (
          <div className="flex items-center justify-between gap-3 text-sm">
            <label className="font-bold">{t("resume.chooseRaider")}</label>
            <span className="text-slate-400 tabular-nums">{t("common.mistakes", { count: guesses.length })}</span>
          </div>
        ) : (
          <FunOutcome status={status} className="sm:col-span-2">
            <span className="block text-slate-400">{t("common.mistakes", { count: guesses.length })}</span>
            <span className="mt-1 block text-slate-400">{t("resume.answerWas")}</span>
            <span className="mt-2 flex items-center gap-3"><CharacterAvatar avatarUrl={target.avatarUrl} classIcon={targetClass.iconUrl} characterName={target.name} className="size-10" /><FunCharacterIdentity character={target} iconSize={28} /></span>
          </FunOutcome>
        )}
        {status === "playing" ? (
          <FunAutocomplete
            items={availableCandidates}
            getKey={(character) => character.key}
            getLabel={(character) => character.name}
            getSearchText={(character) => `${character.name} ${character.realm}`}
            renderOption={(character) => <FunCharacterIdentity character={character} iconSize={30} />}
            placeholder={t("resume.searchRaider")}
            emptyLabel={emptyLabel}
            loading={search.isSearching}
            filterItems={false}
            autoFocus
            onSelect={submitGuess}
            onQueryChange={setQuery}
          />
        ) : null}
      </div>

      <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="min-w-0 border-y border-white/10 py-4">
        <h2 className="text-xl font-black">{t("resume.identifyRaider")}</h2>
        <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-2">
          {round.timeline.map((raid, index) => (
            <div key={raid.id} className="relative min-w-0 border-l-2 border-blue-400/30 bg-slate-950/35 p-3">
              <span className="text-xs font-bold text-blue-300">{index + 1}</span>
              <FunRaidIdentity raid={raid} iconSize={34} compact />
            </div>
          ))}
        </div>
        <div className="mt-3 border-t border-white/10 pt-3">
          <h3 className="text-sm font-bold">{t("resume.guildHistory")}</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {target.guilds.map((guild) => (
              <div key={`${guild.name}:${guild.realm}`} className="flex items-center gap-2 border-l-2 border-white/10 px-2 py-1.5">
                <FunGuildIdentity guild={guild} crestSize={34} />
                <span className="shrink-0 text-xs text-slate-400">{new Date(guild.firstSeenAt).getFullYear()}–{new Date(guild.lastSeenAt).getFullYear()}</span>
              </div>
            ))}
          </div>
        </div>
        </div>

        <aside className="h-fit border-t border-white/10 pt-4 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
          <div><h2 className="font-black">{t("resume.clues")}</h2>{guesses.length === 0 ? <p className="mt-1 text-xs leading-5 text-slate-400">{t("resume.cluesPending")}</p> : null}<ProgressiveClues items={clueItems} revealed={guesses.length} /></div>
        </aside>
      </div>

      {guesses.length > 0 ? (
        <div className="mt-3 border-y border-white/10 py-2">
          <div className="space-y-2">
            <div className="hidden grid-cols-[12rem_repeat(7,1fr)] gap-2 px-3 py-1 text-xs font-bold uppercase tracking-wider text-slate-400 lg:grid">
              <span>{t("resume.raider")}</span><span>{t("resume.class")}</span><span>{t("resume.realm")}</span><span>{t("resume.firstSeen")}</span><span>{t("resume.raids")}</span><span>{t("resume.guilds")}</span><span>{t("resume.reports")}</span><span>{t("resume.lastSeen")}</span>
            </div>
            {guesses.map(({ character }) => {
              const classInfo = getClassInfoById(character.classID);
              return (
                <div key={character.key} className={`${styles.bad} grid grid-cols-2 gap-1 rounded-lg bg-slate-900/70 p-2 text-sm sm:grid-cols-4 lg:grid-cols-[12rem_repeat(7,1fr)] lg:gap-2 lg:px-3 lg:py-3`}>
                  <ResumeGuessCell label={t("resume.raider")}><span className="font-bold">{character.name}</span></ResumeGuessCell>
                  <ResumeGuessCell label={t("resume.class")}><CompareCell comparison={character.classID === target.classID ? "exact" : "mismatch"}><span className="inline-flex items-center gap-2"><FunClassIcon classID={character.classID} size={24} />{classInfo.name}</span></CompareCell></ResumeGuessCell>
                  <ResumeGuessCell label={t("resume.realm")}><CompareCell comparison={character.realm === target.realm ? "exact" : "mismatch"}>{formatRealmName(character.realm)}</CompareCell></ResumeGuessCell>
                  <ResumeGuessCell label={t("resume.firstSeen")}><CompareCell comparison={compareDate(character.firstSeenAt, target.firstSeenAt)}>{new Date(character.firstSeenAt).getFullYear()}</CompareCell></ResumeGuessCell>
                  <ResumeGuessCell label={t("resume.raids")}><CompareCell comparison={compareValue(character.raidCount, target.raidCount)}>{character.raidCount}</CompareCell></ResumeGuessCell>
                  <ResumeGuessCell label={t("resume.guilds")}><CompareCell comparison={compareValue(character.guildCount, target.guildCount)}>{character.guildCount}</CompareCell></ResumeGuessCell>
                  <ResumeGuessCell label={t("resume.reports")}><CompareCell comparison={compareValue(character.reportCount, target.reportCount)}>{character.reportCount}</CompareCell></ResumeGuessCell>
                  <ResumeGuessCell label={t("resume.lastSeen")}><CompareCell comparison={compareDate(character.lastSeenAt, target.lastSeenAt)}>{new Date(character.lastSeenAt).getFullYear()}</CompareCell></ResumeGuessCell>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

    </section>
  );
}

function ResumeGuessCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="min-w-0 rounded-md bg-slate-950/25 px-2 py-2 lg:bg-transparent lg:px-0 lg:py-0">
      <span className="mb-1 block truncate text-[10px] font-bold uppercase tracking-wide text-slate-500 lg:hidden">{label}</span>
      {children}
    </span>
  );
}

function compareValue(guess: number, target: number): Comparison {
  if (guess === target) return "exact";
  return guess < target ? "higher" : "lower";
}

function compareDate(guess: string, target: string): Comparison {
  return compareValue(new Date(guess).getTime(), new Date(target).getTime());
}

function CompareCell({ comparison, children }: { comparison: Comparison; children: React.ReactNode }) {
  const t = useTranslations("fun");
  const arrow = comparison === "higher" ? "↑" : comparison === "lower" ? "↓" : comparison === "mismatch" ? "×" : "✓";
  const color = comparison === "exact" ? "text-emerald-300" : comparison === "mismatch" ? "text-red-300" : "text-slate-300";
  return <span className={`flex items-center gap-1 ${color}`}>{children}<span className="sr-only">{t(`comparisons.${comparison}`)}</span><span aria-hidden="true">{arrow}</span></span>;
}
