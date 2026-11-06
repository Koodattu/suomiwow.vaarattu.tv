"use client";

import Link from "next/link";
import { useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useAuth } from "@/context/AuthContext";
import { foreverApi, foreverCharacterPath, foreverHistory, formatForeverDate, type ForeverCharacter } from "@/lib/forever-api";
import { classColor, ForeverDate, ForeverErrorMessage } from "./ForeverShared";
import styles from "./forever.module.css";

export function useForeverCharacter(identity: string) {
  return useQuery({ queryKey: ["forever", "character", identity], queryFn: () => foreverApi<ForeverCharacter>(`forever/characters/${encodeURIComponent(identity)}`), staleTime: 60_000, refetchInterval: 60_000 });
}

function ProgressChart({ character }: { character: ForeverCharacter }) {
  const t = useTranslations("forever");
  const points = foreverHistory(character.history), last = points.at(-1);
  const date = (timestamp: number) => formatForeverDate(new Date(timestamp).toISOString(), true);
  return <div className={styles.progressChart}>
    <div className={styles.chartHeading}><h3>{t("progress.title")}</h3><span>{t("progress.observationCount", { count: points.length })}</span></div>
    {!last ? <div className={styles.chartEmpty}>{t("progress.noObservations")}</div> : <>
      <div className={styles.levelChart}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 12, right: 18, bottom: 4, left: 0 }} aria-label={t("progress.chartLabel", { name: character.name || character.slug })}>
            <CartesianGrid strokeDasharray="3 4" stroke="#afc2a625" vertical={false} />
            <XAxis dataKey="timestamp" type="number" scale="time" domain={["dataMin", "dataMax"]} padding={{ left: 12, right: 12 }} tickCount={4} minTickGap={70} tickFormatter={date} tick={{ fill: "#aaa898", fontSize: 10 }} tickLine={false} stroke="#494f40" />
            <YAxis domain={[1, 60]} ticks={[1, 20, 40, 60]} width={30} tick={{ fill: "#aaa898", fontSize: 11 }} tickLine={false} axisLine={false} />
            <Tooltip cursor={{ stroke: "#d7b87580", strokeDasharray: "3 4" }} content={({ active, payload }) => {
              const point = payload?.[0]?.payload as (typeof points)[number] | undefined;
              return active && point ? <div className={styles.chartTooltip} role="status"><strong>{t("levelValue", { level: point.level })}</strong><span>{formatForeverDate(new Date(point.timestamp).toISOString())}</span></div> : null;
            }} />
            <Line type="linear" dataKey="level" stroke={classColor(character.className)} strokeWidth={2.5} dot={{ r: 4, stroke: "#151c17", strokeWidth: 2 }} activeDot={{ r: 6, stroke: "#f4dfa9", strokeWidth: 2 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      {points.length === 1 && <p className={styles.chartNote}>{t("progress.firstObservation")}</p>}
    </>}
    <p className={styles.chartNote}>{t("historyNote")}</p>
    {points.length > 0 && <details className={styles.observationTable}><summary>{t("progress.allObservations")}</summary><div className={styles.tableScroll}><table><thead><tr><th scope="col">{t("level")}</th><th scope="col">{t("progress.observedAt")}</th></tr></thead><tbody>{[...points].reverse().map((point, index) => <tr key={`${point.timestamp}-${index}`}><td>{point.level}</td><td>{formatForeverDate(new Date(point.timestamp).toISOString())}</td></tr>)}</tbody></table></div></details>}
  </div>;
}

export function CharacterDetails({ character, showCharacterLink = true }: { character: ForeverCharacter; showCharacterLink?: boolean }) {
  const t = useTranslations("forever"), { user } = useAuth();
  const [busy, setBusy] = useState(false), [queued, setQueued] = useState(false), [error, setError] = useState<unknown>(null);
  const points = foreverHistory(character.history), first = points[0], last = points.at(-1);
  const gained = first && last ? last.level - first.level : null;
  return <div className={styles.characterDetails}>
    <ProgressChart character={character} />
    <aside className={styles.progressAside}>
      <div className={styles.progressStats}>
        <div><strong>{gained === null ? "—" : `+${gained}`}</strong><span>{t("progress.levelsObserved")}</span></div>
        <div><strong>{character.level == null ? "—" : Math.max(0, 60 - character.level)}</strong><span>{t("progress.toGo")}</span></div>
      </div>
      <dl className={styles.progressFacts}>
        <div><dt>{t("progress.firstSeen")}</dt><dd><ForeverDate value={first ? new Date(first.timestamp).toISOString() : undefined} compact /></dd></div>
        <div><dt>{t("sourceUpdated")}</dt><dd><ForeverDate value={character.sourceUpdatedAt} compact /></dd></div>
      </dl>
      {character.errorCode && <p className={styles.chartNote}>{t("retrying")}</p>}
      <div className={styles.progressActions}>
        <a className={styles.button} href={character.armoryUrl} target="_blank" rel="noreferrer">{t("openArmory")}</a>
        {showCharacterLink && <Link className={styles.detailLink} href={foreverCharacterPath(character)}>{t("progress.characterLink")} ↗</Link>}
        {user && <button className={styles.detailLink} disabled={busy || queued || !!character.errorCode} onClick={async () => {
          setBusy(true); setError(null);
          try { await foreverApi(`forever/characters/${character._id}/refresh`, "POST"); setQueued(true); }
          catch (caught) { setError(caught); } finally { setBusy(false); }
        }}>{t(queued ? "refreshQueued" : "refresh")}</button>}
      </div>
      {error != null && <ForeverErrorMessage error={error} />}
    </aside>
  </div>;
}

export function CharacterDetailsLoader({ identity }: { identity: string }) {
  const t = useTranslations("forever"), query = useForeverCharacter(identity);
  if (query.isPending) return <div className={styles.detailsLoading} role="status">{t("loading")}</div>;
  if (query.error) return <div className={styles.detailsLoading}><ForeverErrorMessage error={query.error} /><button className={styles.button} onClick={() => void query.refetch()}>{t("progress.tryAgain")}</button></div>;
  return query.data ? <CharacterDetails character={query.data} /> : null;
}
