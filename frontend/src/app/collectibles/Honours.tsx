"use client";

import { useEffect, useRef, useState, type Dispatch } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { LuBell, LuCrown, LuLock, LuLocateFixed, LuSparkles } from "react-icons/lu";
import type { FigurineCollection, FigurineRecords, MachineItem } from "@/lib/figurine-collection";
import { bestQuality, fishOf } from "@/lib/figurine-collection";
import { findFigure } from "@/lib/figurine-series";
import { HONOUR_GROUPS, PREVIEW_FEED, PREVIEW_HONOURS, previewRankings, type PreviewAction, type PreviewState, type RankMetric } from "@/lib/figurine-community-preview";
import { playFigurineCue } from "@/lib/figurine-audio";
import { Empty, HeaderExtra } from "./FacilityParts";
import Portrait from "./Portrait";
import frame from "./facility-overlay.module.css";
import styles from "./honours.module.css";

const SOURCES = { box: "fromBox", forge: "fromForge", wheel: "fromWheel", pond: "fromPond" } as const;

// Latest pulls: the town's last twenty golden and galaxy finds beside the player's own, all at once.
export function Feed({ preview, dispatch, records, now }: { preview: PreviewState; dispatch: Dispatch<PreviewAction>; records: FigurineRecords; now: Date }) {
  const t = useTranslations("figurineLab.world.overlays.feed"), common = useTranslations("figurineLab"), format = useFormatter();
  return <div className={styles.feed}>
    <section className={styles.town}>
      <h3>{t("all")}</h3>
      <ol className={`${styles.finds} ${frame.scroll}`}>{PREVIEW_FEED.map(entry => {
        const cheered = preview.cheers.includes(entry.id);
        return <li key={entry.id} className={styles.find} data-quality={entry.item.quality}>
          <span className={styles.thumb}><Portrait figureKey={entry.item.key} quality={entry.item.quality} /></span>
          <div className={styles.findText}>
            <b>{findFigure(entry.item.key)?.character.name}</b>
            <small><em>{entry.collector}</em> · {common(`world.feed.${entry.source}`)} · {entry.minutes < 60 ? t("minutes", { count: entry.minutes }) : t("hours", { count: Math.round(entry.minutes / 60) })}</small>
          </div>
          <button type="button" className={styles.cheer} aria-pressed={cheered} aria-label={t("cheer")} title={t("cheer")} onClick={() => dispatch({ type: "cheer", id: entry.id })}><LuBell aria-hidden="true" /><b>{entry.cheers + Number(cheered)}</b></button>
        </li>;
      })}</ol>
    </section>
    <section className={styles.mine}>
      <h3>{t("mine")}</h3>
      {records.feed.length ? <ul className={`${styles.own} ${frame.scroll}`}>{records.feed.map((pull, index) => <li key={`${pull.at}-${index}`} className={styles.find} data-quality={pull.quality}>
        <span className={styles.thumb}><Portrait figureKey={pull.key} quality={pull.quality} /></span>
        <div className={styles.findText}><b>{findFigure(pull.key)?.character.name}</b><small>{common(`world.feed.${SOURCES[pull.source]}`)} · {format.relativeTime(new Date(pull.at), now)}</small></div>
      </li>)}</ul> : <Empty icon={<LuSparkles />} text={common("world.feed.empty")} />}
    </section>
  </div>;
}

// The hall of fame: a wall of plaques, one for every first and record, grouped by what they are for.
export function Fame() {
  const t = useTranslations("figurineLab.world.overlays.fame"), format = useFormatter();
  const taken = PREVIEW_HONOURS.filter(honour => honour.collector).length;
  return <>
    <HeaderExtra><span className={styles.tally}><LuCrown aria-hidden="true" />{taken}/{PREVIEW_HONOURS.length}</span></HeaderExtra>
    <div className={`${styles.hall} ${frame.scroll}`}>{HONOUR_GROUPS.map(group => <section key={group}>
      <h3>{t(`groups.${group}`)}</h3>
      <div className={styles.wall}>{PREVIEW_HONOURS.filter(honour => honour.group === group).map(honour => <article key={honour.id} className={styles.plaque} data-vacant={!honour.collector || undefined} data-quality={honour.item?.quality}>
        <span className={styles.plaquePicture}>{!honour.collector ? <LuLock aria-hidden="true" />
          // eslint-disable-next-line @next/next/no-img-element -- small baked cards, served as they are
          : honour.fish ? <img src={`/figurines/world/fish/${honour.fish}.webp`} alt={fishOf(honour.fish)?.name ?? ""} draggable={false} />
            : honour.item && <Portrait figureKey={honour.item.key} quality={honour.item.quality} />}</span>
        <div>
          <h4>{t(`items.${honour.id}`)}</h4>
          {honour.collector ? <><b>{honour.collector}</b><small>{honour.detail ? `${honour.detail} · ` : ""}<time dateTime={honour.date!}>{format.dateTime(new Date(honour.date!), { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" })}</time></small></> : <small>{t("waiting")}</small>}
        </div>
      </article>)}</div>
    </section>)}</div>
  </>;
}

type Row = { name: string; avatar: MachineItem | null; value: number; you?: true };
// Leaderboards: a measure to rank by, the top three on the podium, and everyone else in a list that
// scrolls. The player is in it at their true place, and a bar under the list always says where.
export function Rankings({ collection, records }: { collection: FigurineCollection; records: FigurineRecords }) {
  const t = useTranslations("figurineLab.world.overlays.ranks"), common = useTranslations("figurineLab.world.leaderboard"), format = useFormatter();
  const [metric, setMetric] = useState<RankMetric>("unique");
  const owned = Object.values(collection), countOf = (measure: RankMetric) => measure === "unique" ? owned.length : measure === "opened" ? records.stats.opened : owned.filter(item => item[measure]).length;
  const mine = countOf(metric);
  // The player's picture: their first favourite, else the first figure they own.
  const faceKey = records.favorites[0]?.key ?? Object.keys(collection)[0];
  const face: MachineItem | null = faceKey && collection[faceKey] ? { key: faceKey, quality: bestQuality(collection[faceKey]) ?? "standard" } : null;
  const others: Row[] = previewRankings(metric).map(collector => ({ name: collector.name, avatar: collector.avatar, value: collector[metric] }));
  // Ties go ahead of the player.
  const place = others.filter(row => row.value >= mine).length;
  const rows = [...others.slice(0, place), { name: t("you"), avatar: face, value: mine, you: true as const }, ...others.slice(place)];
  const rank = rows.findIndex(row => row.you) + 1;
  const list = useRef<HTMLOListElement>(null), you = useRef<HTMLLIElement>(null);
  useEffect(() => { list.current?.scrollTo({ top: 0 }); }, [metric]);
  const pick = (measure: RankMetric) => { if (measure !== metric) { playFigurineCue("pick"); setMetric(measure); } };
  const jump = () => { playFigurineCue("pick"); you.current?.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); };
  const face3 = (row: Row) => row.avatar ? <Portrait figureKey={row.avatar.key} quality={row.avatar.quality} /> : <span className={styles.noFace} />;
  return <div className={styles.ranks}>
    <div className={styles.metrics}>{(["unique", "galaxy", "golden", "opened"] as const).map(measure => <button key={measure} type="button" aria-pressed={measure === metric} data-metric={measure} onClick={() => pick(measure)}><small>{common(`items.${measure}`)}</small><b>{format.number(countOf(measure))}</b></button>)}</div>
    <div className={styles.podium} key={metric}>{[rows[1], rows[0], rows[2]].map((row, index) => {
      const place = [2, 1, 3][index];
      return <article key={place} data-place={place} data-you={row.you}>
        <span className={styles.podiumFace}>{face3(row)}</span>
        <b>{row.name}</b>
        <div className={styles.step}>{place === 1 ? <LuCrown aria-label="1" /> : <span>{place}</span>}<strong>{format.number(row.value)}</strong></div>
      </article>;
    })}</div>
    <div className={styles.standings}>
      <ol ref={list} className={`${styles.rankList} ${frame.scroll}`} start={4}>{rows.slice(3).map((row, index) => <li key={row.you ? "you" : row.name} ref={row.you ? you : undefined} data-you={row.you}>
        <span className={styles.rank}>{index + 4}</span><span className={styles.rankFace}>{face3(row)}</span><b>{row.name}</b><strong>{format.number(row.value)}</strong>
      </li>)}</ol>
      <button type="button" className={styles.youBar} onClick={jump} disabled={rank <= 3}>
        <span className={styles.rank}>{rank}</span><span className={styles.rankFace}>{face3(rows[rank - 1])}</span><b>{t("you")}</b><small>{t("of", { total: rows.length })}</small><strong>{format.number(mine)}</strong>{rank > 3 && <LuLocateFixed aria-hidden="true" />}
      </button>
    </div>
  </div>;
}
