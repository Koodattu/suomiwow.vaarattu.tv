"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import IconImage from "@/components/IconImage";
import { getClassInfoById } from "@/lib/utils";
import type { FunCharacter, RaidConnectionsRound } from "@/types";
import { FunRaidIdentity } from "../FunEncounterIdentity";
import { FunGuildCrest } from "../FunGuildIdentity";

const GROUP_STYLES = [
  "border-amber-300/30 bg-amber-950/35 text-amber-100",
  "border-emerald-300/30 bg-emerald-950/35 text-emerald-100",
  "border-blue-300/30 bg-blue-950/35 text-blue-100",
  "border-violet-300/30 bg-violet-950/35 text-violet-100",
];

export default function RaidConnections({ round }: { round: RaidConnectionsRound }) {
  const t = useTranslations("fun");
  const [selected, setSelected] = useState<string[]>([]);
  const [solvedIds, setSolvedIds] = useState<string[]>([]);
  const [mistakes, setMistakes] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [status, setStatus] = useState<"playing" | "won" | "lost">("playing");

  const tilesByKey = useMemo(() => new Map(round.tiles.map((tile) => [tile.key, tile])), [round.tiles]);
  const solvedKeys = useMemo(() => new Set(round.solution.groups.filter((group) => solvedIds.includes(group.id)).flatMap((group) => group.memberKeys)), [round.solution.groups, solvedIds]);
  const remainingTiles = round.tiles.filter((tile) => !solvedKeys.has(tile.key));

  const toggle = (key: string) => {
    if (status !== "playing") return;
    setNotice(null);
    setSelected((current) => current.includes(key) ? current.filter((item) => item !== key) : current.length < 4 ? [...current, key] : current);
  };

  const submit = () => {
    if (selected.length !== 4 || status !== "playing") return;
    const selectedSet = new Set(selected);
    const unsolved = round.solution.groups.filter((group) => !solvedIds.includes(group.id));
    const match = unsolved.find((group) => group.memberKeys.every((key) => selectedSet.has(key)));
    if (match) {
      const nextSolved = [...solvedIds, match.id];
      setSolvedIds(nextSolved);
      setSelected([]);
      setNotice(t("connections.correctGroup"));
      if (nextSolved.length === round.solution.groups.length) setStatus("won");
      return;
    }

    const closest = Math.max(...unsolved.map((group) => group.memberKeys.filter((key) => selectedSet.has(key)).length));
    const nextMistakes = mistakes + 1;
    setMistakes(nextMistakes);
    setSelected([]);
    setNotice(closest === 3 ? t("connections.oneAway") : t("connections.incorrectGroup"));
    if (nextMistakes >= 4) setStatus("lost");
  };

  return (
    <section className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="min-w-0">
        <div className="flex flex-col gap-2 border-b border-white/10 pb-3 sm:flex-row sm:items-end sm:justify-between">
          <FunRaidIdentity raid={round.raid} iconSize={42} />
          <span className="text-sm font-bold text-red-200 tabular-nums">{t("common.mistakes", { count: mistakes, total: 4 })}</span>
        </div>

      <div className="mt-3 space-y-2">
        {round.solution.groups.map((group, index) => {
          const visible = solvedIds.includes(group.id) || status === "lost";
          if (!visible) return null;
          const members = group.memberKeys.map((key) => tilesByKey.get(key)).filter((tile): tile is FunCharacter => Boolean(tile));
          return (
            <div key={group.id} className={`flex items-center gap-3 rounded-lg border p-3 ${GROUP_STYLES[index % GROUP_STYLES.length]}`}>
              <FunGuildCrest crest={group.guild.crest} faction={group.guild.faction} size={40} />
              <div><p className="font-black">{group.guild.name} <span className="font-normal opacity-70">— {group.guild.realm}</span></p><p className="mt-1 text-sm opacity-80">{members.map((member) => member.name).join(", ")}</p></div>
            </div>
          );
        })}
      </div>

      {status !== "lost" ? (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {remainingTiles.map((tile) => {
            const classInfo = getClassInfoById(tile.classID);
            const active = selected.includes(tile.key);
            return (
              <button
                key={tile.key}
                type="button"
                onClick={() => toggle(tile.key)}
                disabled={status !== "playing"}
                aria-pressed={active}
                className={`flex min-h-20 items-center gap-3 rounded-lg border p-3 text-left transition-[border-color,background-color,transform] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300 ${active ? "scale-[0.98] border-blue-300 bg-blue-950/60" : "border-white/10 bg-slate-900/75 hover:border-blue-300/30"}`}
              >
                <span className="relative size-10 shrink-0 overflow-hidden rounded-md ring-1 ring-white/10"><IconImage iconFilename={classInfo.iconUrl} alt="" fill style={{ objectFit: "cover" }} /></span>
                <span className="min-w-0"><span className="block truncate font-bold">{tile.name}</span><span className="block truncate text-xs text-slate-400">{tile.realm}</span></span>
              </button>
            );
          })}
        </div>
      ) : null}

      </div>

      <aside className="h-fit rounded-xl border border-white/10 bg-slate-900/70 p-4 text-center">
        <p className="text-sm leading-6 text-slate-400">{t("connections.instructions")}</p>
      <div className="mt-4 flex flex-col items-center justify-center gap-3">
        {status === "playing" ? (
          <>
            <button type="button" onClick={submit} disabled={selected.length !== 4} className="min-h-11 rounded-md bg-blue-600 px-6 py-2.5 text-sm font-bold transition-[background-color,transform] hover:bg-blue-500 active:not-disabled:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-45">{t("connections.submitGroup")}</button>
            <p className="min-h-5 text-sm text-slate-400 tabular-nums" role="status">{notice ?? t("connections.selected", { count: selected.length })}</p>
          </>
        ) : (
          <div role="status"><p className={`text-xl font-black ${status === "won" ? "text-emerald-300" : "text-red-300"}`}>{status === "won" ? t("common.youWon") : t("common.gameOver")}</p><p className="mt-2 text-sm text-slate-400">{status === "won" ? t("connections.wonSummary", { mistakes }) : t("connections.lostSummary")}</p></div>
        )}
      </div>
      </aside>
    </section>
  );
}
