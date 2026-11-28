"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { FiSearch } from "react-icons/fi";
import { foreverApi, foreverCharacterPath } from "@/lib/forever-api";
import { CharacterForm, ForeverErrorMessage } from "./ForeverShared";
import styles from "./hub.module.css";
import world from "./forever.module.css";

type Results = {
  characters: { name: string; slug: string; level: number }[];
  guilds: { name: string; _id: string; region: string }[];
};

export default function ForeverHubSearch() {
  const t = useTranslations("forever");
  const [input, setInput] = useState(""), [term, setTerm] = useState("");
  const trimmed = input.trim();
  useEffect(() => {
    const timer = setTimeout(() => setTerm(trimmed), 200);
    return () => clearTimeout(timer);
  }, [trimmed]);
  const ready = Boolean(trimmed) && trimmed === term;
  const query = useQuery({
    queryKey: ["forever", "hub-search", term],
    queryFn: ({ signal }) => foreverApi<Results>(`forever/hub/search?q=${encodeURIComponent(term)}`, "GET", undefined, signal),
    enabled: ready, staleTime: 15_000,
  });
  const data = ready ? query.data : undefined;
  const empty = data && !data.characters.length && !data.guilds.length;
  return <section className={styles.search} aria-label={t("hub.search")}>
    <label htmlFor="forever-search" className="sr-only">{t("hub.search")}</label>
    <div className={styles.field}><FiSearch aria-hidden="true" />
      <input id="forever-search" type="search" autoComplete="off" maxLength={100} value={input}
        placeholder={t("hub.placeholder")} onChange={event => setInput(event.target.value)} />
    </div>
    {trimmed && <div className={styles.results}>
      <p role="status" className={data && !empty ? "sr-only" : undefined}>{data
        ? empty ? t("hub.noMatches") : t("hub.matchCount", { count: data.characters.length + data.guilds.length })
        : ready && query.isError ? "" : t("loading")}</p>
      {ready && query.isError && !data && <><ForeverErrorMessage error={query.error} />
        <button type="button" className={world.button} onClick={() => void query.refetch()}>{t("progress.tryAgain")}</button></>}
      {empty && <CharacterForm compact />}
      {data && !empty && <ul>{data.characters.map(character =>
        <li key={character.slug}><Link href={foreverCharacterPath(character.slug)}>
          <strong>{character.name}</strong><span>{t("character")} · {t("levelValue", { level: character.level })}</span>
        </Link></li>)}{data.guilds.map(guild =>
        <li key={guild._id}><Link href={`/forever/guilds/${encodeURIComponent(guild._id)}`}>
          <strong>{guild.name}</strong><span>{t("guild")} · {t(guild.region === "eu" ? "eu" : "us")}</span>
        </Link></li>)}</ul>}
    </div>}
  </section>;
}
