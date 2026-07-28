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
  finish,
  artVariant,
}: {
  cardId: string;
  finish: CcgFinish;
  artVariant: CcgArtVariant;
}) {
  const t = useTranslations("ccg.leaderboard.showcase");
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const meQuery = useCcgLeaderboardMe(Boolean(user));
  const current = meQuery.data?.showcase ?? [];
  const selected = current.some((item) => item.card.id === cardId);
  const full = !selected && current.length >= 3;
  const mutation = useMutation({
    mutationFn: (cards: CcgShowcaseCardInput[]) => api.updateCcgShowcase(cards),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.ccg.leaderboardMe, data);
      void queryClient.invalidateQueries({ queryKey: queryKeys.ccg.leaderboard });
    },
  });

  if (!user || (!meQuery.data && !meQuery.isPending)) return null;
  const label = mutation.isPending
    ? t("saving")
    : mutation.isError
      ? t("error")
      : selected
        ? t("remove")
        : full
          ? t("full")
          : t("add");

  return (
    <button
      type="button"
      className={`${styles.secondaryButton} ${styles.showcaseButton}`}
      aria-pressed={selected}
      disabled={meQuery.isPending || mutation.isPending || full}
      title={label}
      onClick={() => {
        const cards: CcgShowcaseCardInput[] = selected
          ? current.filter((item) => item.card.id !== cardId).map((item) => ({
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
