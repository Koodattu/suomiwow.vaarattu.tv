"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ANGLER_TOP, FISH, FINISH_TIMES, RARITY_POINTS, anglerScore, dailyCatchesLeft, fishOf, fishRarity, type FigurineRecords, type FigurineQuality } from "@/lib/figurine-collection";
import { findFigure } from "@/lib/figurine-series";
import type { LinePhase, PanelResult } from "./WorldPanels";
import Portrait from "./Portrait";
import styles from "./pond-hud.module.css";

// The fishing pond's controls, laid over the world rather than in a panel: what the water is
// doing above the bottom controls, the catch in the centre, and a bar of buttons along the bottom.
// The world says the rest: something
// glints under the water while the day's prize catches remain, the bucket on the dock holds the
// fish log and the board on the bank the rankings.
export type PondPart = "rod" | "bobber" | "bucket" | "board";
export type PondSheet = "log" | "board";
type Props = {
  records: FigurineRecords; now: Date; line: LinePhase | null; result: Extract<PanelResult, { station: "pond" }> | null;
  busy: boolean; hovered: PondPart | null; sheet: PondSheet | null;
  onCast: () => void; onHook: () => void; onDismiss: () => void; onSheet: (sheet: PondSheet | null) => void; onBack: () => void;
};
// Players learn the pond in a few casts; after that the how-to lines step aside.
const LEARNED = 3;

export default function PondHud({ records, now, line, result, busy, hovered, sheet, onCast, onHook, onDismiss, onSheet, onBack }: Props) {
  const t = useTranslations("figurineLab.world.pond");
  const quality = useTranslations("figurineLab.quality");
  const prizes = dailyCatchesLeft(records, now), learning = records.stats.fish < LEARNED;
  const kinds = FISH.filter((entry) => records.fish[entry.id]).length, score = anglerScore(records);
  const out = line !== null;
  // The water's story: the line's moment while it is out, else the last miss, else what stirs below.
  const story = line === "bite" ? t("story.bite") : line === "nibble" ? t("story.nibble") : line === "wait" ? t("story.wait") : line === "cast" ? t("story.cast")
    : result && "missed" in result ? t(result.missed) : t(prizes > 0 ? "story.glint" : "story.fish");
  const how = line === "wait" || line === "nibble" ? t("how.wait") : line === "bite" ? t("how.bite") : !out && !busy ? t("how.idle") : null;
  const pointing = !out && hovered ? t(`parts.${hovered}`) : null;
  return <>
    <div className={styles.story} data-tone={line === "bite" ? "bite" : result && "missed" in result && !out ? "miss" : !out && prizes > 0 ? "glint" : undefined} aria-live="polite">
      <p>{story}</p>
      {(pointing || (learning && how)) && <small>{pointing ?? how}</small>}
    </div>
    {result && "caught" in result && !out && <>
      <button type="button" className={styles.catchDismiss} onClick={onDismiss} aria-label={t("dismissCatch")}><span>{t("dismissCatch")}</span></button>
      <CatchBanner result={result} quality={(finish) => quality(finish)} />
    </>}
    <nav className={styles.bar} aria-label={t("controls")}>
      <div className={styles.left}>
        <button type="button" className={styles.back} onClick={onBack}>{t("back")}</button>
        <button type="button" className={styles.side} onClick={() => onSheet("log")} aria-haspopup="dialog" aria-label={`${t("log")} ${kinds}/${FISH.length}`}>
          <Glyph kind="log" /><span>{t("log")}</span><em>{kinds}/{FISH.length}</em>
        </button>
      </div>
      {out ? <button type="button" className={styles.action} data-strike={line === "bite"} disabled={line === "cast"} onClick={onHook}><Glyph kind="rod" />{t("strike")}</button>
        : <button type="button" className={styles.action} disabled={busy} onClick={onCast}><Glyph kind="rod" />{t("cast")}</button>}
      <div className={styles.right}>
        <button type="button" className={styles.side} onClick={() => onSheet("board")} aria-haspopup="dialog" aria-label={`${t("rankings")} ${t("points", { points: score })}`}>
          <Glyph kind="board" /><span>{t("rankings")}</span>{score > 0 && <em>{score}</em>}
        </button>
      </div>
    </nav>
    {sheet === "log" && <FishLog records={records} onClose={() => onSheet(null)} />}
    {sheet === "board" && <AnglersBoard records={records} onClose={() => onSheet(null)} />}
  </>;
}

// What came up: the kind (or the prize), its weight, finish and score, and whether it is a first or a best.
function CatchBanner({ result, quality }: { result: Extract<PanelResult, { caught: unknown }>; quality: (finish: FigurineQuality) => string }) {
  const t = useTranslations("figurineLab.world.pond");
  const { caught, figure } = result;
  if (caught.kind === "daily") {
    const name = figure ? findFigure(figure.key)?.character.name ?? "" : "";
    return <div className={styles.banner} data-quality={figure?.quality} role="status">
      {figure && <span className={styles.bannerPortrait}><Portrait figureKey={figure.key} quality={figure.quality} /></span>}
      <div>
        <small>{t(figure ? "banner.chest" : "banner.treasure")}</small>
        <b>{figure ? name : t("banner.box")}</b>
        <span>{figure ? `${figure.quality !== "standard" ? `${quality(figure.quality)} · ` : ""}${t("banner.joins")}` : t("banner.banked", { count: caught.reward.boxes ?? 1 })}</span>
      </div>
    </div>;
  }
  const kind = fishOf(caught.fish)!;
  return <div className={styles.banner} data-quality={caught.quality} role="status">
    <div>
      <small>{caught.first ? t("banner.new") : caught.best ? t("banner.best") : t("banner.caught")}</small>
      <b>{kind.name}</b>
      <span>{t("weight", { weight: caught.weight })}{caught.quality !== "standard" && ` · ${quality(caught.quality)}`}</span>
    </div>
    {caught.score > 0 && <strong className={styles.gain}>{t("gain", { points: caught.score })}</strong>}
  </div>;
}

// A fish as baked from its game model (scripts/bake-fish-cards.mjs); a shape until it is caught.
function FishPicture({ id, unknown = false }: { id: string; unknown?: boolean }) {
  // eslint-disable-next-line @next/next/no-img-element -- small baked cards, served as they are
  return <img className={styles.fishPicture} data-unknown={unknown} src={`/figurines/world/fish/${id}.webp`} alt="" draggable={false} />;
}

// A sheet over the world: a dialog that takes focus, and closes on its button or a tap outside.
function Sheet({ title, intro, closeLabel, onClose, children, wide = false }: { title: string; intro: ReactNode; closeLabel: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => { close.current?.focus(); }, []);
  return <div className={styles.logBackdrop} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className={styles.log} data-wide={wide} role="dialog" aria-modal="true" aria-labelledby="pond-sheet-title">
      <header>
        <div>
          <h2 id="pond-sheet-title">{title}</h2>
          <p>{intro}</p>
        </div>
        <button ref={close} type="button" className={styles.close} onClick={onClose} aria-label={closeLabel}>×</button>
      </header>
      {children}
    </section>
  </div>;
}

// The fish log: every kind the pond holds, a card each, in order of size. Caught kinds show
// their picture, how many, the heaviest and any golden or galaxy ones; the rest are shadows.
function FishLog({ records, onClose }: { records: FigurineRecords; onClose: () => void }) {
  const t = useTranslations("figurineLab.world.pond");
  const caught = FISH.filter((entry) => records.fish[entry.id]);
  const total = caught.reduce((sum, entry) => sum + records.fish[entry.id].count, 0);
  const record = caught.filter((entry) => !("junk" in entry)).sort((a, b) => records.fish[b.id].best - records.fish[a.id].best)[0];
  return <Sheet title={t("log")} closeLabel={t("closeLog")} onClose={onClose} wide
    intro={<>{t("logSummary", { kinds: caught.length, total: FISH.length, count: total })}{record && <> · {t("logRecord", { name: record.name, weight: records.fish[record.id].best })}</>}</>}>
    <ul className={styles.cards}>{FISH.map((entry) => {
      const log = records.fish[entry.id], best = log?.galaxy ? "galaxy" : log?.golden ? "golden" : undefined, rarity = fishRarity(entry);
      return <li key={entry.id} className={styles.card} data-caught={!!log} data-best={best} data-rarity={rarity}>
        <FishPicture id={entry.id} unknown={!log} />
        <b>{log ? entry.name : t("unknown")}</b>
        <small className={styles.rarity}>{t(`rarity.${rarity}`)}</small>
        {log ? <span className={styles.stats}>
          <span>{t("logCount", { count: log.count })}</span>
          <span>{t("logBest", { weight: log.best })}</span>
          {log.golden > 0 && <em data-quality="golden">★ {log.golden}</em>}
          {log.galaxy > 0 && <em data-quality="galaxy">✦ {log.galaxy}</em>}
        </span> : <span className={styles.stats}><span>{t("logMissing")}</span></span>}
      </li>;
    })}</ul>
  </Sheet>;
}

// The anglers' board: where the player stands (the guild's standings come with sign-in), their
// best catches by score, and how a catch scores.
function AnglersBoard({ records, onClose }: { records: FigurineRecords; onClose: () => void }) {
  const t = useTranslations("figurineLab.world.pond");
  const quality = useTranslations("figurineLab.quality");
  const score = anglerScore(records);
  return <Sheet title={t("board")} intro={t("boardIntro")} closeLabel={t("closeBoard")} onClose={onClose}>
    <div className={styles.boardBody}>
      <section className={styles.standings} aria-labelledby="pond-standings">
        <h3 id="pond-standings">{t("standings")}</h3>
        <ol>
          <li data-you="true"><span className={styles.place}>{score > 0 ? 1 : "–"}</span><b>{t("you")}</b><em>{t("points", { points: score })}</em></li>
        </ol>
        <p className={styles.soon}>{t("standingsSoon")}</p>
        <h3>{t("scoring")}</h3>
        <ul className={styles.scoring}>
          {(["common", "uncommon", "rare", "epic"] as const).map((rarity) => <li key={rarity} data-rarity={rarity}><span>{t(`rarity.${rarity}`)}</span><b>{RARITY_POINTS[rarity]}</b></li>)}
        </ul>
        <p className={styles.soon}>{t("scoringSize")}</p>
        <p className={styles.soon}>{t("scoringFinish", { golden: FINISH_TIMES.golden, galaxy: FINISH_TIMES.galaxy })}</p>
      </section>
      <section className={styles.best} aria-labelledby="pond-best">
        <h3 id="pond-best">{t("bestTen", { count: records.angler.length, total: ANGLER_TOP })}</h3>
        {records.angler.length ? <ol className={styles.catches}>{records.angler.map((entry, index) => {
          const kind = fishOf(entry.fish)!;
          return <li key={`${entry.at}-${index}`} data-quality={entry.quality} data-rarity={fishRarity(kind)}>
            <span className={styles.place}>{index + 1}</span>
            <span className={styles.catchFish}><FishPicture id={entry.fish} /></span>
            <span className={styles.catchName}><b>{kind.name}</b><small>{t("weight", { weight: entry.weight })}{entry.quality !== "standard" && ` · ${quality(entry.quality)}`}</small></span>
            <em>{t("points", { points: entry.score })}</em>
          </li>;
        })}</ol> : <p className={styles.empty}>{t("boardEmpty")}</p>}
      </section>
    </div>
  </Sheet>;
}

function Glyph({ kind }: { kind: "log" | "rod" | "board" }) {
  return <svg className={styles.glyph} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {kind === "log" ? <><path d="M3 12c3-4 7-5 10-5 3 0 5 2 6 5-1 3-3 5-6 5-3 0-7-1-10-5z" /><path d="M3 12 1 9M3 12l-2 3" /><circle cx="15.5" cy="11" r=".6" fill="currentColor" /></>
      : kind === "board" ? <><path d="M8 4h8v5a4 4 0 0 1-8 0z" /><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4" /><path d="M12 13v4M8 20h8M9.5 17h5" /></>
      : <><path d="m3 21 9-17c1-2 4-2 6 0l3 3v8a3 3 0 0 1-6 0v-2l2 2" /><path d="m4 17 3 2" /><circle cx="8" cy="14" r="2" /></>}
  </svg>;
}
