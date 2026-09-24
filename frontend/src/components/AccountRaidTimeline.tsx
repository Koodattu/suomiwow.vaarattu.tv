"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { FiArrowLeft, FiArrowRight, FiClock } from "react-icons/fi";
import type { CharacterAccountResponse } from "@/types";
import { buildAccountTimeline, getActivityPosition, type TimelineSegment } from "@/lib/account-raid-timeline";
import { formatRealmName, formatSpecName, getClassInfoById, getSpecIconUrl } from "@/lib/utils";
import IconImage from "@/components/IconImage";

interface Props {
  account: CharacterAccountResponse;
  getClassColor: (className: string) => string;
}

export default function AccountRaidTimeline({ account, getClassColor }: Props) {
  const t = useTranslations("accountProfile.timeline");
  const locale = useLocale();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const timeline = buildAccountTimeline(account.raidTimeline ?? [], account.characters[0]?.region ?? "eu");
  const activeCount = timeline.filter((segment) => segment.type === "raid").length;
  const hasGaps = timeline.some((segment) => segment.type === "gap");
  const segments: TimelineSegment[] = expanded
    ? timeline.flatMap((segment) => segment.type === "gap" ? segment.raids.map((raid) => ({ type: "raid" as const, raid })) : [segment])
    : timeline;
  const date = (value: number | string | null) => value === null ? t("unknownDate") : new Intl.DateTimeFormat(locale, { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(value));
  const exactDate = (value: string) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(value));

  return (
    <section aria-labelledby="account-timeline-title" className="overflow-hidden rounded-xl border border-gray-700 bg-gray-900 shadow-lg shadow-black/10">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-800 bg-gradient-to-r from-sky-950/40 to-gray-900 p-5">
        <div>
          <div className="flex items-center gap-2.5">
            <FiClock className="text-sky-400" aria-hidden="true" />
            <h2 id="account-timeline-title" className="text-lg font-semibold text-white">{t("title")}</h2>
            <span className="rounded-full border border-sky-400/20 bg-sky-400/10 px-2.5 py-0.5 text-xs font-medium text-sky-200">{t("activeRaids", { count: activeCount })}</span>
          </div>
          <p className="mt-1.5 max-w-xl text-sm text-gray-400">{t("description")}</p>
        </div>
        {activeCount > 0 && (
          <div className="flex items-center gap-2">
            {hasGaps && <button type="button" aria-pressed={expanded} onClick={() => setExpanded(!expanded)} className="rounded-md border border-gray-700 px-3 py-2 text-xs font-medium text-gray-300 transition hover:border-gray-500 hover:text-white focus-visible:outline-2 focus-visible:outline-sky-400">{t(expanded ? "compress" : "expand")}</button>}
            <button type="button" aria-label={t("earlier")} onClick={() => scrollRef.current?.scrollBy({ left: -340, behavior: "smooth" })} className="rounded-md border border-gray-700 p-2 text-gray-300 hover:bg-gray-800 focus-visible:outline-2 focus-visible:outline-sky-400"><FiArrowLeft aria-hidden="true" /></button>
            <button type="button" aria-label={t("later")} onClick={() => scrollRef.current?.scrollBy({ left: 340, behavior: "smooth" })} className="rounded-md border border-gray-700 p-2 text-gray-300 hover:bg-gray-800 focus-visible:outline-2 focus-visible:outline-sky-400"><FiArrowRight aria-hidden="true" /></button>
          </div>
        )}
      </div>

      {activeCount === 0 ? <p className="p-8 text-center text-sm text-gray-400">{t("empty")}</p> : (
        <>
          <div ref={scrollRef} role="region" aria-label={t("title")} tabIndex={0} className="relative overflow-x-auto overscroll-x-contain focus-visible:outline-2 focus-visible:outline-sky-400">
            <table className="w-max min-w-full table-fixed border-separate border-spacing-0 text-left">
              <thead>
                <tr>
                  <th scope="col" className="sticky left-0 z-20 w-36 min-w-36 border-b border-r border-gray-800 bg-gray-900 px-4 py-5 align-bottom text-xs font-medium text-gray-500 sm:w-44 sm:min-w-44">{t("characters")}</th>
                  {segments.map((segment) => segment.type === "gap" ? (
                    <th key={`gap-${segment.raids[0].id}`} scope="col" title={segment.raids.map((raid) => raid.name).join("\n")} className="w-24 min-w-24 max-w-24 border-b border-r border-dashed border-gray-800 bg-gray-950/40 px-2 py-5 text-center align-bottom">
                      <span aria-hidden="true" className="mb-3 block text-xl tracking-[0.3em] text-gray-600">···</span>
                      <span className="block text-xs font-normal text-gray-500">{t("gap", { count: segment.raids.length })}</span>
                    </th>
                  ) : (
                    <th key={segment.raid.id} scope="col" className="w-72 min-w-72 max-w-72 border-b border-r border-gray-800 bg-gray-900/70 px-4 py-4 align-top">
                      <div className="mb-3 flex items-center gap-2 text-[10px] font-medium uppercase tracking-widest text-gray-500"><span className="h-1.5 w-1.5 rounded-full bg-sky-400" />{segment.raid.expansion}</div>
                      <div className="flex items-center gap-2.5">
                        <IconImage iconFilename={segment.raid.iconUrl} alt="" width={32} height={32} className="shrink-0 rounded-md" />
                        <span className="text-sm font-semibold text-gray-100">{segment.raid.name}</span>
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-2 text-[11px] font-normal tabular-nums text-gray-500"><span>{date(segment.raid.start)}</span><span className="h-px flex-1 bg-gray-700" /><span>{segment.raid.end === null ? t("openEnd") : date(segment.raid.end)}</span></div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {account.characters.map((character) => {
                  const classInfo = getClassInfoById(character.classID);
                  const color = getClassColor(classInfo.name);
                  return (
                    <tr key={character.characterId} className="group">
                      <th scope="row" className="sticky left-0 z-10 border-b border-r border-gray-800 bg-gray-900 px-3 py-4 group-hover:bg-gray-800">
                        <Link href={`/characters/${encodeURIComponent(character.realm)}/${encodeURIComponent(character.name)}?class=${character.classID}`} className="flex w-28 items-center gap-2 rounded focus-visible:outline-2 focus-visible:outline-sky-400 sm:w-36">
                          <IconImage iconFilename={classInfo.iconUrl} alt="" width={26} height={26} className="shrink-0 rounded" />
                          <span className="min-w-0"><span className="block truncate text-sm font-semibold" style={{ color }}>{character.name}</span><span className="block truncate text-[10px] font-normal text-gray-500">{formatRealmName(character.realm)}</span></span>
                        </Link>
                      </th>
                      {segments.map((segment) => {
                        if (segment.type === "gap") return <td key={`gap-${segment.raids[0].id}`} className="border-b border-r border-dashed border-gray-800 bg-gray-950/40 text-center text-gray-700"><span aria-hidden="true">/ /</span><span className="sr-only">{t("noActivity")}</span></td>;
                        const activity = segment.raid.characters.find((entry) => entry.characterId === character.characterId);
                        if (!activity) return <td key={segment.raid.id} className="border-b border-r border-gray-800/70 px-4 text-center text-gray-700"><span aria-hidden="true">—</span><span className="sr-only">{t("noActivity")}</span></td>;
                        const position = getActivityPosition(segment.raid, activity.firstSeenAt, activity.lastSeenAt);
                        return (
                          <td key={segment.raid.id} className="border-b border-r border-gray-800/70 px-4 py-4 align-top group-hover:bg-gray-800/25">
                            <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1.5">
                              {activity.specs.length ? activity.specs.map((spec) => <span key={spec} className="inline-flex items-center gap-1.5 text-xs text-gray-300"><IconImage iconFilename={getSpecIconUrl(character.classID, spec)} alt="" width={18} height={18} className="rounded" />{formatSpecName(spec)}</span>) : <span className="text-xs text-gray-500">{t("unknownSpec")}</span>}
                            </div>
                            {position ? <div title={`${exactDate(activity.firstSeenAt)} – ${exactDate(activity.lastSeenAt)}`} className="relative mb-2 h-1.5 rounded-full bg-gray-800"><span className="absolute h-full min-w-1 rounded-full" style={{ left: `min(${position.left}%, calc(100% - 4px))`, width: `${position.width}%`, maxWidth: `calc(100% - ${position.left}%)`, backgroundColor: color, boxShadow: `0 0 10px ${color}30` }} /></div> : <p className="mb-2 text-[10px] text-gray-500">{t("outsideWindow")}</p>}
                            <div className="flex justify-between gap-2 text-[10px] tabular-nums text-gray-500"><span>{exactDate(activity.firstSeenAt)} – {exactDate(activity.lastSeenAt)}</span><span className="shrink-0">{t("reports", { count: activity.reportCount })}</span></div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="flex items-start gap-2 px-5 py-3 text-xs leading-relaxed text-gray-500"><span aria-hidden="true" className="mt-1.5 h-1 w-5 shrink-0 rounded-full bg-sky-400/70" />{t("legend")}</p>
        </>
      )}
    </section>
  );
}
