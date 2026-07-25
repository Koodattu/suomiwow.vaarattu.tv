"use client";

import { useParams } from "next/navigation";
import CcgSharedView from "@/components/ccg/CcgSharedView";

export default function SharedCcgPackPage() {
  const { shareId } = useParams<{ shareId: string }>();
  return <CcgSharedView shareId={shareId} expectedKind="pack" />;
}
