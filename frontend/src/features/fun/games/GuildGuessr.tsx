"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { formatRealmName } from "@/lib/utils";
import type { FunGuild, GuildGuessrRound } from "@/types";
import FunAutocomplete from "../FunAutocomplete";
import { FunRaidIdentity } from "../FunEncounterIdentity";
import FunGuildIdentity, { FunGuildCrest } from "../FunGuildIdentity";
import ProgressiveClues from "../ProgressiveClues";
import { useDebouncedFunGameSearch } from "../useFunGameSearch";
import FunOutcome from "../FunOutcome";
import styles from "../fun-feedback.module.css";

type GuessFeedback = {
  guild: FunGuild;
  sameRealm: boolean;
  sharedCharacters: number;
};

export default function GuildGuessr({ round }: { round: GuildGuessrRound }) {
  const t = useTranslations("fun");
  const target = round.solution.target;
  const [query, setQuery] = useState("");
  const [guesses, setGuesses] = useState<GuessFeedback[]>([]);
  const [status, setStatus] = useState<"playing" | "won">("playing");

  const search = useDebouncedFunGameSearch("guild-guessr", query);
  const guessedIds = new Set(guesses.map((guess) => guess.guild.id));
  const availableGuilds = search.candidates.filter((guild) => !guessedIds.has(guild.id));
  const emptyLabel = search.trimmedQuery.length < 2
    ? t("common.typeTwoCharacters")
    : search.isSearching
      ? t("common.searching")
      : search.isError
        ? t("common.searchFailed")
        : t("guildGuessr.noGuilds");

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
  };

  const schedule = target.raidSchedule?.days
    .map((day) => `${t(`days.${day.day.toLocaleLowerCase("en-US")}`)} ${formatHour(day.startHour)}–${formatHour(day.endHour)}`)
    .join(", ");
  const clueItems = [
    { label: t("guildGuessr.realm"), content: formatRealmName(target.realm) },
    { label: t("guildGuessr.raids"), content: <span className="grid gap-2">{target.trackedRaids.map((raid) => <FunRaidIdentity key={raid.id} raid={raid} iconSize={28} compact />)}</span> },
    { label: t("guildGuessr.schedule"), content: schedule || t("guildGuessr.noSchedule") },
    {
      label: t("guildGuessr.crest"),
      content: <span className="inline-flex items-center gap-2"><FunGuildCrest crest={target.crest} faction={target.faction} size={42} />{target.faction || t("guildGuessr.unknownFaction")}</span>,
    },
  ];

  return (
    <section className="mt-5">
      <div className="grid gap-3 border-y border-white/10 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(17rem,24rem)] sm:items-center">
        {status === "playing" ? (
          <div className="flex items-center justify-between gap-3 text-sm">
            <label className="font-bold">{t("guildGuessr.chooseGuild")}</label>
            <span className="text-slate-400 tabular-nums">{t("common.mistakes", { count: guesses.length })}</span>
          </div>
        ) : (
          <FunOutcome status={status} className="sm:col-span-2">
            <span className="block text-slate-400">{t("common.mistakes", { count: guesses.length })}</span>
            <span className="mt-1 block text-slate-400">{t("guildGuessr.answerWas")}</span>
            <FunGuildIdentity guild={target} crestSize={34} className="mt-2" />
          </FunOutcome>
        )}
        {status === "playing" ? (
          <div className="sm:row-start-1 sm:col-start-2">
            <FunAutocomplete
              items={availableGuilds}
              getKey={(guild) => guild.id}
              getLabel={(guild) => guild.name}
              getSearchText={(guild) => `${guild.name} ${guild.realm}`}
              renderOption={(guild) => <FunGuildIdentity guild={guild} crestSize={32} />}
              placeholder={t("guildGuessr.searchGuild")}
              emptyLabel={emptyLabel}
              loading={search.isSearching}
              filterItems={false}
              autoFocus
              onSelect={submitGuess}
              onQueryChange={setQuery}
            />
          </div>
        ) : null}
      </div>

      <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_19rem]">
      <div className="min-w-0">
        <div className="border-y border-white/10 py-4">
        <div className="mx-auto grid max-w-3xl gap-3 sm:grid-cols-[minmax(0,1fr)_9rem_minmax(0,1fr)] sm:items-center">
          <div className="min-w-0 space-y-3">
            {round.neighbors.slice(0, 2).map((neighbor) => <Neighbor key={neighbor.guild.id} neighbor={neighbor} side="left" />)}
          </div>
          <div className={`${styles.softPulse} grid min-h-32 place-items-center rounded-xl border-2 border-dashed border-blue-300/35 bg-blue-950/35 text-center`}>
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
            <div key={guess.guild.id} className={`${styles.bad} grid gap-2 rounded-lg border border-red-400/20 bg-red-950/20 px-4 py-3 text-sm sm:grid-cols-[minmax(12rem,1fr)_auto_auto] sm:items-center`}>
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

      <aside className="h-fit border-t border-white/10 pt-4 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
          <div>
            <h2 className="font-black">{t("guildGuessr.clues")}</h2>
            {guesses.length === 0 ? <p className="mt-1 text-xs leading-5 text-slate-400">{t("guildGuessr.cluesPending")}</p> : null}
            <ProgressiveClues items={clueItems} revealed={guesses.length} />
          </div>
      </aside>
      </div>
    </section>
  );
}

function Neighbor({ neighbor, side = "right" }: { neighbor: GuildGuessrRound["neighbors"][number]; side?: "left" | "right" }) {
  const t = useTranslations("fun");
  return (
    <div className={`flex min-w-0 items-center gap-3 py-4 ${side === "left" ? "sm:flex-row-reverse" : ""}`}>
      <FunGuildCrest crest={neighbor.guild.crest} faction={neighbor.guild.faction} size={48} />
      <div className={`min-w-0 flex-1 ${side === "left" ? "sm:text-right" : "text-left"}`}>
        <p className="text-balance font-bold leading-tight">{neighbor.guild.name}</p>
        <p className="mt-1 text-xs text-slate-400">{formatRealmName(neighbor.guild.realm)}</p>
        <p className="mt-2 text-xs font-semibold text-blue-200">{t("guildGuessr.sharedCharacters", { count: neighbor.sharedCharacters })}</p>
        <p className="mt-0.5 text-xs text-slate-400">{t("guildGuessr.sharedRaids", { count: neighbor.sharedRaids.length })}</p>
      </div>
    </div>
  );
}

function formatHour(hour: number) {
  const whole = Math.floor(hour).toString().padStart(2, "0");
  return `${whole}:${hour % 1 === 0 ? "00" : "30"}`;
}
