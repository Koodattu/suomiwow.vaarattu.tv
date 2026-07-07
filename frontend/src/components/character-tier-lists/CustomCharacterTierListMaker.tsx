"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragOverEvent,
  DragStartEvent,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  closestCenter,
  getFirstCollision,
  pointerWithin,
  rectIntersection,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, defaultAnimateLayoutChanges, rectSortingStrategy, sortableKeyboardCoordinates, useSortable, type AnimateLayoutChanges } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/queries";
import { useAuth } from "@/context/AuthContext";
import IconImage from "@/components/IconImage";
import { CHARACTER_TIER_COLORS } from "@/components/character-tier-lists/CharacterTierBoard";
import { formatSpecName, getClassInfoById, getParseColor, getSpecIconUrl } from "@/lib/utils";
import type { CharacterTierBoardItem } from "@/components/character-tier-lists/CharacterTierBoard";
import type { CustomCharacterTierListResponse, CustomCharacterTierName } from "@/types";

const TIERS: CustomCharacterTierName[] = ["S", "A", "B", "C", "D", "E", "F"];
const UNPLACED = "unplaced";
type ContainerId = CustomCharacterTierName | typeof UNPLACED;
type Containers = Record<ContainerId, string[]>;

const animateLayoutChanges: AnimateLayoutChanges = (args) => defaultAnimateLayoutChanges({ ...args, wasDragging: true });

function formatScore(value: number): string {
  return value.toFixed(value % 1 === 0 ? 0 : 1);
}

function CharacterTile({
  item,
  dragAttributes,
  dragListeners,
  dragRef,
  isDragging,
  isOverlay,
  style,
}: {
  item: CharacterTierBoardItem;
  dragAttributes?: ReturnType<typeof useSortable>["attributes"];
  dragListeners?: ReturnType<typeof useSortable>["listeners"];
  dragRef?: (node: HTMLElement | null) => void;
  isDragging?: boolean;
  isOverlay?: boolean;
  style?: CSSProperties;
}) {
  const classInfo = getClassInfoById(item.classID);
  const specIcon = item.specName ? getSpecIconUrl(item.classID, item.specName) : undefined;
  const specLabel = item.specName ? formatSpecName(item.specName) : classInfo.name;

  return (
    <div
      ref={dragRef}
      style={style}
      title={`${item.name} / ${specLabel}`}
      className={`group relative h-20 w-20 shrink-0 touch-none select-none overflow-hidden rounded-sm bg-gray-800 shadow-sm ring-1 ring-white/10 transition-[opacity,scale,transform] duration-150 ease-out ${
        isOverlay ? "cursor-grabbing scale-105 shadow-xl ring-2 ring-blue-300" : "cursor-grab active:scale-[0.96] active:cursor-grabbing"
      } ${
        isDragging ? "opacity-30 ring-2 ring-blue-400" : ""
      }`}
      {...dragAttributes}
      {...dragListeners}
    >
      <IconImage iconFilename={specIcon ?? classInfo.iconUrl} alt={specLabel} fill style={{ objectFit: "cover" }} />
      {item.score !== null && item.score !== undefined && (
        <span className="absolute right-1 top-1 rounded-sm bg-black/75 px-1 text-[10px] font-bold tabular-nums shadow-sm" style={{ color: getParseColor(item.score) }}>
          {formatScore(item.score)}
        </span>
      )}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/70 to-transparent px-1.5 pb-1 pt-5">
        <div className="truncate text-center text-[11px] font-semibold leading-tight text-white">{item.name}</div>
      </div>
    </div>
  );
}

function SortableCharacterTile({ item }: { item: CharacterTierBoardItem }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.characterKey,
    animateLayoutChanges,
    data: { type: "character" },
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 30 : undefined,
  };

  return <CharacterTile item={item} dragRef={setNodeRef} dragAttributes={attributes} dragListeners={listeners} style={style} isDragging={isDragging} />;
}

function DroppableTierRow({
  id,
  label,
  characterKeys,
  charactersByKey,
}: {
  id: CustomCharacterTierName;
  label: string;
  characterKeys: string[];
  charactersByKey: Map<string, CharacterTierBoardItem>;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div ref={setNodeRef} className="flex border-b border-gray-800 last:border-b-0">
      <div className={`flex min-h-24 w-14 shrink-0 items-center justify-center px-2 text-center text-base font-black md:w-20 md:text-2xl ${CHARACTER_TIER_COLORS[id]}`}>{label}</div>
      <SortableContext items={characterKeys} strategy={rectSortingStrategy}>
        <div className={`flex min-h-24 flex-1 flex-wrap content-start gap-2 p-2 transition-colors ${isOver ? "bg-blue-950/30 ring-1 ring-inset ring-blue-400/60" : "bg-gray-900"}`}>
          {characterKeys.map((characterKey) => {
            const character = charactersByKey.get(characterKey);
            return character ? <SortableCharacterTile key={characterKey} item={character} /> : null;
          })}
        </div>
      </SortableContext>
    </div>
  );
}

function DroppableCharacterPool({
  id,
  label,
  characterKeys,
  charactersByKey,
}: {
  id: typeof UNPLACED;
  label: string;
  characterKeys: string[];
  charactersByKey: Map<string, CharacterTierBoardItem>;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <section ref={setNodeRef} className={`overflow-hidden rounded-lg border transition-colors ${isOver ? "border-blue-400" : "border-gray-700"}`}>
      <div className="flex min-h-10 items-center justify-between border-b border-gray-800 bg-gray-900 px-3">
        <h3 className="text-sm font-semibold text-gray-200">{label}</h3>
        <span className="text-xs tabular-nums text-gray-500">{characterKeys.length}</span>
      </div>
      <SortableContext items={characterKeys} strategy={rectSortingStrategy}>
        <div className={`flex min-h-24 flex-wrap content-start gap-2 p-2 transition-colors ${isOver ? "bg-blue-950/30 ring-1 ring-inset ring-blue-400/60" : "bg-gray-900"}`}>
          {characterKeys.map((characterKey) => {
            const character = charactersByKey.get(characterKey);
            return character ? <SortableCharacterTile key={characterKey} item={character} /> : null;
          })}
        </div>
      </SortableContext>
    </section>
  );
}

function toBoardItem(character: CustomCharacterTierListResponse["roster"][number]): CharacterTierBoardItem {
  return {
    characterKey: character.characterKey,
    name: character.name,
    realm: character.realm,
    region: character.region,
    classID: character.classID,
    reportCount: character.reportCount,
    score: character.score,
    parseScore: character.parseScore,
    survivalScore: character.survivalScore,
    role: character.role,
    metric: character.metric,
    specName: character.specName,
    bestSpecName: character.bestSpecName,
    pulls: character.pulls,
    deaths: character.deaths,
  };
}

function isContainerId(id: UniqueIdentifier | string): id is ContainerId {
  return id === UNPLACED || TIERS.includes(id as CustomCharacterTierName);
}

function findContainer(containers: Containers, id: UniqueIdentifier | string): ContainerId | null {
  const key = String(id);
  if (isContainerId(key)) return key;
  return (Object.entries(containers).find(([, keys]) => keys.includes(key))?.[0] as ContainerId | undefined) ?? null;
}

function getTargetIndex({
  activeId,
  activeRect,
  containers,
  over,
  overContainer,
}: {
  activeId: string;
  activeRect: DragOverEvent["active"]["rect"]["current"]["translated"];
  containers: Containers;
  over: DragOverEvent["over"];
  overContainer: ContainerId;
}) {
  if (!over || isContainerId(over.id)) {
    return containers[overContainer].length;
  }

  const overItems = containers[overContainer];
  const overIndex = overItems.indexOf(String(over.id));
  if (overIndex < 0) return overItems.length;
  if (!activeRect) return overIndex;

  const activeCenterX = activeRect.left + activeRect.width / 2;
  const activeCenterY = activeRect.top + activeRect.height / 2;
  const overCenterX = over.rect.left + over.rect.width / 2;
  const overCenterY = over.rect.top + over.rect.height / 2;
  const isSameRow = Math.abs(activeCenterY - overCenterY) < over.rect.height / 2;
  const isAfterOverItem = isSameRow ? activeCenterX > overCenterX : activeCenterY > overCenterY;
  const activeIndexInOverContainer = overItems.indexOf(activeId);
  const indexAdjustment = isAfterOverItem ? 1 : 0;

  if (activeIndexInOverContainer >= 0 && activeIndexInOverContainer < overIndex) {
    return overIndex + indexAdjustment - 1;
  }

  return overIndex + indexAdjustment;
}

function moveCharacter(containers: Containers, activeId: string, over: DragOverEvent["over"], activeRect: DragOverEvent["active"]["rect"]["current"]["translated"]): Containers {
  if (!over) return containers;

  const activeContainer = findContainer(containers, activeId);
  const overContainer = findContainer(containers, over.id);
  if (!activeContainer || !overContainer) return containers;

  const activeItems = containers[activeContainer];
  const activeIndex = activeItems.indexOf(activeId);
  if (activeIndex < 0) return containers;

  const targetIndex = getTargetIndex({ activeId, activeRect, containers, over, overContainer });

  if (activeContainer === overContainer) {
    const boundedTargetIndex = Math.max(0, Math.min(targetIndex, activeItems.length - 1));
    if (activeIndex === boundedTargetIndex) return containers;
    return { ...containers, [activeContainer]: arrayMove(activeItems, activeIndex, boundedTargetIndex) };
  }

  const nextActiveItems = activeItems.filter((key) => key !== activeId);
  const nextOverItems = [...containers[overContainer]];
  const boundedTargetIndex = Math.max(0, Math.min(targetIndex, nextOverItems.length));
  nextOverItems.splice(boundedTargetIndex, 0, activeId);

  return {
    ...containers,
    [activeContainer]: nextActiveItems,
    [overContainer]: nextOverItems,
  };
}

function buildInitialContainers(data: CustomCharacterTierListResponse): Containers {
  const containers: Containers = {
    S: [],
    A: [],
    B: [],
    C: [],
    D: [],
    E: [],
    F: [],
    [UNPLACED]: [...data.customList.unplacedCharacterKeys],
  };

  for (const bucket of data.customList.tiers) {
    containers[bucket.tier] = [...bucket.characterKeys];
  }

  return containers;
}

export default function CustomCharacterTierListMaker({ realm, name, raidId, data }: { realm: string; name: string; raidId: number; data: CustomCharacterTierListResponse }) {
  const t = useTranslations("characterTierListsPage");
  const { user, login } = useAuth();
  const queryClient = useQueryClient();
  const [containers, setContainers] = useState<Containers>(() => buildInitialContainers(data));
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dragStartContainers = useRef<Containers | null>(null);
  const lastOverId = useRef<UniqueIdentifier | null>(null);

  useEffect(() => {
    setContainers(buildInitialContainers(data));
    setMessage(null);
    setError(null);
  }, [data]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const characters = useMemo(() => data.roster.map(toBoardItem), [data.roster]);
  const charactersByKey = useMemo(() => new Map(characters.map((character) => [character.characterKey, character])), [characters]);
  const activeCharacter = activeId ? charactersByKey.get(activeId) : null;

  const collisionDetectionStrategy = useCallback<CollisionDetection>(
    (args) => {
      const pointerCollisions = pointerWithin(args);
      const intersectionCollisions = pointerCollisions.length > 0 ? pointerCollisions : rectIntersection(args);

      if (intersectionCollisions.length > 0) {
        lastOverId.current = getFirstCollision(intersectionCollisions, "id") ?? null;
        return intersectionCollisions;
      }

      const closestCollisions = closestCenter(args);
      if (closestCollisions.length > 0) {
        lastOverId.current = getFirstCollision(closestCollisions, "id") ?? null;
        return closestCollisions;
      }

      return lastOverId.current ? [{ id: lastOverId.current }] : [];
    },
    [],
  );

  const clearDragState = useCallback(() => {
    setActiveId(null);
    dragStartContainers.current = null;
    lastOverId.current = null;
  }, []);

  const handleDragStart = useCallback(
    ({ active }: DragStartEvent) => {
      const nextActiveId = String(active.id);
      dragStartContainers.current = containers;
      lastOverId.current = active.id;
      setActiveId(nextActiveId);
    },
    [containers],
  );

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;

    const currentActiveId = String(active.id);
    setContainers((current) => moveCharacter(current, currentActiveId, over, active.rect.current.translated));
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) {
      if (dragStartContainers.current) {
        setContainers(dragStartContainers.current);
      }
      clearDragState();
      return;
    }

    setContainers((current) => moveCharacter(current, String(active.id), over, active.rect.current.translated));
    clearDragState();
  }, [clearDragState]);

  const handleDragCancel = useCallback(() => {
    if (dragStartContainers.current) {
      setContainers(dragStartContainers.current);
    }
    clearDragState();
  }, [clearDragState]);

  const invalidateCustomList = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.characterTierLists.custom(realm, name, raidId) });
  };

  const handleSave = async () => {
    if (!user) {
      await login();
      return;
    }

    setIsSaving(true);
    setMessage(null);
    setError(null);

    try {
      await api.saveCustomCharacterTierList(realm, name, raidId, {
        tiers: TIERS.map((tier) => ({ tier, characterKeys: containers[tier] })),
        unplacedCharacterKeys: containers[UNPLACED],
      });
      await invalidateCustomList();
      setMessage(t("saved"));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t("saveFailed"));
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = async () => {
    setIsSaving(true);
    setMessage(null);
    setError(null);

    try {
      if (user && data.customList.saved) {
        await api.deleteCustomCharacterTierList(realm, name, raidId);
        await invalidateCustomList();
      } else {
        setContainers({
          S: [],
          A: [],
          B: [],
          C: [],
          D: [],
          E: [],
          F: [],
          [UNPLACED]: data.roster.map((character) => character.characterKey),
        });
      }
      setMessage(t("resetDone"));
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : t("resetFailed"));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-white">{t("myTierList")}</h2>
          <p className="text-sm text-gray-400">{t("customCount", { count: data.roster.length })}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!user && (
            <button type="button" onClick={login} className="min-h-10 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-blue-500">
              {t("signInToSave")}
            </button>
          )}
          <button
            type="button"
            onClick={handleReset}
            disabled={isSaving}
            className="min-h-10 rounded-md border border-gray-600 px-4 text-sm font-semibold text-gray-100 transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("reset")}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="min-h-10 rounded-md bg-emerald-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSaving ? t("saving") : t("save")}
          </button>
        </div>
      </div>

      {message && <div className="rounded-md border border-emerald-700 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-200">{message}</div>}
      {error && <div className="rounded-md border border-red-700 bg-red-950/40 px-3 py-2 text-sm text-red-200">{error}</div>}

      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetectionStrategy}
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="space-y-4">
          <div className="overflow-hidden rounded-lg border border-gray-700">
            {TIERS.map((tier) => (
              <DroppableTierRow key={tier} id={tier} label={tier} characterKeys={containers[tier]} charactersByKey={charactersByKey} />
            ))}
          </div>
          <DroppableCharacterPool id={UNPLACED} label={t("unplaced")} characterKeys={containers[UNPLACED]} charactersByKey={charactersByKey} />
        </div>
        <DragOverlay adjustScale={false} dropAnimation={{ duration: 180, easing: "cubic-bezier(0.2, 0, 0, 1)" }}>
          {activeCharacter ? <CharacterTile item={activeCharacter} isOverlay /> : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
