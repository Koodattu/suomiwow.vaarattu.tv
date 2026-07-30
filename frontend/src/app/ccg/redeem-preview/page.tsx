"use client";

import { useSearchParams } from "next/navigation";
import { CcgRedeemRewardDialog } from "@/components/ccg/CcgRedeemPanel";
import { useCcgSets } from "@/lib/queries";
import type { CcgRedeemResult } from "@/types";

export default function RedeemPreviewPage() {
  const searchParams = useSearchParams();
  const count = Math.max(1, Math.min(100, Number(searchParams.get("count")) || 1));
  const sets = useCcgSets().data?.sets ?? [];
  const result = { code: "PREVIEW", reward: { type: "packs", packs: count } } as CcgRedeemResult;

  return (
    <CcgRedeemRewardDialog
      result={result}
      sets={sets}
      isInspectingCard={false}
      onDismiss={() => undefined}
      onInspectCard={() => undefined}
    />
  );
}
