"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { HigherOrWipeRound } from "@/types";
import { FunIcon } from "../FunEncounterIdentity";

export default function HigherOrWipe({ round }: { round: HigherOrWipeRound }) {
  const t = useTranslations("fun");
  const [index, setIndex] = useState(0);
  const [streak, setStreak] = useState(0);
  const [best, setBest] = useState(0);
  const [answered, setAnswered] = useState<"left" | "right" | null>(null);
  const [lastCorrect, setLastCorrect] = useState(false);
  const complete = index >= round.questions.length;
  const question = round.questions[index];

  const answer = (side: "left" | "right") => {
    if (!question || answered) return;
    const correct = side === question.correctSide;
    const nextStreak = correct ? streak + 1 : 0;
    setAnswered(side);
    setLastCorrect(correct);
    setStreak(nextStreak);
    setBest((current) => Math.max(current, nextStreak));
  };

  const next = () => {
    setIndex((current) => current + 1);
    setAnswered(null);
  };

  if (complete) {
    return <section className="mx-auto mt-5 max-w-2xl rounded-xl border border-emerald-300/20 bg-emerald-950/25 p-6 text-center" role="status"><p className="text-2xl font-black text-emerald-300">{t("higher.finished")}</p><p className="mt-2 text-slate-300">{t("higher.best", { count: best })}</p></section>;
  }

  return (
    <section className="mx-auto mt-5 max-w-4xl">
      <div className="flex items-center justify-between border-b border-white/10 pb-3 text-sm"><span className="text-slate-400 tabular-nums">{t("higher.question", { current: index + 1, total: round.questions.length })}</span><span className="font-bold text-blue-200 tabular-nums">{t("higher.streak", { count: streak })}</span></div>
      <h2 className="mx-auto mt-5 max-w-2xl text-balance text-center text-2xl font-black">{t(`higher.prompts.${question.kind}`)}</h2>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {(["left", "right"] as const).map((side) => {
          const option = question[side];
          const correct = question.correctSide === side;
          const selected = answered === side;
          const stateClass = answered ? correct ? "border-emerald-400/55 bg-emerald-950/35" : selected ? "border-red-400/55 bg-red-950/30" : "border-white/10 bg-slate-900/60" : "border-white/10 bg-slate-900/75 hover:border-blue-300/45 hover:bg-slate-900";
          return (
            <button key={side} type="button" onClick={() => answer(side)} disabled={Boolean(answered)} className={`min-h-40 rounded-xl border p-5 text-left transition-[border-color,background-color,transform] active:not-disabled:scale-[0.96] disabled:cursor-default focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300 ${stateClass}`}>
              <span className="flex min-w-0 items-center gap-3">
                {option.iconUrl !== undefined ? <FunIcon iconUrl={option.iconUrl} label={option.label} size={40} /> : null}
                <span className="min-w-0 text-xl font-black text-balance">{option.label}</span>
              </span>
              <span className="mt-2 flex min-w-0 items-center gap-2 text-sm text-slate-400">
                {option.detailIconUrl !== undefined ? <FunIcon iconUrl={option.detailIconUrl} label={option.detail} size={28} /> : null}
                <span className="truncate">{option.detail}</span>
              </span>
              {answered ? <span className={`mt-5 block text-2xl font-black tabular-nums ${correct ? "text-emerald-300" : "text-slate-300"}`}>{formatValue(option.value, question.unit, t)}</span> : <span className="mt-5 block text-sm font-bold text-blue-300">{t("higher.choose")}</span>}
            </button>
          );
        })}
      </div>
      {answered ? <div className="mt-4 flex flex-col items-center gap-3 text-center" role="status"><p className={`font-bold ${lastCorrect ? "text-emerald-300" : "text-red-300"}`}>{lastCorrect ? t("higher.correct") : t("higher.wrong")}</p><button type="button" onClick={next} className="min-h-11 rounded-md bg-blue-600 px-6 py-2.5 text-sm font-bold hover:bg-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300">{index + 1 === round.questions.length ? t("higher.results") : t("higher.next")}</button></div> : null}
    </section>
  );
}

function formatValue(value: number, unit: HigherOrWipeRound["questions"][number]["unit"], t: ReturnType<typeof useTranslations<"fun">>) {
  return t(`higher.values.${unit}`, { value: Math.round(value) });
}
