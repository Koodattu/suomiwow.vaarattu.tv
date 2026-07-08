"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FaCopy, FaShareAlt } from "react-icons/fa";
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
import { CHARACTER_TIER_COLORS, CharacterTierCard } from "@/components/character-tier-lists/CharacterTierBoard";
import type { CharacterTierBoardItem } from "@/components/character-tier-lists/CharacterTierBoard";
import type { CustomCharacterTierListResponse, CustomCharacterTierName, SaveCustomCharacterTierListInput } from "@/types";

const TIERS: CustomCharacterTierName[] = ["S", "A", "B", "C", "D", "E", "F"];
const UNPLACED = "unplaced";
type ContainerId = CustomCharacterTierName | typeof UNPLACED;
type Containers = Record<ContainerId, string[]>;

const animateLayoutChanges: AnimateLayoutChanges = (args) => defaultAnimateLayoutChanges({ ...args, wasDragging: true });

function getSharedTierListPath({ realm, name, raidId, shareId }: { realm: string; name: string; raidId: number; shareId: string }): string {
  return `/guilds/${encodeURIComponent(realm)}/${encodeURIComponent(name)}/raids/${raidId}/tierlist/shared/${encodeURIComponent(shareId)}`;
}

function getSharedTierListUrl(params: { realm: string; name: string; raidId: number; shareId: string }): string {
  const path = getSharedTierListPath(params);
  return typeof window === "undefined" ? path : `${window.location.origin}${path}`;
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

  return <CharacterTierCard item={item} link={false} dragRef={setNodeRef} dragAttributes={attributes} dragListeners={listeners} style={style} isDragging={isDragging} showScore={false} />;
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

function ReadOnlyTierRow({
  tier,
  characterKeys,
  charactersByKey,
}: {
  tier: CustomCharacterTierName;
  characterKeys: string[];
  charactersByKey: Map<string, CharacterTierBoardItem>;
}) {
  return (
    <div className="flex border-b border-gray-800 last:border-b-0">
      <div className={`flex min-h-24 w-14 shrink-0 items-center justify-center px-2 text-center text-base font-black md:w-20 md:text-2xl ${CHARACTER_TIER_COLORS[tier]}`}>{tier}</div>
      <div className="flex min-h-24 flex-1 flex-wrap content-start gap-2 bg-gray-900 p-2">
        {characterKeys.map((characterKey) => {
          const character = charactersByKey.get(characterKey);
          return character ? <CharacterTierCard key={characterKey} item={character} link={false} isStatic showScore={false} /> : null;
        })}
      </div>
    </div>
  );
}

function ReadOnlyCharacterPool({
  label,
  characterKeys,
  charactersByKey,
}: {
  label: string;
  characterKeys: string[];
  charactersByKey: Map<string, CharacterTierBoardItem>;
}) {
  if (characterKeys.length === 0) return null;

  return (
    <section className="overflow-hidden rounded-lg border border-gray-700">
      <div className="flex min-h-10 items-center justify-between border-b border-gray-800 bg-gray-900 px-3">
        <h3 className="text-sm font-semibold text-gray-200">{label}</h3>
        <span className="text-xs tabular-nums text-gray-500">{characterKeys.length}</span>
      </div>
      <div className="flex min-h-24 flex-wrap content-start gap-2 bg-gray-900 p-2">
        {characterKeys.map((characterKey) => {
          const character = charactersByKey.get(characterKey);
          return character ? <CharacterTierCard key={characterKey} item={character} link={false} isStatic showScore={false} /> : null;
        })}
      </div>
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

export function CharacterTierListSnapshotBoard({ data }: { data: CustomCharacterTierListResponse }) {
  const t = useTranslations("characterTierListsPage");
  const containers = useMemo(() => buildInitialContainers(data), [data]);
  const characters = useMemo(() => data.roster.map(toBoardItem), [data.roster]);
  const charactersByKey = useMemo(() => new Map(characters.map((character) => [character.characterKey, character])), [characters]);

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-lg border border-gray-700">
        {TIERS.map((tier) => (
          <ReadOnlyTierRow key={tier} tier={tier} characterKeys={containers[tier]} charactersByKey={charactersByKey} />
        ))}
      </div>
      <ReadOnlyCharacterPool label={t("unplaced")} characterKeys={containers[UNPLACED]} charactersByKey={charactersByKey} />
    </div>
  );
}

export default function CustomCharacterTierListMaker({
  realm,
  name,
  raidId,
  data,
  sourceShareId,
  canUpdateSharedList = false,
}: {
  realm: string;
  name: string;
  raidId: number;
  data: CustomCharacterTierListResponse;
  sourceShareId?: string | null;
  canUpdateSharedList?: boolean;
}) {
  const t = useTranslations("characterTierListsPage");
  const { user, login } = useAuth();
  const queryClient = useQueryClient();
  const [containers, setContainers] = useState<Containers>(() => buildInitialContainers(data));
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(() =>
    sourceShareId ? getSharedTierListUrl({ realm: data.guild.realm, name: data.guild.name, raidId: data.raid.id, shareId: sourceShareId }) : null,
  );
  const [shareCopied, setShareCopied] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dragStartContainers = useRef<Containers | null>(null);
  const lastOverId = useRef<UniqueIdentifier | null>(null);

  useEffect(() => {
    setContainers(buildInitialContainers(data));
    setShareUrl(sourceShareId ? getSharedTierListUrl({ realm: data.guild.realm, name: data.guild.name, raidId: data.raid.id, shareId: sourceShareId }) : null);
    setShareCopied(false);
    setMessage(null);
    setError(null);
  }, [data, sourceShareId]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const characters = useMemo(() => data.roster.map(toBoardItem), [data.roster]);
  const charactersByKey = useMemo(() => new Map(characters.map((character) => [character.characterKey, character])), [characters]);
  const activeCharacter = activeId ? charactersByKey.get(activeId) : null;
  const shareButtonLabel = sourceShareId && canUpdateSharedList ? t("updateSharedLink") : t("share");

  const getCurrentPayload = useCallback(
    (): SaveCustomCharacterTierListInput => ({
      tiers: TIERS.map((tier) => ({ tier, characterKeys: containers[tier] })),
      unplacedCharacterKeys: containers[UNPLACED],
    }),
    [containers],
  );

  const copyShareUrl = useCallback(async (nextShareUrl: string) => {
    if (!navigator.clipboard) return;
    await navigator.clipboard.writeText(nextShareUrl);
    setShareCopied(true);
  }, []);

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
      await api.saveCustomCharacterTierList(realm, name, raidId, getCurrentPayload());
      await invalidateCustomList();
      setMessage(t("saved"));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t("saveFailed"));
    } finally {
      setIsSaving(false);
    }
  };

  const handleShare = async () => {
    setIsSharing(true);
    setShareCopied(false);
    setMessage(null);
    setError(null);

    try {
      const shared = sourceShareId && canUpdateSharedList ? await api.updateSharedCharacterTierList(sourceShareId, getCurrentPayload()) : await api.createSharedCharacterTierList(realm, name, raidId, getCurrentPayload());
      await queryClient.invalidateQueries({ queryKey: queryKeys.characterTierLists.shared(shared.share.shareId) });

      const nextShareUrl = getSharedTierListUrl({
        realm: shared.guild.realm,
        name: shared.guild.name,
        raidId: shared.raid.id,
        shareId: shared.share.shareId,
      });
      setShareUrl(nextShareUrl);
      setMessage(t(sourceShareId && canUpdateSharedList ? "sharedLinkUpdated" : "sharedLinkReady"));

      try {
        await copyShareUrl(nextShareUrl);
      } catch {
        setShareCopied(false);
      }
    } catch (shareError) {
      setError(shareError instanceof Error ? shareError.message : t("shareFailed"));
    } finally {
      setIsSharing(false);
    }
  };

  const handleReset = async () => {
    setIsSaving(true);
    setMessage(null);
    setError(null);

    try {
      if (sourceShareId) {
        setContainers(buildInitialContainers(data));
      } else if (user && data.customList.saved) {
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
          <button
            type="button"
            onClick={handleShare}
            disabled={isSharing}
            className="inline-flex min-h-10 items-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white transition-[scale,background-color] duration-150 ease-out hover:bg-blue-500 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100"
          >
            <FaShareAlt className="h-3.5 w-3.5" aria-hidden="true" />
            {isSharing ? t("sharing") : shareButtonLabel}
          </button>
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
      {shareUrl && (
        <div className="flex flex-col gap-2 rounded-md border border-gray-700 bg-gray-900 p-3 sm:flex-row sm:items-center">
          <input
            readOnly
            value={shareUrl}
            onFocus={(event) => event.currentTarget.select()}
            className="min-h-10 min-w-0 flex-1 rounded-md border border-gray-700 bg-gray-950 px-3 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            aria-label={t("sharedLink")}
          />
          <button
            type="button"
            onClick={async () => {
              try {
                await copyShareUrl(shareUrl);
              } catch {
                setShareCopied(false);
              }
            }}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-gray-600 px-4 text-sm font-semibold text-gray-100 transition-[scale,background-color] duration-150 ease-out hover:bg-gray-800 active:scale-[0.96]"
          >
            <FaCopy className="h-3.5 w-3.5" aria-hidden="true" />
            {shareCopied ? t("copied") : t("copyLink")}
          </button>
        </div>
      )}

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
          {activeCharacter ? <CharacterTierCard item={activeCharacter} link={false} isOverlay showScore={false} /> : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
