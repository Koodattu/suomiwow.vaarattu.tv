"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { HigherOrWipeMode, HigherOrWipeOption, HigherOrWipeRound } from "@/types";
import FunCharacterIdentity from "../FunCharacterIdentity";
import { FunBossIdentity, FunRaidIdentity } from "../FunEncounterIdentity";
import FunGuildIdentity from "../FunGuildIdentity";

const MODES: HigherOrWipeMode[] = ["random", "pulls", "started", "mythic-plus", "achievements"];

export default function HigherOrWipe({
  round,
  loading,
  onModeChange,
}: {
  round: HigherOrWipeRound;
  loading: boolean;
  onModeChange: (mode: HigherOrWipeMode) => void;
}) {
  const t = useTranslations("fun");
  const [index, setIndex] = useState(0);
  const [streak, setStreak] = useState(0);
  const [best, setBest] = useState(0);
  const [answered, setAnswered] = useState<"left" | "right" | null>(null);
  const [lastCorrect, setLastCorrect] = useState(false);
  const complete = index >= round.questions.length;
  const question = round.questions[index];
  const modeSelector = <HigherModeSelector selected={round.mode} loading={loading} onChange={onModeChange} />;

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
    return <section className="mx-auto mt-5 max-w-5xl">{modeSelector}<div className="mx-auto mt-4 max-w-2xl border-y border-emerald-300/20 bg-emerald-950/25 p-6 text-center" role="status"><p className="text-2xl font-black text-emerald-300">{t("higher.finished")}</p><p className="mt-2 text-emerald-100/80">{t("higher.best", { count: best })}</p></div></section>;
  }

  return (
    <section className="mx-auto mt-5 max-w-5xl">
      {modeSelector}
      <div className="mt-4 flex items-center justify-between border-b border-white/10 pb-3 text-sm"><span className="text-slate-400 tabular-nums">{t("higher.question", { current: index + 1, total: round.questions.length })}</span><span className="font-bold text-blue-200 tabular-nums">{t("higher.streak", { count: streak })}</span></div>
      <h2 className="mx-auto mt-4 max-w-2xl text-balance text-center text-xl font-black sm:text-2xl">{t(`higher.prompts.${question.kind}`)}</h2>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:gap-3">
        {(["left", "right"] as const).map((side) => {
          const option = question[side];
          const correct = question.correctSide === side;
          const selected = answered === side;
          const stateClass = answered ? correct ? "border-emerald-400/55 bg-emerald-950/35" : selected ? "border-red-400/55 bg-red-950/30" : "border-white/10 bg-slate-900/60" : "border-white/10 bg-slate-900/75 hover:border-blue-300/45 hover:bg-slate-900";
          return (
            <button key={side} type="button" onClick={() => answer(side)} disabled={Boolean(answered)} className={`min-h-32 rounded-lg border p-3 text-left transition-[border-color,background-color,transform] active:not-disabled:scale-[0.97] disabled:cursor-default sm:min-h-36 sm:p-5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300 ${stateClass}`}>
              <HigherOptionIdentity option={option} />
              {answered ? <span className={`mt-3 block text-xl font-black tabular-nums sm:text-2xl ${correct ? "text-emerald-300" : "text-slate-300"}`}>{formatValue(option.value, question.unit, t)}</span> : <span className="mt-3 block text-sm font-bold text-blue-300">{t("higher.choose")}</span>}
            </button>
          );
        })}
      </div>
      {answered ? <div className="mt-4 flex flex-col items-center gap-3 text-center" role="status"><p className={`font-bold ${lastCorrect ? "text-emerald-300" : "text-red-300"}`}>{lastCorrect ? t("higher.correct") : t("higher.wrong")}</p><button type="button" onClick={next} className="min-h-11 rounded-md bg-blue-600 px-6 py-2.5 text-sm font-bold hover:bg-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300">{index + 1 === round.questions.length ? t("higher.results") : t("higher.next")}</button></div> : null}
    </section>
  );
}

function HigherModeSelector({ selected, loading, onChange }: { selected: HigherOrWipeMode; loading: boolean; onChange: (mode: HigherOrWipeMode) => void }) {
  const t = useTranslations("fun");
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <span className="text-sm font-bold text-slate-300">{t("higher.mode")}</span>
      <div className="grid grid-cols-3 gap-1 sm:flex" role="group" aria-label={t("higher.mode")}>
        {MODES.map((mode) => {
          const active = mode === selected;
          return (
            <button
              key={mode}
              type="button"
              aria-pressed={active}
              disabled={loading || active}
              onClick={() => onChange(mode)}
              className={`min-h-10 rounded-md px-3 py-2 text-sm font-bold transition-[background-color,color,transform] active:not-disabled:scale-[0.97] disabled:cursor-default ${active ? "bg-blue-600 text-white" : "text-blue-100/70 hover:bg-white/5 hover:text-white disabled:opacity-55"}`}
            >
              {t(`higher.modes.${mode}`)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function HigherOptionIdentity({ option }: { option: HigherOrWipeOption }) {
  return (
    <span className="grid min-w-0 gap-2">
      {option.guild ? (
        <FunGuildIdentity guild={option.guild} crestSize={40} />
      ) : option.classID !== undefined ? (
        <FunCharacterIdentity character={{ name: option.label, realm: option.detail, classID: option.classID }} iconSize={40} />
      ) : option.boss ? (
        <FunBossIdentity name={option.boss.name} iconUrl={option.boss.iconUrl} iconSize={40} />
      ) : (
        <span><span className="block text-xl font-black text-balance">{option.label}</span><span className="mt-1 block truncate text-sm text-slate-400">{option.detail}</span></span>
      )}
      {option.guild && option.boss ? <FunBossIdentity name={option.boss.name} iconUrl={option.boss.iconUrl} iconSize={28} /> : null}
      {option.raid ? <FunRaidIdentity raid={option.raid} iconSize={26} compact /> : null}
    </span>
  );
}

function formatValue(value: number, unit: HigherOrWipeRound["questions"][number]["unit"], t: ReturnType<typeof useTranslations<"fun">>) {
  return t(`higher.values.${unit}`, { value: Math.round(value) });
}
