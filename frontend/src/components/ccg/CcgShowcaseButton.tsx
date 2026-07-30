"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { FaStar } from "react-icons/fa6";
import type { CcgArtVariant, CcgFinish, CcgShowcaseCardInput } from "@/types";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { queryKeys, useCcgLeaderboardMe } from "@/lib/queries";
import styles from "./ccg.module.css";

export default function CcgShowcaseButton({
  cardId,
  snapshotCardIds,
  finish,
  artVariant,
}: {
  cardId: string;
  snapshotCardIds: string[];
  finish: CcgFinish;
  artVariant: CcgArtVariant;
}) {
  const t = useTranslations("ccg.leaderboard.showcase");
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const meQuery = useCcgLeaderboardMe(Boolean(user));
  const current = meQuery.data?.showcase ?? [];
  const snapshotCardIdSet = new Set([cardId, ...snapshotCardIds]);
  const selected = current.some((item) => snapshotCardIdSet.has(item.card.id));
  const mutation = useMutation({
    mutationFn: (cards: CcgShowcaseCardInput[]) => api.updateCcgShowcase(cards),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.ccg.leaderboardMe, data);
      void queryClient.invalidateQueries({ queryKey: queryKeys.ccg.leaderboard });
      void queryClient.invalidateQueries({ queryKey: ["ccg", "collection"] });
    },
  });

  if (!user || (!meQuery.data && !meQuery.isPending)) return null;
  const displayedSelected = mutation.isPending && mutation.variables
    ? mutation.variables.some((item) => snapshotCardIdSet.has(item.cardId))
    : selected;
  const full = !selected && current.length >= 3;
  const label = full ? t("full") : displayedSelected ? t("unfavorite") : t("favorite");

  return (
    <button
      type="button"
      className={styles.showcaseButton}
      aria-pressed={displayedSelected}
      aria-label={label}
      aria-busy={mutation.isPending}
      data-pending={mutation.isPending || undefined}
      disabled={meQuery.isPending || mutation.isPending || full}
      title={mutation.isError ? t("error") : label}
      onClick={() => {
        const cards: CcgShowcaseCardInput[] = selected
          ? current.filter((item) => !snapshotCardIdSet.has(item.card.id)).map((item) => ({
              cardId: item.card.id,
              finish: item.finish,
              artVariant: item.artVariant,
            }))
          : [
              ...current.map((item) => ({ cardId: item.card.id, finish: item.finish, artVariant: item.artVariant })),
              { cardId, finish, artVariant },
            ];
        mutation.mutate(cards);
      }}
    >
      <FaStar aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}
