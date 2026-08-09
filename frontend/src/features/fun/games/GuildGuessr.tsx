"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { FunGuild, GuildGuessrRound } from "@/types";
import FunAutocomplete from "../FunAutocomplete";
import { FunRaidIdentity } from "../FunEncounterIdentity";
import FunGuildIdentity, { FunGuildCrest } from "../FunGuildIdentity";
import ProgressiveClues from "../ProgressiveClues";

type GuessFeedback = {
  guild: FunGuild;
  sameRealm: boolean;
  sharedCharacters: number;
};

export default function GuildGuessr({ round }: { round: GuildGuessrRound }) {
  const t = useTranslations("fun");
  const target = round.solution.target;
  const [guesses, setGuesses] = useState<GuessFeedback[]>([]);
  const [status, setStatus] = useState<"playing" | "won" | "lost">("playing");

  const availableGuilds = useMemo(() => {
    const guessedIds = new Set(guesses.map((guess) => guess.guild.id));
    return round.guildOptions.filter((guild) => !guessedIds.has(guild.id));
  }, [guesses, round.guildOptions]);

  const submitGuess = (guild: FunGuild) => {
    if (status !== "playing") return;
    if (guild.id === target.id) {
      setStatus("won");
      return;
    }

    const neighbor = round.neighbors.find((item) => item.guild.id === guild.id);
    const nextGuesses = [
      ...guesses,
      {
        guild,
        sameRealm: guild.realm.toLocaleLowerCase("en-US") === target.realm.toLocaleLowerCase("en-US"),
        sharedCharacters: neighbor?.sharedCharacters ?? 0,
      },
    ];
    setGuesses(nextGuesses);
    if (nextGuesses.length >= 5) setStatus("lost");
  };

  const schedule = target.raidSchedule?.days
    .map((day) => `${t(`days.${day.day.toLocaleLowerCase("en-US")}`)} ${formatHour(day.startHour)}–${formatHour(day.endHour)}`)
    .join(", ");
  const clueItems = [
    { label: t("guildGuessr.realm"), content: target.realm },
    { label: t("guildGuessr.raids"), content: <span className="grid gap-2">{target.trackedRaids.map((raid) => <FunRaidIdentity key={raid.id} raid={raid} iconSize={28} compact />)}</span> },
    { label: t("guildGuessr.schedule"), content: schedule || t("guildGuessr.noSchedule") },
    {
      label: t("guildGuessr.crest"),
      content: <span className="inline-flex items-center gap-2"><FunGuildCrest crest={target.crest} faction={target.faction} size={42} />{target.faction || t("guildGuessr.unknownFaction")}</span>,
    },
  ];

  return (
    <section className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_19rem]">
      <div className="min-w-0">
        <div className="rounded-xl border border-white/10 bg-slate-900/70 p-4">
        <div className="mx-auto grid max-w-3xl gap-3 sm:grid-cols-[minmax(0,1fr)_9rem_minmax(0,1fr)] sm:items-center">
          <div className="min-w-0 space-y-3">
            {round.neighbors.slice(0, 2).map((neighbor) => <Neighbor key={neighbor.guild.id} neighbor={neighbor} />)}
          </div>
          <div className="grid min-h-32 place-items-center rounded-xl border-2 border-dashed border-blue-300/35 bg-blue-950/35 text-center">
            <div>
              <span className="text-4xl font-black text-blue-200" aria-hidden="true">?</span>
              <p className="mt-1 text-xs font-bold uppercase tracking-wider text-slate-400">{t("guildGuessr.target")}</p>
            </div>
          </div>
          <div className="min-w-0 space-y-3">
            {round.neighbors.slice(2).map((neighbor) => <Neighbor key={neighbor.guild.id} neighbor={neighbor} />)}
          </div>
        </div>
        </div>

        {guesses.length > 0 ? (
        <div className="mt-3 space-y-2">
          {guesses.map((guess) => (
            <div key={guess.guild.id} className="grid gap-2 rounded-lg border border-red-400/20 bg-red-950/20 px-4 py-3 text-sm sm:grid-cols-[minmax(12rem,1fr)_auto_auto] sm:items-center">
              <FunGuildIdentity guild={guess.guild} crestSize={34} />
              <span className={guess.sameRealm ? "text-emerald-300" : "text-slate-400"}>
                {guess.sameRealm ? t("guildGuessr.sameRealm") : t("guildGuessr.differentRealm")}
              </span>
              <span className="text-slate-300">{t("guildGuessr.sharedCharacters", { count: guess.sharedCharacters })}</span>
            </div>
          ))}
        </div>
        ) : null}
      </div>

      <aside className="h-fit rounded-xl border border-white/10 bg-slate-900/70 p-4">
          {status === "playing" ? (
            <>
              <div className="mb-3 flex items-center justify-between gap-3 text-sm">
                <label className="font-bold">{t("guildGuessr.chooseGuild")}</label>
                <span className="text-slate-400 tabular-nums">{t("common.mistakes", { count: guesses.length, total: 5 })}</span>
              </div>
              <FunAutocomplete
                items={availableGuilds}
                getKey={(guild) => guild.id}
                getLabel={(guild) => guild.name}
                getSearchText={(guild) => `${guild.name} ${guild.realm}`}
                renderOption={(guild) => <FunGuildIdentity guild={guild} crestSize={32} />}
                placeholder={t("guildGuessr.searchGuild")}
                emptyLabel={t("guildGuessr.noGuilds")}
                onSelect={submitGuess}
              />
            </>
          ) : (
            <div className="text-center" role="status">
              <p className={`text-xl font-black ${status === "won" ? "text-emerald-300" : "text-red-300"}`}>{status === "won" ? t("common.youWon") : t("common.gameOver")}</p>
              <p className="mt-2 text-sm text-slate-400">{t("guildGuessr.answerWas")}</p>
              <FunGuildIdentity guild={target} crestSize={48} className="mt-3 justify-center" />
            </div>
          )}
          <div className="mt-4 border-t border-white/10 pt-3">
            <h2 className="font-black">{t("guildGuessr.clues")}</h2>
            <ProgressiveClues items={clueItems} revealed={guesses.length} />
          </div>
      </aside>
    </section>
  );
}

function Neighbor({ neighbor }: { neighbor: GuildGuessrRound["neighbors"][number] }) {
  const t = useTranslations("fun");
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-lg border border-white/10 bg-slate-950/55 p-3">
      <div className="min-w-0 flex-1"><FunGuildIdentity guild={neighbor.guild} crestSize={40} /><p className="mt-1 text-xs text-blue-200">{t("guildGuessr.sharedCharacters", { count: neighbor.sharedCharacters })}</p><p className="text-xs text-slate-400">{t("guildGuessr.sharedRaids", { count: neighbor.sharedRaids.length })}</p></div>
    </div>
  );
}

function formatHour(hour: number) {
  const whole = Math.floor(hour).toString().padStart(2, "0");
  return `${whole}:${hour % 1 === 0 ? "00" : "30"}`;
}
