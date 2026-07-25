"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import PackBoosterVisual, { getPackTheme } from "@/components/ccg/PackBoosterVisual";
import packStyles from "@/components/ccg/pack-opening.module.css";
import type { CcgAdminSetStatus } from "@/types";

const fieldClass = "min-h-10 w-full rounded-md border border-white/10 bg-gray-950/75 px-3 text-sm text-white outline-none transition-colors focus:border-cyan-400/70 focus:ring-2 focus:ring-cyan-400/15";

export default function CcgPackStudio({ sets }: { sets: CcgAdminSetStatus[] }) {
  const t = useTranslations("admin.ccg.packStudio");
  const [selectedZoneId, setSelectedZoneId] = useState(() => sets.find((set) => set.availability === "enabled")?.zoneId ?? sets[0]?.zoneId ?? 0);
  const selectedSet = useMemo(() => sets.find((set) => set.zoneId === selectedZoneId) ?? sets[0] ?? null, [selectedZoneId, sets]);
  const [artOffsetX, setArtOffsetX] = useState(selectedSet?.packArtOffsetX ?? 50);

  useEffect(() => {
    setArtOffsetX(selectedSet?.packArtOffsetX ?? 50);
  }, [selectedSet?.zoneId, selectedSet?.packArtOffsetX]);

  const previewSet = selectedSet ? { ...selectedSet, packArtOffsetX: artOffsetX } : undefined;
  const theme = getPackTheme(previewSet);

  return (
    <section className="grid min-h-[42rem] overflow-hidden rounded-lg bg-gray-900/65 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)] xl:grid-cols-[22rem_minmax(34rem,1fr)]" aria-labelledby="ccg-pack-studio-title">
      <div className="flex min-w-0 flex-col border-b border-white/8 p-4 xl:border-r xl:border-b-0">
        <div>
          <h3 id="ccg-pack-studio-title" className="text-lg font-bold text-white text-balance">{t("title")}</h3>
          <p className="mt-1 text-sm leading-6 text-gray-400 text-pretty">{t("description")}</p>
        </div>

        <label className="mt-5 grid gap-1.5 text-xs font-semibold text-gray-400">
          {t("raid")}
          <select className={fieldClass} value={selectedSet?.zoneId ?? ""} onChange={(event) => setSelectedZoneId(Number(event.target.value))}>
            {sets.map((set) => <option key={set.zoneId} value={set.zoneId}>{set.raidName}</option>)}
          </select>
        </label>

        <label className="mt-5 grid gap-2 text-xs font-semibold text-gray-400">
          <span className="flex items-center justify-between gap-3">
            <span>{t("artOffset")}</span>
            <output className="font-mono text-cyan-300 tabular-nums">{Math.round(artOffsetX)}%</output>
          </span>
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={artOffsetX}
            onChange={(event) => setArtOffsetX(Number(event.target.value))}
            disabled={!selectedSet}
            className="min-h-10 w-full accent-cyan-400 disabled:cursor-not-allowed disabled:opacity-40"
          />
        </label>

        <div className="mt-3 flex items-center gap-3">
          <label className="grid flex-1 gap-1 text-xs font-semibold text-gray-400">
            {t("exactValue")}
            <input
              type="number"
              min="0"
              max="100"
              step="1"
              value={artOffsetX}
              onChange={(event) => setArtOffsetX(Math.min(100, Math.max(0, Number(event.target.value))))}
              disabled={!selectedSet}
              className={`${fieldClass} tabular-nums`}
            />
          </label>
          <button
            type="button"
            onClick={() => setArtOffsetX(selectedSet?.packArtOffsetX ?? 50)}
            disabled={!selectedSet || artOffsetX === selectedSet.packArtOffsetX}
            className="mt-5 min-h-10 rounded-md bg-gray-800 px-3 py-2 text-sm font-semibold text-gray-200 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)] transition-transform duration-150 ease-out hover:bg-gray-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t("reset")}
          </button>
        </div>

        {selectedSet ? (
          <dl className="mt-5 rounded-md bg-gray-950/55 p-3 text-xs shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-gray-500">{t("configured")}</dt>
              <dd className="font-mono text-gray-300 tabular-nums">{selectedSet.packArtOffsetX}%</dd>
            </div>
            <div className="mt-2 flex items-center justify-between gap-3">
              <dt className="text-gray-500">{t("preview")}</dt>
              <dd className="font-mono font-semibold text-cyan-300 tabular-nums">{Math.round(artOffsetX)}%</dd>
            </div>
          </dl>
        ) : null}

        <p className="mt-auto pt-6 text-xs leading-5 text-gray-500 text-pretty">{t("previewOnly")}</p>
      </div>

      <div className="relative grid min-h-[42rem] place-items-center overflow-hidden bg-gray-950 p-8 [perspective:1300px]" style={theme}>
        <div
          className="absolute inset-0 bg-cover bg-center opacity-20"
          style={{ backgroundImage: "linear-gradient(rgba(1,4,12,.2),rgba(1,4,12,.78)),var(--pack-stage-art)" }}
          aria-hidden="true"
        />
        {selectedSet ? (
          <div className="relative z-10 w-full max-w-[18rem]">
            <span className={packStyles.packButton}>
              <PackBoosterVisual title={selectedSet.raidName} cardsLabel={t("cards")} />
            </span>
          </div>
        ) : (
          <p className="relative z-10 text-sm text-gray-500">{t("empty")}</p>
        )}
      </div>
    </section>
  );
}
