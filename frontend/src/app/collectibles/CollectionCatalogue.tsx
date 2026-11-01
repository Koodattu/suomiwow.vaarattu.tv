"use client";

import { useMemo, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { QUALITIES, SHOWCASE_SLOTS, acquiredId, bestQuality, copiesOf, showcaseFigure, type FigurineCollection, type FigurineQuality, type FigurineRecords, type MachineItem } from "@/lib/figurine-collection";
import { findFigure } from "@/lib/figurine-series";
import Portrait from "./Portrait";
import type { PanelSeries } from "./WorldPanels";
import css from "./collection-catalogue.module.css";

// The collection as a catalogue: favourites first (starred, in the player's order; the first
// sixteen stand in the display cabinet and about the world), then every series in full, owned
// figures in colour and missing ones as silhouettes. Picking a figure shows it in the inspector
// beside the list; nothing needs the camera. Favourites reorder by dragging (by the whole card
// with a mouse, by the grip on touch), or a step at a time from the inspector.
export type CatalogueActions = {
  onInspect: (key: string, quality: FigurineQuality) => void;
  onFavorite: (item: MachineItem) => void;
  onMoveFavorite: (key: string, to: number) => void;
  onFavoriteQuality: (key: string, quality: FigurineQuality) => void;
};
type Props = CatalogueActions & { collection: FigurineCollection; records: FigurineRecords; series: PanelSeries[] };
// Acquired dates are the player's own, in their own time zone.
const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
type Drag = { key: string; pointer: number; x: number; y: number; startX: number; startY: number; over: number; active: boolean };

export default function CollectionCatalogue({ collection, records, series, onInspect, onFavorite, onMoveFavorite, onFavoriteQuality }: Props) {
  const t = useTranslations("figurineLab");
  const format = useFormatter();
  const [query, setQuery] = useState("");
  const [ownedOnly, setOwnedOnly] = useState(false);
  // On a phone the inspector opens over the list once a figure is picked.
  const [picked, setPicked] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  // Favourites still owned, at the finish each shows; the display numbers follow this order.
  const favorites = useMemo(() => records.favorites.map((entry) => showcaseFigure(entry, collection)).filter((entry): entry is MachineItem => !!entry), [records.favorites, collection]);
  const favoriteKeys = useMemo(() => new Set(favorites.map(({ key }) => key)), [favorites]);
  const released = series.filter((entry) => entry.released);
  const allKeys = released.flatMap((entry) => entry.keys);
  const selected = picked ?? favorites[0]?.key ?? allKeys.find((key) => collection[key]) ?? allKeys[0] ?? null;
  const owned = allKeys.filter((key) => collection[key]).length;
  const finishCount = (quality: FigurineQuality) => allKeys.filter((key) => collection[key]?.[quality]).length;
  const needle = query.trim().toLocaleLowerCase();
  const matches = (key: string) => {
    if (ownedOnly && !collection[key]) return false;
    if (!needle) return true;
    const found = findFigure(key);
    return !!found && !!collection[key] && found.character.name.toLocaleLowerCase().includes(needle);
  };

  // While dragging, the list shows the dragged favourite where it would land.
  const order = useMemo(() => {
    if (!drag?.active) return favorites;
    const moving = favorites.find(({ key }) => key === drag.key), rest = favorites.filter(({ key }) => key !== drag.key);
    if (!moving) return favorites;
    rest.splice(Math.min(drag.over, rest.length), 0, moving);
    return rest;
  }, [favorites, drag]);
  const startDrag = (event: ReactPointerEvent, key: string, index: number) => {
    if (event.button !== 0 || (event.target as Element).closest("[data-star]")) return;
    if (event.pointerType !== "mouse" && !(event.target as Element).closest("[data-grip]")) return;
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
    setDrag({ key, pointer: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, over: index, active: false });
  };
  const moveDrag = (event: ReactPointerEvent) => {
    if (!drag || event.pointerId !== drag.pointer) return;
    const active = drag.active || Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 6;
    let over = drag.over;
    if (active) {
      const card = document.elementsFromPoint(event.clientX, event.clientY).map((element) => element.closest<HTMLElement>("[data-favorite]")).find(Boolean);
      if (card) over = Number(card.dataset.favorite);
    }
    setDrag({ ...drag, x: event.clientX, y: event.clientY, over, active });
  };
  const endDrag = (event: ReactPointerEvent) => {
    if (!drag || event.pointerId !== drag.pointer) return;
    if (drag.active) {
      // Into the full list (which may hold favourites no longer owned): before the favourite now at
      // the drop place, or last.
      const rest = records.favorites.filter(({ key }) => key !== drag.key), after = favorites.filter(({ key }) => key !== drag.key)[drag.over];
      onMoveFavorite(drag.key, after ? rest.findIndex(({ key }) => key === after.key) : rest.length);
    } else setPicked(drag.key);
    setDrag(null);
  };
  const moveBy = (key: string, step: number) => {
    const index = favorites.findIndex((entry) => entry.key === key), target = favorites[index + step];
    if (!target) return;
    const rest = records.favorites.filter((entry) => entry.key !== key), at = rest.findIndex((entry) => entry.key === target.key);
    onMoveFavorite(key, step > 0 ? at + 1 : at);
  };

  const card = (key: string, favoriteIndex?: number) => {
    const copies = collection[key], best = bestQuality(copies), found = findFigure(key);
    const favorite = favoriteKeys.has(key), shown = favorites.find((entry) => entry.key === key);
    const number = favoriteIndex !== undefined && favoriteIndex < SHOWCASE_SLOTS ? favoriteIndex + 1 : null;
    const dragging = drag?.active && drag.key === key && favoriteIndex !== undefined;
    return <li key={key} className={css.card} data-owned={!!best} data-selected={selected === key} data-dragging={dragging} data-favorite={favoriteIndex}
      onPointerDown={favoriteIndex !== undefined ? (event) => startDrag(event, key, favoriteIndex) : undefined}>
      <button type="button" className={css.pick} onClick={() => { if (favoriteIndex === undefined || !drag) setPicked(key); }} aria-pressed={selected === key}>
        <Portrait figureKey={key} quality={shown?.quality ?? best} locked={!best} />
        <span className={css.name}>{best ? found?.character.name : "?"}</span>
        {best && <span className={css.finishes}>{QUALITIES.filter((quality) => quality !== "standard" && copies?.[quality]).map((quality) => <i key={quality} data-quality={quality} />)}</span>}
        {copiesOf(copies) > 1 && <span className={css.count}>×{copiesOf(copies)}</span>}
      </button>
      {number && <span className={css.number}>{number}</span>}
      {best && <button type="button" data-star className={css.star} aria-pressed={favorite} aria-label={t(favorite ? "world.collection.unstar" : "world.collection.star", { name: found?.character.name ?? "" })}
        onClick={() => onFavorite({ key, quality: best })}>{favorite ? "★" : "☆"}</button>}
      {favoriteIndex !== undefined && <span className={css.grip} data-grip aria-hidden="true">⠿</span>}
    </li>;
  };

  return <div className={css.catalogue} data-inspecting={!!picked}>
    <div className={css.list} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={() => setDrag(null)}>
      <div className={css.tools}>
        <p className={css.summary}>
          <b>{t("world.collection.owned", { got: owned, total: allKeys.length })}</b>
          {finishCount("golden") > 0 && <span data-quality="golden">{t("quality.golden")} ×{finishCount("golden")}</span>}
          {finishCount("galaxy") > 0 && <span data-quality="galaxy">{t("quality.galaxy")} ×{finishCount("galaxy")}</span>}
        </p>
        <input type="search" className={css.search} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("world.collection.search")} aria-label={t("world.collection.search")} />
        <label className={css.toggle}><input type="checkbox" checked={ownedOnly} onChange={(event) => setOwnedOnly(event.target.checked)} />{t("world.collection.ownedOnly")}</label>
      </div>

      <section className={css.section} data-favorites>
        <header><h3>★ {t("world.collection.favorites")}</h3><span>{t("world.collection.onDisplay", { count: Math.min(favorites.length, SHOWCASE_SLOTS), total: SHOWCASE_SLOTS })}</span></header>
        {favorites.length ? <>
          <ul className={css.grid}>{order.slice(0, SHOWCASE_SLOTS).map((entry, index) => card(entry.key, index))}</ul>
          {order.length > SHOWCASE_SLOTS && <>
            <p className={css.divider}>{t("world.collection.notOnDisplay")}</p>
            <ul className={css.grid}>{order.slice(SHOWCASE_SLOTS).map((entry, index) => card(entry.key, index + SHOWCASE_SLOTS))}</ul>
          </>}
          <p className={css.hint}>{t("world.collection.dragHint")}</p>
        </> : <p className={css.hint}>{t("world.collection.favoritesHint")}</p>}
      </section>

      {series.map((entry) => {
        if (!entry.released) return <section key={entry.id} className={css.section} data-upcoming><header><h3>{t("seriesName", { number: entry.number })}</h3><span>{t("comingSoon")}</span></header></section>;
        const keys = entry.keys.filter(matches), got = entry.keys.filter((key) => collection[key]).length;
        if (!keys.length && (needle || ownedOnly)) return null;
        return <section key={entry.id} className={css.section} data-secret={entry.hidden}>
          <header>
            <h3>{entry.hidden ? "✦ " : ""}{t("seriesName", { number: entry.number })}{entry.hidden && <small>{t("world.collection.secret")}</small>}</h3>
            <span>{got}/{entry.keys.length}</span>
            <span className={css.progress}><i style={{ width: `${got / Math.max(1, entry.keys.length) * 100}%` }} /></span>
          </header>
          <ul className={css.grid}>{keys.map((key) => card(key))}</ul>
        </section>;
      })}
    </div>

    {selected && <Inspector key={selected} figureKey={selected} collection={collection} records={records} favorites={favorites} format={format}
      onClose={() => setPicked(null)} onInspect={onInspect} onFavorite={onFavorite} onFavoriteQuality={onFavoriteQuality} onMove={moveBy} />}
    {drag?.active && <span className={css.ghost} style={{ left: drag.x, top: drag.y }}><Portrait figureKey={drag.key} quality={favorites.find(({ key }) => key === drag.key)?.quality} /></span>}
  </div>;
}

function Inspector({ figureKey: key, collection, records, favorites, format, onClose, onInspect, onFavorite, onFavoriteQuality, onMove }: {
  figureKey: string; collection: FigurineCollection; records: FigurineRecords; favorites: MachineItem[]; format: ReturnType<typeof useFormatter>;
  onClose: () => void; onMove: (key: string, step: number) => void;
} & Omit<CatalogueActions, "onMoveFavorite">) {
  const t = useTranslations("figurineLab");
  const found = findFigure(key), copies = collection[key], best = bestQuality(copies);
  const index = favorites.findIndex((entry) => entry.key === key), favorite = index >= 0 ? favorites[index] : null;
  const shownQuality = favorite?.quality ?? best;
  const ownedFinishes = QUALITIES.filter((quality) => copies?.[quality]);
  if (!found) return null;
  const { character } = found;
  return <aside className={css.inspector} aria-label={best ? character.name : t("world.collection.locked")}>
    <button type="button" className={css.inspectorClose} onClick={onClose} aria-label={t("world.close")}>×</button>
    <div className={css.hero} data-quality={shownQuality ?? undefined}>
      <Portrait figureKey={key} quality={shownQuality} locked={!best} className={css.heroPortrait} />
    </div>
    {best ? <>
      <h3 className={css.title}>{character.name}</h3>
      <p className={css.subtitle}>{character.realm} · {t(`races.${character.raceKey}`)} · {t(`classes.${character.classKey}`)}</p>
      <button type="button" className={css.favorite} aria-pressed={!!favorite} onClick={() => onFavorite({ key, quality: best })}>
        {favorite ? <>★ {index < SHOWCASE_SLOTS ? t("world.collection.displayed", { number: index + 1 }) : t("world.collection.favorite")}</> : <>☆ {t("world.collection.addFavorite")}</>}
      </button>
      {favorite && <div className={css.row}>
        <button type="button" onClick={() => onMove(key, -1)} disabled={index === 0}>{t("world.collection.moveEarlier")}</button>
        <button type="button" onClick={() => onMove(key, 1)} disabled={index === favorites.length - 1}>{t("world.collection.moveLater")}</button>
      </div>}
      {favorite && ownedFinishes.length > 1 && <div className={css.finishPicker} role="radiogroup" aria-label={t("world.collection.finish")}>
        <span>{t("world.collection.finish")}</span>
        {ownedFinishes.map((quality) => <button key={quality} type="button" role="radio" aria-checked={favorite.quality === quality} data-quality={quality} onClick={() => onFavoriteQuality(key, quality)}>{t(`quality.${quality}`)}</button>)}
      </div>}
      <ul className={css.copies}>
        {ownedFinishes.map((quality) => <li key={quality} data-quality={quality}>
          <b>{t(`quality.${quality}`)} ×{copies![quality]}</b>
          {records.acquired[acquiredId(key, quality)] && <span>{t("world.collection.acquired", { date: format.dateTime(new Date(records.acquired[acquiredId(key, quality)]), { dateStyle: "medium", timeZone: localZone() }) })}</span>}
        </li>)}
      </ul>
      {copiesOf(copies) > 1 && <p className={css.note}>{t("world.collection.spares", { count: copiesOf(copies) - 1 })}</p>}
      <button type="button" className={css.secondary} onClick={() => onInspect(key, shownQuality ?? best)}>{t("world.collection.inspect")}</button>
    </> : <>
      <h3 className={css.title}>{t("world.collection.locked")}</h3>
      <p className={css.subtitle}>{t("seriesName", { number: String(found.series.number).padStart(3, "0") })}</p>
    </>}
  </aside>;
}
