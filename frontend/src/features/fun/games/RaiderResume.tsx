"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import CharacterAvatar from "@/components/CharacterAvatar";
import { getClassInfoById } from "@/lib/utils";
import type { RaiderResumeCandidate, RaiderResumeRound } from "@/types";
import FunAutocomplete from "../FunAutocomplete";
import FunCharacterIdentity, { FunClassIcon } from "../FunCharacterIdentity";
import { FunRaidIdentity } from "../FunEncounterIdentity";
import FunGuildIdentity from "../FunGuildIdentity";
import ProgressiveClues from "../ProgressiveClues";

type Comparison = "lower" | "exact" | "higher" | "mismatch";
type ResumeGuess = { character: RaiderResumeCandidate };

export default function RaiderResume({ round }: { round: RaiderResumeRound }) {
  const t = useTranslations("fun");
  const target = round.solution.target;
  const [guesses, setGuesses] = useState<ResumeGuess[]>([]);
  const [status, setStatus] = useState<"playing" | "won" | "lost">("playing");
  const targetClass = getClassInfoById(target.classID);

  const availableCandidates = useMemo(() => {
    const guessedKeys = new Set(guesses.map((guess) => guess.character.key));
    return round.candidates.filter((candidate) => !guessedKeys.has(candidate.key));
  }, [guesses, round.candidates]);

  const submitGuess = (character: RaiderResumeCandidate) => {
    if (status !== "playing") return;
    if (character.key === target.key) {
      setStatus("won");
      return;
    }
    const nextGuesses = [...guesses, { character }];
    setGuesses(nextGuesses);
    if (nextGuesses.length >= 6) setStatus("lost");
  };
  const clueItems = [
    { label: t("resume.class"), content: <span className="inline-flex items-center gap-2"><FunClassIcon classID={target.classID} size={24} />{targetClass.name}</span> },
    { label: t("resume.activeYears"), content: `${new Date(target.firstSeenAt).getFullYear()}–${new Date(target.lastSeenAt).getFullYear()}` },
    { label: t("resume.portrait"), content: <span className="inline-flex items-center gap-2"><CharacterAvatar avatarUrl={target.avatarUrl} classIcon={targetClass.iconUrl} characterName={target.name} className="size-10" />{t("resume.portraitClue")}</span> },
  ];

  return (
    <section className="mt-5">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="min-w-0 rounded-xl border border-white/10 bg-slate-900/70 p-4">
        <h2 className="text-xl font-black">{t("resume.identifyRaider")}</h2>
        <div className="mt-3 flex gap-2 overflow-x-auto pb-2">
          {round.timeline.map((raid, index) => (
            <div key={raid.id} className="relative min-w-44 flex-1 rounded-lg bg-slate-950/55 p-3">
              <span className="text-xs font-bold text-blue-300">{index + 1}</span>
              <FunRaidIdentity raid={raid} iconSize={34} compact />
            </div>
          ))}
        </div>
        <div className="mt-3 border-t border-white/10 pt-3">
          <h3 className="text-sm font-bold">{t("resume.guildHistory")}</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {target.guilds.map((guild) => (
              <div key={`${guild.name}:${guild.realm}`} className="flex items-center gap-2 rounded-lg bg-slate-950/55 px-2 py-1.5">
                <FunGuildIdentity guild={guild} crestSize={34} />
                <span className="shrink-0 text-xs text-slate-400">{new Date(guild.firstSeenAt).getFullYear()}–{new Date(guild.lastSeenAt).getFullYear()}</span>
              </div>
            ))}
          </div>
        </div>
        </div>

        <aside className="h-fit rounded-xl border border-white/10 bg-slate-900/70 p-4">
          {status === "playing" ? (
            <>
              <div className="mb-3 flex items-center justify-between gap-3 text-sm">
                <label className="font-bold">{t("resume.chooseRaider")}</label>
                <span className="text-slate-400 tabular-nums">{t("common.mistakes", { count: guesses.length, total: 6 })}</span>
              </div>
              <FunAutocomplete
                items={availableCandidates}
                getKey={(character) => character.key}
                getLabel={(character) => character.name}
                getSearchText={(character) => `${character.name} ${character.realm}`}
                renderOption={(character) => <FunCharacterIdentity character={character} iconSize={30} />}
                placeholder={t("resume.searchRaider")}
                emptyLabel={t("resume.noRaiders")}
                onSelect={submitGuess}
              />
            </>
          ) : (
            <div className="text-center" role="status">
              <p className={`text-xl font-black ${status === "won" ? "text-emerald-300" : "text-red-300"}`}>{status === "won" ? t("common.youWon") : t("common.gameOver")}</p>
              <p className="mt-2 text-sm text-slate-400">{t("resume.answerWas")}</p>
              <div className="mt-3 flex items-center justify-center gap-3">
                <CharacterAvatar avatarUrl={target.avatarUrl} classIcon={targetClass.iconUrl} characterName={target.name} className="size-12" />
                <FunCharacterIdentity character={target} iconSize={28} />
              </div>
            </div>
          )}
          <div className="mt-4 border-t border-white/10 pt-3"><h2 className="font-black">{t("resume.clues")}</h2><ProgressiveClues items={clueItems} revealed={guesses.length} /></div>
        </aside>
      </div>

      {guesses.length > 0 ? (
        <div className="mt-3 overflow-x-auto rounded-xl border border-white/10 bg-slate-950/35 p-2">
          <div className="min-w-[58rem] space-y-2">
            <div className="grid grid-cols-[12rem_repeat(7,1fr)] gap-2 px-3 py-1 text-xs font-bold uppercase tracking-wider text-slate-400">
              <span>{t("resume.raider")}</span><span>{t("resume.class")}</span><span>{t("resume.realm")}</span><span>{t("resume.firstSeen")}</span><span>{t("resume.raids")}</span><span>{t("resume.guilds")}</span><span>{t("resume.reports")}</span><span>{t("resume.lastSeen")}</span>
            </div>
            {guesses.map(({ character }) => {
              const classInfo = getClassInfoById(character.classID);
              return (
                <div key={character.key} className="grid grid-cols-[12rem_repeat(7,1fr)] gap-2 rounded-lg bg-slate-900/80 px-3 py-3 text-sm">
                  <span className="font-bold">{character.name}</span>
                  <CompareCell comparison={character.classID === target.classID ? "exact" : "mismatch"}><span className="inline-flex items-center gap-2"><FunClassIcon classID={character.classID} size={24} />{classInfo.name}</span></CompareCell>
                  <CompareCell comparison={character.realm === target.realm ? "exact" : "mismatch"}>{character.realm}</CompareCell>
                  <CompareCell comparison={compareDate(character.firstSeenAt, target.firstSeenAt)}>{new Date(character.firstSeenAt).getFullYear()}</CompareCell>
                  <CompareCell comparison={compareValue(character.raidCount, target.raidCount)}>{character.raidCount}</CompareCell>
                  <CompareCell comparison={compareValue(character.guildCount, target.guildCount)}>{character.guildCount}</CompareCell>
                  <CompareCell comparison={compareValue(character.reportCount, target.reportCount)}>{character.reportCount}</CompareCell>
                  <CompareCell comparison={compareDate(character.lastSeenAt, target.lastSeenAt)}>{new Date(character.lastSeenAt).getFullYear()}</CompareCell>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

    </section>
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
