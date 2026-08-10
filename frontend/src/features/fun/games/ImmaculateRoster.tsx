"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import IconImage from "@/components/IconImage";
import { getClassInfoById } from "@/lib/utils";
import type { CharacterSearchResult, ImmaculateRosterRound } from "@/types";
import CharacterGuessInput, { characterGuessKey } from "../CharacterGuessInput";
import { FunClassIcon } from "../FunCharacterIdentity";
import FunGuildIdentity, { FunGuildCrest } from "../FunGuildIdentity";
import { FunRaidIdentity } from "../FunEncounterIdentity";

type FilledCell = { key: string; name: string; realm: string };
export const MAX_IMMACULATE_MISTAKES = 5;

type IncorrectAttempt = {
  id: string;
  character: { name: string; realm: string; classID: number; guild: CharacterSearchResult["guild"] };
  guild: ImmaculateRosterRound["rows"][number]["guild"];
  column: ImmaculateRosterRound["columns"][number];
  reason: "duplicate" | "incorrect";
};

export default function ImmaculateRoster({ round, onMistakesChange }: { round: ImmaculateRosterRound; onMistakesChange: (mistakes: number) => void }) {
  const t = useTranslations("fun");
  const cellKeys = useMemo(() => round.rows.flatMap((row) => round.columns.map((column) => `${row.id}:${column.classID}`)), [round.columns, round.rows]);
  const [selectedCell, setSelectedCell] = useState<string | null>(cellKeys[0] ?? null);
  const [filled, setFilled] = useState<Record<string, FilledCell>>({});
  const [mistakes, setMistakes] = useState(0);
  const [incorrectAttempts, setIncorrectAttempts] = useState<IncorrectAttempt[]>([]);
  const [status, setStatus] = useState<"playing" | "won" | "lost">("playing");
  const [notice, setNotice] = useState<string | null>(null);

  const submitCharacter = (character: CharacterSearchResult) => {
    if (!selectedCell || status !== "playing") return;
    const key = characterGuessKey(character);
    if (!key) return;
    const used = Object.values(filled).some((cell) => cell.key === key);
    const valid = round.solution.validCharacterKeysByCell[selectedCell]?.includes(key) === true;
    if (!valid || used) {
      const nextMistakes = mistakes + 1;
      const row = round.rows.find(({ id }) => selectedCell.startsWith(`${id}:`));
      const column = row ? round.columns.find(({ classID }) => selectedCell === `${row.id}:${classID}`) : undefined;
      if (row && column) {
        setIncorrectAttempts((current) => [
          ...current,
          {
            id: `${key}:${selectedCell}:${nextMistakes}`,
            character: { name: character.name, realm: character.realm, classID: character.classID, guild: character.guild },
            guild: row.guild,
            column,
            reason: used ? "duplicate" : "incorrect",
          },
        ]);
      }
      setMistakes(nextMistakes);
      onMistakesChange(nextMistakes);
      setNotice(used ? t("immaculate.duplicate") : t("immaculate.incorrect"));
      if (nextMistakes >= MAX_IMMACULATE_MISTAKES) setStatus("lost");
      return;
    }

    const nextFilled = { ...filled, [selectedCell]: { key, name: character.name, realm: character.realm } };
    setFilled(nextFilled);
    setNotice(t("immaculate.correct"));
    if (Object.keys(nextFilled).length === cellKeys.length) {
      setStatus("won");
      setSelectedCell(null);
      return;
    }
    setSelectedCell(cellKeys.find((cellKey) => !nextFilled[cellKey]) ?? null);
  };

  return (
    <section className="mt-5">
      <div className="min-w-0 overflow-hidden rounded-xl bg-slate-950/45">
        <div className="overflow-x-auto p-2 sm:p-3">
          <div className="grid min-w-[46rem] grid-cols-[17rem_repeat(3,minmax(9rem,1fr))] gap-2">
          <div className="flex min-h-16 items-center rounded-lg bg-slate-900/60 px-3">
            <FunRaidIdentity raid={round.raid} iconSize={38} className="w-full" />
          </div>
          {round.columns.map((column) => (
            <div key={column.classID} className="flex min-h-16 items-center justify-center gap-2 rounded-lg bg-slate-800/80 px-3 text-center text-sm font-bold">
              <span className="relative size-8 overflow-hidden rounded-md"><IconImage iconFilename={column.iconUrl.includes(".") ? column.iconUrl : `${column.iconUrl}.jpg`} alt="" fill style={{ objectFit: "cover" }} /></span>
              {column.name}
            </div>
          ))}
          {round.rows.map((row) => (
            <div key={row.id} className="contents">
              <div className="flex min-h-24 items-center rounded-lg bg-slate-800/80 px-4">
                <FunGuildIdentity guild={row.guild} crestSize={42} wrapName />
              </div>
              {round.columns.map((column) => {
                const cellKey = `${row.id}:${column.classID}`;
                const answer = filled[cellKey];
                const example = round.solution.exampleAnswerByCell[cellKey];
                const showExample = status === "lost" && !answer && example;
                const selected = selectedCell === cellKey;
                if (selected && !answer && status === "playing") {
                  return (
                    <div key={cellKey} className="min-h-24">
                      <CharacterGuessInput onSelect={submitCharacter} autoFocus immediate={false} cell showClassIcon={false} />
                    </div>
                  );
                }
                return (
                  <button
                    key={cellKey}
                    type="button"
                    onClick={() => status === "playing" && !answer && setSelectedCell(cellKey)}
                    disabled={status !== "playing" || Boolean(answer)}
                    className={`min-h-24 rounded-lg border p-3 text-center transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300 ${
                      answer
                        ? "border-emerald-400/30 bg-emerald-950/35"
                        : showExample
                          ? "border-red-400/25 bg-red-950/25"
                          : "border-white/10 bg-slate-900/75 hover:border-blue-300/35"
                    }`}
                  >
                    {answer ? (
                      <span className="flex items-center justify-center gap-2"><FunClassIcon classID={column.classID} size={28} /><span className="min-w-0 text-left"><span className="block truncate font-bold text-emerald-100">{answer.name}</span><span className="mt-0.5 block truncate text-xs text-emerald-300/70">{answer.realm}</span></span></span>
                    ) : showExample ? (
                      <span className="flex items-center justify-center gap-2"><FunClassIcon classID={column.classID} size={28} /><span className="min-w-0 text-left"><span className="block text-xs font-semibold text-red-300">{t("common.exampleAnswer")}</span><span className="mt-0.5 block truncate font-bold">{example.name}</span></span></span>
                    ) : <span className="text-2xl text-slate-600">+</span>}
                  </button>
                );
              })}
            </div>
          ))}
          </div>
        </div>
        {status === "playing" ? (
          notice ? <p className="border-t border-white/10 px-4 py-2 text-xs font-semibold text-blue-200" role="status">{notice}</p> : null
        ) : (
          <div className="border-t border-white/10 px-4 py-3" role="status">
            <p className={`font-black ${status === "won" ? "text-emerald-300" : "text-red-300"}`}>{status === "won" ? t("common.youWon") : t("common.gameOver")}</p>
            <p className="text-sm text-slate-400">{status === "won" ? t("immaculate.wonSummary", { mistakes }) : t("immaculate.lostSummary")}</p>
          </div>
        )}
      </div>

      {incorrectAttempts.length > 0 ? (
        <div className="mt-3 border-y border-white/10 py-2" role="table" aria-label={t("immaculate.incorrectAttempts")}>
          <h2 className="px-2 py-2 text-sm font-black">{t("immaculate.incorrectAttempts")}</h2>
          <div className="hidden grid-cols-[minmax(0,1.15fr)_minmax(0,1.25fr)_minmax(0,1fr)] gap-4 border-t border-white/10 px-3 py-2 text-xs font-bold text-slate-400 sm:grid" role="row">
            <span role="columnheader">{t("immaculate.guessedCharacter")}</span>
            <span role="columnheader">{t("immaculate.attemptedCell")}</span>
            <span role="columnheader">{t("immaculate.result")}</span>
          </div>
          <div className="divide-y divide-white/10 border-t border-white/10 sm:border-t-0">
            {incorrectAttempts.map((attempt) => {
              const guessedClass = getClassInfoById(attempt.character.classID);
              return (
                <div key={attempt.id} className="grid grid-cols-2 gap-1 px-1 py-2 text-sm sm:grid-cols-[minmax(0,1.15fr)_minmax(0,1.25fr)_minmax(0,1fr)] sm:gap-4 sm:px-3" role="row">
                  <AttemptCell label={t("immaculate.guessedCharacter")}>
                    <div className="min-w-0">
                      <span className="block truncate font-bold">{attempt.character.name}</span>
                      <span className="block truncate text-xs text-slate-400">{attempt.character.realm}</span>
                      <span className="mt-2 flex min-w-0 items-center gap-2"><FunClassIcon classID={attempt.character.classID} size={24} /><span className="truncate">{guessedClass.name}</span></span>
                      <span className="mt-1 block truncate text-xs text-slate-300">{attempt.character.guild ? `${attempt.character.guild.name} · ${attempt.character.guild.realm}` : t("immaculate.noGuild")}</span>
                    </div>
                  </AttemptCell>
                  <AttemptCell label={t("immaculate.attemptedCell")}>
                    <div className="grid gap-2">
                      <span><span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500">{t("immaculate.guildRow")}</span><span className="flex min-w-0 items-center gap-2"><FunGuildCrest crest={attempt.guild.crest} faction={attempt.guild.faction} size={24} /><span className="truncate font-semibold">{attempt.guild.name}</span></span></span>
                      <span><span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500">{t("immaculate.classColumn")}</span><span className="flex min-w-0 items-center gap-2"><FunClassIcon classID={attempt.column.classID} size={24} /><span className="truncate font-semibold">{attempt.column.name}</span></span></span>
                    </div>
                  </AttemptCell>
                  <AttemptCell label={t("immaculate.result")} className="col-span-2 sm:col-span-1">
                    <span className="flex items-start gap-1.5 text-red-200"><span aria-hidden="true">×</span><span>{t(`immaculate.${attempt.reason}`)}</span></span>
                  </AttemptCell>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

    </section>
  );
}

function AttemptCell({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 rounded-md bg-slate-950/25 px-2 py-2 sm:bg-transparent sm:px-0 ${className}`} role="cell">
      <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500 sm:hidden">{label}</span>
      {children}
    </div>
  );
}
