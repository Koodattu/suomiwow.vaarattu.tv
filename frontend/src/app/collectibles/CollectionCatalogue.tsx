"use client";

import { useMemo, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { LuChevronDown, LuEye, LuStar } from "react-icons/lu";
import { QUALITIES, SHOWCASE_SLOTS, acquiredId, bestQuality, copiesOf, showcaseFigure, type FigurineCollection, type FigurineQuality, type FigurineRecords, type MachineItem } from "@/lib/figurine-collection";
import { findFigure } from "@/lib/figurine-series";
import { playFigurineCue } from "@/lib/figurine-audio";
import Portrait from "./Portrait";
import type { PanelSeries } from "./WorldPanels";
import css from "./collection-catalogue.module.css";

// The collection as a catalogue. Three parts, each with its own place so nothing pushes anything
// else about: the display rail (the sixteen numbered places of the cabinet, always all there,
// filled by starring), the series (every figure, owned in colour and missing as silhouettes, each
// series folded away under its header until opened), and the inspector for the figure picked.
// Favourites trade places: drag one onto another along the rail with a mouse, or swap it with its
// neighbour from the inspector. Dropped on an empty place, it goes to the end.
export type CatalogueActions = {
  onInspect: (key: string, quality: FigurineQuality) => void;
  onFavorite: (item: MachineItem) => void;
  onMoveFavorite: (key: string, to: number) => void;
  onSwapFavorites: (a: string, b: string) => void;
  onFavoriteQuality: (key: string, quality: FigurineQuality) => void;
};
type Props = CatalogueActions & { collection: FigurineCollection; records: FigurineRecords; series: PanelSeries[] };
// Acquired dates are the player's own, in their own time zone.
const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
type Drag = { key: string; pointer: number; x: number; y: number; startX: number; startY: number; over: number; active: boolean };
const FILTERS = ["all", "owned", "missing", "golden", "galaxy"] as const;
type Filter = (typeof FILTERS)[number];
// Which series are folded away, kept for the visit.
const FOLDED_KEY = "suomiwow-figurine-collection-folded";
const readFolded = (): string[] | null => { if (typeof window === "undefined") return null; try { const stored: unknown = JSON.parse(window.sessionStorage.getItem(FOLDED_KEY) ?? "null"); return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === "string") : null; } catch { return null; } };

export default function CollectionCatalogue({ collection, records, series, onInspect, onFavorite, onMoveFavorite, onSwapFavorites, onFavoriteQuality }: Props) {
  const t = useTranslations("figurineLab");
  const format = useFormatter();
  const [query, setQuery] = useState(""), [filter, setFilter] = useState<Filter>("all");
  // Every series starts folded: the rail and the list of series fit on one screen.
  const [folded, setFolded] = useState(() => readFolded() ?? series.filter((entry) => entry.released).map((entry) => entry.id));
  const fold = (id: string) => {
    playFigurineCue("pick");
    setFolded((current) => { const next = current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]; try { window.sessionStorage.setItem(FOLDED_KEY, JSON.stringify(next)); } catch { /* it simply opens again next time */ } return next; });
  };
  const [drag, setDrag] = useState<Drag | null>(null);
  // Favourites still owned, at the finish each shows; the display numbers follow this order.
  const favorites = useMemo(() => records.favorites.map((entry) => showcaseFigure(entry, collection)).filter((entry): entry is MachineItem => !!entry), [records.favorites, collection]);
  const favoriteKeys = useMemo(() => new Set(favorites.map(({ key }) => key)), [favorites]);
  const released = series.filter((entry) => entry.released), upcoming = series.length - released.length;
  const allKeys = released.flatMap((entry) => entry.keys);
  // The figure in the inspector stays put until another is picked; on a phone it opens over the list.
  const [picked, setPicked] = useState<string | null>(() => favorites[0]?.key ?? allKeys.find((key) => collection[key]) ?? allKeys[0] ?? null);
  const [inspecting, setInspecting] = useState(false);
  const pick = (key: string) => { playFigurineCue("pick"); setPicked(key); setInspecting(true); };
  const star = (item: MachineItem) => { playFigurineCue(favoriteKeys.has(item.key) ? "unstar" : "star"); onFavorite(item); };
  const owned = allKeys.filter((key) => collection[key]).length;
  const needle = query.trim().toLocaleLowerCase();
  const matches = (key: string) => {
    const copies = collection[key];
    if (filter === "owned" && !copies || filter === "missing" && copies || (filter === "golden" || filter === "galaxy") && !copies?.[filter]) return false;
    if (!needle) return true;
    return !!copies && !!findFigure(key)?.character.name.toLocaleLowerCase().includes(needle);
  };
  const countOf = (value: Filter) => value === "all" ? allKeys.length : value === "owned" ? owned : value === "missing" ? allKeys.length - owned : allKeys.filter((key) => collection[key]?.[value]).length;

  // While dragging, the rail shows the two favourites already traded.
  const order = useMemo(() => {
    const from = drag?.active ? favorites.findIndex(({ key }) => key === drag.key) : -1;
    if (!drag || from < 0 || drag.over === from) return favorites;
    const next = [...favorites];
    if (drag.over < next.length) [next[from], next[drag.over]] = [next[drag.over], next[from]]; else next.push(...next.splice(from, 1));
    return next;
  }, [favorites, drag]);
  const startDrag = (event: ReactPointerEvent, key: string, index: number) => {
    if (event.button !== 0 || event.pointerType !== "mouse") return;
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
    setDrag({ key, pointer: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, over: index, active: false });
  };
  const moveDrag = (event: ReactPointerEvent) => {
    if (!drag || event.pointerId !== drag.pointer) return;
    const active = drag.active || Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 6;
    let over = drag.over;
    if (active) {
      const slot = document.elementsFromPoint(event.clientX, event.clientY).map((element) => element.closest<HTMLElement>("[data-place]")).find(Boolean);
      if (slot) over = Number(slot.dataset.place);
    }
    setDrag({ ...drag, x: event.clientX, y: event.clientY, over, active });
  };
  const endDrag = (event: ReactPointerEvent) => {
    if (!drag || event.pointerId !== drag.pointer) return;
    const from = favorites.findIndex(({ key }) => key === drag.key), other = favorites[drag.over];
    if (drag.active && drag.over !== from) {
      playFigurineCue("place");
      // Onto another favourite: the two trade places. Onto an empty place: it goes last.
      if (other) onSwapFavorites(drag.key, other.key); else onMoveFavorite(drag.key, records.favorites.length);
    }
    setDrag(null);
  };
  const moveBy = (key: string, step: number) => {
    const index = favorites.findIndex((entry) => entry.key === key), target = favorites[index + step];
    if (!target) return;
    playFigurineCue("place");
    onSwapFavorites(key, target.key);
  };

  // The rail: sixteen numbered places, then any favourites waiting past them.
  const places = Math.max(SHOWCASE_SLOTS, order.length);
  return <div className={css.catalogue} data-inspecting={inspecting}>
    <div className={css.main}>
      <div className={css.tools}>
        <div className={css.summary}>
          <b>{t("world.collection.owned", { got: owned, total: allKeys.length })}</b>
          <span className={css.meter}><i style={{ width: `${owned / Math.max(1, allKeys.length) * 100}%` }} /></span>
        </div>
        <input type="search" className={css.search} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("world.collection.search")} aria-label={t("world.collection.search")} />
        <div className={css.filters}>{FILTERS.map((value) => <button key={value} type="button" aria-pressed={filter === value} data-filter={value} onClick={() => { playFigurineCue("pick"); setFilter(value); }}>{value === "golden" || value === "galaxy" ? t(`quality.${value}`) : t(`world.collection.filters.${value}`)}<small>{countOf(value)}</small></button>)}</div>
      </div>

      <section className={css.display} aria-label={t("world.collection.favorites")} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={() => setDrag(null)}>
        <header><h3><LuStar aria-hidden="true" />{t("world.collection.favorites")}</h3><span>{t("world.collection.onDisplay", { count: Math.min(favorites.length, SHOWCASE_SLOTS), total: SHOWCASE_SLOTS })}</span></header>
        <ol className={css.rail}>{Array.from({ length: places }, (_, index) => {
          const entry = order[index], dragging = !!entry && drag?.active && drag.key === entry.key;
          const landing = drag?.active && drag.over === index && !dragging;
          return <li key={index} className={css.place} data-place={index} data-filled={!!entry} data-waiting={index >= SHOWCASE_SLOTS || undefined} data-selected={!!entry && picked === entry.key} data-dragging={dragging || undefined} data-landing={landing || undefined}
            onPointerDown={entry ? (event) => startDrag(event, entry.key, index) : undefined}>
            {entry ? <button type="button" onClick={() => { if (!drag?.active) pick(entry.key); }} aria-pressed={picked === entry.key} aria-label={findFigure(entry.key)?.character.name}><Portrait figureKey={entry.key} quality={entry.quality} /></button> : null}
            <span className={css.number}>{index < SHOWCASE_SLOTS ? index + 1 : "+"}</span>
          </li>;
        })}</ol>
      </section>

      <div className={css.list}>
        {released.map((entry) => {
          const keys = entry.keys.filter(matches), got = entry.keys.filter((key) => collection[key]).length, closed = folded.includes(entry.id) && !needle;
          if (!keys.length && (needle || filter !== "all")) return null;
          return <section key={entry.id} className={css.section} data-secret={entry.hidden} data-folded={closed}>
            <button type="button" className={css.fold} onClick={() => fold(entry.id)} aria-expanded={!closed}>
              <LuChevronDown aria-hidden="true" />
              <h3>{entry.hidden ? "✦ " : ""}{t("seriesName", { number: entry.number })}{entry.hidden && <small>{t("world.collection.secret")}</small>}</h3>
              <span className={css.progress}><i style={{ width: `${got / Math.max(1, entry.keys.length) * 100}%` }} /></span>
              <span data-complete={got === entry.keys.length || undefined}>{got}/{entry.keys.length}</span>
            </button>
            {!closed && <ul className={css.grid}>{keys.map((key) => {
              const copies = collection[key], best = bestQuality(copies), found = findFigure(key), favorite = favoriteKeys.has(key), shown = favorites.find((item) => item.key === key);
              return <li key={key} className={css.card} data-owned={!!best} data-selected={picked === key} data-quality={best ?? undefined}>
                <button type="button" className={css.pick} onClick={() => pick(key)} aria-pressed={picked === key}>
                  <Portrait figureKey={key} quality={shown?.quality ?? best} locked={!best} />
                  <span className={css.name}>{best ? found?.character.name : "?"}</span>
                  {best && <span className={css.finishes}>{QUALITIES.filter((quality) => quality !== "standard" && copies?.[quality]).map((quality) => <i key={quality} data-quality={quality} />)}</span>}
                  {copiesOf(copies) > 1 && <span className={css.count}>×{copiesOf(copies)}</span>}
                </button>
                {best && <button type="button" className={css.star} aria-pressed={favorite} aria-label={t(favorite ? "world.collection.unstar" : "world.collection.star", { name: found?.character.name ?? "" })}
                  onClick={() => star({ key, quality: best })}><LuStar aria-hidden="true" /></button>}
              </li>;
            })}</ul>}
          </section>;
        })}
        {upcoming > 0 && filter === "all" && !needle && <p className={css.upcoming}>{t("world.collection.upcomingCount", { count: upcoming })}</p>}
      </div>
    </div>

    {picked && <Inspector key={picked} figureKey={picked} collection={collection} records={records} favorites={favorites} format={format}
      onClose={() => setInspecting(false)} onInspect={onInspect} onFavorite={star} onFavoriteQuality={onFavoriteQuality} onMove={moveBy} />}
    {drag?.active && <span className={css.ghost} style={{ left: drag.x, top: drag.y }}><Portrait figureKey={drag.key} quality={favorites.find(({ key }) => key === drag.key)?.quality} /></span>}
  </div>;
}

function Inspector({ figureKey: key, collection, records, favorites, format, onClose, onInspect, onFavorite, onFavoriteQuality, onMove }: {
  figureKey: string; collection: FigurineCollection; records: FigurineRecords; favorites: MachineItem[]; format: ReturnType<typeof useFormatter>;
  onClose: () => void; onMove: (key: string, step: number) => void;
} & Omit<CatalogueActions, "onMoveFavorite" | "onSwapFavorites">) {
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
    {best ? <div className={css.details}>
      <h3 className={css.title}>{character.name}</h3>
      <p className={css.subtitle}>{character.realm} · {t(`races.${character.raceKey}`)} · {t(`classes.${character.classKey}`)}</p>
      <ul className={css.copies}>
        {ownedFinishes.map((quality) => <li key={quality} data-quality={quality}>
          <b>{t(`quality.${quality}`)} ×{copies![quality]}</b>
          {records.acquired[acquiredId(key, quality)] && <span>{format.dateTime(new Date(records.acquired[acquiredId(key, quality)]), { dateStyle: "medium", timeZone: localZone() })}</span>}
        </li>)}
      </ul>
      {/* The same rows whether starred or not, so starring changes what they say and nothing else. */}
      <button type="button" className={css.favorite} aria-pressed={!!favorite} onClick={() => onFavorite({ key, quality: best })}>
        <LuStar aria-hidden="true" />{favorite ? index < SHOWCASE_SLOTS ? t("world.collection.displayed", { number: index + 1 }) : t("world.collection.favorite") : t("world.collection.addFavorite")}
      </button>
      <div className={css.row}>
        <button type="button" onClick={() => onMove(key, -1)} disabled={!favorite || index === 0}>{t("world.collection.moveEarlier")}</button>
        <button type="button" onClick={() => onMove(key, 1)} disabled={!favorite || index === favorites.length - 1}>{t("world.collection.moveLater")}</button>
      </div>
      <div className={css.finishPicker} role="radiogroup" aria-label={t("world.collection.finish")} data-idle={!favorite || ownedFinishes.length < 2 || undefined}>
        {QUALITIES.map((quality) => <button key={quality} type="button" role="radio" aria-checked={shownQuality === quality} data-quality={quality} disabled={!favorite || !copies?.[quality] || ownedFinishes.length < 2} onClick={() => { playFigurineCue("pick"); onFavoriteQuality(key, quality); }}>{t(`quality.${quality}`)}</button>)}
      </div>
      <button type="button" className={css.secondary} onClick={() => onInspect(key, shownQuality ?? best)}><LuEye aria-hidden="true" />{t("world.collection.inspect")}</button>
    </div> : <div className={css.details}>
      <h3 className={css.title}>{t("world.collection.locked")}</h3>
      <p className={css.subtitle}>{t("seriesName", { number: String(found.series.number).padStart(3, "0") })}</p>
    </div>}
  </aside>;
}
