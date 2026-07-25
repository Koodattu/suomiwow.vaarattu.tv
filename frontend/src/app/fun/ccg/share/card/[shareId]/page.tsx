"use client";

import { useParams } from "next/navigation";
import CcgSharedView from "@/components/ccg/CcgSharedView";

export default function SharedCcgCardPage() {
  const { shareId } = useParams<{ shareId: string }>();
  return <CcgSharedView shareId={shareId} expectedKind="card" />;
}
