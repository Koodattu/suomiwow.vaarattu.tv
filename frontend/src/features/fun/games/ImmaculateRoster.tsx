"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import IconImage from "@/components/IconImage";
import type { CharacterSearchResult, ImmaculateRosterRound } from "@/types";
import CharacterGuessInput, { characterGuessKey } from "../CharacterGuessInput";
import FunGuildIdentity from "../FunGuildIdentity";
import { FunRaidIdentity } from "../FunEncounterIdentity";

type FilledCell = { key: string; name: string; realm: string };

export default function ImmaculateRoster({ round }: { round: ImmaculateRosterRound }) {
  const t = useTranslations("fun");
  const cellKeys = useMemo(() => round.rows.flatMap((row) => round.columns.map((column) => `${row.id}:${column.classID}`)), [round.columns, round.rows]);
  const [selectedCell, setSelectedCell] = useState<string | null>(cellKeys[0] ?? null);
  const [filled, setFilled] = useState<Record<string, FilledCell>>({});
  const [mistakes, setMistakes] = useState(0);
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
      setMistakes(nextMistakes);
      setNotice(used ? t("immaculate.duplicate") : t("immaculate.incorrect"));
      if (nextMistakes >= 3) setStatus("lost");
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
    <section className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="min-w-0 overflow-hidden rounded-xl border border-white/10 bg-slate-950/45">
        <div className="flex flex-col gap-3 bg-slate-900/70 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <FunRaidIdentity raid={round.raid} iconSize={42} />
            <p className="mt-2 text-sm text-slate-400">{t("immaculate.instructions")}</p>
          </div>
          <div className="flex gap-2 text-xs font-bold">
            <span className="rounded-md bg-slate-950/65 px-3 py-2 text-slate-300 tabular-nums">{t("common.completed", { count: Object.keys(filled).length, total: cellKeys.length })}</span>
            <span className="rounded-md bg-red-950/45 px-3 py-2 text-red-200 tabular-nums">{t("common.mistakes", { count: mistakes, total: 3 })}</span>
          </div>
        </div>

        <div className="overflow-x-auto border-t border-white/10 p-2 sm:p-3">
          <div className="grid min-w-[42rem] grid-cols-[12rem_repeat(3,minmax(9rem,1fr))] gap-2">
          <div />
          {round.columns.map((column) => (
            <div key={column.classID} className="flex min-h-16 items-center justify-center gap-2 rounded-lg bg-slate-800/80 px-3 text-center text-sm font-bold">
              <span className="relative size-8 overflow-hidden rounded-md"><IconImage iconFilename={column.iconUrl.includes(".") ? column.iconUrl : `${column.iconUrl}.jpg`} alt="" fill style={{ objectFit: "cover" }} /></span>
              {column.name}
            </div>
          ))}
          {round.rows.map((row) => (
            <div key={row.id} className="contents">
              <div className="flex min-h-24 items-center gap-3 rounded-lg bg-slate-800/80 px-3">
                <FunGuildIdentity guild={row.guild} crestSize={42} />
              </div>
              {round.columns.map((column) => {
                const cellKey = `${row.id}:${column.classID}`;
                const answer = filled[cellKey];
                const example = round.solution.exampleAnswerByCell[cellKey];
                const showExample = status === "lost" && !answer && example;
                const selected = selectedCell === cellKey;
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
                          : selected
                            ? "border-blue-300 bg-blue-950/55"
                            : "border-white/10 bg-slate-900/75 hover:border-blue-300/35"
                    }`}
                  >
                    {answer ? (
                      <><span className="block font-bold text-emerald-100">{answer.name}</span><span className="mt-1 block text-xs text-emerald-300/70">{answer.realm}</span></>
                    ) : showExample ? (
                      <><span className="block text-xs font-semibold text-red-300">{t("common.exampleAnswer")}</span><span className="mt-1 block font-bold">{example.name}</span></>
                    ) : (
                      <span className={selected ? "font-bold text-blue-200" : "text-2xl text-slate-600"}>{selected ? t("immaculate.selected") : "+"}</span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
          </div>
        </div>
      </div>

      <div className="h-fit rounded-xl border border-white/10 bg-slate-900/70 p-4">
        {status === "playing" ? (
          <>
            <label className="mb-2 block text-sm font-bold">{selectedCell ? t("immaculate.chooseCharacter") : t("immaculate.chooseCell")}</label>
            <CharacterGuessInput onSelect={submitCharacter} disabled={!selectedCell} />
            {notice ? <p className="mt-3 text-sm text-slate-300" role="status">{notice}</p> : <p className="mt-3 text-xs text-slate-400">{t("immaculate.tip")}</p>}
          </>
        ) : (
          <div className="text-center" role="status">
            <p className={`text-xl font-black ${status === "won" ? "text-emerald-300" : "text-red-300"}`}>{status === "won" ? t("common.youWon") : t("common.gameOver")}</p>
            <p className="mt-2 text-sm text-slate-400">{status === "won" ? t("immaculate.wonSummary", { mistakes }) : t("immaculate.lostSummary")}</p>
          </div>
        )}
      </div>
    </section>
  );
}
