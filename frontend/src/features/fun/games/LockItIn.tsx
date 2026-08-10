"use client";

import { useMemo, useState } from "react";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useLocale, useTranslations } from "next-intl";
import type { FunGuild, LockItInRound } from "@/types";
import { FunBossIdentity, FunRaidIdentity } from "../FunEncounterIdentity";
import FunGuildIdentity from "../FunGuildIdentity";

export default function LockItIn({ round }: { round: LockItInRound }) {
  const t = useTranslations("fun");
  const locale = useLocale();
  const [placements, setPlacements] = useState<Array<FunGuild | null>>([null, null, null, null, null]);
  const [revealIndex, setRevealIndex] = useState(0);
  const [locked, setLocked] = useState(false);
  const complete = placements.every(Boolean);
  const current = round.revealOrder[revealIndex];
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const killDateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Helsinki" }),
    [locale],
  );

  const score = useMemo(() => {
    if (!locked) return 0;
    return placements.reduce((total, guild, index) => {
      if (!guild) return total;
      const actual = round.solution.ranking.findIndex((item) => item.guild.id === guild.id);
      if (actual === index) return total + 2;
      return Math.abs(actual - index) === 1 ? total + 1 : total;
    }, 0);
  }, [locked, placements, round.solution.ranking]);

  const place = (rankIndex: number) => {
    if (!current || placements[rankIndex]) return;
    const next = [...placements];
    next[rankIndex] = current;
    setPlacements(next);
    setRevealIndex((index) => index + 1);
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!complete || locked || !over || active.id === over.id) return;
    setPlacements((items) => {
      const oldIndex = items.findIndex((guild) => guild?.id === active.id);
      const newIndex = items.findIndex((guild) => guild?.id === over.id);
      return oldIndex < 0 || newIndex < 0 ? items : arrayMove(items, oldIndex, newIndex);
    });
  };

  return (
    <section className="mt-5">
      <div className="grid gap-3 border-y border-white/10 py-3 sm:grid-cols-[minmax(15rem,auto)_minmax(0,1fr)] sm:items-center">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <FunBossIdentity name={round.boss.name} iconUrl={round.boss.iconUrl} iconSize={40} />
          <FunRaidIdentity raid={round.raid} />
        </div>
        <div className="border-l-2 border-blue-400/40 pl-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-blue-300">{t(`lock.modes.${round.mode}.label`)}</p>
          <p className="mt-0.5 text-pretty text-sm leading-5 text-slate-300">{t(`lock.modes.${round.mode}.description`)}</p>
        </div>
      </div>

      {!locked ? <div className="flex min-h-16 items-center justify-between gap-3 border-b border-white/10 py-3" aria-live="polite">
        {!complete && current ? (
          <div className="flex min-w-0 items-center gap-3">
            <p className="shrink-0 text-xs font-bold text-blue-300 tabular-nums">{t("lock.currentGuild", { current: revealIndex + 1, total: round.revealOrder.length })}</p>
            <FunGuildIdentity guild={current} crestSize={38} />
          </div>
        ) : null}
        {complete && !locked ? (
          <button
            type="button"
            onClick={() => setLocked(true)}
            className="ml-auto min-h-10 rounded-md bg-blue-600 px-5 py-2 text-sm font-bold transition-[background-color,transform] hover:bg-blue-500 active:scale-[0.97] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300"
          >
            {t("lock.lockRanking")}
          </button>
        ) : null}
      </div> : null}

      <div className="mt-3">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={placements.flatMap((guild) => (guild ? [guild.id] : []))} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {placements.map((guild, index) =>
                guild ? (
                  <SortableGuildRow key={guild.id} guild={guild} rank={index + 1} disabled={!complete || locked} />
                ) : (
                  <button
                    key={`empty-${index}`}
                    type="button"
                    onClick={() => place(index)}
                    disabled={complete || !current}
                    className="group grid min-h-[4.5rem] w-full grid-cols-[3rem_1fr_auto] items-center rounded-lg border border-dashed border-blue-300/25 bg-slate-950/35 px-3 text-left transition-[background-color,border-color,transform] hover:border-blue-300/60 hover:bg-blue-950/35 active:scale-[0.98] disabled:cursor-not-allowed disabled:hover:border-blue-300/25 disabled:hover:bg-slate-950/35"
                  >
                    <span className="text-lg font-black text-blue-300">#{index + 1}</span>
                    <span className="font-semibold text-slate-400 transition-colors group-hover:text-blue-100">{t("lock.placeHere")}</span>
                    <span aria-hidden="true" className="grid size-10 place-items-center rounded-full bg-blue-400/10 text-xl text-blue-300 transition-[background-color,transform] group-hover:scale-110 group-hover:bg-blue-400/20">+</span>
                  </button>
                ),
              )}
            </div>
          </SortableContext>
        </DndContext>

        {locked ? (
          <div className="mt-4 rounded-xl bg-emerald-950/25 p-4 shadow-[inset_0_0_0_1px_rgb(110_231_183/0.2)]" role="status">
            <div className="text-center">
              <p className="text-xs font-bold uppercase tracking-wider text-blue-300">{t(`lock.modes.${round.mode}.label`)}</p>
              <p className="text-xl font-black text-emerald-300 tabular-nums">{t("lock.score", { score, total: 10 })}</p>
              <p className="mt-1 text-sm text-slate-400">{t("lock.scoreRules")}</p>
            </div>
            <ol className="mt-5 space-y-2">
              {round.solution.ranking.map((item, index) => (
                <li key={item.guild.id} className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-2 rounded-md bg-slate-950/45 px-3 py-2.5 text-sm">
                  <span className="font-black text-blue-300">#{index + 1}</span>
                  <FunGuildIdentity guild={item.guild} crestSize={34} />
                  <span className="text-right text-xs text-slate-400 tabular-nums sm:text-sm">
                    {round.mode === "pulls"
                      ? t("lock.pulls", { count: item.pullCount })
                      : item.killedAt
                        ? t("lock.killedAt", { date: killDateFormatter.format(new Date(item.killedAt)) })
                        : "—"}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function SortableGuildRow({ guild, rank, disabled }: { guild: FunGuild; rank: number; disabled: boolean }) {
  const t = useTranslations("fun");
  const { attributes, listeners, setActivatorNodeRef, setNodeRef, transform, transition, isDragging } = useSortable({ id: guild.id, disabled });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 10 : undefined }}
      className={`grid min-h-20 grid-cols-[3rem_minmax(0,1fr)_3rem] items-center rounded-lg bg-slate-900/80 px-3 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.1)] ${isDragging ? "relative scale-[1.015] bg-slate-800 shadow-xl" : ""}`}
    >
      <span className="text-lg font-black text-blue-300">#{rank}</span>
      <FunGuildIdentity guild={guild} crestSize={40} />
      {!disabled ? (
        <button
          ref={setActivatorNodeRef}
          type="button"
          {...attributes}
          {...listeners}
          className="grid size-11 cursor-grab touch-none place-items-center rounded-md text-slate-400 transition-[background-color,color,transform] hover:bg-white/5 hover:text-white active:scale-[0.96] active:cursor-grabbing focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300"
          aria-label={t("lock.dragGuild", { guild: guild.name })}
        >
          <svg aria-hidden="true" className="size-5" viewBox="0 0 20 20" fill="currentColor">
            <circle cx="6" cy="4" r="1.5" /><circle cx="14" cy="4" r="1.5" />
            <circle cx="6" cy="10" r="1.5" /><circle cx="14" cy="10" r="1.5" />
            <circle cx="6" cy="16" r="1.5" /><circle cx="14" cy="16" r="1.5" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}
