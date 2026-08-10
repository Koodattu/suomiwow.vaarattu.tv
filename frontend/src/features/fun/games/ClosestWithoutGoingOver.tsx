"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { formatRealmName } from "@/lib/utils";
import type { ClosestWithoutGoingOverRound } from "@/types";
import FunCharacterIdentity from "../FunCharacterIdentity";
import { FunBossIdentity, FunRaidIdentity } from "../FunEncounterIdentity";
import FunGuildIdentity from "../FunGuildIdentity";

const MAX_GUESSES = 3;

export default function ClosestWithoutGoingOver({ round }: { round: ClosestWithoutGoingOverRound }) {
  const t = useTranslations("fun");
  const [guess, setGuess] = useState("");
  const [guesses, setGuesses] = useState<number[]>([]);
  const answer = round.solution.value;
  const latest = guesses.at(-1);
  const exact = latest === answer;
  const finished = exact || guesses.length >= MAX_GUESSES;
  const bestGuess = guesses.reduce<number | null>((best, value) => best === null || Math.abs(answer - value) < Math.abs(answer - best) ? value : best, null);
  const bars = useMemo(() => histogram(round.distribution.values, 10), [round.distribution.values]);
  const maxBar = Math.max(...bars.map((bar) => bar.count), 1);
  const subjectIdentity = round.challenge.guild ? (
    <FunGuildIdentity guild={round.challenge.guild} crestSize={32} className="inline-flex align-middle" />
  ) : round.challenge.characterClassID !== null ? (
    <FunCharacterIdentity character={{ name: round.challenge.subject, realm: round.challenge.detail, classID: round.challenge.characterClassID }} iconSize={32} className="inline-flex align-middle" />
  ) : (
    <span>{round.challenge.subject}</span>
  );

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (finished) return;
    const value = Number(guess);
    if (!Number.isFinite(value) || value < 0) return;
    setGuesses((current) => [...current, Math.round(value)]);
    setGuess("");
  };

  return (
    <section className="mx-auto mt-5 grid max-w-5xl overflow-hidden rounded-xl border border-white/10 bg-slate-900/55 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          {round.challenge.boss ? <FunBossIdentity name={round.challenge.boss.name} iconUrl={round.challenge.boss.iconUrl} /> : null}
          {round.challenge.raid ? <FunRaidIdentity raid={round.challenge.raid} iconSize={32} compact /> : null}
        </div>
        {!round.challenge.boss && !round.challenge.raid ? <p className="mt-4 text-sm text-blue-200">{formatRealmName(round.challenge.detail)}</p> : null}
        <h2 className="mt-3 text-balance text-2xl font-black">{t.rich(`closest.prompts.${round.challenge.kind}`, { identity: () => subjectIdentity })}</h2>

        {guesses.length > 0 ? (
          <ol className="mt-5 grid gap-2 sm:grid-cols-3" aria-label={t("closest.attempts")}>
            {guesses.map((value, index) => {
              const direction = value === answer ? "exact" : value < answer ? "higher" : "lower";
              return (
                <li key={`${value}-${index}`} className={`rounded-lg px-3 py-2.5 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.1)] ${direction === "exact" ? "bg-emerald-950/35" : "bg-slate-950/45"}`}>
                  <span className="block text-[10px] font-bold uppercase tracking-wide text-slate-500">{t("closest.attempt", { number: index + 1 })}</span>
                  <span className="mt-0.5 flex items-baseline justify-between gap-3"><span className="text-lg font-black tabular-nums">{value}</span><span className={`text-sm font-bold ${direction === "exact" ? "text-emerald-300" : "text-blue-200"}`}>{t(`closest.${direction}`)}</span></span>
                </li>
              );
            })}
          </ol>
        ) : null}

        {!finished ? (
          <form onSubmit={submit} className="mt-6 flex flex-col gap-3 sm:flex-row">
            <label className="sr-only" htmlFor="closest-guess">{t("closest.yourGuess")}</label>
            <input
              id="closest-guess"
              type="number"
              min="0"
              step="1"
              value={guess}
              onChange={(event) => setGuess(event.target.value)}
              placeholder={t(`closest.placeholders.${round.challenge.unit}`)}
              autoFocus
              className="min-h-12 min-w-0 flex-1 rounded-md border border-slate-600 bg-slate-950/75 px-4 text-lg font-bold tabular-nums placeholder:text-slate-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/25"
            />
            <button type="submit" disabled={guess.trim() === ""} className="min-h-12 rounded-md bg-blue-600 px-6 text-sm font-bold transition-[background-color,transform] hover:bg-blue-500 active:scale-[0.96] disabled:opacity-45">{t("closest.submitGuess")}</button>
          </form>
        ) : (
          <div className="mt-6 rounded-lg bg-slate-950/45 p-4" role="status">
            <p className={`text-2xl font-black ${exact ? "text-emerald-300" : "text-blue-200"}`}>{exact ? t("closest.exact") : t("closest.finished")}</p>
            <div className="mt-4 flex flex-wrap gap-x-8 gap-y-3 text-sm">
              <span><span className="block text-slate-400">{t("closest.answer")}</span><span className="text-xl font-black text-emerald-300 tabular-nums">{answer}</span></span>
              {bestGuess !== null ? <span><span className="block text-slate-400">{t("closest.bestGuess")}</span><span className="text-xl font-black tabular-nums">{bestGuess} <span className="text-sm font-semibold text-slate-400">{t("closest.away", { difference: Math.abs(answer - bestGuess) })}</span></span></span> : null}
            </div>
          </div>
        )}
        <p className="mt-3 text-xs text-slate-400 tabular-nums">{t("closest.remaining", { count: Math.max(0, MAX_GUESSES - guesses.length) })}</p>
      </div>

      <aside className="border-t border-white/10 bg-slate-950/25 p-4 lg:border-l lg:border-t-0">
        <h3 className="font-black">{t("closest.distribution")}</h3>
        <p className="mt-1 text-pretty text-xs leading-5 text-slate-400">{t("closest.distributionHelp")}</p>
        <div className="mt-4 flex h-28 items-end gap-1" aria-hidden="true">
          {bars.map((bar) => <span key={bar.start} className="min-w-0 flex-1 rounded-t-sm bg-blue-400/65" style={{ height: `${Math.max(5, (bar.count / maxBar) * 100)}%` }} />)}
        </div>
        <div className="mt-2 flex justify-between text-xs text-slate-400 tabular-nums"><span>{round.distribution.min}</span><span>{t("closest.median", { value: round.distribution.median })}</span><span>{round.distribution.max}</span></div>
      </aside>
    </section>
  );
}

function histogram(values: number[], bucketCount: number): Array<{ start: number; count: number }> {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const width = Math.max(1, (max - min + 1) / bucketCount);
  const buckets = Array.from({ length: bucketCount }, (_, index) => ({ start: min + index * width, count: 0 }));
  for (const value of values) {
    const index = Math.min(bucketCount - 1, Math.floor((value - min) / width));
    buckets[index].count += 1;
  }
  return buckets;
}
