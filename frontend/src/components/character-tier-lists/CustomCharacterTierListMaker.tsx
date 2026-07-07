"use client";

import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { DndContext, DragEndEvent, KeyboardSensor, PointerSensor, closestCenter, useDroppable, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/queries";
import { useAuth } from "@/context/AuthContext";
import CharacterTierBoard, { CharacterTierBoardItem, CharacterTierCard } from "@/components/character-tier-lists/CharacterTierBoard";
import type { CustomCharacterTierListResponse, CustomCharacterTierName } from "@/types";

const TIERS: CustomCharacterTierName[] = ["S", "A", "B", "C", "D", "E", "F"];
const UNPLACED = "unplaced";
type ContainerId = CustomCharacterTierName | typeof UNPLACED;

function SortableCharacter({ item }: { item: CharacterTierBoardItem }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.characterKey });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 30 : undefined,
  };

  return <CharacterTierCard item={item} dragRef={setNodeRef} dragAttributes={attributes} dragListeners={listeners} style={style} isDragging={isDragging} link={false} />;
}

function DroppableTier({
  id,
  label,
  characterKeys,
  charactersByKey,
}: {
  id: ContainerId;
  label: string;
  characterKeys: string[];
  charactersByKey: Map<string, CharacterTierBoardItem>;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div ref={setNodeRef} className={`rounded-lg border ${isOver ? "border-blue-400 bg-blue-950/20" : "border-gray-700 bg-gray-900"} transition-colors`}>
      <div className="border-b border-gray-700 px-3 py-2 text-sm font-semibold text-gray-200">{label}</div>
      <SortableContext items={characterKeys} strategy={verticalListSortingStrategy}>
        <div className="flex min-h-20 flex-col gap-2 p-2">
          {characterKeys.map((characterKey) => {
            const character = charactersByKey.get(characterKey);
            return character ? <SortableCharacter key={characterKey} item={character} /> : null;
          })}
        </div>
      </SortableContext>
    </div>
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

function buildInitialContainers(data: CustomCharacterTierListResponse): Record<ContainerId, string[]> {
  const containers: Record<ContainerId, string[]> = {
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
  const [containers, setContainers] = useState<Record<ContainerId, string[]>>(() => buildInitialContainers(data));
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
  const generatedCharacters = useMemo(() => characters.filter((character) => character.score !== null), [characters]);

  const findContainer = (id: string): ContainerId | null => {
    if (id === UNPLACED || TIERS.includes(id as CustomCharacterTierName)) return id as ContainerId;
    return (Object.entries(containers).find(([, keys]) => keys.includes(id))?.[0] as ContainerId | undefined) ?? null;
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;

    const activeId = String(active.id);
    const overId = String(over.id);
    const activeContainer = findContainer(activeId);
    const overContainer = findContainer(overId);
    if (!activeContainer || !overContainer) return;

    setContainers((current) => {
      const activeItems = current[activeContainer];
      const overItems = current[overContainer];
      const activeIndex = activeItems.indexOf(activeId);
      if (activeIndex < 0) return current;

      if (activeContainer === overContainer) {
        const overIndex = overItems.indexOf(overId);
        if (overIndex < 0 || activeIndex === overIndex) return current;
        return { ...current, [activeContainer]: arrayMove(activeItems, activeIndex, overIndex) };
      }

      const nextActiveItems = activeItems.filter((key) => key !== activeId);
      const nextOverItems = [...overItems];
      const overIndex = nextOverItems.indexOf(overId);
      nextOverItems.splice(overIndex >= 0 ? overIndex : nextOverItems.length, 0, activeId);

      return {
        ...current,
        [activeContainer]: nextActiveItems,
        [overContainer]: nextOverItems,
      };
    });
  };

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

      {generatedCharacters.length > 0 && <CharacterTierBoard title={t("generatedBaseline")} characters={generatedCharacters} emptyMessage={t("noScoredCharacters")} />}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
          <div className="grid gap-3">
            {TIERS.map((tier) => (
              <DroppableTier key={tier} id={tier} label={tier} characterKeys={containers[tier]} charactersByKey={charactersByKey} />
            ))}
          </div>
          <DroppableTier id={UNPLACED} label={t("unplaced")} characterKeys={containers[UNPLACED]} charactersByKey={charactersByKey} />
        </div>
      </DndContext>
    </div>
  );
}
